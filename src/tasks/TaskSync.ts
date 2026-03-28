import { logger } from '../utils/logger.js';
import type { GitHubService } from '../github/GitHubService.js';
import type { Task } from '../types.js';
import { taskEngine } from './TaskEngine.js';

// ---------------------------------------------------------------------------
// TaskSync
// ---------------------------------------------------------------------------

/**
 * Synchronises the local task queue with GitHub Issues on a polling schedule.
 *
 * ### Responsibilities
 * - Fetch open issues every `pollIntervalMs` milliseconds and enqueue any
 *   new ones as `backlog` tasks.
 * - Mark tasks as `done` when their backing issue has been closed on GitHub.
 * - Poll PR status for tasks in the `review` state; transition them to
 *   `done` once the PR is merged.
 *
 * ### Usage
 * ```ts
 * const sync = new TaskSync(githubService);
 * sync.start();
 * // … later …
 * sync.stop();
 * ```
 */
export class TaskSync {
  private intervalHandle: NodeJS.Timeout | null = null;
  private readonly service: GitHubService;
  private readonly pollIntervalMs: number;
  /** Stable base path used to populate `Task.repoPath`. */
  private readonly repoPath: string;

  /**
   * @param service         - Authenticated {@link GitHubService} instance.
   * @param pollIntervalMs  - How often to poll GitHub (default: 60 000 ms).
   * @param repoPath        - Working-tree root to stamp on newly created tasks.
   */
  constructor(
    service: GitHubService,
    pollIntervalMs = 60_000,
    repoPath = process.cwd()
  ) {
    this.service = service;
    this.pollIntervalMs = pollIntervalMs;
    this.repoPath = repoPath;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Starts the polling loop, running an initial sync immediately.
   */
  start(): void {
    void this.sync();
    this.intervalHandle = setInterval(() => void this.sync(), this.pollIntervalMs);
    logger.info({ pollIntervalMs: this.pollIntervalMs }, 'TaskSync started');
  }

  /**
   * Stops the polling loop. No-op if already stopped.
   */
  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      logger.info('TaskSync stopped');
    }
  }

  // ---------------------------------------------------------------------------
  // Core sync logic
  // ---------------------------------------------------------------------------

  /**
   * Fetches open GitHub Issues, reconciles them with the task queue, and polls
   * any in-review PRs for merge status.
   */
  async sync(): Promise<void> {
    logger.debug('TaskSync: starting sync cycle');
    try {
      await this.syncIssues();
      await this.syncPRStatus();
    } catch (err) {
      logger.warn({ err }, 'TaskSync: sync cycle failed');
    }
  }

  private async syncIssues(): Promise<void> {
    const summaries = await this.service.listIssues({ state: 'open' });
    const openIssueIds = new Set(summaries.map((i) => `issue-${i.issueNumber}`));

    // Enqueue / update all open issues.
    // IssueSummary does not carry `body` or `createdAt`; use sensible defaults.
    for (const summary of summaries) {
      const task: Task = {
        id: `issue-${summary.issueNumber}`,
        issueNumber: summary.issueNumber,
        title: summary.title,
        body: '',
        labels: summary.labels,
        status: 'backlog',
        repoPath: this.repoPath,
        createdAt: summary.updatedAt,
        updatedAt: summary.updatedAt,
      };
      taskEngine.enqueue(task);
    }

    // Mark tasks whose issues have since been closed.
    for (const task of taskEngine.getQueue()) {
      if (!openIssueIds.has(task.id) && task.status !== 'done') {
        taskEngine.markComplete(task.id, { success: true });
        logger.info({ taskId: task.id }, 'TaskSync: issue closed — task marked done');
      }
    }

    logger.debug({ issueCount: summaries.length }, 'TaskSync: issue sync complete');
  }

  private async syncPRStatus(): Promise<void> {
    const reviewTasks = taskEngine.getQueue().filter(
      (t) => t.status === 'review' && t.prNumber !== undefined
    );

    await Promise.allSettled(
      reviewTasks.map(async (task) => {
        try {
          const pr = await this.service.getPullRequest(task.prNumber!);
          if (pr.status === 'merged') {
            taskEngine.markComplete(task.id, {
              success: true,
              prNumber: task.prNumber,
              prUrl: pr.url,
            });
            logger.info(
              { taskId: task.id, prNumber: task.prNumber },
              'TaskSync: PR merged — task marked done'
            );
          }
        } catch (err) {
          logger.debug({ taskId: task.id, err }, 'TaskSync: PR status check failed');
        }
      })
    );
  }
}
