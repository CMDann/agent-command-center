import { Octokit } from '@octokit/rest';
import { logger } from '../utils/logger.js';
import type {
  Issue,
  IssueFilters,
  CreateIssueInput,
  PR,
  CreatePRInput,
  PRStatus,
  Contributor,
} from '../types.js';

/** Configuration required to construct a {@link GitHubService}. */
export interface GitHubServiceConfig {
  /** GitHub personal access token with `repo`, `issues`, and `pull_requests` scopes. */
  token: string;
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

/**
 * Wraps the GitHub REST API (via Octokit) for all repository operations
 * that NEXUS performs — issues, pull requests, collaborators, and comments.
 */
export class GitHubService {
  private readonly octokit: Octokit;
  private readonly owner: string;
  private readonly repo: string;

  /**
   * @param config - Authentication token plus owner/repo coordinates.
   */
  constructor(config: GitHubServiceConfig) {
    this.owner = config.owner;
    this.repo = config.repo;
    this.octokit = new Octokit({ auth: config.token });
  }

  /**
   * Lists issues in the configured repository.
   *
   * @param filters - Optional filters for state, labels, and assignee.
   * @returns Array of {@link Issue} objects sorted newest-first.
   * @throws {GitHubServiceError} If the API call fails.
   */
  async getIssues(filters?: IssueFilters): Promise<Issue[]> {
    try {
      const { data } = await this.octokit.rest.issues.listForRepo({
        owner: this.owner,
        repo: this.repo,
        state: filters?.state ?? 'open',
        labels: filters?.labels?.join(','),
        assignee: filters?.assignee,
        per_page: 50,
      });

      // The issues API also returns pull requests; exclude them.
      return data
        .filter((item) => !item.pull_request)
        .map((item) => ({
          issueNumber: item.number,
          title: item.title,
          body: item.body ?? '',
          labels: item.labels.map((l) => (typeof l === 'string' ? l : (l.name ?? ''))),
          assigneeLogin: item.assignee?.login,
          url: item.html_url,
          state: item.state as 'open' | 'closed',
          createdAt: new Date(item.created_at),
          updatedAt: new Date(item.updated_at),
        }));
    } catch (err) {
      const statusCode = (err as { status?: number }).status;
      logger.error({ owner: this.owner, repo: this.repo, err }, 'getIssues failed');
      throw new GitHubServiceError('Failed to list issues', statusCode, err);
    }
  }

  /**
   * Creates a new issue in the configured repository.
   *
   * @param input - Issue title, body, labels, and optional assignees.
   * @returns The newly created {@link Issue}.
   * @throws {GitHubServiceError} If the API call fails.
   */
  async createIssue(input: CreateIssueInput): Promise<Issue> {
    try {
      const { data } = await this.octokit.rest.issues.create({
        owner: this.owner,
        repo: this.repo,
        title: input.title,
        body: input.body,
        labels: input.labels,
        assignees: input.assignees,
      });

      return {
        issueNumber: data.number,
        title: data.title,
        body: data.body ?? '',
        labels: data.labels.map((l) => (typeof l === 'string' ? l : (l.name ?? ''))),
        assigneeLogin: data.assignee?.login,
        url: data.html_url,
        state: data.state as 'open' | 'closed',
        createdAt: new Date(data.created_at),
        updatedAt: new Date(data.updated_at),
      };
    } catch (err) {
      const statusCode = (err as { status?: number }).status;
      logger.error({ title: input.title, err }, 'createIssue failed');
      throw new GitHubServiceError('Failed to create issue', statusCode, err);
    }
  }

  /**
   * Opens a pull request in the configured repository.
   *
   * @param input - PR title, body, head branch, and base branch.
   * @returns The newly created {@link PR}.
   * @throws {GitHubServiceError} If the API call fails.
   */
  async createPR(input: CreatePRInput): Promise<PR> {
    try {
      const { data } = await this.octokit.rest.pulls.create({
        owner: this.owner,
        repo: this.repo,
        title: input.title,
        body: input.body,
        head: input.head,
        base: input.base,
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
      const statusCode = (err as { status?: number }).status;
      logger.error({ head: input.head, base: input.base, err }, 'createPR failed');
      throw new GitHubServiceError('Failed to create pull request', statusCode, err);
    }
  }

  /**
   * Fetches the current status of a pull request by number.
   *
   * @param prNumber - The pull request number.
   * @returns The {@link PR} with its resolved {@link PRStatus}.
   * @throws {GitHubServiceError} If the PR does not exist or the API call fails.
   */
  async getPRStatus(prNumber: number): Promise<PR> {
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
      const statusCode = (err as { status?: number }).status;
      logger.error({ prNumber, err }, 'getPRStatus failed');
      throw new GitHubServiceError(`Failed to get PR #${prNumber}`, statusCode, err);
    }
  }

  /**
   * Lists repository collaborators.
   *
   * Requires the authenticated user to have at least push access to the repository.
   *
   * @returns Array of {@link Contributor} objects.
   * @throws {GitHubServiceError} If the API call fails or the token lacks permission.
   */
  async getCollaborators(): Promise<Contributor[]> {
    try {
      const { data } = await this.octokit.rest.repos.listCollaborators({
        owner: this.owner,
        repo: this.repo,
        per_page: 100,
      });

      return data.map((user) => ({
        login: user.login,
        name: user.name ?? undefined,
        avatarUrl: user.avatar_url,
        role: resolveRole(user.permissions),
      }));
    } catch (err) {
      const statusCode = (err as { status?: number }).status;
      logger.error({ owner: this.owner, repo: this.repo, err }, 'getCollaborators failed');
      throw new GitHubServiceError('Failed to list collaborators', statusCode, err);
    }
  }

  /**
   * Posts a comment on an issue or pull request.
   *
   * @param issueNumber - The issue (or PR) number to comment on.
   * @param body - Markdown body of the comment.
   * @throws {GitHubServiceError} If the API call fails.
   */
  async addComment(issueNumber: number, body: string): Promise<void> {
    try {
      await this.octokit.rest.issues.createComment({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
        body,
      });
      logger.info({ issueNumber }, 'Posted comment on issue');
    } catch (err) {
      const statusCode = (err as { status?: number }).status;
      logger.error({ issueNumber, err }, 'addComment failed');
      throw new GitHubServiceError(`Failed to comment on issue #${issueNumber}`, statusCode, err);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type OctokitPermissions =
  | { admin?: boolean; maintain?: boolean; push?: boolean; triage?: boolean; pull?: boolean }
  | undefined;

function resolveRole(permissions: OctokitPermissions): Contributor['role'] {
  if (!permissions) return 'contributor';
  if (permissions.admin) return 'owner';
  if (permissions.maintain || permissions.push) return 'maintainer';
  return 'contributor';
}
