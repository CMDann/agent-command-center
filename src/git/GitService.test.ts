import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock simple-git BEFORE importing GitService
// ---------------------------------------------------------------------------

const { mockGit } = vi.hoisted(() => {
  const mockGit = {
    status: vi.fn(),
    log: vi.fn(),
    checkoutLocalBranch: vi.fn(),
    getRemotes: vi.fn(),
  };
  return { mockGit };
});

vi.mock('simple-git', () => ({
  default: vi.fn(() => mockGit),
}));

// Mock the logger so file I/O doesn't happen during tests
vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

// Mock fs so detectSubRepos doesn't touch the real filesystem
vi.mock('fs', () => ({
  readdirSync: vi.fn(() => []),
  statSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

import { GitService, GitServiceError } from './GitService.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface FakeStatus {
  current: string | null;
  ahead: number;
  behind: number;
  modified: string[];
  not_added: string[];
  staged: string[];
  deleted: string[];
  isClean: () => boolean;
}

function makeStatus(overrides: Partial<FakeStatus> = {}): FakeStatus {
  return {
    current: overrides.current ?? 'main',
    ahead: overrides.ahead ?? 0,
    behind: overrides.behind ?? 0,
    modified: overrides.modified ?? [],
    not_added: overrides.not_added ?? [],
    staged: overrides.staged ?? [],
    deleted: overrides.deleted ?? [],
    isClean: overrides.isClean ?? ((): boolean => true),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GitService', () => {
  let service: GitService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new GitService('/fake/workdir');
  });

  // ---- getCurrentBranch ---------------------------------------------------

  describe('getCurrentBranch', () => {
    it('returns the branch name from git status', async () => {
      mockGit.status.mockResolvedValue(makeStatus({ current: 'feat/my-feature' }));

      const branch = await service.getCurrentBranch();

      expect(branch).toBe('feat/my-feature');
    });

    it("returns 'HEAD' when current branch is null (detached HEAD)", async () => {
      // Bypass makeStatus because null is treated as nullish by ??, which would
      // substitute the default 'main'. Set current: null directly on the mock.
      mockGit.status.mockResolvedValue({
        current: null,
        ahead: 0,
        behind: 0,
        modified: [],
        not_added: [],
        staged: [],
        deleted: [],
        isClean: () => true,
      });

      const branch = await service.getCurrentBranch();

      expect(branch).toBe('HEAD');
    });

    it('throws GitServiceError when git status fails', async () => {
      mockGit.status.mockRejectedValue(new Error('not a git repo'));

      await expect(service.getCurrentBranch()).rejects.toThrow(GitServiceError);
    });
  });

  // ---- getStatus ----------------------------------------------------------

  describe('getStatus', () => {
    it('returns a clean status snapshot', async () => {
      mockGit.status.mockResolvedValue(
        makeStatus({ current: 'main', isClean: () => true })
      );

      const status = await service.getStatus();

      expect(status.branch).toBe('main');
      expect(status.isDirty).toBe(false);
      expect(status.modified).toEqual([]);
    });

    it('reflects dirty state when modified files are present', async () => {
      mockGit.status.mockResolvedValue(
        makeStatus({
          current: 'fix/auth',
          modified: ['src/auth.ts', 'src/api.ts'],
          not_added: ['src/new.ts'],
          isClean: () => false,
        })
      );

      const status = await service.getStatus();

      expect(status.isDirty).toBe(true);
      expect(status.modified).toEqual(['src/auth.ts', 'src/api.ts']);
      expect(status.untracked).toEqual(['src/new.ts']);
    });

    it('includes staged and deleted files', async () => {
      mockGit.status.mockResolvedValue(
        makeStatus({
          staged: ['src/staged.ts'],
          deleted: ['src/old.ts'],
          isClean: () => false,
        })
      );

      const status = await service.getStatus();

      expect(status.staged).toContain('src/staged.ts');
      expect(status.deleted).toContain('src/old.ts');
    });

    it('throws GitServiceError on failure', async () => {
      mockGit.status.mockRejectedValue(new Error('git error'));

      await expect(service.getStatus()).rejects.toThrow(GitServiceError);
    });
  });

  // ---- getAheadBehind -----------------------------------------------------

  describe('getAheadBehind', () => {
    it('returns ahead and behind counts from status', async () => {
      mockGit.status.mockResolvedValue(makeStatus({ ahead: 3, behind: 1 }));

      const result = await service.getAheadBehind();

      expect(result.ahead).toBe(3);
      expect(result.behind).toBe(1);
    });

    it('returns zeros when branch is in sync with remote', async () => {
      mockGit.status.mockResolvedValue(makeStatus({ ahead: 0, behind: 0 }));

      const result = await service.getAheadBehind();

      expect(result).toEqual({ ahead: 0, behind: 0 });
    });

    it('throws GitServiceError on failure', async () => {
      mockGit.status.mockRejectedValue(new Error('git error'));

      await expect(service.getAheadBehind()).rejects.toThrow(GitServiceError);
    });
  });

  // ---- getRecentCommits ---------------------------------------------------

  describe('getRecentCommits', () => {
    const rawLogEntries = [
      {
        hash: 'abc1234567890',
        date: '2026-03-28',
        message: 'feat: add feature',
        author_name: 'Alice',
      },
      {
        hash: 'def9876543210',
        date: '2026-03-27',
        message: 'fix: patch bug',
        author_name: 'Bob',
      },
    ];

    it('returns mapped commits with short hashes', async () => {
      mockGit.log.mockResolvedValue({ all: rawLogEntries });

      const commits = await service.getRecentCommits(5);

      expect(commits).toHaveLength(2);
      expect(commits[0]?.hash).toBe('abc1234');
      expect(commits[0]?.message).toBe('feat: add feature');
      expect(commits[0]?.author).toBe('Alice');
    });

    it('passes maxCount to simple-git log', async () => {
      mockGit.log.mockResolvedValue({ all: [] });

      await service.getRecentCommits(10);

      expect(mockGit.log).toHaveBeenCalledWith({ maxCount: 10 });
    });

    it('throws GitServiceError when log fails', async () => {
      mockGit.log.mockRejectedValue(new Error('git error'));

      await expect(service.getRecentCommits(5)).rejects.toThrow(GitServiceError);
    });
  });

  // ---- createBranch -------------------------------------------------------

  describe('createBranch', () => {
    it('calls checkoutLocalBranch with the given name', async () => {
      mockGit.checkoutLocalBranch.mockResolvedValue(undefined);

      await service.createBranch('nexus/task-42-fix-auth');

      expect(mockGit.checkoutLocalBranch).toHaveBeenCalledWith('nexus/task-42-fix-auth');
    });

    it('throws GitServiceError when checkout fails', async () => {
      mockGit.checkoutLocalBranch.mockRejectedValue(new Error('branch exists'));

      await expect(service.createBranch('duplicate-branch')).rejects.toThrow(GitServiceError);
    });
  });

  // ---- GitServiceError ----------------------------------------------------

  describe('GitServiceError', () => {
    it('has the correct name and preserves message', () => {
      const err = new GitServiceError('something went wrong', new Error('cause'));

      expect(err.name).toBe('GitServiceError');
      expect(err.message).toBe('something went wrong');
      expect(err instanceof Error).toBe(true);
    });
  });
});
