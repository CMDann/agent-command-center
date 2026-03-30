import React, { useState } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { AgentsPanel } from './panels/AgentsPanel.js';
import { TasksPanel } from './panels/TasksPanel.js';
import { GitPanel } from './panels/GitPanel.js';
import { LogPanel } from './panels/LogPanel.js';
import { ConnectAgentModal } from './modals/ConnectAgentModal.js';
import { AssignTaskModal } from './modals/AssignTaskModal.js';
import { NewIssueModal } from './modals/NewIssueModal.js';
import { ContributorDetailModal } from './modals/ContributorDetailModal.js';
import { HelpModal } from './modals/HelpModal.js';
import { ErrorBoundary } from './ErrorBoundary.js';
import { useTaskStore } from './hooks/useTaskStore.js';

// ---------------------------------------------------------------------------
// Modal state discriminant
// ---------------------------------------------------------------------------

type ActiveModal =
  | { type: 'none' }
  | { type: 'help' }
  | { type: 'connect' }
  | { type: 'assign'; taskId: string; taskTitle: string; issueNumber: number }
  | { type: 'newIssue' }
  | { type: 'contributorDetail'; login: string };

const NO_MODAL: ActiveModal = { type: 'none' };

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Root TUI application component.
 *
 * Renders the 2×2 panel layout and manages global keyboard shortcuts:
 * - `?`     — toggle the keyboard-shortcut help overlay
 * - `c`     — open the Connect Agent modal
 * - `i`     — open the New Issue modal
 * - `a`     — open the Assign Task modal (delegated from TasksPanel)
 * - `Enter` — dispatch the selected assigned task to its agent
 * - `q`     — quit the application
 *
 * Each panel is wrapped in an {@link ErrorBoundary} so a crash in one panel
 * shows `[Panel Error — press r to reload]` instead of exiting the TUI.
 *
 * When any modal is open the main panels are hidden and the modal fills
 * their space. Pressing `Escape` (or `?` for the help modal) closes it.
 */
export const App: React.FC = () => {
  const { exit } = useApp();
  const [modal, setModal] = useState<ActiveModal>(NO_MODAL);
  const { selectedTaskId, dispatchToAgent } = useTaskStore();

  const closeModal = (): void => setModal(NO_MODAL);

  useInput((input) => {
    // The help modal handles its own close key ('?' / Escape).
    // All other modals intercept input internally.
    if (modal.type !== 'none') return;

    if (input === '?') {
      setModal({ type: 'help' });
    } else if (input === 'q') {
      exit();
    } else if (input === 'c') {
      setModal({ type: 'connect' });
    } else if (input === 'i') {
      setModal({ type: 'newIssue' });
    } else if (input === 'Enter' && selectedTaskId !== null) {
      void dispatchToAgent(selectedTaskId);
    }
    // 'a' is handled by TasksPanel and triggers onAssign callback.
  });

  // Hint text shown in the header bar.
  const hint =
    modal.type !== 'none'
      ? '[Esc] Cancel'
      : '[?] Help  [c] Connect  [i] Issue  [Enter] Dispatch  [q] Quit';

  return (
    <Box flexDirection="column">
      {/* Header — always visible */}
      <Box borderStyle="single" paddingX={2}>
        <Text color="cyan" bold>
          NEXUS{' '}
        </Text>
        <Text color="#555555">v1.0.0 — multi-agent orchestration dashboard</Text>
        <Text>  </Text>
        <Text color="#555555">{hint}</Text>
      </Box>

      {/* Modals — rendered in place of the panels */}
      {modal.type === 'help' && (
        <HelpModal onClose={closeModal} />
      )}

      {modal.type === 'connect' && (
        <ConnectAgentModal onClose={closeModal} />
      )}

      {modal.type === 'assign' && (
        <AssignTaskModal
          taskId={modal.taskId}
          taskTitle={modal.taskTitle}
          issueNumber={modal.issueNumber}
          onClose={closeModal}
        />
      )}

      {modal.type === 'newIssue' && (
        <NewIssueModal onClose={closeModal} />
      )}

      {modal.type === 'contributorDetail' && (
        <ContributorDetailModal
          login={modal.login}
          onClose={closeModal}
        />
      )}

      {/* Main dashboard — shown only when no modal is open */}
      {modal.type === 'none' && (
        <>
          {/* Row 1: Agents | Tasks */}
          <Box flexDirection="row">
            <ErrorBoundary label="Agents">
              <AgentsPanel
                onContributorDetail={(login) =>
                  setModal({ type: 'contributorDetail', login })
                }
              />
            </ErrorBoundary>
            <ErrorBoundary label="Tasks">
              <TasksPanel
                onAssign={(taskId, taskTitle, issueNumber) =>
                  setModal({ type: 'assign', taskId, taskTitle, issueNumber })
                }
              />
            </ErrorBoundary>
          </Box>

          {/* Row 2: Git | Log */}
          <Box flexDirection="row">
            <ErrorBoundary label="Git">
              <GitPanel />
            </ErrorBoundary>
            <ErrorBoundary label="Log">
              <LogPanel />
            </ErrorBoundary>
          </Box>
        </>
      )}
    </Box>
  );
};
