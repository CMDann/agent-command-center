import { EventEmitter } from 'events';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock execa before any adapter imports resolve
// ---------------------------------------------------------------------------

const { mockExeca } = vi.hoisted(() => ({ mockExeca: vi.fn() }));

vi.mock('execa', () => ({ execa: mockExeca }));

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Import modules AFTER mocks are set up
// ---------------------------------------------------------------------------

import { AgentManager, AgentNotFoundError } from './AgentManager.js';
import { AgentError } from './AgentAdapter.js';

// ---------------------------------------------------------------------------
// Subprocess mock factory
// ---------------------------------------------------------------------------

/**
 * Creates a mock execa subprocess that emits events and can be resolved or
 * rejected to simulate process exit.
 */
function createMockSubprocess(
  opts: { exitCode?: number; errorMessage?: string } = {}
): ReturnType<typeof mockExeca> & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  _resolve: () => void;
  _reject: (err: Error) => void;
} {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  let resolveP!: () => void;
  let rejectP!: (err: Error) => void;

  const promise = new Promise<void>((res, rej) => {
    resolveP = res;
    rejectP = rej;
  });

  const subprocess = Object.assign(promise, {
    pid: 42000,
    stdout,
    stderr,
    kill: vi.fn(() => rejectP(new Error('killed'))),
    _resolve: resolveP,
    _reject: rejectP,
  });

  if (opts.exitCode !== undefined && opts.exitCode !== 0) {
    // Schedule automatic rejection so tests that don't control the promise
    // still get a consistent failure.
    void Promise.resolve().then(() =>
      rejectP(new Error(opts.errorMessage ?? `Process exited with code ${opts.exitCode}`))
    );
  }

  return subprocess as ReturnType<typeof mockExeca> & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    _resolve: () => void;
    _reject: (err: Error) => void;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CLAUDE_CONFIG = { id: 'claude-1', type: 'claude' as const, autopr: true };
const CODEX_CONFIG = { id: 'codex-1', type: 'codex' as const, autopr: true };

const SAMPLE_TASK = {
  id: 'task-42',
  issueNumber: 42,
  title: 'Fix auth bug',
  body: 'Auth is broken',
  labels: ['bug'],
  status: 'backlog' as const,
  repoPath: '/projects/myapp',
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgentManager', () => {
  let manager: AgentManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new AgentManager();
  });

  // ---- register -----------------------------------------------------------

  describe('register', () => {
    it('adds the agent to the sessions list', () => {
      manager.register(CLAUDE_CONFIG);

      const sessions = manager.listAgents();
      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.id).toBe('claude-1');
      expect(sessions[0]?.status).toBe('disconnected');
    });

    it('supports registering multiple agents of different types', () => {
      manager.register(CLAUDE_CONFIG);
      manager.register(CODEX_CONFIG);

      expect(manager.listAgents()).toHaveLength(2);
    });

    it('replaces an existing adapter when re-registering the same ID', () => {
      manager.register(CLAUDE_CONFIG);
      manager.register({ ...CLAUDE_CONFIG, workdir: '/new/path' });

      const sessions = manager.listAgents();
      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.workdir).toBe('/new/path');
    });

    it('registers an openclaw agent via OpenClawAdapter', () => {
      // openclaw no longer throws — it creates an OpenClawAdapter
      expect(() =>
        manager.register({ id: 'oc-1', type: 'openclaw', autopr: true })
      ).not.toThrow();
      expect(manager.listAgents().find((s) => s.id === 'oc-1')).toBeDefined();
    });
  });

  // ---- connect ------------------------------------------------------------

  describe('connect', () => {
    it('calls connect on the adapter and updates status to idle', async () => {
      // --version check resolves immediately.
      const versionSub = createMockSubprocess();
      mockExeca.mockReturnValueOnce(versionSub);
      versionSub._resolve();

      manager.register(CLAUDE_CONFIG);
      await manager.connect('claude-1');

      const session = manager.listAgents()[0];
      expect(session?.status).toBe('idle');
    });

    it('throws AgentNotFoundError for an unknown agent', async () => {
      await expect(manager.connect('ghost')).rejects.toThrow(AgentNotFoundError);
    });

    it('propagates AgentError when the CLI is not found', async () => {
      const versionSub = createMockSubprocess({ exitCode: 1, errorMessage: 'command not found' });
      mockExeca.mockReturnValueOnce(versionSub);

      manager.register(CLAUDE_CONFIG);
      await expect(manager.connect('claude-1')).rejects.toThrow(AgentError);
    });
  });

  // ---- disconnect ---------------------------------------------------------

  describe('disconnect', () => {
    it('sets the agent status to disconnected', async () => {
      const versionSub = createMockSubprocess();
      mockExeca.mockReturnValueOnce(versionSub);
      versionSub._resolve();

      manager.register(CLAUDE_CONFIG);
      await manager.connect('claude-1');
      await manager.disconnect('claude-1');

      expect(manager.listAgents()[0]?.status).toBe('disconnected');
    });

    it('throws AgentNotFoundError for an unknown agent', async () => {
      await expect(manager.disconnect('ghost')).rejects.toThrow(AgentNotFoundError);
    });
  });

  // ---- dispatch -----------------------------------------------------------

  describe('dispatch', () => {
    it('dispatches a task to an idle agent and emits task_complete', async () => {
      // Step 1: connect (version check).
      const versionSub = createMockSubprocess();
      mockExeca.mockReturnValueOnce(versionSub);
      versionSub._resolve();

      // Step 2: dispatch (task process).
      const taskSub = createMockSubprocess();
      mockExeca.mockReturnValueOnce(taskSub);

      manager.register(CLAUDE_CONFIG);
      await manager.connect('claude-1');

      const completeSpy = vi.fn();
      manager.on('agent:task_complete', completeSpy);

      const dispatchPromise = manager.dispatch('claude-1', SAMPLE_TASK);

      // Emit some fake output, then resolve.
      taskSub.stdout.emit('data', Buffer.from('Working on it...\n'));
      taskSub._resolve();

      await dispatchPromise;

      expect(completeSpy).toHaveBeenCalledWith('claude-1');
      expect(manager.listAgents()[0]?.status).toBe('idle');
    });

    it('sets agent status to error when the task process fails', async () => {
      const versionSub = createMockSubprocess();
      mockExeca.mockReturnValueOnce(versionSub);
      versionSub._resolve();

      const taskSub = createMockSubprocess();
      mockExeca.mockReturnValueOnce(taskSub);

      manager.register(CLAUDE_CONFIG);
      await manager.connect('claude-1');

      taskSub._reject(new Error('non-zero exit'));
      await expect(manager.dispatch('claude-1', SAMPLE_TASK)).rejects.toThrow(AgentError);

      expect(manager.listAgents()[0]?.status).toBe('error');
    });

    it('throws AgentNotFoundError for an unknown agent', async () => {
      await expect(manager.dispatch('ghost', SAMPLE_TASK)).rejects.toThrow(AgentNotFoundError);
    });
  });

  // ---- getLogs ------------------------------------------------------------

  describe('getLogs', () => {
    it('returns empty array for an agent with no log output', () => {
      manager.register(CLAUDE_CONFIG);
      expect(manager.getLogs('claude-1')).toEqual([]);
    });

    it('returns empty array for an unknown agent', () => {
      expect(manager.getLogs('nobody')).toEqual([]);
    });

    it('accumulates log lines from a running task', async () => {
      const versionSub = createMockSubprocess();
      mockExeca.mockReturnValueOnce(versionSub);
      versionSub._resolve();

      const taskSub = createMockSubprocess();
      mockExeca.mockReturnValueOnce(taskSub);

      manager.register(CLAUDE_CONFIG);
      await manager.connect('claude-1');

      const dispatchPromise = manager.dispatch('claude-1', SAMPLE_TASK);
      taskSub.stdout.emit('data', Buffer.from('line one\nline two\n'));
      taskSub._resolve();
      await dispatchPromise;

      const logs = manager.getLogs('claude-1');
      expect(logs.some((l) => l.includes('line one'))).toBe(true);
      expect(logs.some((l) => l.includes('line two'))).toBe(true);
    });
  });

  // ---- event forwarding ---------------------------------------------------

  describe('event forwarding', () => {
    it('fires agent:status when an agent status changes', async () => {
      const versionSub = createMockSubprocess();
      mockExeca.mockReturnValueOnce(versionSub);
      versionSub._resolve();

      const statusSpy = vi.fn();
      manager.on('agent:status', statusSpy);

      manager.register(CLAUDE_CONFIG);
      await manager.connect('claude-1');

      expect(statusSpy).toHaveBeenCalledWith('claude-1', 'idle');
    });

    it('fires agent:log when the adapter emits a log line', async () => {
      const versionSub = createMockSubprocess();
      mockExeca.mockReturnValueOnce(versionSub);
      versionSub._resolve();

      const taskSub = createMockSubprocess();
      mockExeca.mockReturnValueOnce(taskSub);

      const logSpy = vi.fn();
      manager.on('agent:log', logSpy);

      manager.register(CLAUDE_CONFIG);
      await manager.connect('claude-1');

      const dispatchPromise = manager.dispatch('claude-1', SAMPLE_TASK);
      taskSub.stdout.emit('data', 'hello from agent');
      taskSub._resolve();
      await dispatchPromise;

      expect(logSpy).toHaveBeenCalledWith(
        'claude-1',
        expect.stringContaining('hello from agent')
      );
    });
  });

  // ---- onStatusChange / onLog helpers -------------------------------------

  describe('onStatusChange', () => {
    it('registers a status change listener', async () => {
      const versionSub = createMockSubprocess();
      mockExeca.mockReturnValueOnce(versionSub);
      versionSub._resolve();

      const cb = vi.fn();
      manager.onStatusChange(cb);
      manager.register(CLAUDE_CONFIG);
      await manager.connect('claude-1');

      expect(cb).toHaveBeenCalledWith('claude-1', 'idle');
    });
  });

  // ---- codex adapter wired ------------------------------------------------

  describe('codex adapter', () => {
    it('registers a codex agent and resolves connect', async () => {
      const versionSub = createMockSubprocess();
      mockExeca.mockReturnValueOnce(versionSub);
      versionSub._resolve();

      manager.register(CODEX_CONFIG);
      await manager.connect('codex-1');

      expect(manager.listAgents()[0]?.status).toBe('idle');
      expect(mockExeca).toHaveBeenCalledWith(
        'codex',
        ['--version'],
        expect.anything()
      );
    });
  });

  // ---- AgentNotFoundError -------------------------------------------------

  describe('AgentNotFoundError', () => {
    it('has the correct name and message', () => {
      const err = new AgentNotFoundError('my-agent');
      expect(err.name).toBe('AgentNotFoundError');
      expect(err.message).toContain('my-agent');
      expect(err instanceof Error).toBe(true);
    });
  });
});
