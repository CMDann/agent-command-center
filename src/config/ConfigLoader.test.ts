import { describe, it, expect } from 'vitest';
import { NexusConfigSchema } from './schema.js';
import { ConfigValidationError } from './ConfigLoader.js';
import { ZodError } from 'zod';

describe('NexusConfigSchema', () => {
  describe('parse', () => {
    it('should parse a minimal valid config with defaults applied', () => {
      const config = NexusConfigSchema.parse({ workspace: '/projects/myapp' });

      expect(config.workspace).toBe('/projects/myapp');
      expect(config.agents).toEqual([]);
      expect(config.repos).toEqual([]);
    });

    it('should apply default bridge port and host', () => {
      const config = NexusConfigSchema.parse({ workspace: '/projects/myapp' });

      expect(config.bridge.port).toBe(7777);
      expect(config.bridge.host).toBe('localhost');
    });

    it('should accept a full agent config', () => {
      const config = NexusConfigSchema.parse({
        workspace: '/projects/myapp',
        agents: [
          {
            id: 'claude-local',
            type: 'claude',
            workdir: '/projects/myapp',
            autopr: true,
          },
        ],
      });

      expect(config.agents).toHaveLength(1);
      expect(config.agents[0]?.id).toBe('claude-local');
      expect(config.agents[0]?.type).toBe('claude');
    });

    it('should reject an invalid agent type', () => {
      expect(() =>
        NexusConfigSchema.parse({
          workspace: '/projects/myapp',
          agents: [{ id: 'bad-agent', type: 'unknown' }],
        })
      ).toThrow(ZodError);
    });

    it('should reject a config missing the required workspace field', () => {
      expect(() => NexusConfigSchema.parse({})).toThrow(ZodError);
    });
  });
});

describe('ConfigValidationError', () => {
  it('should be constructable with issues from a ZodError', () => {
    const zodError = new ZodError([
      {
        code: 'invalid_type',
        expected: 'string',
        received: 'undefined',
        path: ['workspace'],
        message: 'Required',
      },
    ]);

    const error = new ConfigValidationError('Invalid config', zodError.issues);

    expect(error.name).toBe('ConfigValidationError');
    expect(error.message).toBe('Invalid config');
    expect(error.issues).toHaveLength(1);
    expect(error instanceof Error).toBe(true);
  });
});
