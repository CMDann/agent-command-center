import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { logger } from '../utils/logger.js';
import type {
  Task,
  TaskStatus,
  TaskResult,
  Assignee,
  AssigneeType,
  AgentSession,
} from '../types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Status sort order — lower index means higher visual priority. */
const STATUS_PRIORITY: Record<TaskStatus, number> = {
  in_progress: 0,
  assigned: 1,
  backlog: 2,
  review: 3,
  done: 4,
};

// ---------------------------------------------------------------------------
// Persistence types
// ---------------------------------------------------------------------------

/** Shape written to / read from `.nexus/assignments.json`. */
interface PersistedAssignment {
  taskId: string;
  assigneeId: string;
  assigneeType: AssigneeType;
}

// ---------------------------------------------------------------------------
// TaskEngine
// ---------------------------------------------------------------------------

/**
 * In-memory priority queue for NEXUS tasks backed by GitHub Issues.
 *
 * Handles:
 * - Enqueueing tasks from GitHub (idempotent — re-enqueue = update metadata).
 * - Manual and automatic assignment.
 * - Status transitions (backlog → assigned → in_progress → review → done).
 * - Persisting manual assignment overrides to `.nexus/assignments.json` so
 *   they survive a process restart.
 *
 * ### Auto-assignment rules (evaluated in order)
 * 1. Label `claude` → assign to an idle `claude` agent.
 * 2. Label `codex`  → assign to an idle `codex` agent.
 * 3. Issue body mentions an agent's `workdir` → assign to that agent.
 * 4. Any idle agent (first available).
 * 5. No idle agent → returns `null` (human-review fallback).
 */
export class TaskEngine {
  private readonly tasks = new Map<string, Task>();
  /** Manual assignment overrides keyed by task ID — survive re-enqueues. */
  private readonly overrides = new Map<string, PersistedAssignment>();
  private readonly persistPath: string;

  /**
   * @param nexusDir - Path to the `.nexus` data directory (default: `.nexus`).
   */
  constructor(nexusDir = '.nexus') {
    this.persistPath = join(nexusDir, 'assignments.json');
    this.loadOverrides(nexusDir);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Adds or updates a task in the queue.
   *
   * If the task already exists, its metadata (title, body, labels, etc.) is
   * refreshed but an existing manual assignment and non-backlog status are
   * preserved.
   *
   * @param task - The task to enqueue (typically hydrated from a GitHub Issue).
   */
  enqueue(task: Task): void {
    const existing = this.tasks.get(task.id);
    const override = this.overrides.get(task.id);

    if (existing) {
      // Preserve running/assigned state; only refresh metadata.
      this.tasks.set(task.id, {
        ...task,
        status: existing.status !== 'backlog' ? existing.status : task.status,
        assigneeId: override?.assigneeId ?? existing.assigneeId,
        assigneeType: override?.assigneeType ?? existing.assigneeType,
      });
    } else {
      // Apply persisted override if available.
      this.tasks.set(task.id, {
        ...task,
        assigneeId: override?.assigneeId ?? task.assigneeId,
        assigneeType: override?.assigneeType ?? task.assigneeType,
        status: override ? 'assigned' : task.status,
      });
    }
    logger.debug({ taskId: task.id, issueNumber: task.issueNumber }, 'Task enqueued');
  }

  /**
   * Manually assigns a task to an agent or contributor.
   *
   * Persists the override so it survives process restarts.
   *
   * @param taskId      - The task to assign.
   * @param assigneeId  - Agent ID or contributor login.
   * @param assigneeType - Whether the assignee is an agent or a human.
   */
  assign(taskId: string, assigneeId: string, assigneeType: AssigneeType): void {
    const task = this.tasks.get(taskId);
    if (task) {
      this.tasks.set(taskId, {
        ...task,
        assigneeId,
        assigneeType,
        status: task.status === 'backlog' ? 'assigned' : task.status,
      });
    }
    const override: PersistedAssignment = { taskId, assigneeId, assigneeType };
    this.overrides.set(taskId, override);
    this.persistOverrides();
    logger.info({ taskId, assigneeId, assigneeType }, 'Task assigned');
  }

  /**
   * Evaluates the auto-assignment rules from IMPLEMENTATION.md §10 and returns
   * the best assignee for the given task.
   *
   * @param task   - The task to assign.
   * @param agents - Current snapshot of all registered agent sessions.
   * @returns An {@link Assignee} on success, or `null` if no agent is available
   *          (human-review fallback).
   */
  autoAssign(task: Task, agents: AgentSession[]): Assignee | null {
    const idleAgents = agents.filter((a) => a.status === 'idle');

    // Rule 1 — label 'claude'
    if (task.labels.includes('claude')) {
      const agent = idleAgents.find((a) => a.type === 'claude');
      if (agent) return { id: agent.id, type: 'agent' };
    }

    // Rule 2 — label 'codex'
    if (task.labels.includes('codex')) {
      const agent = idleAgents.find((a) => a.type === 'codex');
      if (agent) return { id: agent.id, type: 'agent' };
    }

    // Rule 3 — workdir match (issue body mentions the agent's working directory)
    if (task.body) {
      for (const agent of idleAgents) {
        if (agent.workdir && task.body.includes(agent.workdir)) {
          return { id: agent.id, type: 'agent' };
        }
      }
    }

    // Rule 4 — any idle agent (first found)
    if (idleAgents.length > 0) {
      return { id: idleAgents[0]!.id, type: 'agent' };
    }

    // Rule 5 — human-review fallback
    logger.debug({ taskId: task.id }, 'autoAssign: no idle agent — flagged for human review');
    return null;
  }

  /**
   * Returns a sorted snapshot of the task queue.
   *
   * Sort order: `in_progress` → `assigned` → `backlog` → `review` → `done`,
   * then ascending by issue number within each status group.
   */
  getQueue(): Task[] {
    return [...this.tasks.values()].sort(compareTasksForQueue);
  }

  /**
   * Transitions a task to `in_progress`.
   *
   * @param taskId - The task that has started.
   */
  markInProgress(taskId: string): void {
    this.transition(taskId, 'in_progress');
    logger.info({ taskId }, 'Task marked in_progress');
  }

  /**
   * Transitions a task to `review` (if a PR was opened) or `done`.
   *
   * @param taskId - The task that finished.
   * @param result - Completion result from the agent.
   */
  markComplete(taskId: string, result: TaskResult): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    const newStatus: TaskStatus = result.prNumber !== undefined ? 'review' : 'done';
    this.tasks.set(taskId, {
      ...task,
      status: newStatus,
      prNumber: result.prNumber ?? task.prNumber,
    });
    logger.info({ taskId, newStatus }, 'Task marked complete');
  }

  /**
   * Returns a single task by ID, or `undefined` if not found.
   *
   * @param taskId - The task ID to look up.
   */
  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Removes a task from the queue (e.g. when the issue is deleted).
   *
   * @param taskId - The task to remove.
   */
  removeTask(taskId: string): void {
    this.tasks.delete(taskId);
    // Overrides are retained so that if the issue is re-opened the assignment
    // is restored automatically.
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private transition(taskId: string, status: TaskStatus): void {
    const task = this.tasks.get(taskId);
    if (task) {
      this.tasks.set(taskId, { ...task, status });
    }
  }

  private loadOverrides(nexusDir: string): void {
    try {
      const raw = readFileSync(this.persistPath, 'utf8');
      const entries = JSON.parse(raw) as PersistedAssignment[];
      for (const entry of entries) {
        this.overrides.set(entry.taskId, entry);
      }
      logger.debug({ count: entries.length }, 'Loaded assignment overrides');
    } catch {
      // File does not exist yet — start fresh.
      // Ensure the directory exists so the first write succeeds.
      try {
        mkdirSync(nexusDir, { recursive: true });
      } catch {
        // Directory may already exist.
      }
    }
  }

  private persistOverrides(): void {
    try {
      const entries = [...this.overrides.values()];
      writeFileSync(this.persistPath, JSON.stringify(entries, null, 2), 'utf8');
    } catch (err) {
      logger.warn({ err }, 'Failed to persist assignment overrides');
    }
  }
}

// ---------------------------------------------------------------------------
// Comparator
// ---------------------------------------------------------------------------

/**
 * Comparator for {@link Task} objects.
 * Sort by status priority ascending, then by issue number ascending.
 */
function compareTasksForQueue(a: Task, b: Task): number {
  const statusDiff = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
  if (statusDiff !== 0) return statusDiff;
  return a.issueNumber - b.issueNumber;
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

/**
 * Process-wide singleton {@link TaskEngine}.
 * Import and use this directly from stores and services.
 */
export const taskEngine = new TaskEngine();
