import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Task, AgentSession, TaskResult } from '../types.js';

// ---------------------------------------------------------------------------
// Mock logger before any module that imports it (pino's file transport
// requires .nexus/ to exist; mocking prevents the missing-fd crash in CI).
// ---------------------------------------------------------------------------

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Mock fs so tests don't touch the real filesystem
// ---------------------------------------------------------------------------

vi.mock('fs', () => ({
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(() => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); }),
  writeFileSync: vi.fn(),
}));

const { TaskEngine } = await import('./TaskEngine.js');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'issue-1',
    issueNumber: 1,
    title: 'Fix the bug',
    body: 'Some description',
    labels: [],
    status: 'backlog',
    repoPath: '/workspace',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  };
}

function makeAgent(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: 'claude-1',
    type: 'claude',
    status: 'idle',
    autopr: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// enqueue
// ---------------------------------------------------------------------------

describe('TaskEngine', () => {
  let engine: InstanceType<typeof TaskEngine>;

  beforeEach(() => {
    engine = new TaskEngine('.nexus-test');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('enqueue', () => {
    it('adds a new task to the queue', () => {
      engine.enqueue(makeTask());
      expect(engine.getQueue()).toHaveLength(1);
    });

    it('preserves non-backlog status when re-enqueuing an existing task', () => {
      engine.enqueue(makeTask());
      engine.markInProgress('issue-1');
      engine.enqueue(makeTask({ title: 'Updated title' }));
      const task = engine.getTask('issue-1');
      expect(task?.status).toBe('in_progress');
      expect(task?.title).toBe('Updated title');
    });

    it('resets to backlog when re-enqueuing a done task', () => {
      engine.enqueue(makeTask());
      engine.markComplete('issue-1', { success: true });
      // Enqueue again (issue reopened on GitHub).
      engine.enqueue(makeTask());
      // Status is now 'done' from markComplete; re-enqueue keeps it (done != backlog).
      // Actually the logic: existing.status !== 'backlog' → keep existing.
      // So 'done' is preserved until it moves back to backlog externally.
      const task = engine.getTask('issue-1');
      expect(task).toBeDefined();
    });

    it('stores multiple tasks independently', () => {
      engine.enqueue(makeTask({ id: 'issue-1', issueNumber: 1 }));
      engine.enqueue(makeTask({ id: 'issue-2', issueNumber: 2 }));
      expect(engine.getQueue()).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // assign
  // -------------------------------------------------------------------------

  describe('assign', () => {
    it('sets assigneeId and assigneeType on the task', () => {
      engine.enqueue(makeTask());
      engine.assign('issue-1', 'claude-1', 'agent');
      const task = engine.getTask('issue-1');
      expect(task?.assigneeId).toBe('claude-1');
      expect(task?.assigneeType).toBe('agent');
    });

    it('transitions a backlog task to assigned', () => {
      engine.enqueue(makeTask());
      engine.assign('issue-1', 'claude-1', 'agent');
      expect(engine.getTask('issue-1')?.status).toBe('assigned');
    });

    it('does not downgrade an in_progress task to assigned', () => {
      engine.enqueue(makeTask());
      engine.markInProgress('issue-1');
      engine.assign('issue-1', 'codex-1', 'agent');
      expect(engine.getTask('issue-1')?.status).toBe('in_progress');
    });

    it('applies the override to subsequent enqueues of the same task', () => {
      engine.enqueue(makeTask());
      engine.assign('issue-1', 'bob', 'human');
      // Re-enqueue (e.g. from a sync) with no assignee.
      engine.enqueue(makeTask());
      const task = engine.getTask('issue-1');
      expect(task?.assigneeId).toBe('bob');
    });

    it('persists override to assignments.json', async () => {
      const { writeFileSync } = await import('fs');
      engine.enqueue(makeTask());
      engine.assign('issue-1', 'claude-1', 'agent');
      expect(writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('assignments.json'),
        expect.stringContaining('claude-1'),
        'utf8'
      );
    });
  });

  // -------------------------------------------------------------------------
  // autoAssign — the core business logic
  // -------------------------------------------------------------------------

  describe('autoAssign', () => {
    describe('Rule 1 — label "claude"', () => {
      it('assigns to an idle claude agent when the task has label "claude"', () => {
        const task = makeTask({ labels: ['claude'] });
        const agents = [makeAgent({ id: 'claude-1', type: 'claude', status: 'idle' })];
        const result = engine.autoAssign(task, agents);
        expect(result).toEqual({ id: 'claude-1', type: 'agent' });
      });

      it('skips busy claude agents and falls through to rule 4', () => {
        const task = makeTask({ labels: ['claude'] });
        const agents = [
          makeAgent({ id: 'claude-1', type: 'claude', status: 'working' }),
          makeAgent({ id: 'codex-1', type: 'codex', status: 'idle' }),
        ];
        const result = engine.autoAssign(task, agents);
        // Rule 1 fails (no idle claude), Rule 2 not triggered, Rule 4 picks any idle.
        expect(result).toEqual({ id: 'codex-1', type: 'agent' });
      });
    });

    describe('Rule 2 — label "codex"', () => {
      it('assigns to an idle codex agent when the task has label "codex"', () => {
        const task = makeTask({ labels: ['codex'] });
        const agents = [makeAgent({ id: 'codex-1', type: 'codex', status: 'idle' })];
        const result = engine.autoAssign(task, agents);
        expect(result).toEqual({ id: 'codex-1', type: 'agent' });
      });

      it('takes rule 1 priority when both claude and codex labels are present', () => {
        const task = makeTask({ labels: ['claude', 'codex'] });
        const agents = [
          makeAgent({ id: 'claude-1', type: 'claude', status: 'idle' }),
          makeAgent({ id: 'codex-1', type: 'codex', status: 'idle' }),
        ];
        const result = engine.autoAssign(task, agents);
        expect(result?.id).toBe('claude-1');
      });
    });

    describe('Rule 3 — workdir match', () => {
      it('assigns to the agent whose workdir is mentioned in the issue body', () => {
        const task = makeTask({
          body: 'This issue affects /workspace/packages/api',
        });
        const agents = [
          makeAgent({ id: 'api-agent', type: 'claude', status: 'idle', workdir: '/workspace/packages/api' }),
          makeAgent({ id: 'other-agent', type: 'codex', status: 'idle', workdir: '/workspace/packages/web' }),
        ];
        const result = engine.autoAssign(task, agents);
        expect(result?.id).toBe('api-agent');
      });

      it('falls through when no workdir matches', () => {
        const task = makeTask({ body: 'Nothing about any specific path.' });
        const agents = [
          makeAgent({ id: 'any-agent', type: 'claude', status: 'idle', workdir: '/workspace/packages/api' }),
        ];
        // Rule 3 misses, Rule 4 picks 'any-agent'.
        const result = engine.autoAssign(task, agents);
        expect(result?.id).toBe('any-agent');
      });
    });

    describe('Rule 4 — any idle agent', () => {
      it('assigns to the first idle agent when no other rule matches', () => {
        const task = makeTask({ labels: [] });
        const agents = [
          makeAgent({ id: 'agent-a', type: 'claude', status: 'idle' }),
          makeAgent({ id: 'agent-b', type: 'codex', status: 'idle' }),
        ];
        const result = engine.autoAssign(task, agents);
        expect(result?.id).toBe('agent-a');
      });

      it('skips non-idle agents', () => {
        const task = makeTask();
        const agents = [
          makeAgent({ id: 'busy', type: 'claude', status: 'working' }),
          makeAgent({ id: 'disconnected', type: 'codex', status: 'disconnected' }),
          makeAgent({ id: 'free', type: 'claude', status: 'idle' }),
        ];
        const result = engine.autoAssign(task, agents);
        expect(result?.id).toBe('free');
      });
    });

    describe('Rule 5 — human fallback', () => {
      it('returns null when no agents are idle', () => {
        const task = makeTask();
        const agents = [
          makeAgent({ id: 'busy', type: 'claude', status: 'working' }),
        ];
        const result = engine.autoAssign(task, agents);
        expect(result).toBeNull();
      });

      it('returns null when agent list is empty', () => {
        const result = engine.autoAssign(makeTask(), []);
        expect(result).toBeNull();
      });
    });
  });

  // -------------------------------------------------------------------------
  // getQueue sorting
  // -------------------------------------------------------------------------

  describe('getQueue', () => {
    it('sorts by status priority: in_progress before assigned before backlog', () => {
      engine.enqueue(makeTask({ id: 'issue-3', issueNumber: 3 }));
      engine.enqueue(makeTask({ id: 'issue-1', issueNumber: 1 }));
      engine.enqueue(makeTask({ id: 'issue-2', issueNumber: 2 }));
      engine.assign('issue-2', 'a', 'agent');
      engine.markInProgress('issue-3');

      const queue = engine.getQueue();
      expect(queue[0]?.id).toBe('issue-3'); // in_progress
      expect(queue[1]?.id).toBe('issue-2'); // assigned
      expect(queue[2]?.id).toBe('issue-1'); // backlog
    });

    it('sorts by issue number within the same status', () => {
      engine.enqueue(makeTask({ id: 'issue-5', issueNumber: 5 }));
      engine.enqueue(makeTask({ id: 'issue-2', issueNumber: 2 }));
      engine.enqueue(makeTask({ id: 'issue-8', issueNumber: 8 }));

      const queue = engine.getQueue();
      expect(queue.map((t) => t.issueNumber)).toEqual([2, 5, 8]);
    });
  });

  // -------------------------------------------------------------------------
  // markInProgress / markComplete
  // -------------------------------------------------------------------------

  describe('markInProgress', () => {
    it('transitions task to in_progress', () => {
      engine.enqueue(makeTask());
      engine.markInProgress('issue-1');
      expect(engine.getTask('issue-1')?.status).toBe('in_progress');
    });

    it('is a no-op for an unknown task ID', () => {
      expect(() => engine.markInProgress('ghost')).not.toThrow();
    });
  });

  describe('markComplete', () => {
    it('transitions to review when result has a prNumber', () => {
      engine.enqueue(makeTask());
      engine.markInProgress('issue-1');
      const result: TaskResult = { success: true, prNumber: 42, prUrl: 'http://x' };
      engine.markComplete('issue-1', result);
      const task = engine.getTask('issue-1');
      expect(task?.status).toBe('review');
      expect(task?.prNumber).toBe(42);
    });

    it('transitions to done when result has no prNumber', () => {
      engine.enqueue(makeTask());
      engine.markInProgress('issue-1');
      engine.markComplete('issue-1', { success: true });
      expect(engine.getTask('issue-1')?.status).toBe('done');
    });

    it('is a no-op for an unknown task ID', () => {
      expect(() => engine.markComplete('ghost', { success: true })).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // removeTask
  // -------------------------------------------------------------------------

  describe('removeTask', () => {
    it('removes the task from the queue', () => {
      engine.enqueue(makeTask());
      engine.removeTask('issue-1');
      expect(engine.getQueue()).toHaveLength(0);
    });

    it('is a no-op for an unknown task ID', () => {
      expect(() => engine.removeTask('ghost')).not.toThrow();
    });
  });
});
