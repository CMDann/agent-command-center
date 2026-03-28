import { create } from 'zustand';
import { GitHubService } from '../../github/GitHubService.js';
import { logger } from '../../utils/logger.js';
import type { IssueSummary } from '../../types.js';

/**
 * Attempts to build a {@link GitHubService} from environment variables.
 * Returns `null` if required variables are missing so the store can surface
 * a helpful message to the user instead of crashing.
 */
function buildService(): GitHubService | null {
  try {
    return GitHubService.fromEnv();
  } catch {
    return null;
  }
}

// Initialised once per process.
const githubService = buildService();

interface GitHubStoreState {
  issues: IssueSummary[];
  isLoading: boolean;
  error: string | null;
  isConfigured: boolean;
  /**
   * Fetches open issues, then updates the store.
   * Silently sets `error` on failure rather than throwing.
   */
  refresh(): Promise<void>;
}

/**
 * Zustand store for GitHub issue state shown in the Tasks panel.
 *
 * Requires `GITHUB_OWNER` and `GITHUB_REPO` env vars to be set.
 * `GITHUB_TOKEN` is optional (recommended to avoid rate limiting).
 */
export const useGitHubStore = create<GitHubStoreState>((set) => ({
  issues: [],
  isLoading: false,
  error: null,
  isConfigured: githubService !== null,

  async refresh(): Promise<void> {
    if (!githubService) {
      set({
        error: 'GitHub not configured. Set GITHUB_OWNER and GITHUB_REPO (optionally GITHUB_TOKEN).',
      });
      return;
    }

    set({ isLoading: true, error: null });
    try {
      const issues = await githubService.listIssues({ state: 'open' });
      set({ issues, isLoading: false });
      logger.debug({ issueCount: issues.length }, 'GitHub store refreshed');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ err }, 'GitHub store refresh failed');
      set({ isLoading: false, error: message });
    }
  },
}));
