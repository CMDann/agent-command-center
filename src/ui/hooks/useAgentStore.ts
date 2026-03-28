import { create } from 'zustand';
import { agentManager } from '../../agents/AgentManager.js';
import { logger } from '../../utils/logger.js';
import type { AgentConfig, AgentSession } from '../../types.js';

/** Maximum log lines shown per agent in the Log panel. */
const MAX_VISIBLE_LOGS = 100;

interface AgentStoreState {
  /** Snapshot of all registered agent sessions. */
  sessions: AgentSession[];
  /** Per-agent log line ring-buffer (agentId → lines). */
  logLines: Record<string, string[]>;
  /** The currently selected agent for the Log panel. */
  selectedAgentId: string | null;
  /** True while a connect operation is in progress. */
  isConnecting: boolean;
  /** Last error from a connect/disconnect operation. */
  connectError: string | null;

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  /**
   * Registers and immediately connects a new agent.
   * Updates `sessions` and sets `selectedAgentId` to the new agent on success.
   *
   * @param config - Agent configuration (id, type, workdir, …).
   */
  registerAndConnect(config: AgentConfig): Promise<void>;

  /**
   * Disconnects the specified agent and updates the store.
   *
   * @param agentId - The agent to disconnect.
   */
  disconnect(agentId: string): Promise<void>;

  /**
   * Sets the currently selected agent (for log streaming).
   *
   * @param agentId - Agent to select, or `null` to clear.
   */
  selectAgent(agentId: string | null): void;

  /** Refreshes the sessions snapshot from the manager. */
  syncSessions(): void;
}

// ---------------------------------------------------------------------------
// Bootstrap — wire manager events into the store before the store is created
// ---------------------------------------------------------------------------

// These listeners fire for the lifetime of the process.
agentManager.onStatusChange((agentId: string) => {
  useAgentStore.setState((state) => ({
    sessions: agentManager.listAgents(),
    // Clear connect error once an agent successfully transitions away from
    // 'error' or 'disconnected'.
    connectError: state.connectError && state.selectedAgentId === agentId ? null : state.connectError,
  }));
});

agentManager.onLog((agentId: string, line: string) => {
  useAgentStore.setState((state) => {
    const existing = state.logLines[agentId] ?? [];
    const updated = [...existing, line];
    // Trim to MAX_VISIBLE_LOGS.
    const trimmed = updated.length > MAX_VISIBLE_LOGS
      ? updated.slice(updated.length - MAX_VISIBLE_LOGS)
      : updated;
    return { logLines: { ...state.logLines, [agentId]: trimmed } };
  });
});

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/**
 * Zustand store for agent session state.
 *
 * Subscribes to {@link agentManager} events on module load, so state stays
 * in sync without polling.
 */
export const useAgentStore = create<AgentStoreState>((set) => ({
  sessions: [],
  logLines: {},
  selectedAgentId: null,
  isConnecting: false,
  connectError: null,

  async registerAndConnect(config: AgentConfig): Promise<void> {
    set({ isConnecting: true, connectError: null });
    try {
      agentManager.register(config);
      await agentManager.connect(config.id);
      set((state) => ({
        isConnecting: false,
        sessions: agentManager.listAgents(),
        selectedAgentId: config.id,
        logLines: { ...state.logLines, [config.id]: [] },
      }));
      logger.info({ agentId: config.id }, 'Agent registered and connected via store');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ agentId: config.id, err }, 'registerAndConnect failed');
      // Still sync sessions so the error state shows in the panel.
      set({ isConnecting: false, connectError: message, sessions: agentManager.listAgents() });
    }
  },

  async disconnect(agentId: string): Promise<void> {
    try {
      await agentManager.disconnect(agentId);
      set({ sessions: agentManager.listAgents() });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ agentId, err }, 'disconnect failed via store');
      set({ connectError: message, sessions: agentManager.listAgents() });
    }
  },

  selectAgent(agentId: string | null): void {
    set({ selectedAgentId: agentId });
  },

  syncSessions(): void {
    set({ sessions: agentManager.listAgents() });
  },
}));
