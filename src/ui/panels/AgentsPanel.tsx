import React from 'react';
import { Box, Text } from 'ink';

/**
 * Agents & Contributors panel — placeholder for Phase 0.
 * Will display connected agents and human contributors in Phase 2+.
 */
export const AgentsPanel: React.FC = () => {
  return (
    <Box borderStyle="single" flexDirection="column" width="50%" padding={1}>
      <Text color="cyan" bold>
        AGENTS &amp; CONTRIBUTORS
      </Text>
      <Text color="#555555"> </Text>
      <Text color="#555555">No agents connected</Text>
    </Box>
  );
};
