import { AgentAdapter, AgentError, type TaskCompleteResult } from './AgentAdapter.js';
import { GitService } from '../git/GitService.js';
import { GitHubWriteService } from '../github/GitHubWriteService.js';
import { taskEngine } from '../tasks/TaskEngine.js';
import { logger } from '../utils/logger.js';
import type { AgentConfig, AgentStatus, Task } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Converts a free-form title to a safe kebab-case branch slug (≤ 40 chars).
 * Non-alphanumeric sequences are replaced with `-`; leading/trailing dashes
 * and any trailing dash after truncation are removed.
 */
export function toKebab(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}

// ---------------------------------------------------------------------------
// AgentPRWrapper
// ---------------------------------------------------------------------------

/**
 * Decorator that wraps any {@link AgentAdapter} to enforce the NEXUS PR workflow:
 *
 * ### Before `dispatch`
 * Creates a feature branch `nexus/task-{issueNumber}-{kebab-title}` in the
 * task's repository via the provided {@link GitService} factory.
 *
 * ### After `task_complete`
 * 1. Verifies the branch has at least one commit ahead of `main`.
 * 2. Pushes the branch to `origin`.
 * 3. Opens a PR via {@link GitHubWriteService.createPR}.
 * 4. Comments on the issue: `"🤖 PR opened by {agentId}: {prUrl}"`.
 * 5. Transitions the task status to `review`.
 *
 * On any failure the task is marked `error` and the failure is surfaced via a
 * log line (visible in the LogPanel). The `task_complete` event is always
 * forwarded so downstream listeners are never blocked.
 *
 * ### Event forwarding
 * `status` and `log` events from the inner adapter are forwarded transparently.
 * `task_complete` is intercepted and re-emitted only after the full PR flow
 * completes (or fails).
 */
export class AgentPRWrapper extends AgentAdapter {
  constructor(
    private readonly inner: AgentAdapter,
    /** Factory that returns a GitService for a given repository root path. */
    private readonly gitServiceFactory: (repoPath: string) => GitService,
    private readonly writeService: GitHubWriteService,
    config: AgentConfig
  ) {
    super(config);

    // Forward status and log events so AgentManager sees them transparently.
    this.inner.on('status', (status: AgentStatus) => {
      this.setStatus(status);
    });
    this.inner.on('log', (line: string) => {
      // Re-emit raw — the inner adapter already prefixed the log line with [agentId].
      this.emit('log', line);
    });
    // task_complete is intentionally NOT forwarded here; it is intercepted in dispatch().
  }

  // ---------------------------------------------------------------------------
  // Lifecycle — delegate to inner
  // ---------------------------------------------------------------------------

  async connect(): Promise<void> {
    await this.inner.connect();
  }

  async disconnect(): Promise<void> {
    await this.inner.disconnect();
  }

  // ---------------------------------------------------------------------------
  // Dispatch — branch creation + PR workflow
  // ---------------------------------------------------------------------------

  async dispatch(task: Task): Promise<void> {
    if (this.session.status !== 'idle') {
      throw new AgentError(
        `Agent '${this.id}' is not idle (status: ${this.session.status})`,
        this.id
      );
    }

    const branchName = `nexus/task-${task.issueNumber}-${toKebab(task.title)}`;
    const git = this.gitServiceFactory(task.repoPath);

    // Step 1: Create the feature branch before delegating the task.
    try {
      await git.createBranch(branchName);
      this.emit('log', `[${this.id}] Created branch: ${branchName}`);
      logger.info({ agentId: this.id, branchName }, 'AgentPRWrapper: branch created');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ agentId: this.id, branchName, err }, 'AgentPRWrapper: failed to create branch');
      this.emit('log', `[${this.id}] Failed to create branch '${branchName}': ${msg}`);
      taskEngine.markFailed(task.id);
      throw new AgentError(`Failed to create branch '${branchName}': ${msg}`, this.id);
    }

    // Step 2: Wire a one-shot task_complete listener BEFORE dispatching so we
    //         never miss the event even if the inner adapter fires synchronously.
    this.inner.once('task_complete', () => {
      void this.runPRFlow(task, branchName, git);
    });

    // Step 3: Delegate to the inner adapter.
    await this.inner.dispatch(task);
  }

  // ---------------------------------------------------------------------------
  // PR flow (runs asynchronously after task_complete from inner)
  // ---------------------------------------------------------------------------

  private async runPRFlow(task: Task, branchName: string, git: GitService): Promise<void> {
    try {
      // a. Verify the branch has at least one commit ahead of main.
      const ahead = await git.getCommitsAheadOf('main');
      if (ahead === 0) {
        const reason = `Branch '${branchName}' has no commits ahead of main — skipping PR`;
        logger.warn({ agentId: this.id, branchName }, `AgentPRWrapper: ${reason}`);
        this.emit('log', `[${this.id}] ${reason}`);
        taskEngine.markFailed(task.id);
        this.emit('task_complete', {} as TaskCompleteResult);
        return;
      }

      // b. Push the branch.
      await git.pushBranch(branchName);
      this.emit('log', `[${this.id}] Pushed branch: ${branchName}`);

      // c. Open the PR.
      const pr = await this.writeService.createPR({
        title: `[NEXUS] ${task.title}`,
        body: `Closes #${task.issueNumber}\n\nOpened automatically by NEXUS agent \`${this.id}\`.`,
        head: branchName,
        base: 'main',
      });
      this.emit('log', `[${this.id}] Opened PR #${pr.prNumber}: ${pr.url}`);
      logger.info(
        { agentId: this.id, prNumber: pr.prNumber, prUrl: pr.url },
        'AgentPRWrapper: PR created'
      );

      // d. Comment on the issue.
      await this.writeService.addComment(
        task.issueNumber,
        `🤖 PR opened by ${this.id}: ${pr.url}`
      );

      // e. Transition task to review and forward enriched task_complete.
      taskEngine.markComplete(task.id, { success: true, prUrl: pr.url, prNumber: pr.prNumber });
      this.emit('task_complete', { prUrl: pr.url, prNumber: pr.prNumber });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ agentId: this.id, taskId: task.id, err }, 'AgentPRWrapper: PR flow failed');
      this.emit('log', `[${this.id}] PR flow failed: ${msg}`);
      taskEngine.markFailed(task.id);
      // Always emit task_complete so upstream listeners (useTaskStore, AgentManager) are unblocked.
      this.emit('task_complete', {} as TaskCompleteResult);
    }
  }
}
