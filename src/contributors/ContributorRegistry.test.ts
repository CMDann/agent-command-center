import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock logger before any module that imports it
// ---------------------------------------------------------------------------

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Mock GitHubService.fromEnv so the module-level singleton returns null
// (avoids env-variable dependency at import time)
// ---------------------------------------------------------------------------

vi.mock('../github/GitHubService.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../github/GitHubService.js')>();
  return {
    ...actual,
    GitHubService: class MockGitHubService extends actual.GitHubService {
      static fromEnv(): never {
        throw new actual.GitHubServiceError('No env in tests');
      }
    },
  };
});

import { ContributorRegistry } from './ContributorRegistry.js';
import type { Contributor, IssueSummary } from '../types.js';
import { GitHubService } from '../github/GitHubService.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const COLLABORATORS: Contributor[] = [
  { login: 'alice', name: 'Alice', role: 'owner', avatarUrl: 'https://example.com/alice.png' },
  { login: 'bob', role: 'contributor' },
  { login: 'carol', role: 'maintainer' },
];

const OPEN_ISSUES: IssueSummary[] = [
  {
    issueNumber: 7,
    title: 'Fix login bug',
    labels: [],
    assigneeLogin: 'bob',
    url: 'https://github.com/owner/repo/issues/7',
    state: 'open',
    updatedAt: new Date('2026-01-01'),
  },
];

function makeMockService(overrides: Partial<{
  getCollaborators: () => Promise<Contributor[]>;
  listIssues: () => Promise<IssueSummary[]>;
}> = {}): GitHubService {
  return {
    getCollaborators: overrides.getCollaborators ?? vi.fn().mockResolvedValue(COLLABORATORS),
    listIssues: overrides.listIssues ?? vi.fn().mockResolvedValue(OPEN_ISSUES),
  } as unknown as GitHubService;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ContributorRegistry', () => {
  let service: GitHubService;
  let registry: ContributorRegistry;

  beforeEach(() => {
    vi.useFakeTimers();
    service = makeMockService();
    registry = new ContributorRegistry(service);
  });

  afterEach(() => {
    registry.stop();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  it('starts with an empty contributor list', () => {
    expect(registry.getContributors()).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // load() via refresh()
  // -------------------------------------------------------------------------

  it('refresh() fetches collaborators and open issues', async () => {
    await registry.refresh();
    expect(service.getCollaborators).toHaveBeenCalledOnce();
    expect(service.listIssues).toHaveBeenCalledWith({ state: 'open' });
  });

  it('maps collaborators to Contributor model', async () => {
    await registry.refresh();
    const contributors = registry.getContributors();
    expect(contributors).toHaveLength(3);
    expect(contributors[0]).toMatchObject({ login: 'alice', name: 'Alice', role: 'owner' });
    expect(contributors[1]).toMatchObject({ login: 'bob', role: 'contributor' });
  });

  it('populates currentTaskId from open issue assignments', async () => {
    await registry.refresh();
    const bob = registry.getContributors().find((c) => c.login === 'bob');
    expect(bob?.currentTaskId).toBe('issue-7');
  });

  it('leaves currentTaskId undefined for contributors with no open issues', async () => {
    await registry.refresh();
    const alice = registry.getContributors().find((c) => c.login === 'alice');
    expect(alice?.currentTaskId).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // update event
  // -------------------------------------------------------------------------

  it('emits "update" event with the contributor list after load', async () => {
    const handler = vi.fn();
    registry.on('update', handler);
    await registry.refresh();
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ login: 'alice' }),
    ]));
  });

  // -------------------------------------------------------------------------
  // start() / stop()
  // -------------------------------------------------------------------------

  it('start() triggers an immediate load', async () => {
    // Wait for the 'update' event which fires after a successful load.
    const loaded = new Promise<void>((resolve) => {
      registry.once('update', () => resolve());
    });
    registry.start();
    await loaded;
    expect(service.getCollaborators).toHaveBeenCalledOnce();
  });

  it('start() schedules periodic refresh at the given interval', async () => {
    const INTERVAL = 60_000;
    const r = new ContributorRegistry(service, INTERVAL);

    const firstLoad = new Promise<void>((resolve) => { r.once('update', () => resolve()); });
    r.start();
    await firstLoad;

    // Advance timer to trigger a second refresh, then wait for it.
    const secondLoad = new Promise<void>((resolve) => { r.once('update', () => resolve()); });
    vi.advanceTimersByTime(INTERVAL);
    await secondLoad;

    expect(service.getCollaborators).toHaveBeenCalledTimes(2);
    r.stop();
  });

  it('stop() prevents further refreshes', async () => {
    const INTERVAL = 60_000;
    const r = new ContributorRegistry(service, INTERVAL);

    const firstLoad = new Promise<void>((resolve) => { r.once('update', () => resolve()); });
    r.start();
    await firstLoad;

    r.stop();

    // Advance past multiple intervals; no further loads should occur.
    vi.advanceTimersByTime(INTERVAL * 3);
    // Drain any pending microtasks.
    await Promise.resolve();

    // Only the initial load should have happened.
    expect(service.getCollaborators).toHaveBeenCalledOnce();
  });

  it('stop() is safe to call multiple times', () => {
    registry.start();
    expect(() => { registry.stop(); registry.stop(); }).not.toThrow();
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  it('keeps stale data when refresh fails', async () => {
    await registry.refresh(); // loads COLLABORATORS

    // Now make the service fail.
    (service.getCollaborators as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('network error')
    );

    await registry.refresh(); // should not throw
    // Old data preserved.
    expect(registry.getContributors()).toHaveLength(3);
  });

  it('does not emit "update" when refresh fails', async () => {
    (service.getCollaborators as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('network error')
    );
    const handler = vi.fn();
    registry.on('update', handler);
    await registry.refresh();
    expect(handler).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // getContributors() returns a copy
  // -------------------------------------------------------------------------

  it('getContributors() returns a shallow copy (mutation does not affect internal state)', async () => {
    await registry.refresh();
    const copy = registry.getContributors();
    copy.push({ login: 'hacker', role: 'contributor' });
    expect(registry.getContributors()).toHaveLength(3);
  });
});
