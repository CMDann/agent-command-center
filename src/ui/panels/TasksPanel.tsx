import React, { useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { useTaskStore } from '../hooks/useTaskStore.js';
import type { Task, TaskStatus } from '../../types.js';

// ---------------------------------------------------------------------------
// Color / label helpers
// ---------------------------------------------------------------------------

/** Returns the Ink color for each task status (matches project palette). */
function statusColor(status: TaskStatus): string {
  switch (status) {
    case 'backlog':     return '#555555';
    case 'assigned':    return 'yellow';
    case 'in_progress': return 'cyan';
    case 'review':      return 'magenta';
    case 'done':        return 'green';
  }
}

/** Short human-readable badge for each task status. */
function statusBadge(status: TaskStatus): string {
  switch (status) {
    case 'backlog':     return 'backlog';
    case 'assigned':    return 'assigned';
    case 'in_progress': return 'in_prog';
    case 'review':      return 'review';
    case 'done':        return 'done';
  }
}

// ---------------------------------------------------------------------------
// TaskRow sub-component
// ---------------------------------------------------------------------------

interface TaskRowProps {
  task: Task;
  isSelected: boolean;
}

/** Renders a single task row: selection indicator, issue #, title, status badge, assignee. */
const TaskRow: React.FC<TaskRowProps> = ({ task, isSelected }) => {
  const color = statusColor(task.status);

  return (
    <Box flexDirection="row">
      {/* Selection indicator */}
      <Text color="cyan">{isSelected ? '▶ ' : '  '}</Text>

      {/* Issue number */}
      <Text color="cyan">#{String(task.issueNumber).padStart(3, ' ')} </Text>

      {/* Title — truncated to 28 chars */}
      <Text>
        {task.title.length > 28
          ? `${task.title.slice(0, 27)}…`
          : task.title.padEnd(28)}
      </Text>

      {/* Status badge */}
      <Text color={color}> [{statusBadge(task.status)}]</Text>

      {/* Assignee (agent ID or contributor login) */}
      <Text color={task.assigneeId !== undefined ? 'green' : '#555555'}>
        {' '}{task.assigneeId ?? 'unassigned'}
      </Text>
    </Box>
  );
};

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

interface TasksPanelProps {
  /** Called when the user presses `a` on a selected task. */
  onAssign: (taskId: string, taskTitle: string) => void;
}

/**
 * Task queue panel.
 *
 * Renders the sorted task queue from {@link useTaskStore} with status
 * colour-coding and assignee display.
 *
 * Keybindings:
 * - `↑` / `↓` — navigate tasks
 * - `a`        — open assign modal for the selected task
 */
export const TasksPanel: React.FC<TasksPanelProps> = ({ onAssign }) => {
  const { tasks, selectedTaskId, selectTask } = useTaskStore();

  const selectedIndex = tasks.findIndex((t) => t.id === selectedTaskId);

  const moveSelection = useCallback(
    (delta: number): void => {
      if (tasks.length === 0) return;
      const next = Math.max(0, Math.min(tasks.length - 1, selectedIndex + delta));
      selectTask(tasks[next]?.id ?? null);
    },
    [tasks, selectedIndex, selectTask]
  );

  useInput((input, key) => {
    if (key.upArrow) { moveSelection(-1); return; }
    if (key.downArrow) { moveSelection(1); return; }
    if (input === 'a' && selectedTaskId !== null) {
      const task = tasks.find((t) => t.id === selectedTaskId);
      if (task) onAssign(task.id, task.title);
    }
  });

  return (
    <Box borderStyle="single" flexDirection="column" width="50%" padding={1}>
      {/* Panel title */}
      <Box flexDirection="row">
        <Text color="cyan" bold>
          TASKS
        </Text>
        {tasks.length > 0 && (
          <Text color="#555555"> ({tasks.length})</Text>
        )}
      </Box>

      {/* Empty state */}
      {tasks.length === 0 && (
        <Box marginTop={1}>
          <Text color="#555555">No tasks. Press </Text>
          <Text color="cyan">[i]</Text>
          <Text color="#555555"> to create an issue.</Text>
        </Box>
      )}

      {/* Task list */}
      {tasks.map((task) => (
        <TaskRow
          key={task.id}
          task={task}
          isSelected={task.id === selectedTaskId}
        />
      ))}

      {/* Status bar */}
      {tasks.length > 0 && (
        <Box marginTop={1}>
          <Text color="#555555">[↑↓] select  [a] assign  [i] new issue</Text>
        </Box>
      )}
    </Box>
  );
};
