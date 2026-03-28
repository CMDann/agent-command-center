import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock @octokit/rest BEFORE importing GitHubService
// ---------------------------------------------------------------------------

const { mockRest } = vi.hoisted(() => {
  const mockRest = {
    issues: {
      listForRepo: vi.fn(),
      create: vi.fn(),
      createComment: vi.fn(),
    },
    pulls: {
      create: vi.fn(),
      get: vi.fn(),
    },
    repos: {
      listCollaborators: vi.fn(),
    },
  };
  return { mockRest };
});

vi.mock('@octokit/rest', () => ({
  Octokit: vi.fn(() => ({ rest: mockRest })),
}));

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { GitHubService, GitHubServiceError } from './GitHubService.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_CONFIG = { token: 'ghp_test', owner: 'acme', repo: 'widget' };

interface RawIssue {
  number: number;
  title: string;
  body: string;
  state: string;
  html_url: string;
  created_at: string;
  updated_at: string;
  labels: { name: string }[];
  assignee: { login: string } | null;
  pull_request: unknown;
}

function makeRawIssue(overrides: Partial<RawIssue> = {}): RawIssue {
  return {
    number: overrides.number ?? 1,
    title: overrides.title ?? 'Test issue',
    body: overrides.body ?? 'Body text',
    state: overrides.state ?? 'open',
    html_url: overrides.html_url ?? 'https://github.com/acme/widget/issues/1',
    created_at: overrides.created_at ?? '2026-01-01T00:00:00Z',
    updated_at: overrides.updated_at ?? '2026-01-02T00:00:00Z',
    labels: overrides.labels ?? [],
    assignee: overrides.assignee ?? null,
    pull_request: overrides.pull_request,
  };
}

interface RawPR {
  number: number;
  title: string;
  html_url: string;
  state: string;
  draft: boolean;
  merged_at: string | null;
  head: { ref: string };
  base: { ref: string };
  created_at: string;
  updated_at: string;
}

function makeRawPR(overrides: Partial<RawPR> = {}): RawPR {
  return {
    number: overrides.number ?? 10,
    title: overrides.title ?? 'Test PR',
    html_url: overrides.html_url ?? 'https://github.com/acme/widget/pull/10',
    state: overrides.state ?? 'open',
    draft: overrides.draft ?? false,
    merged_at: overrides.merged_at ?? null,
    head: overrides.head ?? { ref: 'feat/branch' },
    base: overrides.base ?? { ref: 'main' },
    created_at: overrides.created_at ?? '2026-01-01T00:00:00Z',
    updated_at: overrides.updated_at ?? '2026-01-02T00:00:00Z',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GitHubService', () => {
  let service: GitHubService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new GitHubService(BASE_CONFIG);
  });

  // ---- getIssues ----------------------------------------------------------

  describe('getIssues', () => {
    it('returns mapped open issues', async () => {
      const raw = makeRawIssue({
        number: 42,
        title: 'Fix auth bug',
        labels: [{ name: 'bug' }],
        assignee: { login: 'alice' },
      });
      mockRest.issues.listForRepo.mockResolvedValue({ data: [raw] });

      const issues = await service.getIssues();

      expect(issues).toHaveLength(1);
      expect(issues[0]?.issueNumber).toBe(42);
      expect(issues[0]?.title).toBe('Fix auth bug');
      expect(issues[0]?.labels).toEqual(['bug']);
      expect(issues[0]?.assigneeLogin).toBe('alice');
    });

    it('filters out pull requests from the response', async () => {
      const pr = makeRawIssue({ number: 99, pull_request: { url: 'https://...' } });
      const issue = makeRawIssue({ number: 1 });
      mockRest.issues.listForRepo.mockResolvedValue({ data: [pr, issue] });

      const issues = await service.getIssues();

      expect(issues).toHaveLength(1);
      expect(issues[0]?.issueNumber).toBe(1);
    });

    it('passes filters to Octokit', async () => {
      mockRest.issues.listForRepo.mockResolvedValue({ data: [] });

      await service.getIssues({ state: 'closed', labels: ['bug', 'urgent'], assignee: 'bob' });

      expect(mockRest.issues.listForRepo).toHaveBeenCalledWith(
        expect.objectContaining({
          state: 'closed',
          labels: 'bug,urgent',
          assignee: 'bob',
        })
      );
    });

    it('uses open state by default', async () => {
      mockRest.issues.listForRepo.mockResolvedValue({ data: [] });

      await service.getIssues();

      expect(mockRest.issues.listForRepo).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'open' })
      );
    });

    it('throws GitHubServiceError on API failure', async () => {
      mockRest.issues.listForRepo.mockRejectedValue(
        Object.assign(new Error('API error'), { status: 404 })
      );

      await expect(service.getIssues()).rejects.toThrow(GitHubServiceError);
    });
  });

  // ---- createIssue --------------------------------------------------------

  describe('createIssue', () => {
    it('creates and returns a mapped issue', async () => {
      const raw = makeRawIssue({ number: 5, title: 'New feature' });
      mockRest.issues.create.mockResolvedValue({ data: raw });

      const issue = await service.createIssue({ title: 'New feature', labels: ['enhancement'] });

      expect(issue.issueNumber).toBe(5);
      expect(issue.title).toBe('New feature');
    });

    it('passes all input fields to Octokit', async () => {
      mockRest.issues.create.mockResolvedValue({ data: makeRawIssue() });

      await service.createIssue({
        title: 'Bug',
        body: 'Description',
        labels: ['bug'],
        assignees: ['alice'],
      });

      expect(mockRest.issues.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Bug',
          body: 'Description',
          labels: ['bug'],
          assignees: ['alice'],
        })
      );
    });

    it('throws GitHubServiceError on API failure', async () => {
      mockRest.issues.create.mockRejectedValue(new Error('Validation failed'));

      await expect(service.createIssue({ title: 'X' })).rejects.toThrow(GitHubServiceError);
    });
  });

  // ---- createPR -----------------------------------------------------------

  describe('createPR', () => {
    it('creates and returns a mapped PR', async () => {
      const raw = makeRawPR({ number: 77, title: 'feat: add oauth' });
      mockRest.pulls.create.mockResolvedValue({ data: raw });

      const pr = await service.createPR({
        title: 'feat: add oauth',
        head: 'feat/oauth',
        base: 'main',
      });

      expect(pr.prNumber).toBe(77);
      expect(pr.title).toBe('feat: add oauth');
      expect(pr.status).toBe('open');
    });

    it('resolves merged status when merged_at is set', async () => {
      const raw = makeRawPR({
        state: 'closed',
        merged_at: '2026-03-01T00:00:00Z',
      });
      mockRest.pulls.create.mockResolvedValue({ data: raw });

      const pr = await service.createPR({ title: 'X', head: 'feat/x', base: 'main' });

      expect(pr.status).toBe('merged');
    });

    it('resolves draft status', async () => {
      const raw = makeRawPR({ draft: true });
      mockRest.pulls.create.mockResolvedValue({ data: raw });

      const pr = await service.createPR({ title: 'X', head: 'feat/x', base: 'main' });

      expect(pr.status).toBe('draft');
    });

    it('throws GitHubServiceError on API failure', async () => {
      mockRest.pulls.create.mockRejectedValue(new Error('Conflict'));

      await expect(
        service.createPR({ title: 'X', head: 'feat/x', base: 'main' })
      ).rejects.toThrow(GitHubServiceError);
    });
  });

  // ---- getPRStatus --------------------------------------------------------

  describe('getPRStatus', () => {
    it('fetches and returns the PR status', async () => {
      const raw = makeRawPR({ number: 42, state: 'open' });
      mockRest.pulls.get.mockResolvedValue({ data: raw });

      const pr = await service.getPRStatus(42);

      expect(pr.prNumber).toBe(42);
      expect(pr.status).toBe('open');
    });

    it('passes the pull_number to Octokit', async () => {
      mockRest.pulls.get.mockResolvedValue({ data: makeRawPR() });

      await service.getPRStatus(55);

      expect(mockRest.pulls.get).toHaveBeenCalledWith(
        expect.objectContaining({ pull_number: 55 })
      );
    });

    it('throws GitHubServiceError when the PR is not found', async () => {
      mockRest.pulls.get.mockRejectedValue(Object.assign(new Error('Not Found'), { status: 404 }));

      await expect(service.getPRStatus(999)).rejects.toThrow(GitHubServiceError);
    });
  });

  // ---- getCollaborators ---------------------------------------------------

  describe('getCollaborators', () => {
    it('returns mapped contributors', async () => {
      mockRest.repos.listCollaborators.mockResolvedValue({
        data: [
          { login: 'alice', name: 'Alice A', avatar_url: 'https://img/alice', permissions: { admin: true } },
          { login: 'bob', name: 'Bob B', avatar_url: 'https://img/bob', permissions: { push: true } },
          { login: 'carol', name: 'Carol', avatar_url: 'https://img/carol', permissions: { pull: true } },
        ],
      });

      const contributors = await service.getCollaborators();

      expect(contributors).toHaveLength(3);
      expect(contributors[0]?.role).toBe('owner');
      expect(contributors[1]?.role).toBe('maintainer');
      expect(contributors[2]?.role).toBe('contributor');
    });

    it('throws GitHubServiceError on permission error', async () => {
      mockRest.repos.listCollaborators.mockRejectedValue(
        Object.assign(new Error('Forbidden'), { status: 403 })
      );

      await expect(service.getCollaborators()).rejects.toThrow(GitHubServiceError);
    });
  });

  // ---- addComment ---------------------------------------------------------

  describe('addComment', () => {
    it('calls Octokit with the correct issue number and body', async () => {
      mockRest.issues.createComment.mockResolvedValue({ data: {} });

      await service.addComment(42, 'PR opened: https://github.com/acme/widget/pull/10');

      expect(mockRest.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          issue_number: 42,
          body: 'PR opened: https://github.com/acme/widget/pull/10',
        })
      );
    });

    it('throws GitHubServiceError on API failure', async () => {
      mockRest.issues.createComment.mockRejectedValue(new Error('Forbidden'));

      await expect(service.addComment(1, 'hello')).rejects.toThrow(GitHubServiceError);
    });
  });

  // ---- GitHubServiceError -------------------------------------------------

  describe('GitHubServiceError', () => {
    it('carries statusCode and is an instance of Error', () => {
      const err = new GitHubServiceError('Not found', 404);

      expect(err.name).toBe('GitHubServiceError');
      expect(err.statusCode).toBe(404);
      expect(err instanceof Error).toBe(true);
    });
  });
});
