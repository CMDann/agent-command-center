import { create } from 'zustand';
import { GitHubService } from '../../github/GitHubService.js';
import { logger } from '../../utils/logger.js';
import type { Issue, Contributor } from '../../types.js';

/**
 * Attempts to build a {@link GitHubService} from environment variables.
 * Returns `null` if required variables are missing so the store can surface
 * a helpful message to the user instead of crashing.
 */
function buildService(): GitHubService | null {
  const token = process.env['GITHUB_TOKEN'];
  const owner = process.env['GITHUB_OWNER'];
  const repo = process.env['GITHUB_REPO'];
  if (!token || !owner || !repo) return null;
  return new GitHubService({ token, owner, repo });
}

// Initialised once per process.
const githubService = buildService();

interface GitHubStoreState {
  issues: Issue[];
  contributors: Contributor[];
  isLoading: boolean;
  error: string | null;
  isConfigured: boolean;
  /**
   * Fetches open issues and collaborators, then updates the store.
   * Silently sets `error` on failure rather than throwing.
   */
  refresh(): Promise<void>;
}

/**
 * Zustand store for GitHub issues and contributor state shown in the Tasks panel.
 *
 * Requires `GITHUB_TOKEN`, `GITHUB_OWNER`, and `GITHUB_REPO` env vars to be set.
 * When they are missing, `isConfigured` is `false` and `refresh()` is a no-op.
 */
export const useGitHubStore = create<GitHubStoreState>((set) => ({
  issues: [],
  contributors: [],
  isLoading: false,
  error: null,
  isConfigured: githubService !== null,

  async refresh(): Promise<void> {
    if (!githubService) {
      set({
        error: 'GitHub not configured. Set GITHUB_TOKEN, GITHUB_OWNER, and GITHUB_REPO.',
      });
      return;
    }

    set({ isLoading: true, error: null });
    try {
      const [issues, contributors] = await Promise.all([
        githubService.getIssues({ state: 'open' }),
        githubService.getCollaborators(),
      ]);
      set({ issues, contributors, isLoading: false });
      logger.debug({ issueCount: issues.length }, 'GitHub store refreshed');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ err }, 'GitHub store refresh failed');
      set({ isLoading: false, error: message });
    }
  },
}));
