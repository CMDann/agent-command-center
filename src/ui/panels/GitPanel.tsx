import React from 'react';
import { Box, Text } from 'ink';

/**
 * Git status panel — placeholder for Phase 0.
 * Will display branch info, dirty files, and sub-repos in Phase 1+.
 */
export const GitPanel: React.FC = () => {
  return (
    <Box borderStyle="single" flexDirection="column" width="50%" padding={1}>
      <Text color="cyan" bold>
        GIT STATUS
      </Text>
      <Text color="#555555"> </Text>
      <Text color="#555555">Loading...</Text>
    </Box>
  );
};
