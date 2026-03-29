import React, { useState } from 'react';
import { resolve } from 'path';
import { Box, Text, useInput } from 'ink';
import { useTaskStore } from '../hooks/useTaskStore.js';
import { useGitStore } from '../hooks/useGitStore.js';
import { logger } from '../../utils/logger.js';
import { GitHubWriteService } from '../../github/GitHubWriteService.js';

// ---------------------------------------------------------------------------
// Write service (built from env vars, or null if not configured)
// ---------------------------------------------------------------------------

function buildWriteService(): GitHubWriteService | null {
  try {
    return GitHubWriteService.fromEnv();
  } catch {
    return null;
  }
}

const githubService = buildWriteService();

// ---------------------------------------------------------------------------
// Step machine
// ---------------------------------------------------------------------------

type Step = 'select_repo' | 'enter_title' | 'enter_body' | 'enter_labels' | 'submitting';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface NewIssueModalProps {
  /** Called when the modal closes (cancel or after successful creation). */
  onClose: () => void;
}

/**
 * Inline modal for creating a new GitHub Issue and immediately enqueuing
 * it as a backlog task.
 *
 * ### Interaction flow
 * 0. If sub-repos are detected, user selects target sub-repo (`↑`/`↓` + `Enter`).
 *    This step is skipped when no sub-repos exist.
 * 1. User types the issue **title** → `Enter` to advance.
 * 2. User types the **body** (optional, single line) → `Enter` to advance.
 * 3. User types comma-separated **labels** → `Enter` to submit.
 * 4. On success, the issue is enqueued and the modal closes.
 * 5. `Escape` cancels at any step.
 *
 * When GitHub is not configured, step 3 still creates a local-only task
 * (no API call is made).
 */
export const NewIssueModal: React.FC<NewIssueModalProps> = ({ onClose }) => {
  const { subRepos, activeSubRepo } = useGitStore();
  const hasSubRepos = subRepos.length > 0;

  // Pre-select the active sub-repo index, falling back to 0.
  const initialRepoIndex = activeSubRepo !== null
    ? Math.max(0, subRepos.findIndex((r) => r.path === activeSubRepo.path))
    : 0;

  const [step, setStep] = useState<Step>(hasSubRepos ? 'select_repo' : 'enter_title');
  const [repoIndex, setRepoIndex] = useState(initialRepoIndex);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [labels, setLabels] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { enqueue } = useTaskStore();

  /** Absolute path of the repo selected by the user (or workspace root). */
  const selectedRepoPath = hasSubRepos && subRepos[repoIndex] !== undefined
    ? resolve(process.cwd(), subRepos[repoIndex]!.path)
    : process.cwd();

  useInput((input, key) => {
    if (step === 'submitting') return;

    if (key.escape) {
      onClose();
      return;
    }

    if (step === 'select_repo') {
      if (key.upArrow) {
        setRepoIndex((i) => Math.max(0, i - 1));
      } else if (key.downArrow) {
        setRepoIndex((i) => Math.min(subRepos.length - 1, i + 1));
      } else if (key.return) {
        setStep('enter_title');
      }
      return;
    }

    if (step === 'enter_title') {
      if (key.return) {
        if (title.trim().length === 0) {
          setError('Title cannot be empty.');
          return;
        }
        setError(null);
        setStep('enter_body');
      } else if (key.backspace || key.delete) {
        setTitle((v) => v.slice(0, -1));
      } else if (input && input.length === 1 && !key.ctrl && !key.meta) {
        setError(null);
        setTitle((v) => v + input);
      }
      return;
    }

    if (step === 'enter_body') {
      if (key.return) {
        setStep('enter_labels');
      } else if (key.backspace || key.delete) {
        setBody((v) => v.slice(0, -1));
      } else if (input && input.length === 1 && !key.ctrl && !key.meta) {
        setBody((v) => v + input);
      }
      return;
    }

    if (step === 'enter_labels') {
      if (key.return) {
        setStep('submitting');
        void handleSubmit(title.trim(), body.trim(), labels.trim());
      } else if (key.backspace || key.delete) {
        setLabels((v) => v.slice(0, -1));
      } else if (input && input.length === 1 && !key.ctrl && !key.meta) {
        setLabels((v) => v + input);
      }
    }
  });

  const handleSubmit = async (
    finalTitle: string,
    finalBody: string,
    finalLabels: string
  ): Promise<void> => {
    const parsedLabels = finalLabels
      .split(',')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    try {
      if (githubService) {
        const issue = await githubService.createIssue({
          title: finalTitle,
          body: finalBody || undefined,
          labels: parsedLabels,
        });

        // Enqueue the newly created issue as a backlog task.
        enqueue({
          id: `issue-${issue.issueNumber}`,
          issueNumber: issue.issueNumber,
          title: issue.title,
          body: issue.body,
          labels: issue.labels,
          status: 'backlog',
          repoPath: selectedRepoPath,
          createdAt: issue.createdAt,
          updatedAt: issue.updatedAt,
        });
        logger.info({ issueNumber: issue.issueNumber }, 'New issue created and enqueued');
      } else {
        // GitHub not configured — create a local-only placeholder task.
        const localId = `local-${Date.now()}`;
        enqueue({
          id: localId,
          issueNumber: 0,
          title: finalTitle,
          body: finalBody,
          labels: parsedLabels,
          status: 'backlog',
          repoPath: selectedRepoPath,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        logger.info({ localId }, 'Created local task (GitHub not configured)');
      }
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err }, 'Failed to create issue');
      setError(message);
      setStep('enter_title');
    }
  };

  return (
    <Box
      borderStyle="round"
      borderColor="cyan"
      flexDirection="column"
      padding={1}
      marginTop={1}
    >
      <Text color="cyan" bold>
        New Issue
      </Text>
      <Text color="#555555">Press Escape to cancel</Text>

      {!githubService && (
        <Box marginTop={1}>
          <Text color="yellow">GitHub not configured — task will be local-only.</Text>
        </Box>
      )}

      {/* Sub-repo selector (shown only if sub-repos exist) */}
      {hasSubRepos && (
        <Box marginTop={1} flexDirection="column">
          <Text color={step === 'select_repo' ? 'white' : '#555555'}>
            Repo:   {subRepos[repoIndex]?.path ?? process.cwd()}
          </Text>
          {step === 'select_repo' && (
            <Box marginLeft={2} flexDirection="column">
              {subRepos.map((repo, idx) => (
                <Text
                  key={repo.path}
                  color={idx === repoIndex ? 'cyan' : '#555555'}
                >
                  {idx === repoIndex ? '▶ ' : '  '}{repo.path}
                  {repo.branch !== undefined ? ` [${repo.branch}]` : ''}
                </Text>
              ))}
              <Text color="#555555">[↑↓] select  [Enter] confirm</Text>
            </Box>
          )}
        </Box>
      )}

      <Box marginTop={hasSubRepos ? 0 : 1} flexDirection="column">
        {/* Title input */}
        {(step !== 'select_repo') && (
          <Box flexDirection="row">
            <Text color={step === 'enter_title' ? 'white' : '#555555'}>Title:  </Text>
            <Text color="white">{title}</Text>
            {step === 'enter_title' && <Text color="cyan">▌</Text>}
          </Box>
        )}

        {/* Body input */}
        {(step === 'enter_body' || step === 'enter_labels' || step === 'submitting') && (
          <Box marginTop={1} flexDirection="row">
            <Text color={step === 'enter_body' ? 'white' : '#555555'}>Body:   </Text>
            <Text color="white">{body || '(empty)'}</Text>
            {step === 'enter_body' && <Text color="cyan">▌</Text>}
          </Box>
        )}

        {/* Labels input */}
        {(step === 'enter_labels' || step === 'submitting') && (
          <Box marginTop={1} flexDirection="row">
            <Text color={step === 'enter_labels' ? 'white' : '#555555'}>Labels: </Text>
            <Text color="white">{labels || '(none)'}</Text>
            {step === 'enter_labels' && <Text color="cyan">▌</Text>}
          </Box>
        )}

        {/* Submitting indicator */}
        {step === 'submitting' && (
          <Box marginTop={1}>
            <Text color="cyan">Creating issue...</Text>
          </Box>
        )}

        {/* Error message */}
        {error !== null && (
          <Box marginTop={1}>
            <Text color="red">{error}</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
};
