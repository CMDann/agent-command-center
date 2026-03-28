import React, { useState } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { AgentsPanel } from './panels/AgentsPanel.js';
import { TasksPanel } from './panels/TasksPanel.js';
import { GitPanel } from './panels/GitPanel.js';
import { LogPanel } from './panels/LogPanel.js';
import { ConnectAgentModal } from './modals/ConnectAgentModal.js';

/**
 * Root TUI application component.
 *
 * Renders the 2×2 panel layout and manages global keyboard shortcuts:
 * - `c` — open the Connect Agent modal
 * - `q` — quit the application
 *
 * When the Connect Agent modal is open the main panels are hidden and the
 * modal fills their space. Pressing `Escape` in the modal returns to the
 * normal layout.
 */
export const App: React.FC = () => {
  const { exit } = useApp();
  const [showConnectModal, setShowConnectModal] = useState(false);

  useInput((input) => {
    // Ignore global shortcuts when the modal has focus.
    if (showConnectModal) return;

    if (input === 'q') {
      exit();
    } else if (input === 'c') {
      setShowConnectModal(true);
    }
  });

  return (
    <Box flexDirection="column">
      {/* Header — always visible */}
      <Box borderStyle="single" paddingX={2}>
        <Text color="cyan" bold>
          NEXUS{' '}
        </Text>
        <Text color="#555555">v0.1.0 — multi-agent orchestration dashboard</Text>
        <Text>  </Text>
        <Text color="#555555">
          {showConnectModal ? '[Esc] Cancel' : '[c] Connect  [q] Quit'}
        </Text>
      </Box>

      {showConnectModal ? (
        /* Modal replaces main panels */
        <ConnectAgentModal onClose={() => setShowConnectModal(false)} />
      ) : (
        <>
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
        </>
      )}
    </Box>
  );
};
