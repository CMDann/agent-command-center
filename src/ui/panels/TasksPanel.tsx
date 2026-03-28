import React from 'react';
import { Box, Text } from 'ink';

/**
 * Tasks panel — placeholder for Phase 0.
 * Will display the task queue backed by GitHub Issues in Phase 4+.
 */
export const TasksPanel: React.FC = () => {
  return (
    <Box borderStyle="single" flexDirection="column" width="50%" padding={1}>
      <Text color="cyan" bold>
        TASKS
      </Text>
      <Text color="#555555"> </Text>
      <Text color="#555555">No tasks loaded</Text>
    </Box>
  );
};
