import React, { useCallback, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useAgentStore } from '../hooks/useAgentStore.js';
import { useContributorStore } from '../hooks/useContributorStore.js';
import type { AgentSession, AgentStatus, AgentType, Contributor } from '../../types.js';

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
// Unified list item shape
// ---------------------------------------------------------------------------

type ListItem =
  | { kind: 'agent'; session: AgentSession }
  | { kind: 'contributor'; contributor: Contributor };

/** Sort agents: working first, then idle, then error/disconnected. */
function agentSortKey(s: AgentSession): number {
  switch (s.status) {
    case 'working':      return 0;
    case 'idle':         return 1;
    case 'error':        return 2;
    case 'disconnected': return 3;
  }
}

/** Sort contributors: those with an active task first, then the rest. */
function contributorSortKey(c: Contributor): number {
  return c.currentTaskId !== undefined ? 0 : 1;
}

function buildList(sessions: AgentSession[], contributors: Contributor[]): ListItem[] {
  const sortedAgents = [...sessions].sort((a, b) => agentSortKey(a) - agentSortKey(b));
  const sortedContributors = [...contributors].sort(
    (a, b) => contributorSortKey(a) - contributorSortKey(b)
  );
  return [
    ...sortedAgents.map((session): ListItem => ({ kind: 'agent', session })),
    ...sortedContributors.map((contributor): ListItem => ({ kind: 'contributor', contributor })),
  ];
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
      <Text color="cyan">{isSelected ? '▶ ' : '  '}</Text>
      <Text color={color} bold={isBold}>
        {icon} {session.id.padEnd(16)}
      </Text>
      <Text color={color}>[{statusLabel(session.status)}]</Text>
      {session.currentTask !== undefined && (
        <Text color="yellow"> {session.currentTask}</Text>
      )}
    </Box>
  );
};

interface ContributorRowProps {
  contributor: Contributor;
  isSelected: boolean;
}

/** Renders a single contributor row with 👤 icon, login, and active task. */
const ContributorRow: React.FC<ContributorRowProps> = ({ contributor, isSelected }) => {
  const hasTask = contributor.currentTaskId !== undefined;

  return (
    <Box flexDirection="row">
      <Text color="cyan">{isSelected ? '▶ ' : '  '}</Text>
      <Text color={hasTask ? 'cyan' : '#888888'} bold={hasTask}>
        {'👤 '}{contributor.login.padEnd(16)}
      </Text>
      <Text color="#888888">[{contributor.role}]</Text>
      {hasTask && (
        <Text color="yellow"> {contributor.currentTaskId}</Text>
      )}
    </Box>
  );
};

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

interface AgentsPanelProps {
  /** Called when the user presses `Enter` on a selected contributor. */
  onContributorDetail: (login: string) => void;
}

/**
 * Agents & Contributors panel.
 *
 * Displays a unified sorted list: agents (working → idle → error →
 * disconnected) followed by contributors (active task first).
 *
 * Keybindings:
 * - `↑` / `↓`  — navigate list
 * - `d`        — disconnect selected agent
 * - `Enter`    — open detail view for selected contributor
 */
export const AgentsPanel: React.FC<AgentsPanelProps> = ({ onContributorDetail }) => {
  const { sessions, disconnect } = useAgentStore();
  const { contributors } = useContributorStore();

  const items = buildList(sessions, contributors);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const clampedIndex = items.length > 0
    ? Math.min(selectedIndex, items.length - 1)
    : 0;

  const moveSelection = useCallback(
    (delta: number): void => {
      if (items.length === 0) return;
      setSelectedIndex((i) => Math.max(0, Math.min(items.length - 1, i + delta)));
    },
    [items.length]
  );

  useInput((input, key) => {
    if (key.upArrow) { moveSelection(-1); return; }
    if (key.downArrow) { moveSelection(1); return; }

    const selected = items[clampedIndex];
    if (!selected) return;

    if (input === 'd' && selected.kind === 'agent') {
      void disconnect(selected.session.id);
    }
    if (key.return && selected.kind === 'contributor') {
      onContributorDetail(selected.contributor.login);
    }
  });

  const agentCount = sessions.length;
  const contributorCount = contributors.length;

  return (
    <Box borderStyle="single" flexDirection="column" width="50%" padding={1}>
      {/* Panel title */}
      <Text color="cyan" bold>
        AGENTS &amp; CONTRIBUTORS
      </Text>

      {/* Empty state */}
      {items.length === 0 && (
        <Box marginTop={1}>
          <Text color="#555555">No agents connected. Press </Text>
          <Text color="cyan">[c]</Text>
          <Text color="#555555"> to connect one.</Text>
        </Box>
      )}

      {/* Agents section */}
      {agentCount > 0 && (
        <>
          <Text color="#555555"> agents</Text>
          {sessions.map((session) => {
            const idx = items.findIndex(
              (it) => it.kind === 'agent' && it.session.id === session.id
            );
            return (
              <AgentRow
                key={session.id}
                session={session}
                isSelected={idx === clampedIndex}
              />
            );
          })}
        </>
      )}

      {/* Contributors section */}
      {contributorCount > 0 && (
        <>
          <Text color="#555555"> contributors</Text>
          {contributors.map((contributor) => {
            const idx = items.findIndex(
              (it) => it.kind === 'contributor' && it.contributor.login === contributor.login
            );
            return (
              <ContributorRow
                key={contributor.login}
                contributor={contributor}
                isSelected={idx === clampedIndex}
              />
            );
          })}
        </>
      )}

      {/* Status bar */}
      {items.length > 0 && (
        <Box marginTop={1}>
          <Text color="#555555">
            [↑↓] select  [d] disconnect  [Enter] detail  [c] connect
          </Text>
        </Box>
      )}
    </Box>
  );
};
