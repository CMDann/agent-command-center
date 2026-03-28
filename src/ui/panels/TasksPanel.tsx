import React, { useEffect } from 'react';
import { Box, Text } from 'ink';
import { useGitHubStore } from '../hooks/useGitHubStore.js';
import type { IssueSummary } from '../../types.js';

/** Max issues to display before truncating. */
const MAX_ISSUES = 15;

/** Renders a single issue row. */
const IssueRow: React.FC<{ issue: IssueSummary }> = ({ issue }) => (
  <Box flexDirection="row" marginTop={1}>
    {/* Issue number */}
    <Text color="cyan">#{String(issue.issueNumber).padStart(3, ' ')} </Text>

    {/* Title — truncated to 35 chars to fit the panel */}
    <Text>
      {issue.title.length > 35 ? `${issue.title.slice(0, 34)}…` : issue.title.padEnd(35)}
    </Text>

    {/* Assignee */}
    <Text color={issue.assigneeLogin !== undefined ? 'green' : '#555555'}>
      {' '}[{issue.assigneeLogin ?? 'unassigned'}]
    </Text>

    {/* First label */}
    {issue.labels.length > 0 && (
      <Text color="magenta"> {issue.labels[0]}</Text>
    )}
  </Box>
);

/**
 * Tasks / open issues panel.
 * Displays GitHub Issues fetched via {@link useGitHubStore}, ordered
 * newest-first. Shows a configuration prompt when GitHub env vars are absent.
 *
 * Data is loaded on mount and refreshed every 60 s.
 */
export const TasksPanel: React.FC = () => {
  const { issues, isLoading, error, isConfigured, refresh } = useGitHubStore();

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), 60_000);
    return (): void => clearInterval(interval);
    // refresh is a stable Zustand action reference — empty deps is intentional.
  }, []);

  const visible = issues.slice(0, MAX_ISSUES);

  return (
    <Box borderStyle="single" flexDirection="column" width="50%" padding={1}>
      {/* Panel title */}
      <Box flexDirection="row">
        <Text color="cyan" bold>
          TASKS
        </Text>
        {issues.length > 0 && (
          <Text color="#555555"> ({issues.length} open)</Text>
        )}
      </Box>

      {/* Not configured */}
      {!isConfigured && error !== null && (
        <Box marginTop={1} flexDirection="column">
          <Text color="yellow">GitHub not configured.</Text>
          <Text color="#555555">Set GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO</Text>
          <Text color="#555555">in .env to enable issue tracking.</Text>
        </Box>
      )}

      {/* Error from a configured-but-failing service */}
      {isConfigured && error !== null && (
        <Box marginTop={1}>
          <Text color="red">{error}</Text>
        </Box>
      )}

      {/* Loading placeholder */}
      {isLoading && issues.length === 0 && error === null && (
        <Text color="#555555">Loading issues...</Text>
      )}

      {/* Issue list */}
      {visible.map((issue) => (
        <IssueRow key={issue.issueNumber} issue={issue} />
      ))}

      {/* Truncation notice */}
      {issues.length > MAX_ISSUES && (
        <Text color="#555555">…{issues.length - MAX_ISSUES} more issues</Text>
      )}

      {/* Empty state */}
      {isConfigured && !isLoading && error === null && issues.length === 0 && (
        <Text color="green"> No open issues</Text>
      )}
    </Box>
  );
};
