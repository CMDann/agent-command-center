import { EventEmitter } from 'events';
import { GitHubService } from '../github/GitHubService.js';
import { logger } from '../utils/logger.js';
import type { Contributor } from '../types.js';

// ---------------------------------------------------------------------------
// ContributorRegistry
// ---------------------------------------------------------------------------

/**
 * Fetches and caches GitHub repository collaborators, mapping them to the
 * {@link Contributor} model. Refreshes automatically every 5 minutes and
 * tracks `currentTaskId` by reading GitHub issue assignments.
 *
 * ### Events
 * - `update` — fired after every successful refresh with the new
 *   `Contributor[]` snapshot as the first argument.
 */
export class ContributorRegistry extends EventEmitter {
  private contributors: Contributor[] = [];
  private refreshTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly service: GitHubService,
    private readonly refreshInterval: number = 5 * 60 * 1000
  ) {
    super();
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Starts the registry: performs an immediate load and schedules periodic
   * refreshes at `refreshInterval` milliseconds.
   */
  start(): void {
    void this.load();
    this.refreshTimer = setInterval(() => { void this.load(); }, this.refreshInterval);
  }

  /**
   * Stops the periodic refresh. Safe to call multiple times.
   */
  stop(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Data access
  // ---------------------------------------------------------------------------

  /** Returns the current cached contributor snapshot. */
  getContributors(): Contributor[] {
    return [...this.contributors];
  }

  /** Triggers an immediate refresh outside the normal schedule. */
  async refresh(): Promise<void> {
    await this.load();
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private async load(): Promise<void> {
    try {
      const [collaborators, issues] = await Promise.all([
        this.service.getCollaborators(),
        this.service.listIssues({ state: 'open' }),
      ]);

      // Build a login→issueNumber map for contributors with open assignments.
      const assignedIssueMap = new Map<string, number>();
      for (const issue of issues) {
        if (issue.assigneeLogin) {
          assignedIssueMap.set(issue.assigneeLogin, issue.issueNumber);
        }
      }

      this.contributors = collaborators.map((c) => {
        const issueNumber = assignedIssueMap.get(c.login);
        return {
          ...c,
          currentTaskId: issueNumber !== undefined ? `issue-${issueNumber}` : undefined,
        };
      });

      logger.info(
        { count: this.contributors.length },
        'ContributorRegistry: contributors refreshed'
      );

      this.emit('update', this.getContributors());
    } catch (err) {
      logger.warn({ err }, 'ContributorRegistry: failed to refresh contributors');
      // Do not clear existing cache — stale data is better than empty data.
    }
  }
}

// ---------------------------------------------------------------------------
// Module-level singleton (null when GitHub is not configured)
// ---------------------------------------------------------------------------

function buildRegistry(): ContributorRegistry | null {
  try {
    const service = GitHubService.fromEnv();
    return new ContributorRegistry(service);
  } catch {
    return null;
  }
}

export const contributorRegistry: ContributorRegistry | null = buildRegistry();
