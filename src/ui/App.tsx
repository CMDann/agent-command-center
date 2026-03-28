import React from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { AgentsPanel } from './panels/AgentsPanel.js';
import { TasksPanel } from './panels/TasksPanel.js';
import { GitPanel } from './panels/GitPanel.js';
import { LogPanel } from './panels/LogPanel.js';

/**
 * Root TUI application component.
 * Renders the four main panels in a 2×2 grid layout.
 * Handles the global `q` keybinding to quit.
 */
export const App: React.FC = () => {
  const { exit } = useApp();

  useInput((input) => {
    if (input === 'q') {
      exit();
    }
  });

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box borderStyle="single" paddingX={2}>
        <Text color="cyan" bold>
          NEXUS{' '}
        </Text>
        <Text color="#555555">v0.1.0 — multi-agent orchestration dashboard</Text>
        <Text> </Text>
        <Text color="#555555">
          [?] Help  [q] Quit
        </Text>
      </Box>

      {/* Main panels row 1: Agents | Tasks */}
      <Box flexDirection="row">
        <AgentsPanel />
        <TasksPanel />
      </Box>

      {/* Main panels row 2: Git | Log */}
      <Box flexDirection="row">
        <GitPanel />
        <LogPanel />
      </Box>
    </Box>
  );
};
