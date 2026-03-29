import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { useAgentStore } from '../hooks/useAgentStore.js';
import { useTaskStore } from '../hooks/useTaskStore.js';
import type { AgentSession } from '../../types.js';

// ---------------------------------------------------------------------------
// Assignee list item
// ---------------------------------------------------------------------------

/** Unified row shape for both agents and contributors. */
interface AssigneeOption {
  /** Display key shown in the list (e.g. `1`, `2`, …). */
  key: string;
  /** Display label. */
  label: string;
  /** Internal ID used for assignment. */
  id: string;
  /** Whether this is an agent or a human. */
  kind: 'agent' | 'human';
}

/** Maximum number of assignee options that can be listed. */
const MAX_OPTIONS = 9;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds the ordered list of selectable assignee options from current
 * agent sessions.
 */
function buildOptions(sessions: AgentSession[]): AssigneeOption[] {
  const options: AssigneeOption[] = [];
  let index = 1;

  for (const session of sessions) {
    if (index > MAX_OPTIONS) break;
    const statusNote =
      session.status === 'idle' ? 'idle' : session.status === 'working' ? 'busy' : session.status;
    options.push({
      key: String(index++),
      label: `${session.id.padEnd(16)} [${session.type}] ${statusNote}`,
      id: session.id,
      kind: 'agent',
    });
  }

  return options;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface AssignTaskModalProps {
  /** The task ID to assign. */
  taskId: string;
  /** Task title shown in the modal header. */
  taskTitle: string;
  /** Called when the modal closes (cancel or after successful assignment). */
  onClose: () => void;
}

/**
 * Inline modal for assigning a task to an agent or contributor.
 *
 * ### Interaction flow
 * 1. A numbered list of all available agents + contributors is shown.
 * 2. User presses the number key corresponding to their choice.
 * 3. Assignment is applied and the modal closes.
 * 4. `Escape` cancels without making a change.
 */
export const AssignTaskModal: React.FC<AssignTaskModalProps> = ({
  taskId,
  taskTitle,
  onClose,
}) => {
  const { sessions } = useAgentStore();
  const { assign } = useTaskStore();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const options = buildOptions(sessions);

  const handleAssign = useCallback(
    (option: AssigneeOption): void => {
      setSelectedKey(option.key);
      assign(taskId, option.id, option.kind === 'agent' ? 'agent' : 'human');
      onClose();
    },
    [assign, taskId, onClose]
  );

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    const match = options.find((o) => o.key === input);
    if (match) {
      handleAssign(match);
    }
  });

  return (
    <Box
      borderStyle="round"
      borderColor="cyan"
      flexDirection="column"
      padding={1}
      marginTop={1}
    >
      <Text color="cyan" bold>
        Assign Task
      </Text>
      <Text color="#555555">Press Escape to cancel</Text>

      {/* Task being assigned */}
      <Box marginTop={1}>
        <Text color="white">Task: </Text>
        <Text color="yellow">
          {taskTitle.length > 50 ? `${taskTitle.slice(0, 49)}…` : taskTitle}
        </Text>
      </Box>

      {/* Empty state */}
      {options.length === 0 && (
        <Box marginTop={1}>
          <Text color="#555555">No agents or contributors available.</Text>
        </Box>
      )}

      {/* Option list */}
      {options.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text color="white">Select assignee:</Text>
          {options.map((opt) => (
            <Box key={opt.key} marginLeft={2}>
              <Text color={selectedKey === opt.key ? 'cyan' : 'white'}>
                [{opt.key}] {opt.label}
              </Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
};
