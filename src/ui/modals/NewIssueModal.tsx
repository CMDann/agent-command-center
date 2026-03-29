import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useTaskStore } from '../hooks/useTaskStore.js';
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

type Step = 'enter_title' | 'enter_body' | 'enter_labels' | 'submitting';

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
  const [step, setStep] = useState<Step>('enter_title');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [labels, setLabels] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { enqueue } = useTaskStore();

  useInput((input, key) => {
    if (step === 'submitting') return;

    if (key.escape) {
      onClose();
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
          repoPath: process.cwd(),
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
          repoPath: process.cwd(),
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

      <Box marginTop={1} flexDirection="column">
        {/* Title input */}
        <Box flexDirection="row">
          <Text color={step === 'enter_title' ? 'white' : '#555555'}>Title:  </Text>
          <Text color="white">{title}</Text>
          {step === 'enter_title' && <Text color="cyan">▌</Text>}
        </Box>

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
