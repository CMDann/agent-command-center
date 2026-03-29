import { create } from 'zustand';
import { resolve } from 'path';
import { GitService } from '../../git/GitService.js';
import { logger } from '../../utils/logger.js';
import type { GitStatus, Commit, SubRepo } from '../../types.js';

/** Workspace root — captured once so `switchContext` can return to it. */
const WORKSPACE_ROOT = process.cwd();

// Initialised once per process — safe for the TUI singleton model.
const gitService = new GitService(WORKSPACE_ROOT);

interface GitStoreState {
  status: GitStatus | null;
  aheadBehind: { ahead: number; behind: number };
  recentCommits: Commit[];
  subRepos: SubRepo[];
  /** The currently active sub-repository context, or `null` for the workspace root. */
  activeSubRepo: SubRepo | null;
  isLoading: boolean;
  error: string | null;
  /**
   * Fetches the latest git state and updates the store.
   * Silently sets `error` on failure rather than throwing.
   */
  refresh(): Promise<void>;
  /**
   * Explicitly sets the active sub-repository context and switches the
   * underlying {@link GitService} to operate on that path.
   * Pass `null` to return to the workspace root.
   */
  setActiveSubRepo(repo: SubRepo | null): void;
  /**
   * Cycles through detected sub-repos: `null` → first → … → last → `null`.
   * Also updates the {@link GitService} context and triggers a refresh.
   */
  cycleSubRepo(): void;
}

/**
 * Zustand store for all git-related state shown in the Git panel.
 *
 * Usage inside a component:
 * ```ts
 * const { status, aheadBehind, subRepos, activeSubRepo, cycleSubRepo, refresh } = useGitStore();
 * ```
 */
export const useGitStore = create<GitStoreState>((set, get) => ({
  status: null,
  aheadBehind: { ahead: 0, behind: 0 },
  recentCommits: [],
  subRepos: [],
  activeSubRepo: null,
  isLoading: false,
  error: null,

  async refresh(): Promise<void> {
    set({ isLoading: true, error: null });
    try {
      // Sub-repo detection always scans the workspace root regardless of active context.
      const [status, aheadBehind, recentCommits, subRepos] = await Promise.all([
        gitService.getStatus(),
        gitService.getAheadBehind(),
        gitService.getRecentCommits(10),
        gitService.detectSubRepos(WORKSPACE_ROOT),
      ]);
      set({ status, aheadBehind, recentCommits, subRepos, isLoading: false });
      logger.debug({ branch: status.branch, isDirty: status.isDirty }, 'Git store refreshed');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ err }, 'Git store refresh failed');
      set({ isLoading: false, error: message });
    }
  },

  setActiveSubRepo(repo: SubRepo | null): void {
    const repoPath = repo !== null ? resolve(WORKSPACE_ROOT, repo.path) : WORKSPACE_ROOT;
    gitService.switchContext(repoPath);
    set({ activeSubRepo: repo });
    void get().refresh();
  },

  cycleSubRepo(): void {
    const { subRepos, activeSubRepo } = get();
    let next: SubRepo | null;

    if (activeSubRepo === null) {
      next = subRepos[0] ?? null;
    } else {
      const idx = subRepos.findIndex((r) => r.path === activeSubRepo.path);
      const nextIdx = idx + 1;
      next = nextIdx >= subRepos.length ? null : (subRepos[nextIdx] ?? null);
    }

    const repoPath = next !== null ? resolve(WORKSPACE_ROOT, next.path) : WORKSPACE_ROOT;
    gitService.switchContext(repoPath);
    set({ activeSubRepo: next });
    void get().refresh();
  },
}));
