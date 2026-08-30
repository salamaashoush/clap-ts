/**
 * Tests for the machine-readable command tree dump.
 */

import { describe, test, expect } from 'bun:test';
import { toSpec, toSpecJson, walkSpec } from '../spec.js';
import type { CommandDef } from '../types.js';

const command: CommandDef = {
  meta: { name: 'my-app', version: '3.0', description: 'Does things', author: 'Salama Ashoush' },
  args: {
    config: { type: 'string', short: 'c', description: 'Config', env: 'APP_CONFIG' },
    mode: {
      type: 'string',
      valueParser: [{ name: 'fast', help: 'Skip checks' }, 'safe'],
      description: 'Mode',
    },
    port: { type: 'number', default: 8080, numArgs: { min: 1, max: 1 } },
    custom: { type: 'string', valueParser: (v) => v.trim() },
    old: { type: 'string', deprecated: 'gone soon', replacedBy: 'config' },
    secret: { type: 'string', hidden: true },
    file: { type: 'positional', required: true, valueName: 'FILE' },
  },
  subCommands: {
    test: { meta: { name: 'test', description: 'Tests', aliases: ['t'] } },
    ghost: { meta: { name: 'ghost', hidden: true } },
  },
};

const spec = toSpec(command);

describe('toSpec', () => {
  test('roots the path at the command name', () => {
    expect(spec.name).toBe('my-app');
    expect(spec.path).toEqual(['my-app']);
    expect(spec.subcommands[0]?.path).toEqual(['my-app', 'test']);
  });

  test('carries the command metadata', () => {
    expect(spec.version).toBe('3.0');
    expect(spec.author).toBe('Salama Ashoush');
    expect(spec.description).toBe('Does things');
  });

  test('builds a usage line', () => {
    expect(spec.usage).toBe('my-app [OPTIONS] <FILE> [COMMAND]');
  });

  test('flattens possible values, mixing plain strings and records', () => {
    const mode = spec.args.find((a) => a.name === 'mode')!;
    expect(mode.possibleValues).toEqual([{ name: 'fast', help: 'Skip checks' }, { name: 'safe' }]);
  });

  test('reports a function parser as a flag rather than dropping it silently', () => {
    expect(spec.args.find((a) => a.name === 'custom')!.hasCustomParser).toBe(true);
    expect(spec.args.find((a) => a.name === 'mode')!.hasCustomParser).toBeUndefined();
  });

  test('normalises deprecation', () => {
    const old = spec.args.find((a) => a.name === 'old')!;
    expect(old.deprecated).toBe('gone soon');
    expect(old.replacedBy).toBe('config');
  });

  test('omits hidden args and commands by default', () => {
    expect(spec.args.map((a) => a.name)).not.toContain('secret');
    expect(spec.subcommands.map((c) => c.name)).not.toContain('ghost');
  });

  test('includeHidden brings them back', () => {
    const full = toSpec(command, { includeHidden: true });
    expect(full.args.map((a) => a.name)).toContain('secret');
    expect(full.subcommands.map((c) => c.name)).toContain('ghost');
  });

  test('drops undefined keys rather than emitting nulls', () => {
    const port = spec.args.find((a) => a.name === 'port')!;
    expect('env' in port).toBe(false);
    expect(port.default).toBe(8080);
  });

  test('resolves lazy subcommands', () => {
    const lazy: CommandDef = {
      meta: { name: 'app' },
      lazySubCommands: () => ({ built: { meta: { name: 'built' } } }),
    };
    expect(toSpec(lazy).subcommands.map((c) => c.name)).toEqual(['built']);
  });
});

describe('serialisation', () => {
  test('round-trips through JSON unchanged', () => {
    expect(JSON.parse(toSpecJson(command))).toEqual(JSON.parse(JSON.stringify(spec)));
  });

  test('nothing in the output is a function', () => {
    const seen = JSON.stringify(spec);
    expect(seen).not.toContain('=>');
    expect(seen).not.toContain('function');
  });
});

describe('walkSpec', () => {
  test('yields the root then every descendant', () => {
    expect([...walkSpec(spec)].map((c) => c.path.join(' '))).toEqual(['my-app', 'my-app test']);
  });
});
