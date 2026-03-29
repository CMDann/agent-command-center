import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRest } = vi.hoisted(() => ({
  mockRest: {
    issues: {
      create: vi.fn(),
      createComment: vi.fn(),
    },
    pulls: {
      create: vi.fn(),
    },
  },
}));

vi.mock('@octokit/rest', () => ({
  Octokit: vi.fn(() => ({ rest: mockRest })),
}));

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { GitHubServiceError } from './GitHubService.js';
import { GitHubWriteService } from './GitHubWriteService.js';

const service = new GitHubWriteService('acme', 'widget', 'ghp_test');

describe('GitHubWriteService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requires owner/repo/token in fromEnv', () => {
    expect(() => GitHubWriteService.fromEnv({ GITHUB_TOKEN: 'x' })).toThrow(GitHubServiceError);
  });

  it('creates an issue and maps the response', async () => {
    mockRest.issues.create.mockResolvedValue({
      data: {
        number: 12,
        title: 'Test issue',
        body: 'Body',
        labels: [{ name: 'bug' }],
        assignee: { login: 'dan' },
        html_url: 'https://github.com/acme/widget/issues/12',
        state: 'open',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
      },
    });

    const issue = await service.createIssue({ title: 'Test issue', body: 'Body', labels: ['bug'] });

    expect(issue.issueNumber).toBe(12);
    expect(issue.labels).toEqual(['bug']);
  });

  it('surfaces createIssue permission failures as GitHubServiceError', async () => {
    mockRest.issues.create.mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403 }));

    await expect(service.createIssue({ title: 'Nope' })).rejects.toThrow(GitHubServiceError);
  });

  it('creates a pull request and maps the response', async () => {
    mockRest.pulls.create.mockResolvedValue({
      data: {
        number: 44,
        title: 'Test PR',
        html_url: 'https://github.com/acme/widget/pull/44',
        draft: false,
        head: { ref: 'feat/x' },
        base: { ref: 'main' },
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
      },
    });

    const pr = await service.createPR({ title: 'Test PR', head: 'feat/x', base: 'main' });

    expect(pr.prNumber).toBe(44);
    expect(pr.head).toBe('feat/x');
  });

  it('surfaces createPR permission failures as GitHubServiceError', async () => {
    mockRest.pulls.create.mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403 }));

    await expect(service.createPR({ title: 'Nope', head: 'feat/x', base: 'main' })).rejects.toThrow(GitHubServiceError);
  });

  it('posts comments successfully', async () => {
    mockRest.issues.createComment.mockResolvedValue({ data: {} });

    await expect(service.addComment(12, 'hello')).resolves.toBeUndefined();
    expect(mockRest.issues.createComment).toHaveBeenCalledWith(
      expect.objectContaining({ issue_number: 12, body: 'hello' })
    );
  });

  it('surfaces addComment permission failures as GitHubServiceError', async () => {
    mockRest.issues.createComment.mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403 }));

    await expect(service.addComment(12, 'hello')).rejects.toThrow(GitHubServiceError);
  });
});
