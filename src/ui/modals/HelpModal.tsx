import React from 'react';
import { Box, Text, useInput } from 'ink';

// ---------------------------------------------------------------------------
// Shortcut data
// ---------------------------------------------------------------------------

interface ShortcutRow {
  key: string;
  description: string;
}

interface ShortcutSection {
  section: string;
  shortcuts: ShortcutRow[];
}

const SHORTCUTS: ShortcutSection[] = [
  {
    section: 'Global',
    shortcuts: [
      { key: '?',      description: 'Toggle this help overlay' },
      { key: 'c',      description: 'Connect a new agent' },
      { key: 'i',      description: 'Create a new GitHub issue' },
      { key: 'q',      description: 'Quit NEXUS' },
    ],
  },
  {
    section: 'Tasks Panel',
    shortcuts: [
      { key: '↑ / ↓',  description: 'Navigate task list' },
      { key: 'a',      description: 'Assign selected task to agent or contributor' },
      { key: 'Enter',  description: 'Dispatch selected task to its assigned agent' },
    ],
  },
  {
    section: 'Agents & Contributors Panel',
    shortcuts: [
      { key: '↑ / ↓',  description: 'Navigate agents / contributors list' },
      { key: 'd',      description: 'Disconnect selected agent' },
      { key: 'Enter',  description: 'Open contributor detail view' },
    ],
  },
  {
    section: 'Git Panel',
    shortcuts: [
      { key: 'r',      description: 'Refresh git status' },
      { key: 's',      description: 'Set active sub-repo context (filter Tasks panel)' },
    ],
  },
  {
    section: 'New Issue Modal',
    shortcuts: [
      { key: 'Enter',  description: 'Advance to next field / submit' },
      { key: 'Escape', description: 'Cancel' },
    ],
  },
  {
    section: 'Contributor Detail Modal',
    shortcuts: [
      { key: 'r',      description: 'Refresh assigned issues' },
      { key: 'Escape', description: 'Close' },
    ],
  },
  {
    section: 'Any Modal',
    shortcuts: [
      { key: 'Escape', description: 'Cancel and return to main panels' },
    ],
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface HelpModalProps {
  /** Called when the modal should close. */
  onClose: () => void;
}

/**
 * Full-screen help overlay listing all NEXUS keyboard shortcuts.
 *
 * Opened with `?` from the main dashboard. Closed with `Escape` or `?`.
 */
export const HelpModal: React.FC<HelpModalProps> = ({ onClose }) => {
  useInput((input, key) => {
    if (key.escape || input === '?') {
      onClose();
    }
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
        NEXUS — Keyboard Shortcuts
      </Text>
      <Text color="#555555">Press Escape or ? to close</Text>

      {SHORTCUTS.map(({ section, shortcuts }) => (
        <Box key={section} flexDirection="column" marginTop={1}>
          <Text color="white" bold>
            {section}
          </Text>
          {shortcuts.map(({ key, description }) => (
            <Box key={key} marginLeft={2} flexDirection="row">
              <Text color="cyan">{key.padEnd(14)}</Text>
              <Text color="#888888">{description}</Text>
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  );
};
