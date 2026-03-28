import { execa } from 'execa';
import { AgentAdapter, AgentError } from './AgentAdapter.js';
import { logger } from '../utils/logger.js';
import type { AgentConfig, Task } from '../types.js';

/** Timeout (ms) used when verifying the `claude` CLI is available. */
const CONNECT_TIMEOUT_MS = 10_000;

/** The type of the subprocess returned by execa. */
type ExecaProcess = ReturnType<typeof execa>;

/**
 * Agent adapter for the `claude` CLI.
 *
 * `connect()` verifies the binary is on `PATH`.
 * `dispatch()` spawns `claude -p "<prompt>"` per task and streams
 * stdout / stderr as `'log'` events.
 */
export class ClaudeAdapter extends AgentAdapter {
  private activeProcess: ExecaProcess | null = null;

  constructor(config: AgentConfig) {
    super(config);
  }

  /**
   * Verifies the `claude` CLI is on `PATH` and sets status to `idle`.
   *
   * @throws {AgentError} If the binary is not found or times out.
   */
  async connect(): Promise<void> {
    try {
      await execa('claude', ['--version'], { timeout: CONNECT_TIMEOUT_MS });
      this.session = { ...this.session, connectedAt: new Date(), pid: undefined };
      this.setStatus('idle');
      this.emitLog('claude CLI verified — agent ready');
      logger.info({ agentId: this.id }, 'ClaudeAdapter connected');
    } catch (err) {
      this.setStatus('error');
      logger.error({ agentId: this.id, err }, 'ClaudeAdapter connect failed');
      throw new AgentError(
        `Failed to connect claude agent '${this.id}': ${String(err)}`,
        this.id
      );
    }
  }

  /**
   * Kills any active task process and sets status to `disconnected`.
   */
  async disconnect(): Promise<void> {
    if (this.activeProcess) {
      try {
        this.activeProcess.kill();
      } catch {
        // Process may have already exited — ignore.
      }
      this.activeProcess = null;
    }
    this.session = { ...this.session, currentTask: undefined, pid: undefined };
    this.setStatus('disconnected');
    this.emitLog('Disconnected');
    logger.info({ agentId: this.id }, 'ClaudeAdapter disconnected');
  }

  /**
   * Spawns `claude -p "<prompt>"` in the agent's working directory.
   * Streams output as log events. Emits `'task_complete'` when the
   * process exits with code 0.
   *
   * @param task - The task to dispatch.
   * @throws {AgentError} If the agent is not idle or the process fails.
   */
  async dispatch(task: Task): Promise<void> {
    if (this.session.status !== 'idle') {
      throw new AgentError(
        `Agent '${this.id}' is not idle (status: ${this.session.status})`,
        this.id
      );
    }

    const workdir = this.session.workdir ?? process.cwd();
    const prompt = buildPrompt(task);

    this.session = { ...this.session, currentTask: task.id };
    this.setStatus('working');
    this.emitLog(`Dispatching task #${task.issueNumber}: ${task.title}`);

    const subprocess = execa('claude', ['-p', prompt], {
      cwd: workdir,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    this.activeProcess = subprocess;
    if (subprocess.pid !== undefined) {
      this.session = { ...this.session, pid: subprocess.pid };
    }

    pipeStream(subprocess.stdout, (line) => this.emitLog(line));
    pipeStream(subprocess.stderr, (line) => this.emitLog(`[stderr] ${line}`));

    try {
      await subprocess;
      this.activeProcess = null;
      this.session = {
        ...this.session,
        currentTask: undefined,
        pid: undefined,
        lastSeen: new Date(),
      };
      this.setStatus('idle');
      this.emitLog(`Task #${task.issueNumber} completed`);
      this.emit('task_complete', {});
      logger.info({ agentId: this.id, taskId: task.id }, 'Task completed');
    } catch (err) {
      this.activeProcess = null;
      this.session = { ...this.session, currentTask: undefined, pid: undefined };
      this.setStatus('error');
      this.emitLog(`Task #${task.issueNumber} failed: ${String(err)}`);
      logger.error({ agentId: this.id, taskId: task.id, err }, 'Task failed');
      throw new AgentError(
        `Task dispatch failed for agent '${this.id}': ${String(err)}`,
        this.id
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

/**
 * Pipes data events from a Node.js Readable (or null) into a string callback.
 * Each non-empty line is passed to `onLine` individually.
 */
function pipeStream(
  stream: NodeJS.ReadableStream | null | undefined,
  onLine: (line: string) => void
): void {
  if (!stream) return;
  stream.on('data', (chunk: Buffer | string) => {
    const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk;
    for (const line of text.split('\n')) {
      const trimmed = line.trimEnd();
      if (trimmed) onLine(trimmed);
    }
  });
}

/**
 * Builds the `-p` prompt string sent to `claude` for a given task.
 */
function buildPrompt(task: Task): string {
  return [
    `Task #${task.issueNumber}: ${task.title}`,
    '',
    task.body,
    '',
    `Repository path: ${task.repoPath}`,
  ].join('\n');
}
