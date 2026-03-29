import React, { useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { useGitStore } from '../hooks/useGitStore.js';
import type { SubRepo } from '../../types.js';

/** Max number of untracked files to list before truncating. */
const MAX_FILES = 10;

/** Renders one row per file with a coloured status prefix. */
const FileRow: React.FC<{ prefix: string; file: string; color: string }> = ({
  prefix,
  file,
  color,
}) => (
  <Box>
    <Text color={color}> {prefix} </Text>
    <Text>{file}</Text>
  </Box>
);

/** Renders a single sub-repo row with dirty indicator, branch, and active highlight. */
const SubRepoRow: React.FC<{ repo: SubRepo; isActive: boolean }> = ({ repo, isActive }) => (
  <Box>
    <Text color={isActive ? 'cyan' : repo.isDirty === true ? 'yellow' : 'green'}>
      {isActive ? '▶ ' : repo.isDirty === true ? '● ' : '○ '}
    </Text>
    <Text bold={isActive}>{repo.path}</Text>
    {repo.branch !== undefined && (
      <Text color={isActive ? 'cyan' : '#555555'}> [{repo.branch}]</Text>
    )}
  </Box>
);

/**
 * Git status panel.
 * Displays current branch, ahead/behind tracking, modified/staged/untracked
 * files, and any detected sub-repositories.
 *
 * Keybindings:
 * - `s` — cycle active sub-repo context (filters Tasks panel and git display)
 *
 * Data is loaded from {@link useGitStore} on mount and refreshed every 30 s.
 */
export const GitPanel: React.FC = () => {
  const {
    status,
    aheadBehind,
    subRepos,
    activeSubRepo,
    cycleSubRepo,
    isLoading,
    error,
    refresh,
  } = useGitStore();

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), 30_000);
    return (): void => clearInterval(interval);
    // refresh is a stable Zustand action reference — empty deps is intentional.
  }, []);

  useInput((input) => {
    if (input === 's') {
      cycleSubRepo();
    }
  });

  return (
    <Box borderStyle="single" flexDirection="column" width="50%" padding={1}>
      {/* Panel title */}
      <Text color="cyan" bold>
        GIT STATUS
      </Text>

      {/* Error state */}
      {error !== null && (
        <Box marginTop={1}>
          <Text color="red">{error}</Text>
        </Box>
      )}

      {/* Loading placeholder shown only before first data arrives */}
      {isLoading && status === null && error === null && (
        <Text color="#555555">Loading...</Text>
      )}

      {/* Branch + ahead/behind */}
      {status !== null && (
        <>
          <Box marginTop={1} flexDirection="row">
            <Text color={status.isDirty ? 'yellow' : 'green'}>
              {status.isDirty ? '●' : '○'}{' '}
            </Text>
            <Text bold>{status.branch}</Text>
            {(aheadBehind.ahead > 0 || aheadBehind.behind > 0) && (
              <Text color="#555555">
                {' '}
                (↑{aheadBehind.ahead} ↓{aheadBehind.behind})
              </Text>
            )}
          </Box>

          {/* Staged files */}
          {status.staged.map((f) => (
            <FileRow key={`A:${f}`} prefix="A" file={f} color="green" />
          ))}

          {/* Modified files */}
          {status.modified.map((f) => (
            <FileRow key={`M:${f}`} prefix="M" file={f} color="yellow" />
          ))}

          {/* Deleted files */}
          {status.deleted.map((f) => (
            <FileRow key={`D:${f}`} prefix="D" file={f} color="red" />
          ))}

          {/* Untracked files — capped at MAX_FILES */}
          {status.untracked.slice(0, MAX_FILES).map((f) => (
            <FileRow key={`?:${f}`} prefix="?" file={f} color="#555555" />
          ))}
          {status.untracked.length > MAX_FILES && (
            <Text color="#555555">
              {'  '}…{status.untracked.length - MAX_FILES} more untracked
            </Text>
          )}

          {/* Clean working tree */}
          {!status.isDirty && (
            <Text color="green"> nothing to commit, working tree clean</Text>
          )}
        </>
      )}

      {/* Sub-repos section */}
      {subRepos.length > 0 && (
        <>
          <Text> </Text>
          <Box flexDirection="row">
            <Text color="cyan" bold>
              SUBREPOS
            </Text>
            {activeSubRepo !== null && (
              <Text color="#555555"> (context: {activeSubRepo.path})</Text>
            )}
          </Box>
          {subRepos.map((repo) => (
            <SubRepoRow
              key={repo.path}
              repo={repo}
              isActive={activeSubRepo?.path === repo.path}
            />
          ))}
          <Box marginTop={1}>
            <Text color="#555555">[s] cycle context</Text>
          </Box>
        </>
      )}
    </Box>
  );
};
