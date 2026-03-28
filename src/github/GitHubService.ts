import { Octokit } from '@octokit/rest';
import { logger } from '../utils/logger.js';
import type {
  IssueSummary,
  IssueFilters,
  PR,
  PRSummary,
  PRStatus,
  PRChecksStatus,
} from '../types.js';

/** Configuration required to construct a {@link GitHubService}. */
export interface GitHubServiceConfig {
  /**
   * GitHub personal access token (PAT).
   *
   * Optional for public repos, but strongly recommended to avoid rate limits.
   * Never log this value.
   */
  token?: string;
  /** Repository owner (user or organisation login). */
  owner: string;
  /** Repository name. */
  repo: string;
}

/**
 * Thrown when a GitHub API call fails.
 */
export class GitHubServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'GitHubServiceError';
  }
}

function assertNonEmpty(value: string | undefined, field: string): asserts value is string {
  if (!value || value.trim().length === 0) {
    throw new GitHubServiceError(`Missing required GitHub config: ${field}`);
  }
}

function getStatusCode(err: unknown): number | undefined {
  return (err as { status?: number }).status;
}

function safeErrorForLogs(err: unknown): { name?: string; message?: string; status?: number } {
  if (!err || typeof err !== 'object') return {};
  const anyErr = err as { name?: string; message?: string; status?: number };
  return { name: anyErr.name, message: anyErr.message, status: anyErr.status };
}

/**
 * Maps the raw `state` / `draft` / `merged_at` fields from the Octokit pull
 * response to the {@link PRStatus} union used internally by NEXUS.
 */
function resolvePRStatus(
  state: string,
  draft: boolean | undefined,
  mergedAt: string | null | undefined
): PRStatus {
  if (draft) return 'draft';
  if (mergedAt) return 'merged';
  if (state === 'closed') return 'closed';
  return 'open';
}

function resolveChecksStatus(state: string | undefined): PRChecksStatus {
  switch (state) {
    case 'success':
    case 'failure':
    case 'pending':
    case 'error':
      return state;
    default:
      return 'unknown';
  }
}

/**
 * Read-only wrapper around the GitHub REST API (via Octokit).
 *
 * IMPORTANT: This service intentionally supports read operations only.
 * Write operations (issue creation, comments, PR creation, etc.) belong in a
 * separate slice so we can reason about permissions and failure modes.
 */
export class GitHubService {
  private readonly octokit: Octokit;
  private readonly owner: string;
  private readonly repo: string;

  /**
   * Construct directly from explicit configuration.
   */
  constructor(config: GitHubServiceConfig) {
    assertNonEmpty(config.owner, 'owner');
    assertNonEmpty(config.repo, 'repo');

    this.owner = config.owner;
    this.repo = config.repo;

    // Auth is optional (public repos), but we still construct Octokit the same
    // way. Never log config.token.
    this.octokit = new Octokit(config.token ? { auth: config.token } : {});
  }

  /**
   * Constructs a {@link GitHubService} using conventional environment variables.
   *
   * - GITHUB_TOKEN (optional)
   * - GITHUB_OWNER (required)
   * - GITHUB_REPO (required)
   */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): GitHubService {
    return new GitHubService({
      token: env.GITHUB_TOKEN,
      owner: env.GITHUB_OWNER ?? '',
      repo: env.GITHUB_REPO ?? '',
    });
  }

  /**
   * Lists issues in the configured repository.
   *
   * @param filters - Optional filters for state, labels, and assignee.
   * @returns Array of {@link IssueSummary} objects.
   */
  async listIssues(filters?: IssueFilters): Promise<IssueSummary[]> {
    try {
      const { data } = await this.octokit.rest.issues.listForRepo({
        owner: this.owner,
        repo: this.repo,
        state: filters?.state ?? 'open',
        labels: filters?.labels?.join(','),
        assignee: filters?.assignee,
        per_page: 50,
      });

      // The issues API can return pull requests; exclude them.
      return data
        .filter((item) => !item.pull_request)
        .map((item) => ({
          issueNumber: item.number,
          title: item.title,
          labels: item.labels.map((l) => (typeof l === 'string' ? l : (l.name ?? ''))),
          assigneeLogin: item.assignee?.login,
          url: item.html_url,
          state: item.state as 'open' | 'closed',
          updatedAt: new Date(item.updated_at),
        }));
    } catch (err) {
      const statusCode = getStatusCode(err);
      logger.error(
        { owner: this.owner, repo: this.repo, err: safeErrorForLogs(err) },
        'GitHubService.listIssues failed'
      );
      throw new GitHubServiceError('Failed to list issues', statusCode, err);
    }
  }

  /**
   * Lists pull requests in the configured repository.
   *
   * @param state - PR state filter.
   */
  async listPullRequests(state: 'open' | 'closed' | 'all' = 'open'): Promise<PRSummary[]> {
    try {
      const { data } = await this.octokit.rest.pulls.list({
        owner: this.owner,
        repo: this.repo,
        state,
        per_page: 50,
      });

      return data.map((pr) => ({
        prNumber: pr.number,
        title: pr.title,
        url: pr.html_url,
        status: resolvePRStatus(pr.state, pr.draft, pr.merged_at),
        head: pr.head.ref,
        base: pr.base.ref,
        updatedAt: new Date(pr.updated_at),
      }));
    } catch (err) {
      const statusCode = getStatusCode(err);
      logger.error(
        { owner: this.owner, repo: this.repo, err: safeErrorForLogs(err) },
        'GitHubService.listPullRequests failed'
      );
      throw new GitHubServiceError('Failed to list pull requests', statusCode, err);
    }
  }

  /**
   * Fetches a single PR with a normalized {@link PRStatus}.
   */
  async getPullRequest(prNumber: number): Promise<PR> {
    try {
      const { data } = await this.octokit.rest.pulls.get({
        owner: this.owner,
        repo: this.repo,
        pull_number: prNumber,
      });

      return {
        prNumber: data.number,
        title: data.title,
        url: data.html_url,
        status: resolvePRStatus(data.state, data.draft, data.merged_at),
        head: data.head.ref,
        base: data.base.ref,
        createdAt: new Date(data.created_at),
        updatedAt: new Date(data.updated_at),
      };
    } catch (err) {
      const statusCode = getStatusCode(err);
      logger.error(
        { owner: this.owner, repo: this.repo, prNumber, err: safeErrorForLogs(err) },
        'GitHubService.getPullRequest failed'
      );
      throw new GitHubServiceError(`Failed to get PR #${prNumber}`, statusCode, err);
    }
  }

  /**
   * Fetches a lightweight PR summary (optionally including best-effort CI checks status).
   */
  async getPullRequestSummary(prNumber: number): Promise<PRSummary> {
    const pr = await this.getPullRequest(prNumber);

    let checksStatus: PRChecksStatus | undefined;
    try {
      // Best-effort. Some tokens may not have access to statuses/checks.
      const { data } = await this.octokit.rest.repos.getCombinedStatusForRef({
        owner: this.owner,
        repo: this.repo,
        ref: pr.head,
      });
      checksStatus = resolveChecksStatus(data.state);
    } catch (err) {
      logger.debug(
        { owner: this.owner, repo: this.repo, prNumber, err: safeErrorForLogs(err) },
        'GitHubService.getPullRequestSummary: checks status unavailable'
      );
      checksStatus = undefined;
    }

    return {
      prNumber: pr.prNumber,
      title: pr.title,
      url: pr.url,
      status: pr.status,
      head: pr.head,
      base: pr.base,
      updatedAt: pr.updatedAt,
      checksStatus,
    };
  }
}
