import { EventEmitter } from 'events';
import { ClaudeAdapter } from './ClaudeAdapter.js';
import { CodexAdapter } from './CodexAdapter.js';
import { AgentAdapter, AgentError, type TaskCompleteResult } from './AgentAdapter.js';
import { logger } from '../utils/logger.js';
import type { AgentConfig, AgentSession, AgentStatus, AgentType, Task } from '../types.js';

/** Maximum log lines retained per agent to prevent unbounded memory growth. */
const MAX_LOG_LINES = 200;

/**
 * Thrown when an operation targets an agent ID that has not been registered.
 */
export class AgentNotFoundError extends Error {
  constructor(agentId: string) {
    super(`Agent '${agentId}' is not registered`);
    this.name = 'AgentNotFoundError';
  }
}

/**
 * Manages the full lifecycle of all local agent sessions.
 *
 * Responsibilities:
 * - Create the correct {@link AgentAdapter} subclass based on agent type.
 * - Forward adapter events to registered listeners.
 * - Maintain a per-agent log ring-buffer for the TUI.
 *
 * Intended to be used as a singleton (`agentManager`) by the Zustand store.
 */
export class AgentManager extends EventEmitter {
  private readonly adapters = new Map<string, AgentAdapter>();
  /** Ring-buffer of recent log lines per agent ID. */
  private readonly logBuffers = new Map<string, string[]>();

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  /**
   * Creates and registers a new agent adapter without connecting it.
   * If an adapter with the same ID already exists, it is replaced.
   *
   * @param config - The agent configuration from `nexus.config.json` or the TUI.
   */
  register(config: AgentConfig): void {
    const adapter = createAdapter(config);
    this.adapters.set(config.id, adapter);
    this.logBuffers.set(config.id, []);
    this.wireAdapterEvents(adapter);
    logger.info({ agentId: config.id, type: config.type }, 'Agent registered');
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Connects a previously registered agent.
   *
   * @param agentId - The agent to connect.
   * @throws {AgentNotFoundError} If the agent is not registered.
   * @throws {AgentError} If the connection fails.
   */
  async connect(agentId: string): Promise<void> {
    const adapter = this.requireAdapter(agentId);
    await adapter.connect();
    logger.info({ agentId }, 'Agent connected');
  }

  /**
   * Disconnects a previously connected agent.
   *
   * @param agentId - The agent to disconnect.
   * @throws {AgentNotFoundError} If the agent is not registered.
   * @throws {AgentError} If disconnection fails.
   */
  async disconnect(agentId: string): Promise<void> {
    const adapter = this.requireAdapter(agentId);
    await adapter.disconnect();
    logger.info({ agentId }, 'Agent disconnected');
  }

  /**
   * Dispatches a task to the specified agent.
   *
   * @param agentId - The target agent.
   * @param task - The task to run.
   * @throws {AgentNotFoundError} If the agent is not registered.
   * @throws {AgentError} If the agent is not idle or dispatch fails.
   */
  async dispatch(agentId: string, task: Task): Promise<void> {
    const adapter = this.requireAdapter(agentId);
    await adapter.dispatch(task);
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  /**
   * Returns a snapshot of all registered agent sessions, newest-first by
   * connection time (disconnected agents appear last).
   */
  listAgents(): AgentSession[] {
    return [...this.adapters.values()].map((a) => a.getSession());
  }

  /**
   * Returns the most recent log lines for an agent (up to {@link MAX_LOG_LINES}).
   *
   * @param agentId - The agent whose logs to retrieve.
   * @returns Array of log line strings, or an empty array if not found.
   */
  getLogs(agentId: string): string[] {
    return this.logBuffers.get(agentId) ?? [];
  }

  // ---------------------------------------------------------------------------
  // Event subscription helpers
  // ---------------------------------------------------------------------------

  /**
   * Registers a callback that fires whenever any agent changes status.
   *
   * @param cb - Called with the agent ID and new status.
   */
  onStatusChange(cb: (agentId: string, status: AgentStatus) => void): void {
    this.on('agent:status', cb);
  }

  /**
   * Registers a callback that fires whenever any agent emits a log line.
   *
   * @param cb - Called with the agent ID and log line string.
   */
  onLog(cb: (agentId: string, line: string) => void): void {
    this.on('agent:log', cb);
  }

  /**
   * Registers a callback that fires whenever an agent completes a task.
   *
   * @param cb - Called with the agent ID and task completion result.
   */
  onTaskComplete(cb: (agentId: string, result: TaskCompleteResult) => void): void {
    this.on('agent:task_complete', cb);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private requireAdapter(agentId: string): AgentAdapter {
    const adapter = this.adapters.get(agentId);
    if (!adapter) throw new AgentNotFoundError(agentId);
    return adapter;
  }

  private wireAdapterEvents(adapter: AgentAdapter): void {
    adapter.on('status', (status: AgentStatus) => {
      this.emit('agent:status', adapter.id, status);
    });

    adapter.on('log', (line: string) => {
      const buffer = this.logBuffers.get(adapter.id) ?? [];
      buffer.push(line);
      // Trim the buffer to MAX_LOG_LINES by discarding the oldest entries.
      if (buffer.length > MAX_LOG_LINES) {
        buffer.splice(0, buffer.length - MAX_LOG_LINES);
      }
      this.logBuffers.set(adapter.id, buffer);
      this.emit('agent:log', adapter.id, line);
    });

    adapter.on('task_complete', (result) => {
      this.emit('agent:task_complete', adapter.id, result);
    });
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates the correct {@link AgentAdapter} subclass for the given config type.
 *
 * @param config - Agent configuration.
 * @returns A concrete adapter instance.
 * @throws {AgentError} For unrecognised agent types.
 */
function createAdapter(config: AgentConfig): AgentAdapter {
  const typeMap: Record<AgentType, (c: AgentConfig) => AgentAdapter> = {
    claude: (c) => new ClaudeAdapter(c),
    codex: (c) => new CodexAdapter(c),
    // openclaw is handled by the bridge adapter added in Phase 3.
    openclaw: (c) => {
      throw new AgentError(
        `openclaw agents require the bridge adapter (Phase 3). Agent: '${c.id}'`,
        c.id
      );
    },
  };

  const factory = typeMap[config.type];
  return factory(config);
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

/**
 * Process-wide singleton {@link AgentManager}.
 * Import and use this directly from stores and services.
 */
export const agentManager = new AgentManager();
