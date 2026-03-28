import { create } from 'zustand';
import { GitService } from '../../git/GitService.js';
import { logger } from '../../utils/logger.js';
import type { GitStatus, Commit, SubRepo } from '../../types.js';

// Initialised once per process — safe for the TUI singleton model.
const gitService = new GitService(process.cwd());

interface GitStoreState {
  status: GitStatus | null;
  aheadBehind: { ahead: number; behind: number };
  recentCommits: Commit[];
  subRepos: SubRepo[];
  isLoading: boolean;
  error: string | null;
  /**
   * Fetches the latest git state and updates the store.
   * Silently sets `error` on failure rather than throwing.
   */
  refresh(): Promise<void>;
}

/**
 * Zustand store for all git-related state shown in the Git panel.
 *
 * Usage inside a component:
 * ```ts
 * const { status, aheadBehind, refresh } = useGitStore();
 * ```
 */
export const useGitStore = create<GitStoreState>((set) => ({
  status: null,
  aheadBehind: { ahead: 0, behind: 0 },
  recentCommits: [],
  subRepos: [],
  isLoading: false,
  error: null,

  async refresh(): Promise<void> {
    set({ isLoading: true, error: null });
    try {
      const [status, aheadBehind, recentCommits, subRepos] = await Promise.all([
        gitService.getStatus(),
        gitService.getAheadBehind(),
        gitService.getRecentCommits(10),
        gitService.detectSubRepos(process.cwd()),
      ]);
      set({ status, aheadBehind, recentCommits, subRepos, isLoading: false });
      logger.debug({ branch: status.branch, isDirty: status.isDirty }, 'Git store refreshed');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ err }, 'Git store refresh failed');
      set({ isLoading: false, error: message });
    }
  },
}));
