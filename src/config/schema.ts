import { z } from 'zod';

/** Schema for a sub-repository entry in the workspace. */
const RepoConfigSchema = z.object({
  name: z.string(),
  path: z.string(),
  remote: z.string().optional(),
});

/** Schema for the agent bridge server configuration. */
const BridgeConfigSchema = z
  .object({
    port: z.number().default(7777),
    host: z.string().default('localhost'),
  })
  .default({});

/** Schema for SSH tunnel configuration. */
const SshTunnelConfigSchema = z.object({
  host: z.string(),
  port: z.number().optional(),
  user: z.string(),
  keyPath: z.string(),
});

/** Schema for a single agent configuration entry. */
const AgentConfigSchema = z.object({
  id: z.string(),
  type: z.enum(['claude', 'codex', 'openclaw']),
  workdir: z.string().optional(),
  host: z.string().optional(),
  port: z.number().optional(),
  transport: z.enum(['ssh', 'websocket']).optional(),
  autopr: z.boolean().default(true),
  sshTunnel: SshTunnelConfigSchema.optional(),
});

/** Root schema for nexus.config.json. */
export const NexusConfigSchema = z.object({
  workspace: z.string(),
  repos: z.array(RepoConfigSchema).default([]),
  bridge: BridgeConfigSchema,
  agents: z.array(AgentConfigSchema).default([]),
});

/** Inferred TypeScript type for the validated NEXUS configuration. */
export type NexusConfig = z.infer<typeof NexusConfigSchema>;

/** Inferred TypeScript type for a single agent configuration entry. */
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

/** Inferred TypeScript type for a sub-repository entry. */
export type RepoConfig = z.infer<typeof RepoConfigSchema>;
