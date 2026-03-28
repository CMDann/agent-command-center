import simpleGit, { type SimpleGit } from 'simple-git';
import { readdirSync, statSync, type Dirent } from 'fs';
import { join, relative } from 'path';
import { logger } from '../utils/logger.js';
import type { GitStatus, Commit, SubRepo } from '../types.js';

/**
 * Reads the entries of `dir`, returning `null` instead of throwing when the
 * path is inaccessible. Typed as a helper so the correct `Dirent[]` overload
 * is inferred rather than the widest `readdirSync` return type.
 */
function tryReaddir(dir: string): Dirent[] | null {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
}

/** Maximum directory depth searched when detecting sub-repositories. */
const MAX_SUBREPO_DEPTH = 3;

/** Directory names that are always skipped during sub-repo detection. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.cache', 'coverage', '.nyc_output']);

/**
 * Thrown when a git operation fails due to an unexpected error.
 */
export class GitServiceError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'GitServiceError';
  }
}

/**
 * Provides programmatic access to git operations for a single repository.
 * All methods operate on the `workdir` supplied at construction time.
 */
export class GitService {
  private readonly git: SimpleGit;
  private readonly workdir: string;

  /**
   * @param workdir - Absolute path to the git repository root. Defaults to `process.cwd()`.
   */
  constructor(workdir: string = process.cwd()) {
    this.workdir = workdir;
    this.git = simpleGit(workdir);
  }

  /**
   * Returns the name of the currently checked-out branch.
   *
   * @returns Branch name, or `'HEAD'` when in detached HEAD state.
   * @throws {GitServiceError} If the git command fails.
   */
  async getCurrentBranch(): Promise<string> {
    try {
      const status = await this.git.status();
      return status.current ?? 'HEAD';
    } catch (err) {
      throw new GitServiceError('Failed to get current branch', err);
    }
  }

  /**
   * Returns a snapshot of the current working tree status.
   *
   * @returns {@link GitStatus} with branch name, dirty flag, and categorised file lists.
   * @throws {GitServiceError} If the git command fails.
   */
  async getStatus(): Promise<GitStatus> {
    try {
      const status = await this.git.status();
      return {
        branch: status.current ?? 'HEAD',
        isDirty: !status.isClean(),
        modified: status.modified,
        untracked: status.not_added,
        staged: status.staged,
        deleted: status.deleted,
      };
    } catch (err) {
      throw new GitServiceError('Failed to get git status', err);
    }
  }

  /**
   * Returns how many commits the local branch is ahead of and behind its remote tracking branch.
   *
   * @returns Object with `ahead` and `behind` counts. Both are `0` when no tracking branch exists.
   * @throws {GitServiceError} If the git command fails.
   */
  async getAheadBehind(): Promise<{ ahead: number; behind: number }> {
    try {
      const status = await this.git.status();
      return { ahead: status.ahead, behind: status.behind };
    } catch (err) {
      throw new GitServiceError('Failed to get ahead/behind counts', err);
    }
  }

  /**
   * Returns the `n` most recent commits on the current branch.
   *
   * @param n - Maximum number of commits to return (must be ≥ 1).
   * @returns Array of {@link Commit} objects, newest first.
   * @throws {GitServiceError} If the git command fails.
   */
  async getRecentCommits(n: number): Promise<Commit[]> {
    try {
      const log = await this.git.log({ maxCount: n });
      return log.all.map((entry) => ({
        hash: entry.hash.slice(0, 7),
        date: entry.date,
        message: entry.message,
        author: entry.author_name,
      }));
    } catch (err) {
      throw new GitServiceError('Failed to get recent commits', err);
    }
  }

  /**
   * Recursively walks `rootPath` looking for nested git repositories.
   * Skips `node_modules`, `dist`, and other common non-source directories.
   * Searches up to {@link MAX_SUBREPO_DEPTH} levels deep.
   *
   * @param rootPath - Absolute path of the workspace root to search within.
   * @returns Array of detected {@link SubRepo} entries.
   */
  async detectSubRepos(rootPath: string): Promise<SubRepo[]> {
    const subRepos: SubRepo[] = [];

    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > MAX_SUBREPO_DEPTH) return;

      const entries = tryReaddir(dir);
      if (!entries) return;

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (SKIP_DIRS.has(entry.name)) continue;

        const fullPath = join(dir, entry.name);

        // Skip the root repo itself (depth === 0 means we're scanning rootPath's children).
        const isSubRepoRoot = ((): boolean => {
          try {
            statSync(join(fullPath, '.git'));
            return true;
          } catch {
            return false;
          }
        })();

        if (isSubRepoRoot) {
          try {
            const subGit = simpleGit(fullPath);
            const status = await subGit.status();
            const remote = await subGit
              .getRemotes(true)
              .then((remotes) => remotes[0]?.refs.fetch)
              .catch(() => undefined);

            subRepos.push({
              name: entry.name,
              path: relative(rootPath, fullPath),
              remote,
              branch: status.current ?? undefined,
              isDirty: !status.isClean(),
            });
          } catch (err) {
            logger.warn({ path: fullPath, err }, 'Failed to inspect sub-repo, skipping');
          }
          // Don't recurse further into a sub-repo's contents.
        } else {
          await walk(fullPath, depth + 1);
        }
      }
    };

    await walk(rootPath, 0);
    return subRepos;
  }

  /**
   * Creates a new local branch and switches to it.
   *
   * @param name - The branch name to create (e.g. `nexus/task-42-fix-auth`).
   * @throws {GitServiceError} If the branch already exists or the git command fails.
   */
  async createBranch(name: string): Promise<void> {
    try {
      await this.git.checkoutLocalBranch(name);
      logger.info({ branch: name, workdir: this.workdir }, 'Created and checked out branch');
    } catch (err) {
      throw new GitServiceError(`Failed to create branch '${name}'`, err);
    }
  }
}
