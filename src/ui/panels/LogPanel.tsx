import React from 'react';
import { Box, Text } from 'ink';
import { useAgentStore } from '../hooks/useAgentStore.js';

/** Max log lines rendered in the panel at one time. */
const MAX_DISPLAYED_LINES = 20;

/**
 * Agent log panel.
 *
 * Streams the most recent log output from the agent currently selected in
 * {@link AgentsPanel}. Data is sourced from `useAgentStore().logLines`.
 *
 * When no agent is selected, shows a hint to select one.
 */
export const LogPanel: React.FC = () => {
  const { selectedAgentId, logLines } = useAgentStore();

  const lines: string[] =
    selectedAgentId !== null ? (logLines[selectedAgentId] ?? []) : [];

  // Show the most recent MAX_DISPLAYED_LINES lines.
  const visible = lines.slice(-MAX_DISPLAYED_LINES);

  return (
    <Box borderStyle="single" flexDirection="column" width="50%" padding={1}>
      {/* Panel title */}
      <Box flexDirection="row">
        <Text color="cyan" bold>
          AGENT LOG
        </Text>
        {selectedAgentId !== null && (
          <Text color="#555555"> [{selectedAgentId}]</Text>
        )}
      </Box>

      {/* No agent selected */}
      {selectedAgentId === null && (
        <Box marginTop={1}>
          <Text color="#555555">Select an agent in the Agents panel to view logs.</Text>
        </Box>
      )}

      {/* Agent selected but no logs yet */}
      {selectedAgentId !== null && lines.length === 0 && (
        <Text color="#555555">No log output yet.</Text>
      )}

      {/* Log lines */}
      {visible.map((line, i) => (
        <Text key={i} wrap="truncate-end">
          <Text color="#555555">{line.startsWith('[') ? '' : '  '}</Text>
          {line}
        </Text>
      ))}
    </Box>
  );
};
