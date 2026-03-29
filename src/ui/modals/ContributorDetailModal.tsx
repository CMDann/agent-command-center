import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { GitHubService } from '../../github/GitHubService.js';
import { logger } from '../../utils/logger.js';
import type { IssueSummary, Contributor } from '../../types.js';
import { useContributorStore } from '../hooks/useContributorStore.js';

// ---------------------------------------------------------------------------
// Read service (built from env vars, or null if not configured)
// ---------------------------------------------------------------------------

function buildReadService(): GitHubService | null {
  try {
    return GitHubService.fromEnv();
  } catch {
    return null;
  }
}

const githubReadService = buildReadService();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function roleColor(role: Contributor['role']): string {
  switch (role) {
    case 'owner':       return 'magenta';
    case 'maintainer':  return 'cyan';
    case 'contributor': return '#888888';
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ContributorDetailModalProps {
  /** GitHub login of the contributor to show. */
  login: string;
  /** Called when the modal closes. */
  onClose: () => void;
}

/**
 * Detail view for a human contributor.
 *
 * Shows:
 * - Contributor profile (login, name, role)
 * - Open GitHub issues assigned to them
 *
 * Keybindings:
 * - `Escape` — close
 * - `r`      — refresh
 */
export const ContributorDetailModal: React.FC<ContributorDetailModalProps> = ({
  login,
  onClose,
}) => {
  const { contributors } = useContributorStore();
  const contributor = contributors.find((c) => c.login === login);

  const [issues, setIssues] = useState<IssueSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadIssues = (): void => {
    if (githubReadService === null) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setLoadError(null);
    void githubReadService
      .listIssues({ assignee: login, state: 'open' })
      .then((data) => {
        setIssues(data);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn({ login, err }, 'ContributorDetailModal: failed to load issues');
        setLoadError(message);
        setIsLoading(false);
      });
  };

  // Load on mount.
  useEffect(() => {
    loadIssues();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [login]);

  useInput((input, key) => {
    if (key.escape) { onClose(); return; }
    if (input === 'r') { loadIssues(); }
  });

  return (
    <Box
      borderStyle="round"
      borderColor="cyan"
      flexDirection="column"
      padding={1}
      marginTop={1}
    >
      <Text color="cyan" bold>
        Contributor Detail
      </Text>
      <Text color="#555555">Press Escape to close  [r] refresh</Text>

      {/* Profile */}
      <Box marginTop={1} flexDirection="column">
        <Box flexDirection="row">
          <Text color="white">Login: </Text>
          <Text color="cyan">@{login}</Text>
        </Box>
        {contributor?.name !== undefined && (
          <Box flexDirection="row">
            <Text color="white">Name:  </Text>
            <Text color="white">{contributor.name}</Text>
          </Box>
        )}
        {contributor !== undefined && (
          <Box flexDirection="row">
            <Text color="white">Role:  </Text>
            <Text color={roleColor(contributor.role)}>{contributor.role}</Text>
          </Box>
        )}
        {contributor?.currentTaskId !== undefined && (
          <Box flexDirection="row">
            <Text color="white">Task:  </Text>
            <Text color="yellow">{contributor.currentTaskId}</Text>
          </Box>
        )}
      </Box>

      {/* Assigned issues */}
      <Box marginTop={1} flexDirection="column">
        <Text color="white" bold>Open Issues</Text>

        {isLoading && (
          <Box marginTop={1}>
            <Text color="cyan">Loading...</Text>
          </Box>
        )}

        {!isLoading && loadError !== null && (
          <Box marginTop={1}>
            <Text color="red">{loadError}</Text>
          </Box>
        )}

        {!isLoading && githubReadService === null && (
          <Box marginTop={1}>
            <Text color="yellow">GitHub not configured — cannot load issues.</Text>
          </Box>
        )}

        {!isLoading && loadError === null && issues.length === 0 && githubReadService !== null && (
          <Box marginTop={1}>
            <Text color="#555555">No open issues assigned to @{login}.</Text>
          </Box>
        )}

        {!isLoading && issues.map((issue) => (
          <Box key={issue.issueNumber} marginTop={0} flexDirection="row">
            <Text color="cyan">  #{String(issue.issueNumber).padStart(4, ' ')} </Text>
            <Text>
              {issue.title.length > 45
                ? `${issue.title.slice(0, 44)}…`
                : issue.title}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
};
