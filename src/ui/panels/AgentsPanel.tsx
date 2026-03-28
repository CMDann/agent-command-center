import React, { useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { useAgentStore } from '../hooks/useAgentStore.js';
import type { AgentSession, AgentStatus, AgentType } from '../../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns the display icon for each agent type. */
function typeIcon(type: AgentType): string {
  return type === 'openclaw' ? '⚡' : '●';
}

/** Returns the Ink color for each agent status. */
function statusColor(status: AgentStatus): string {
  switch (status) {
    case 'idle':         return 'green';
    case 'working':      return 'cyan';
    case 'error':        return 'red';
    case 'disconnected': return '#555555';
  }
}

/** Returns a short human-readable label for each status. */
function statusLabel(status: AgentStatus): string {
  switch (status) {
    case 'idle':         return 'idle';
    case 'working':      return 'working';
    case 'error':        return 'error';
    case 'disconnected': return 'disconnected';
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface AgentRowProps {
  session: AgentSession;
  isSelected: boolean;
}

/** Renders a single agent row with icon, ID, status, and current task. */
const AgentRow: React.FC<AgentRowProps> = ({ session, isSelected }) => {
  const color = statusColor(session.status);
  const icon = typeIcon(session.type);
  const isBold = session.status === 'working';

  return (
    <Box flexDirection="row">
      {/* Selection indicator */}
      <Text color="cyan">{isSelected ? '▶ ' : '  '}</Text>

      {/* Type icon + status colour */}
      <Text color={color} bold={isBold}>
        {icon} {session.id.padEnd(16)}
      </Text>

      {/* Status badge */}
      <Text color={color}>[{statusLabel(session.status)}]</Text>

      {/* Current task, if any */}
      {session.currentTask !== undefined && (
        <Text color="yellow"> {session.currentTask}</Text>
      )}
    </Box>
  );
};

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

/**
 * Agents & Contributors panel.
 *
 * Displays all registered agent sessions with status indicators.
 * Up/Down arrows navigate the selection; the selected agent's logs
 * are shown in the Log panel via `useAgentStore().selectedAgentId`.
 *
 * Keybindings (active when this panel has implicit focus):
 * - `↑` / `↓` — navigate agents
 * - `d`       — disconnect selected agent
 */
export const AgentsPanel: React.FC = () => {
  const { sessions, selectedAgentId, selectAgent, disconnect } = useAgentStore();

  const selectedIndex = sessions.findIndex((s) => s.id === selectedAgentId);

  const moveSelection = useCallback(
    (delta: number): void => {
      if (sessions.length === 0) return;
      const next = Math.max(0, Math.min(sessions.length - 1, selectedIndex + delta));
      selectAgent(sessions[next]?.id ?? null);
    },
    [sessions, selectedIndex, selectAgent]
  );

  useInput((input, key) => {
    if (key.upArrow) { moveSelection(-1); return; }
    if (key.downArrow) { moveSelection(1); return; }
    if (input === 'd' && selectedAgentId !== null) {
      void disconnect(selectedAgentId);
    }
  });

  return (
    <Box borderStyle="single" flexDirection="column" width="50%" padding={1}>
      {/* Panel title */}
      <Text color="cyan" bold>
        AGENTS &amp; CONTRIBUTORS
      </Text>

      {/* Empty state */}
      {sessions.length === 0 && (
        <Box marginTop={1}>
          <Text color="#555555">No agents connected. Press </Text>
          <Text color="cyan">[c]</Text>
          <Text color="#555555"> to connect one.</Text>
        </Box>
      )}

      {/* Agent list */}
      {sessions.map((session) => (
        <AgentRow
          key={session.id}
          session={session}
          isSelected={session.id === selectedAgentId}
        />
      ))}

      {/* Status bar */}
      {sessions.length > 0 && (
        <Box marginTop={1}>
          <Text color="#555555">[↑↓] select  [d] disconnect  [c] connect new</Text>
        </Box>
      )}
    </Box>
  );
};
