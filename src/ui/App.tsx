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
import { useTaskStore } from './hooks/useTaskStore.js';

// ---------------------------------------------------------------------------
// Modal state discriminant
// ---------------------------------------------------------------------------

type ActiveModal =
  | { type: 'none' }
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
 * - `c` — open the Connect Agent modal
 * - `i` — open the New Issue modal
 * - `a` — open the Assign Task modal (delegated from TasksPanel)
 * - `Enter` — dispatch the selected assigned task to its agent
 * - `q` — quit the application
 *
 * When any modal is open the main panels are hidden and the modal fills
 * their space. Pressing `Escape` in any modal returns to the normal layout.
 */
export const App: React.FC = () => {
  const { exit } = useApp();
  const [modal, setModal] = useState<ActiveModal>(NO_MODAL);
  const { selectedTaskId, dispatchToAgent } = useTaskStore();

  const closeModal = (): void => setModal(NO_MODAL);

  useInput((input) => {
    // Ignore global shortcuts when any modal is open.
    if (modal.type !== 'none') return;

    if (input === 'q') {
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

  // Hint text shown in the header.
  const hint =
    modal.type !== 'none'
      ? '[Esc] Cancel'
      : '[c] Connect  [i] New Issue  [Enter] Dispatch  [q] Quit';

  return (
    <Box flexDirection="column">
      {/* Header — always visible */}
      <Box borderStyle="single" paddingX={2}>
        <Text color="cyan" bold>
          NEXUS{' '}
        </Text>
        <Text color="#555555">v0.1.0 — multi-agent orchestration dashboard</Text>
        <Text>  </Text>
        <Text color="#555555">{hint}</Text>
      </Box>

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

      {modal.type === 'none' && (
        <>
          {/* Main panels row 1: Agents | Tasks */}
          <Box flexDirection="row">
            <AgentsPanel
              onContributorDetail={(login) =>
                setModal({ type: 'contributorDetail', login })
              }
            />
            <TasksPanel
              onAssign={(taskId, taskTitle, issueNumber) =>
                setModal({ type: 'assign', taskId, taskTitle, issueNumber })
              }
            />
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
