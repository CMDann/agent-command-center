import { Octokit } from '@octokit/rest';
import { logger } from '../utils/logger.js';
import type { Issue, CreateIssueInput, CreatePRInput, PR } from '../types.js';
import { GitHubServiceError } from './GitHubService.js';

// ---------------------------------------------------------------------------
// GitHubWriteService
// ---------------------------------------------------------------------------

/**
 * Write-capable GitHub API wrapper.
 *
 * Handles mutations (issue creation, PR management, comments) separately
 * from the read-only {@link GitHubService} so consumers can reason about
 * the permissions required for each operation independently.
 */
export class GitHubWriteService {
  private readonly octokit: Octokit;
  private readonly owner: string;
  private readonly repo: string;

  /**
   * @param owner - GitHub repository owner (user or organisation login).
   * @param repo  - GitHub repository name.
   * @param token - Fine-grained PAT with `issues:write` and `pull_requests:write` scopes.
   */
  constructor(owner: string, repo: string, token: string) {
    this.owner = owner;
    this.repo = repo;
    this.octokit = new Octokit({ auth: token });
  }

  /**
   * Constructs a {@link GitHubWriteService} from environment variables.
   *
   * Requires `GITHUB_TOKEN`, `GITHUB_OWNER`, and `GITHUB_REPO` to be set.
   *
   * @returns A ready-to-use {@link GitHubWriteService}.
   * @throws {GitHubServiceError} If any required variable is missing.
   */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): GitHubWriteService {
    const token = env['GITHUB_TOKEN'];
    const owner = env['GITHUB_OWNER'];
    const repo = env['GITHUB_REPO'];
    if (!token || !owner || !repo) {
      throw new GitHubServiceError(
        'GITHUB_TOKEN, GITHUB_OWNER, and GITHUB_REPO must be set for write operations'
      );
    }
    return new GitHubWriteService(owner, repo, token);
  }

  /**
   * Creates a new issue in the configured repository.
   *
   * @param input - Issue title, optional body, labels, and assignees.
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

      logger.info({ issueNumber: data.number, title: data.title }, 'Issue created');

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
   * @param input - PR title, optional body, head branch, and base branch.
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

      logger.info({ prNumber: data.number, title: data.title }, 'Pull request created');

      return {
        prNumber: data.number,
        title: data.title,
        url: data.html_url,
        status: data.draft ? 'draft' : 'open',
        head: data.head.ref,
        base: data.base.ref,
        createdAt: new Date(data.created_at),
        updatedAt: new Date(data.updated_at),
      };
    } catch (err) {
      const statusCode = (err as { status?: number }).status;
      logger.error({ head: input.head, err }, 'createPR failed');
      throw new GitHubServiceError('Failed to create pull request', statusCode, err);
    }
  }

  /**
   * Adds a GitHub login as an assignee on an issue.
   *
   * @param issueNumber - The issue number to update.
   * @param login       - GitHub login of the assignee to add.
   * @throws {GitHubServiceError} If the API call fails.
   */
  async addAssignee(issueNumber: number, login: string): Promise<void> {
    try {
      await this.octokit.rest.issues.addAssignees({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
        assignees: [login],
      });
      logger.info({ issueNumber, login }, 'Assignee added to issue');
    } catch (err) {
      const statusCode = (err as { status?: number }).status;
      logger.error({ issueNumber, login, err }, 'addAssignee failed');
      throw new GitHubServiceError(
        `Failed to add assignee @${login} to issue #${issueNumber}`,
        statusCode,
        err
      );
    }
  }

  /**
   * Removes a GitHub login from the assignees of an issue.
   *
   * @param issueNumber - The issue number to update.
   * @param login       - GitHub login of the assignee to remove.
   * @throws {GitHubServiceError} If the API call fails.
   */
  async removeAssignee(issueNumber: number, login: string): Promise<void> {
    try {
      await this.octokit.rest.issues.removeAssignees({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
        assignees: [login],
      });
      logger.info({ issueNumber, login }, 'Assignee removed from issue');
    } catch (err) {
      const statusCode = (err as { status?: number }).status;
      logger.error({ issueNumber, login, err }, 'removeAssignee failed');
      throw new GitHubServiceError(
        `Failed to remove assignee @${login} from issue #${issueNumber}`,
        statusCode,
        err
      );
    }
  }

  /**
   * Posts a comment on an issue or pull request.
   *
   * @param issueNumber - The issue (or PR) number to comment on.
   * @param body        - Markdown body of the comment.
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
      logger.info({ issueNumber }, 'Comment posted on issue');
    } catch (err) {
      const statusCode = (err as { status?: number }).status;
      logger.error({ issueNumber, err }, 'addComment failed');
      throw new GitHubServiceError(
        `Failed to comment on issue #${issueNumber}`,
        statusCode,
        err
      );
    }
  }
}
