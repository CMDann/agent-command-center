import React from 'react';
import { render } from 'ink';
import { App } from './ui/App.js';
import { logger } from './utils/logger.js';

logger.info('NEXUS starting up');

render(<App />);
