import React from 'react';
import { Box, Text } from 'ink';

/**
 * Agent log panel — placeholder for Phase 0.
 * Will stream real-time log output from active agent sessions in Phase 2+.
 */
export const LogPanel: React.FC = () => {
  return (
    <Box borderStyle="single" flexDirection="column" width="50%" padding={1}>
      <Text color="cyan" bold>
        AGENT LOG
      </Text>
      <Text color="#555555"> </Text>
      <Text color="#555555">No log output</Text>
    </Box>
  );
};
