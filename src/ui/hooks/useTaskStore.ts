import { create } from 'zustand';
import { taskEngine } from '../../tasks/TaskEngine.js';
import { agentManager } from '../../agents/AgentManager.js';
import { logger } from '../../utils/logger.js';
import type {
  Task,
  TaskResult,
  AssigneeType,
  Assignee,
  AgentSession,
} from '../../types.js';
import type { TaskCompleteResult } from '../../agents/AgentAdapter.js';

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

interface TaskStoreState {
  /** Sorted task queue snapshot. */
  tasks: Task[];
  /** Currently selected task ID for the assignment modal. */
  selectedTaskId: string | null;

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  /**
   * Adds or updates a task in the queue and refreshes the store snapshot.
   *
   * @param task - The task to enqueue.
   */
  enqueue(task: Task): void;

  /**
   * Manually assigns a task and refreshes the store snapshot.
   *
   * @param taskId      - The task to assign.
   * @param assigneeId  - Agent ID or contributor login.
   * @param assigneeType - `'agent'` or `'human'`.
   */
  assign(taskId: string, assigneeId: string, assigneeType: AssigneeType): void;

  /**
   * Runs auto-assignment rules against the current agent list and returns the
   * best assignee, or `null` if no idle agent is available.
   *
   * @param task   - The task to evaluate.
   * @param agents - Live agent session snapshot (pass-in for testability).
   */
  autoAssign(task: Task, agents: AgentSession[]): Assignee | null;

  /**
   * Marks a task as in-progress and refreshes the snapshot.
   *
   * @param taskId - The task that started.
   */
  markInProgress(taskId: string): void;

  /**
   * Marks a task as complete/review and refreshes the snapshot.
   *
   * @param taskId - The finished task.
   * @param result - Agent completion result (may contain PR info).
   */
  markComplete(taskId: string, result: TaskResult): void;

  /**
   * Sets the selected task ID (for the assignment modal).
   *
   * @param taskId - Task to select, or `null` to clear.
   */
  selectTask(taskId: string | null): void;

  /**
   * Dispatches the selected assigned task to its agent via AgentManager,
   * then marks the task as in-progress.
   *
   * @param taskId - The task to dispatch.
   */
  dispatchToAgent(taskId: string): Promise<void>;

  /**
   * Bulk-updates the queue from a GitHub sync (called by TaskSync).
   *
   * @param tasks - Fresh task list from TaskSync.
   */
  syncTasks(tasks: Task[]): void;
}

// ---------------------------------------------------------------------------
// Bootstrap — wire agent task_complete events before store creation
// ---------------------------------------------------------------------------

/**
 * When an agent reports TASK_COMPLETE, find the task it was working on and
 * mark it complete in the task engine.
 */
agentManager.onTaskComplete((agentId: string, result: TaskCompleteResult) => {
  const storeState = useTaskStore.getState();
  const activeTask = storeState.tasks.find(
    (t) => t.assigneeId === agentId && t.status === 'in_progress'
  );
  if (activeTask) {
    storeState.markComplete(activeTask.id, {
      success: true,
      prUrl: result.prUrl,
      prNumber: result.prNumber,
    });
    logger.info(
      { agentId, taskId: activeTask.id },
      'Task marked complete via agent task_complete event'
    );
  }
});

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/**
 * Zustand store for the NEXUS task queue.
 *
 * Wraps {@link taskEngine} (pure in-memory class) and keeps a reactive
 * snapshot of `tasks` for Ink panels to render.
 *
 * Subscribes to {@link agentManager} `task_complete` events at module load
 * so the task status updates without any component needing to poll.
 */
export const useTaskStore = create<TaskStoreState>((set) => ({
  tasks: [],
  selectedTaskId: null,

  enqueue(task: Task): void {
    taskEngine.enqueue(task);
    set({ tasks: taskEngine.getQueue() });
  },

  assign(taskId: string, assigneeId: string, assigneeType: AssigneeType): void {
    taskEngine.assign(taskId, assigneeId, assigneeType);
    set({ tasks: taskEngine.getQueue() });
  },

  autoAssign(task: Task, agents: AgentSession[]): Assignee | null {
    return taskEngine.autoAssign(task, agents);
  },

  markInProgress(taskId: string): void {
    taskEngine.markInProgress(taskId);
    set({ tasks: taskEngine.getQueue() });
  },

  markComplete(taskId: string, result: TaskResult): void {
    taskEngine.markComplete(taskId, result);
    set({ tasks: taskEngine.getQueue() });
  },

  selectTask(taskId: string | null): void {
    set({ selectedTaskId: taskId });
  },

  async dispatchToAgent(taskId: string): Promise<void> {
    const task = taskEngine.getTask(taskId);
    if (!task) {
      logger.warn({ taskId }, 'dispatchToAgent: task not found');
      return;
    }
    if (!task.assigneeId || task.assigneeType !== 'agent') {
      logger.warn({ taskId }, 'dispatchToAgent: task has no agent assignee');
      return;
    }
    try {
      await agentManager.dispatch(task.assigneeId, task);
      taskEngine.markInProgress(taskId);
      set({ tasks: taskEngine.getQueue() });
      logger.info({ taskId, agentId: task.assigneeId }, 'Task dispatched to agent');
    } catch (err) {
      logger.error({ taskId, err }, 'dispatchToAgent failed');
    }
  },

  syncTasks(tasks: Task[]): void {
    for (const task of tasks) {
      taskEngine.enqueue(task);
    }
    set({ tasks: taskEngine.getQueue() });
  },
}));
