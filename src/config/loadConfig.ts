import { ConfigLoader, ConfigValidationError } from './ConfigLoader.js';
import { logger } from '../utils/logger.js';
import type { NexusConfig } from './schema.js';

/**
 * Loads config once at startup.
 *
 * - Uses NEXUS_CONFIG_PATH when set (supports ~ and relative paths).
 * - Otherwise searches upward from process.cwd().
 */
export async function loadConfig(): Promise<NexusConfig> {
  const loader = new ConfigLoader();
  const configPath = process.env['NEXUS_CONFIG_PATH'];
  return loader.load({ configPath });
}

/**
 * Load config, printing a friendly message and exiting on validation failure.
 */
export async function loadConfigOrExit(): Promise<NexusConfig> {
  try {
    const config = await loadConfig();
    logger.debug(
      {
        workspace: config.workspace,
        repoCount: config.repos.length,
        agentCount: config.agents.length,
        bridgeHost: config.bridge.host,
        bridgePort: config.bridge.port,
        githubConfigured: Boolean(config.github.owner && config.github.repo),
      },
      'Config loaded'
    );
    return config;
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      // Print the message directly; it is designed for operator display.
      // Avoid structured logging to reduce accidental secret inclusion.
      // eslint-disable-next-line no-console
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}
