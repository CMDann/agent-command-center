import React from 'react';
import { render } from 'ink';
import { App } from './ui/App.js';
import { logger } from './utils/logger.js';

logger.info('NEXUS starting up');

// CI/automation-friendly smoke mode: ensure the app can start without
// requiring an interactive TUI session.
if (process.env.NEXUS_SMOKE === '1') {
  logger.info('NEXUS_SMOKE enabled; exiting after startup.');
  process.exit(0);
}

render(<App />);
