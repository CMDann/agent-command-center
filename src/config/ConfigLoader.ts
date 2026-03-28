import { cosmiconfig } from 'cosmiconfig';
import { NexusConfigSchema, type NexusConfig } from './schema.js';
import { ZodError } from 'zod';

/**
 * Thrown when the loaded configuration fails Zod validation.
 */
export class ConfigValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: ZodError['issues']
  ) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

/**
 * Loads and validates the NEXUS configuration from the nearest
 * `nexus.config.json` (or any cosmiconfig-supported format) in the
 * directory tree. Falls back to schema defaults when no file is found.
 */
export class ConfigLoader {
  /**
   * Searches for and loads the NEXUS config file, then validates it.
   *
   * @returns The validated {@link NexusConfig} object.
   * @throws {ConfigValidationError} If the config file fails schema validation.
   */
  async load(): Promise<NexusConfig> {
    const explorer = cosmiconfig('nexus');
    const result = await explorer.search();

    const raw: unknown = result?.config ?? { workspace: process.cwd() };

    try {
      return NexusConfigSchema.parse(raw);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new ConfigValidationError(
          `Invalid nexus configuration: ${err.message}`,
          err.issues
        );
      }
      throw err;
    }
  }
}
