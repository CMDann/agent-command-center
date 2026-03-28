import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { NexusConfigSchema } from './schema.js';
import { ConfigLoader, ConfigValidationError } from './ConfigLoader.js';

describe('NexusConfigSchema', () => {
  it('parses a minimal valid config with defaults applied', () => {
    const config = NexusConfigSchema.parse({ workspace: '/projects/myapp' });

    expect(config.workspace).toBe('/projects/myapp');
    expect(config.agents).toEqual([]);
    expect(config.repos).toEqual([]);
    expect(config.bridge.port).toBe(7777);
    expect(config.bridge.host).toBe('localhost');
    expect(config.github).toEqual({});
  });

  it('accepts subrepos as an alias for repos (back-compat)', () => {
    const config = NexusConfigSchema.parse({
      workspace: '/projects/myapp',
      subrepos: [{ name: 'api', path: './packages/api' }],
    });

    expect(config.repos).toHaveLength(1);
    expect(config.repos[0]?.name).toBe('api');
  });

  it('rejects an invalid agent type', () => {
    expect(() =>
      NexusConfigSchema.parse({
        workspace: '/projects/myapp',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        agents: [{ id: 'bad-agent', type: 'unknown' as any }],
      })
    ).toThrow(ZodError);
  });

  it('enforces local agent workdir requirement', () => {
    expect(() =>
      NexusConfigSchema.parse({
        workspace: '/projects/myapp',
        agents: [{ id: 'claude-local', type: 'claude' }],
      })
    ).toThrow(ZodError);
  });

  it('enforces remote agent host/transport requirements', () => {
    expect(() =>
      NexusConfigSchema.parse({
        workspace: '/projects/myapp',
        agents: [{ id: 'openclaw-remote', type: 'openclaw' }],
      })
    ).toThrow(ZodError);
  });
});

describe('ConfigLoader', () => {
  it('normalizes paths relative to the config file directory', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-config-'));
    const cfgPath = path.join(tmp, 'nexus.config.json');

    await fs.writeFile(
      cfgPath,
      JSON.stringify(
        {
          workspace: './workspace',
          repos: [{ name: 'api', path: './packages/api' }],
          agents: [{ id: 'claude-local', type: 'claude', workdir: './' }],
        },
        null,
        2
      ),
      'utf8'
    );

    const loader = new ConfigLoader();
    const cfg = await loader.load({ configPath: cfgPath });

    expect(cfg.workspace).toBe(path.resolve(tmp, 'workspace'));
    expect(cfg.repos[0]?.path).toBe(path.resolve(tmp, 'packages/api'));
    expect(cfg.agents[0]?.workdir).toBe(path.resolve(tmp));
  });

  it('applies env overrides with higher precedence than file', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-config-'));
    const cfgPath = path.join(tmp, 'nexus.config.json');

    await fs.writeFile(
      cfgPath,
      JSON.stringify(
        {
          workspace: tmp,
          github: { owner: 'from-file', repo: 'from-file' },
        },
        null,
        2
      ),
      'utf8'
    );

    const loader = new ConfigLoader();
    const cfg = await loader.load({
      configPath: cfgPath,
      env: {
        GITHUB_OWNER: 'from-env',
        GITHUB_REPO: 'from-env',
        GITHUB_TOKEN: 'super-secret',
      },
    });

    expect(cfg.github.owner).toBe('from-env');
    expect(cfg.github.repo).toBe('from-env');
    // token is present in returned config but must never appear in error messages
    expect(cfg.github.token).toBe('super-secret');
  });

  it('throws ConfigValidationError with friendly message on invalid configs', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-config-'));
    const cfgPath = path.join(tmp, 'nexus.config.json');

    await fs.writeFile(cfgPath, JSON.stringify({ workspace: tmp, agents: [{ id: 'x', type: 'claude' }] }), 'utf8');

    const loader = new ConfigLoader();

    await expect(loader.load({ configPath: cfgPath })).rejects.toMatchObject({
      name: 'ConfigValidationError',
    });

    try {
      await loader.load({ configPath: cfgPath });
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigValidationError);
      const msg = (err as Error).message;
      expect(msg).toContain('Invalid NEXUS configuration');
      expect(msg).toContain('Local agents (claude/codex) require `workdir`');
      // Avoid leaking obvious secrets in error messages
      expect(msg).not.toContain('super-secret');
    }
  });
});
