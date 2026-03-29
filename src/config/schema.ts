import { z } from 'zod';

const SshTunnelConfigSchema = z.object({
  host: z.string().min(1, 'SSH tunnel host is required'),
  port: z.number().int().min(1).max(65535).optional(),
  user: z.string().min(1, 'SSH tunnel user is required'),
  keyPath: z.string().min(1, 'SSH tunnel keyPath is required'),
});

/**
 * Schema for a repo entry in the workspace.
 *
 * NOTE: Docs historically used the term "subrepos". We standardize on `repos`.
 */
const RepoConfigSchema = z.object({
  name: z.string().min(1, 'Repo name is required'),
  path: z.string().min(1, 'Repo path is required'),
  remote: z.string().optional(),
});

/** Schema for GitHub configuration (token is recommended via env var). */
const GitHubConfigSchema = z
  .object({
    owner: z.string().min(1, 'GitHub owner is required').optional(),
    repo: z.string().min(1, 'GitHub repo is required').optional(),
    /**
     * Optional because we prefer loading from env; never print this value.
     * (Kept for completeness / private local configs.)
     */
    token: z.string().min(1).optional(),
  })
  .default({});

/** Schema for the agent bridge server configuration. */
const BridgeConfigSchema = z
  .object({
    port: z.number().int().min(1).max(65535).default(7777),
    host: z.string().min(1).default('localhost'),
    /**
     * Shared secret for authenticating remote agent bridge connections.
     * Prefer env var `NEXUS_BRIDGE_SECRET`.
     */
    secret: z.string().min(1).optional(),
  })
  .default({});

/** Schema for a single agent configuration entry. */
const AgentConfigSchema = z
  .object({
    id: z.string().min(1, 'Agent id is required'),
    type: z.enum(['claude', 'codex', 'openclaw']),
    /**
     * Working directory for local agents.
     * Resolved relative to the config file directory.
     */
    workdir: z.string().optional(),

    /** Remote connection settings (required for remote agents). */
    host: z.string().optional(),
    port: z.number().int().min(1).max(65535).optional(),
    transport: z.enum(['ssh', 'websocket']).optional(),
    sshTunnel: SshTunnelConfigSchema.optional(),

    autopr: z.boolean().default(true),
  })
  .superRefine((agent, ctx) => {
    const isOpenClaw = agent.type === 'openclaw';

    if (isOpenClaw) {
      const hasHost = !!agent.host;
      const hasPort = agent.port !== undefined;
      const hasTransport = agent.transport !== undefined;
      const hasSshTunnel = agent.sshTunnel !== undefined;

      if (!hasHost && !hasPort && !hasTransport && !hasSshTunnel) {
        // Server mode: allow a local bridge listener with optional explicit port.
        return;
      }

      if (!hasHost) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['host'],
          message: 'OpenClaw client mode requires host.',
        });
      }

      if (!hasTransport) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['transport'],
          message: 'OpenClaw client mode requires transport (ssh or websocket).',
        });
      }

      if (agent.transport === 'websocket' && !hasPort) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['port'],
          message: 'OpenClaw websocket client mode requires port (for example 7777).',
        });
      }

      if (agent.transport === 'ssh' && hasPort) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['port'],
          message: 'OpenClaw ssh transport should not set port directly; use sshTunnel for tunnel settings or websocket transport for direct socket connections.',
        });
      }

      if (agent.transport === 'ssh' && !hasSshTunnel) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['sshTunnel'],
          message: 'OpenClaw ssh transport requires sshTunnel configuration.',
        });
      }

      if (agent.transport === 'websocket' && hasSshTunnel) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['sshTunnel'],
          message: 'OpenClaw websocket transport should not include sshTunnel configuration.',
        });
      }

      if (agent.workdir) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['workdir'],
          message: 'OpenClaw agents do not use local workdir in config.',
        });
      }
    } else {
      if (!agent.workdir) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['workdir'],
          message: 'Local agents require a workdir.',
        });
      }
      if (agent.host || agent.transport || agent.port || agent.sshTunnel) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [],
          message:
            'Local agents should not set host/port/transport/sshTunnel. Use type="openclaw" for bridge-based agents.',
        });
      }
    }
  });

/**
 * Root schema for nexus.config.json.
 *
 * - `workspace` is required.
 * - `repos` is the standardized name ("subrepos" is accepted as an alias).
 */
export const NexusConfigSchema = z.preprocess(
  (input) => {
    if (!input || typeof input !== 'object') return input;
    const obj = input as Record<string, unknown>;
    // Back-compat alias: subrepos -> repos
    if (obj['repos'] === undefined && Array.isArray(obj['subrepos'])) {
      return { ...obj, repos: obj['subrepos'] };
    }
    return obj;
  },
  z
    .object({
      /** Workspace root directory (resolved relative to config file directory). */
      workspace: z.string().min(1, 'Workspace path is required'),
      repos: z.array(RepoConfigSchema).default([]),
      bridge: BridgeConfigSchema,
      github: GitHubConfigSchema,
      agents: z.array(AgentConfigSchema).default([]),
    })
    .superRefine((cfg, ctx) => {
      const hasOwner = !!cfg.github?.owner;
      const hasRepo = !!cfg.github?.repo;
      if (hasOwner !== hasRepo) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['github'],
          message:
            'GitHub config must include both owner and repo (or neither). Token can be provided via GITHUB_TOKEN.',
        });
      }
    })
);

/** Inferred TypeScript type for the validated NEXUS configuration. */
export type NexusConfig = z.infer<typeof NexusConfigSchema>;

export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type RepoConfig = z.infer<typeof RepoConfigSchema>;
export type BridgeConfig = z.infer<typeof BridgeConfigSchema>;
export type GitHubConfig = z.infer<typeof GitHubConfigSchema>;
