import path from 'node:path';
import os from 'node:os';
import { cosmiconfig } from 'cosmiconfig';
import { ZodError } from 'zod';
import { NexusConfigSchema, type NexusConfig } from './schema.js';

/**
 * Thrown when the loaded configuration fails Zod validation.
 *
 * This error is designed to be displayed directly in a CLI/TUI:
 * - actionable
 * - includes the config file path (when known)
 * - avoids printing secrets
 */
export class ConfigValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: ZodError['issues'],
    public readonly filepath?: string
  ) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

export interface LoadConfigOptions {
  /**
   * Directory to start searching from when configPath is not provided.
   * Defaults to process.cwd().
   */
  cwd?: string;
  /**
   * Explicit config file path. Supports ~ and relative paths.
   * If omitted, cosmiconfig search() is used.
   */
  configPath?: string;
  /**
   * Environment variables (default: process.env).
   * Used for overrides and secret injection.
   */
  env?: NodeJS.ProcessEnv;
}

function expandTilde(p: string): string {
  if (!p.startsWith('~')) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

function resolveFrom(baseDir: string, p: string): string {
  const expanded = expandTilde(p);
  return path.isAbsolute(expanded) ? expanded : path.resolve(baseDir, expanded);
}

function formatIssues(issues: ZodError['issues']): string {
  return issues
    .map((issue) => {
      const p = issue.path.length ? issue.path.join('.') : '(root)';
      return `- ${p}: ${issue.message}`;
    })
    .join('\n');
}

function applyEnvOverrides(raw: Record<string, unknown>, env: NodeJS.ProcessEnv): Record<string, unknown> {
  const out: Record<string, unknown> = { ...raw };

  // GitHub overrides
  const owner = env['GITHUB_OWNER'];
  const repo = env['GITHUB_REPO'];
  const token = env['GITHUB_TOKEN'];
  if (owner || repo || token) {
    const githubRaw = (out['github'] && typeof out['github'] === 'object' ? (out['github'] as Record<string, unknown>) : {});
    out['github'] = {
      ...githubRaw,
      ...(owner ? { owner } : null),
      ...(repo ? { repo } : null),
      ...(token ? { token } : null),
    };
  }

  // Bridge secret override
  const bridgeSecret = env['NEXUS_BRIDGE_SECRET'];
  if (bridgeSecret) {
    const bridgeRaw = (out['bridge'] && typeof out['bridge'] === 'object' ? (out['bridge'] as Record<string, unknown>) : {});
    out['bridge'] = {
      ...bridgeRaw,
      secret: bridgeSecret,
    };
  }

  return out;
}

function normalizePaths(config: NexusConfig, baseDir: string): NexusConfig {
  return {
    ...config,
    workspace: resolveFrom(baseDir, config.workspace),
    repos: config.repos.map((r) => ({
      ...r,
      path: resolveFrom(baseDir, r.path),
    })),
    agents: config.agents.map((a) => ({
      ...a,
      ...(a.workdir ? { workdir: resolveFrom(baseDir, a.workdir) } : null),
    })),
  };
}

/**
 * Loads and validates the NEXUS configuration.
 *
 * Precedence (highest → lowest):
 * 1) environment variables (GITHUB_*, NEXUS_BRIDGE_SECRET)
 * 2) config file (explicit path if provided, otherwise nearest found by search)
 * 3) defaults
 */
export class ConfigLoader {
  async load(options: LoadConfigOptions = {}): Promise<NexusConfig> {
    const cwd = options.cwd ?? process.cwd();
    const env = options.env ?? process.env;

    const explorer = cosmiconfig('nexus');

    const explicitPath = options.configPath ? resolveFrom(cwd, options.configPath) : undefined;

    const result = explicitPath ? await explorer.load(explicitPath) : await explorer.search(cwd);
    const filepath = result?.filepath;

    const baseDir = filepath ? path.dirname(filepath) : cwd;

    // Default when no file found: config rooted at cwd.
    const rawConfig: Record<string, unknown> =
      (result?.config && typeof result.config === 'object' ? (result.config as Record<string, unknown>) : { workspace: cwd });

    const merged = applyEnvOverrides(rawConfig, env);

    try {
      const parsed = NexusConfigSchema.parse(merged);
      return normalizePaths(parsed, baseDir);
    } catch (err) {
      if (err instanceof ZodError) {
        const messageParts = [
          'Invalid NEXUS configuration.',
          filepath ? `Config file: ${filepath}` : 'Config file: (none found; using defaults + env)',
          '',
          'Problems:',
          formatIssues(err.issues),
          '',
          'Tips:',
          '- Validate JSON syntax and field names (docs use `repos`, not `subrepos`).',
          '- Local agents (claude/codex) require `workdir`.',
          '- Remote agents (openclaw) require `host` + `transport` (and `port` for websocket).',
          '- GitHub token should be provided via GITHUB_TOKEN.',
        ];

        throw new ConfigValidationError(messageParts.join('\n'), err.issues, filepath);
      }
      throw err;
    }
  }
}
