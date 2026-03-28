import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useAgentStore } from '../hooks/useAgentStore.js';
import type { AgentType } from '../../types.js';

/** Ordered list of selectable agent types with display labels. */
const AGENT_TYPES: { key: string; value: AgentType; label: string }[] = [
  { key: '1', value: 'claude', label: 'claude  — Anthropic Claude CLI' },
  { key: '2', value: 'codex', label: 'codex   — OpenAI Codex CLI' },
];

type Step = 'enter_id' | 'select_type' | 'connecting';

interface ConnectAgentModalProps {
  /** Called when the modal is closed (cancel or success). */
  onClose: () => void;
}

/**
 * Inline modal for connecting a new local agent.
 *
 * ### Interaction flow
 * 1. User types the agent ID → press `Enter` to advance.
 * 2. User presses `1` or `2` to select the agent type.
 * 3. Modal connects the agent and closes automatically on success.
 * 4. `Escape` cancels at any step.
 */
export const ConnectAgentModal: React.FC<ConnectAgentModalProps> = ({ onClose }) => {
  const [step, setStep] = useState<Step>('enter_id');
  const [agentId, setAgentId] = useState('');
  const [selectedType, setSelectedType] = useState<AgentType | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const { registerAndConnect, isConnecting, connectError } = useAgentStore();

  useInput((input, key) => {
    if (isConnecting) return; // Lock input while connecting.

    if (key.escape) {
      onClose();
      return;
    }

    if (step === 'enter_id') {
      if (key.return) {
        if (agentId.trim().length === 0) {
          setLocalError('Agent ID cannot be empty.');
          return;
        }
        setLocalError(null);
        setStep('select_type');
      } else if (key.backspace || key.delete) {
        setAgentId((v) => v.slice(0, -1));
      } else if (input && input.length === 1 && !key.ctrl && !key.meta) {
        setLocalError(null);
        setAgentId((v) => v + input);
      }
      return;
    }

    if (step === 'select_type') {
      const match = AGENT_TYPES.find((t) => t.key === input);
      if (match) {
        setSelectedType(match.value);
        setStep('connecting');
        void doConnect(agentId.trim(), match.value);
      }
    }
  });

  const doConnect = async (id: string, type: AgentType): Promise<void> => {
    await registerAndConnect({
      id,
      type,
      autopr: true,
    });
    // If connectError is still null after the call, we succeeded.
    // The store sets connectError on failure; check after the await.
    const storeState = useAgentStore.getState();
    if (!storeState.connectError) {
      onClose();
    } else {
      setLocalError(storeState.connectError);
      setStep('enter_id');
      setAgentId('');
    }
  };

  const displayError = localError ?? connectError;

  return (
    <Box
      borderStyle="round"
      borderColor="cyan"
      flexDirection="column"
      padding={1}
      marginTop={1}
    >
      <Text color="cyan" bold>
        Connect Agent
      </Text>
      <Text color="#555555">Press Escape to cancel</Text>

      <Box marginTop={1} flexDirection="column">
        {/* Step 1 — ID input */}
        <Box flexDirection="row">
          <Text color={step === 'enter_id' ? 'white' : '#555555'}>Agent ID: </Text>
          <Text color="white">{agentId}</Text>
          {step === 'enter_id' && <Text color="cyan">▌</Text>}
        </Box>

        {/* Step 2 — type selection */}
        {(step === 'select_type' || step === 'connecting') && (
          <Box marginTop={1} flexDirection="column">
            <Text color="white">Select type:</Text>
            {AGENT_TYPES.map((t) => (
              <Box key={t.key} marginLeft={2}>
                <Text color={selectedType === t.value ? 'cyan' : 'white'}>
                  [{t.key}] {t.label}
                  {selectedType === t.value ? ' ←' : ''}
                </Text>
              </Box>
            ))}
          </Box>
        )}

        {/* Connecting spinner */}
        {step === 'connecting' && isConnecting && (
          <Box marginTop={1}>
            <Text color="cyan">Connecting...</Text>
          </Box>
        )}

        {/* Error message */}
        {displayError !== null && (
          <Box marginTop={1}>
            <Text color="red">{displayError}</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
};
