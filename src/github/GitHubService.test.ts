import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock @octokit/rest BEFORE importing GitHubService
// ---------------------------------------------------------------------------

const { mockRest } = vi.hoisted(() => {
  const mockRest = {
    issues: {
      listForRepo: vi.fn(),
    },
    pulls: {
      list: vi.fn(),
      get: vi.fn(),
    },
    repos: {
      getCombinedStatusForRef: vi.fn(),
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
  state: string;
  html_url: string;
  updated_at: string;
  labels: { name: string }[];
  assignee: { login: string } | null;
  pull_request?: unknown;
}

function makeRawIssue(overrides: Partial<RawIssue> = {}): RawIssue {
  return {
    number: overrides.number ?? 1,
    title: overrides.title ?? 'Test issue',
    state: overrides.state ?? 'open',
    html_url: overrides.html_url ?? 'https://github.com/acme/widget/issues/1',
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

describe('GitHubService (read-only)', () => {
  let service: GitHubService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new GitHubService(BASE_CONFIG);
  });

  describe('fromEnv', () => {
    it('builds from conventional env vars', () => {
      const s = GitHubService.fromEnv({
        GITHUB_TOKEN: 'ghp_x',
        GITHUB_OWNER: 'o',
        GITHUB_REPO: 'r',
      });
      expect(s).toBeInstanceOf(GitHubService);
    });

    it('throws when required owner/repo are missing', () => {
      expect(() => GitHubService.fromEnv({ GITHUB_TOKEN: 'x' })).toThrow(GitHubServiceError);
    });
  });

  describe('listIssues', () => {
    it('returns mapped open issues', async () => {
      const raw = makeRawIssue({
        number: 42,
        title: 'Fix auth bug',
        labels: [{ name: 'bug' }],
        assignee: { login: 'alice' },
      });
      mockRest.issues.listForRepo.mockResolvedValue({ data: [raw] });

      const issues = await service.listIssues();

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

      const issues = await service.listIssues();

      expect(issues).toHaveLength(1);
      expect(issues[0]?.issueNumber).toBe(1);
    });

    it('passes filters to Octokit', async () => {
      mockRest.issues.listForRepo.mockResolvedValue({ data: [] });

      await service.listIssues({ state: 'closed', labels: ['bug', 'urgent'], assignee: 'bob' });

      expect(mockRest.issues.listForRepo).toHaveBeenCalledWith(
        expect.objectContaining({
          state: 'closed',
          labels: 'bug,urgent',
          assignee: 'bob',
        })
      );
    });

    it('throws GitHubServiceError on API failure', async () => {
      mockRest.issues.listForRepo.mockRejectedValue(
        Object.assign(new Error('API error'), { status: 404 })
      );

      await expect(service.listIssues()).rejects.toThrow(GitHubServiceError);
    });
  });

  describe('listPullRequests', () => {
    it('returns mapped pull requests', async () => {
      const raw = makeRawPR({ number: 77, title: 'feat: add oauth' });
      mockRest.pulls.list.mockResolvedValue({ data: [raw] });

      const prs = await service.listPullRequests();

      expect(prs).toHaveLength(1);
      expect(prs[0]?.prNumber).toBe(77);
      expect(prs[0]?.status).toBe('open');
    });

    it('passes state to Octokit', async () => {
      mockRest.pulls.list.mockResolvedValue({ data: [] });

      await service.listPullRequests('closed');

      expect(mockRest.pulls.list).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'closed' })
      );
    });

    it('throws GitHubServiceError on API failure', async () => {
      mockRest.pulls.list.mockRejectedValue(Object.assign(new Error('Boom'), { status: 500 }));
      await expect(service.listPullRequests()).rejects.toThrow(GitHubServiceError);
    });
  });

  describe('getPullRequest', () => {
    it('fetches and returns a mapped PR', async () => {
      const raw = makeRawPR({ number: 42, state: 'open' });
      mockRest.pulls.get.mockResolvedValue({ data: raw });

      const pr = await service.getPullRequest(42);

      expect(pr.prNumber).toBe(42);
      expect(pr.status).toBe('open');
    });

    it('throws GitHubServiceError when PR is not found', async () => {
      mockRest.pulls.get.mockRejectedValue(Object.assign(new Error('Not Found'), { status: 404 }));

      await expect(service.getPullRequest(999)).rejects.toThrow(GitHubServiceError);
    });
  });

  describe('getPullRequestSummary', () => {
    it('includes checks status when available', async () => {
      mockRest.pulls.get.mockResolvedValue({
        data: makeRawPR({ number: 1, head: { ref: 'feat/x' } }),
      });
      mockRest.repos.getCombinedStatusForRef.mockResolvedValue({ data: { state: 'success' } });

      const summary = await service.getPullRequestSummary(1);

      expect(summary.checksStatus).toBe('success');
    });

    it('omits checks status when checks call fails', async () => {
      mockRest.pulls.get.mockResolvedValue({
        data: makeRawPR({ number: 1, head: { ref: 'feat/x' } }),
      });
      mockRest.repos.getCombinedStatusForRef.mockRejectedValue(
        Object.assign(new Error('Forbidden'), { status: 403 })
      );

      const summary = await service.getPullRequestSummary(1);

      expect(summary.checksStatus).toBeUndefined();
    });
  });
});
