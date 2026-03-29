import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — set up before any imports that depend on them
// ---------------------------------------------------------------------------

vi.mock('../tasks/TaskEngine.js', () => ({
  taskEngine: {
    markComplete: vi.fn(),
    markFailed: vi.fn(),
  },
}));

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Imports — after mocks
// ---------------------------------------------------------------------------

import { AgentPRWrapper, toKebab } from './AgentPRWrapper.js';
import { AgentAdapter } from './AgentAdapter.js';
import { GitService } from '../git/GitService.js';
import { GitHubWriteService } from '../github/GitHubWriteService.js';
import { taskEngine } from '../tasks/TaskEngine.js';
import type { AgentConfig, Task } from '../types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const AGENT_CONFIG: AgentConfig = {
  id: 'test-agent',
  type: 'claude',
  autopr: true,
};

const SAMPLE_TASK: Task = {
  id: 'issue-42',
  issueNumber: 42,
  title: 'Fix auth bug',
  body: 'Auth is broken',
  labels: [],
  status: 'assigned',
  repoPath: '/workspace/repo',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

const SAMPLE_PR = {
  prNumber: 99,
  title: '[NEXUS] Fix auth bug',
  url: 'https://github.com/owner/repo/pull/99',
  status: 'open' as const,
  head: 'nexus/task-42-fix-auth-bug',
  base: 'main',
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ---------------------------------------------------------------------------
// Stub inner adapter
// ---------------------------------------------------------------------------

/**
 * Minimal concrete `AgentAdapter` used as the `inner` in tests.
 * `dispatch()` immediately emits `task_complete` so the PR flow runs
 * synchronously (for predictable test assertions).
 */
class StubAdapter extends AgentAdapter {
  /** Set to true to simulate a dispatch failure. */
  failDispatch = false;

  /** Public escape hatch for tests: drives the adapter into a specific status. */
  forceStatus(s: import('../types.js').AgentStatus): void {
    this.setStatus(s);
  }

  async connect(): Promise<void> {
    this.setStatus('idle');
  }

  async disconnect(): Promise<void> {
    this.setStatus('disconnected');
  }

  async dispatch(task: Task): Promise<void> {
    if (this.failDispatch) {
      throw new Error('stub dispatch failed');
    }
    this.session = { ...this.session, currentTask: task.id };
    this.setStatus('working');
    // Emit synchronously — tests can await dispatch() and then check state.
    this.emit('task_complete', {});
    this.setStatus('idle');
  }
}

// ---------------------------------------------------------------------------
// Mock service factories
// ---------------------------------------------------------------------------

function makeMockGit(overrides: Partial<{
  createBranch: () => Promise<void>;
  getCommitsAheadOf: () => Promise<number>;
  pushBranch: () => Promise<void>;
}> = {}): GitService {
  return {
    createBranch: overrides.createBranch ?? vi.fn().mockResolvedValue(undefined),
    getCommitsAheadOf: overrides.getCommitsAheadOf ?? vi.fn().mockResolvedValue(3),
    pushBranch: overrides.pushBranch ?? vi.fn().mockResolvedValue(undefined),
  } as unknown as GitService;
}

function makeMockWrite(overrides: Partial<{
  createPR: () => Promise<typeof SAMPLE_PR>;
  addComment: () => Promise<void>;
}> = {}): GitHubWriteService {
  return {
    createPR: overrides.createPR ?? vi.fn().mockResolvedValue(SAMPLE_PR),
    addComment: overrides.addComment ?? vi.fn().mockResolvedValue(undefined),
  } as unknown as GitHubWriteService;
}

// ---------------------------------------------------------------------------
// Helper to flush microtasks (the PR flow runs in a void async callback)
// ---------------------------------------------------------------------------

function flushAsync(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('toKebab', () => {
  it('lowercases and replaces non-alphanumeric runs', () => {
    expect(toKebab('Fix: Auth Bug')).toBe('fix-auth-bug');
  });

  it('trims leading and trailing dashes', () => {
    expect(toKebab('--hello world--')).toBe('hello-world');
  });

  it('truncates to 40 chars and strips trailing dash', () => {
    const long = 'a'.repeat(50);
    const result = toKebab(long);
    expect(result.length).toBeLessThanOrEqual(40);
    expect(result).not.toMatch(/-$/);
  });

  it('handles special characters in a real issue title', () => {
    const result = toKebab('Fix: Auth Token Refresh — Phase 2 (Edge Cases!!)');
    expect(result).toMatch(/^[a-z0-9-]+$/);
    expect(result.length).toBeLessThanOrEqual(40);
  });
});

describe('AgentPRWrapper', () => {
  let inner: StubAdapter;
  let mockGit: GitService;
  let mockWrite: GitHubWriteService;
  let gitFactory: (repoPath: string) => GitService;
  let wrapper: AgentPRWrapper;
  let emittedEvents: Array<{ event: string; args: unknown[] }>;

  beforeEach(() => {
    vi.clearAllMocks();

    inner = new StubAdapter(AGENT_CONFIG);
    mockGit = makeMockGit();
    mockWrite = makeMockWrite();
    gitFactory = vi.fn().mockReturnValue(mockGit);

    wrapper = new AgentPRWrapper(inner, gitFactory, mockWrite, AGENT_CONFIG);

    // Manually set the wrapper's status to idle (simulating post-connect state).
    // `connect()` delegates to inner which calls `setStatus('idle')`, but the
    // inner's status event needs to fire first. We prime it directly here.
    inner.forceStatus('idle'); // triggers status event which updates wrapper

    emittedEvents = [];
    wrapper.on('task_complete', (...args) => emittedEvents.push({ event: 'task_complete', args }));
    wrapper.on('log', (...args) => emittedEvents.push({ event: 'log', args }));
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it('happy path: creates branch, pushes, opens PR, comments, marks task complete', async () => {
    await wrapper.dispatch(SAMPLE_TASK);
    await flushAsync();

    const branchName = 'nexus/task-42-fix-auth-bug';

    // GitService factory called with task repoPath
    expect(gitFactory).toHaveBeenCalledWith(SAMPLE_TASK.repoPath);

    // Branch created
    expect(mockGit.createBranch).toHaveBeenCalledWith(branchName);

    // Commits checked
    expect(mockGit.getCommitsAheadOf).toHaveBeenCalledWith('main');

    // Branch pushed
    expect(mockGit.pushBranch).toHaveBeenCalledWith(branchName);

    // PR opened with correct title and body
    expect(mockWrite.createPR).toHaveBeenCalledWith({
      title: '[NEXUS] Fix auth bug',
      body: expect.stringContaining('#42') as string,
      head: branchName,
      base: 'main',
    });

    // Comment posted on the issue
    expect(mockWrite.addComment).toHaveBeenCalledWith(
      42,
      expect.stringContaining('test-agent') as string
    );
    expect(mockWrite.addComment).toHaveBeenCalledWith(
      42,
      expect.stringContaining(SAMPLE_PR.url) as string
    );

    // TaskEngine notified
    expect(taskEngine.markComplete).toHaveBeenCalledWith('issue-42', {
      success: true,
      prUrl: SAMPLE_PR.url,
      prNumber: SAMPLE_PR.prNumber,
    });

    // Wrapper emits enriched task_complete
    const tc = emittedEvents.find((e) => e.event === 'task_complete');
    expect(tc).toBeDefined();
    expect(tc?.args[0]).toMatchObject({ prUrl: SAMPLE_PR.url, prNumber: SAMPLE_PR.prNumber });
  });

  // -------------------------------------------------------------------------
  // Branch name generation
  // -------------------------------------------------------------------------

  it('generates correct branch name with issue number and kebab title', async () => {
    await wrapper.dispatch(SAMPLE_TASK);
    expect(mockGit.createBranch).toHaveBeenCalledWith('nexus/task-42-fix-auth-bug');
  });

  it('branch name is kebab-cased and length-bounded for long titles', async () => {
    const task: Task = {
      ...SAMPLE_TASK,
      title: 'Fix: Auth Token Refresh — Phase 2 (Edge Cases!!)',
    };
    await wrapper.dispatch(task);
    await flushAsync();

    const [[branchName]] = (mockGit.createBranch as ReturnType<typeof vi.fn>).mock.calls as [[string]];
    expect(branchName).toMatch(/^nexus\/task-42-[a-z0-9-]+$/);
    expect(branchName.length).toBeLessThanOrEqual(55); // 'nexus/task-42-' + 40 chars
    expect(branchName).not.toMatch(/-$/);
  });

  // -------------------------------------------------------------------------
  // Pre-dispatch failure: branch creation
  // -------------------------------------------------------------------------

  it('createBranch failure: marks task failed, throws, inner dispatch never called', async () => {
    const gitFail = makeMockGit({
      createBranch: vi.fn().mockRejectedValue(new Error('branch already exists')),
    });
    const failFactory = vi.fn().mockReturnValue(gitFail);
    const w = new AgentPRWrapper(inner, failFactory, mockWrite, AGENT_CONFIG);
    inner.forceStatus('idle');

    const dispatchSpy = vi.spyOn(inner, 'dispatch');

    await expect(w.dispatch(SAMPLE_TASK)).rejects.toThrow('branch already exists');

    expect(taskEngine.markFailed).toHaveBeenCalledWith('issue-42');
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(mockWrite.createPR).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // No commits ahead of main
  // -------------------------------------------------------------------------

  it('skips PR when branch has no commits ahead of main', async () => {
    const gitNoCommits = makeMockGit({
      getCommitsAheadOf: vi.fn().mockResolvedValue(0),
    });
    const noCommitsFactory = vi.fn().mockReturnValue(gitNoCommits);
    const w = new AgentPRWrapper(inner, noCommitsFactory, mockWrite, AGENT_CONFIG);
    inner.forceStatus('idle');

    // Capture events
    const events: Array<{ event: string; args: unknown[] }> = [];
    w.on('task_complete', (...args) => events.push({ event: 'task_complete', args }));

    await w.dispatch(SAMPLE_TASK);
    await flushAsync();

    expect(gitNoCommits.pushBranch).not.toHaveBeenCalled();
    expect(mockWrite.createPR).not.toHaveBeenCalled();
    expect(taskEngine.markFailed).toHaveBeenCalledWith('issue-42');
    // task_complete still emitted so listeners are unblocked
    expect(events.some((e) => e.event === 'task_complete')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // pushBranch failure
  // -------------------------------------------------------------------------

  it('pushBranch failure: logs error, marks task failed, emits task_complete', async () => {
    const gitPushFail = makeMockGit({
      pushBranch: vi.fn().mockRejectedValue(new Error('push rejected')),
    });
    const pushFailFactory = vi.fn().mockReturnValue(gitPushFail);
    const w = new AgentPRWrapper(inner, pushFailFactory, mockWrite, AGENT_CONFIG);
    inner.forceStatus('idle');

    const events: Array<{ event: string; args: unknown[] }> = [];
    w.on('task_complete', (...args) => events.push({ event: 'task_complete', args }));

    await w.dispatch(SAMPLE_TASK);
    await flushAsync();

    expect(mockWrite.createPR).not.toHaveBeenCalled();
    expect(taskEngine.markFailed).toHaveBeenCalledWith('issue-42');
    expect(events.some((e) => e.event === 'task_complete')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // createPR failure
  // -------------------------------------------------------------------------

  it('createPR failure: logs error, marks task failed, does not call addComment', async () => {
    const writePRFail = makeMockWrite({
      createPR: vi.fn().mockRejectedValue(new Error('GitHub API error')),
    });
    const w = new AgentPRWrapper(inner, gitFactory, writePRFail, AGENT_CONFIG);
    inner.forceStatus('idle');

    const events: Array<{ event: string; args: unknown[] }> = [];
    w.on('task_complete', (...args) => events.push({ event: 'task_complete', args }));

    await w.dispatch(SAMPLE_TASK);
    await flushAsync();

    expect(writePRFail.addComment).not.toHaveBeenCalled();
    expect(taskEngine.markFailed).toHaveBeenCalledWith('issue-42');
    expect(events.some((e) => e.event === 'task_complete')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Event forwarding
  // -------------------------------------------------------------------------

  it('forwards status events from inner to wrapper', async () => {
    const statusEvents: unknown[] = [];
    wrapper.on('status', (s) => statusEvents.push(s));

    await wrapper.connect();

    expect(statusEvents).toContain('idle');
  });

  it('forwards log events from inner to wrapper without double-prefixing', async () => {
    const logLines: string[] = [];
    wrapper.on('log', (line: string) => logLines.push(line));

    // The inner adapter emits log on dispatch.
    inner.emit('log', '[test-agent] working on task');

    expect(logLines).toContain('[test-agent] working on task');
  });

  it('does not double-emit task_complete for a single dispatch', async () => {
    const tcEvents: unknown[] = [];
    wrapper.on('task_complete', (r) => tcEvents.push(r));

    await wrapper.dispatch(SAMPLE_TASK);
    await flushAsync();

    expect(tcEvents).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // connect / disconnect delegation
  // -------------------------------------------------------------------------

  it('connect delegates to inner', async () => {
    const connectSpy = vi.spyOn(inner, 'connect');
    await wrapper.connect();
    expect(connectSpy).toHaveBeenCalledOnce();
  });

  it('disconnect delegates to inner', async () => {
    const disconnectSpy = vi.spyOn(inner, 'disconnect');
    await wrapper.disconnect();
    expect(disconnectSpy).toHaveBeenCalledOnce();
  });

  // -------------------------------------------------------------------------
  // Idle guard
  // -------------------------------------------------------------------------

  it('throws AgentError when dispatching to a non-idle agent', async () => {
    inner.forceStatus('working');
    await expect(wrapper.dispatch(SAMPLE_TASK)).rejects.toThrow("is not idle");
  });
});
