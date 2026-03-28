import { EventEmitter } from 'events';
import type { AgentConfig, AgentSession, AgentStatus, Task } from '../types.js';

// ---------------------------------------------------------------------------
// Shared result / error types
// ---------------------------------------------------------------------------

/** Result payload emitted with the `'task_complete'` event. */
export interface TaskCompleteResult {
  /** GitHub PR URL opened by the agent, if any. */
  prUrl?: string;
  /** GitHub PR number opened by the agent, if any. */
  prNumber?: number;
}

/**
 * Thrown by adapter methods when an agent operation fails.
 */
export class AgentError extends Error {
  constructor(
    message: string,
    /** The ID of the agent that produced this error. */
    public readonly agentId: string
  ) {
    super(message);
    this.name = 'AgentError';
  }
}

// ---------------------------------------------------------------------------
// Abstract base class
// ---------------------------------------------------------------------------

/**
 * Abstract base class for all NEXUS agent adapters.
 *
 * Subclasses handle one agent type (claude, codex, openclaw, …) and wire up
 * the process/socket lifecycle to the shared event protocol below.
 *
 * ### Events emitted
 * | Event | Payload | Description |
 * |-------|---------|-------------|
 * | `'status'` | `AgentStatus` | Agent status changed |
 * | `'log'`    | `string`       | One log line from the agent process |
 * | `'task_complete'` | `TaskCompleteResult` | Task finished successfully |
 *
 * Consumers subscribe using the standard Node.js `EventEmitter` API:
 * ```ts
 * adapter.on('log', (line) => console.log(line));
 * adapter.on('task_complete', ({ prUrl }) => { ... });
 * ```
 */
export abstract class AgentAdapter extends EventEmitter {
  protected session: AgentSession;

  /**
   * @param config - Static agent configuration from `nexus.config.json`.
   */
  constructor(config: AgentConfig) {
    super();
    this.session = { ...config, status: 'disconnected' };
  }

  // ---------------------------------------------------------------------------
  // Public read-only surface
  // ---------------------------------------------------------------------------

  /** Unique identifier for this agent (mirrors `config.id`). */
  get id(): string {
    return this.session.id;
  }

  /**
   * Returns a shallow copy of the current runtime session state.
   * Mutations to the returned object do not affect the adapter.
   */
  getSession(): AgentSession {
    return { ...this.session };
  }

  // ---------------------------------------------------------------------------
  // Abstract lifecycle methods — must be implemented by subclasses
  // ---------------------------------------------------------------------------

  /**
   * Establishes the agent connection (verifies CLI, opens socket, etc.).
   * Implementations **must** call `this.setStatus('idle')` on success.
   *
   * @throws {AgentError} On connection failure.
   */
  abstract connect(): Promise<void>;

  /**
   * Tears down the agent connection cleanly.
   * Implementations **must** call `this.setStatus('disconnected')` on completion.
   *
   * @throws {AgentError} On unexpected failure.
   */
  abstract disconnect(): Promise<void>;

  /**
   * Sends a task to the agent for execution.
   * Implementations **must**:
   * - Call `this.setStatus('working')` when the task starts.
   * - Call `this.setStatus('idle')` and `this.emit('task_complete', result)`
   *   when the task finishes successfully.
   * - Call `this.setStatus('error')` on failure.
   *
   * @param task - The task to dispatch.
   * @throws {AgentError} If the task cannot be dispatched or the agent fails.
   */
  abstract dispatch(task: Task): Promise<void>;

  // ---------------------------------------------------------------------------
  // Protected helpers for subclasses
  // ---------------------------------------------------------------------------

  /**
   * Updates the stored status and fires a `'status'` event.
   *
   * @param status - The new {@link AgentStatus}.
   */
  protected setStatus(status: AgentStatus): void {
    this.session = { ...this.session, status };
    this.emit('status', status);
  }

  /**
   * Emits a `'log'` event prefixed with the agent ID.
   *
   * @param line - Raw text from the agent process.
   */
  protected emitLog(line: string): void {
    this.emit('log', `[${this.session.id}] ${line}`);
  }
}
