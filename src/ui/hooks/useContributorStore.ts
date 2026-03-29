import { create } from 'zustand';
import { contributorRegistry } from '../../contributors/ContributorRegistry.js';
import { logger } from '../../utils/logger.js';
import type { Contributor } from '../../types.js';

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

interface ContributorStoreState {
  /** Current cached contributor list. */
  contributors: Contributor[];
  /** True while a refresh is in progress. */
  isLoading: boolean;

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  /**
   * Forces an immediate refresh from GitHub.
   * No-op when GitHub is not configured.
   */
  refresh(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Bootstrap — wire registry events before store creation
// ---------------------------------------------------------------------------

if (contributorRegistry !== null) {
  contributorRegistry.on('update', (contributors: Contributor[]) => {
    useContributorStore.setState({ contributors, isLoading: false });
  });

  // Start the registry (immediate load + scheduled refresh).
  contributorRegistry.start();
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/**
 * Zustand store for human contributor state.
 *
 * Subscribes to {@link contributorRegistry} `update` events at module load so
 * state stays in sync without polling. When GitHub is not configured the store
 * remains empty but functional.
 */
export const useContributorStore = create<ContributorStoreState>((set) => ({
  contributors: [],
  isLoading: contributorRegistry !== null,

  async refresh(): Promise<void> {
    if (contributorRegistry === null) return;
    set({ isLoading: true });
    try {
      await contributorRegistry.refresh();
    } catch (err) {
      logger.warn({ err }, 'useContributorStore: refresh failed');
      set({ isLoading: false });
    }
  },
}));
