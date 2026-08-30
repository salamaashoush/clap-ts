/**
 * Tests for value-source reporting, the new arg actions, and the conditional
 * requires added alongside them.
 */

import { describe, test, expect, afterEach } from 'bun:test';
import { parseArgs, CliParseError } from '../parser.js';
import { validate } from '../validation.js';
import { defineCommand, runMain } from '../runner.js';
import type { ArgsDef, CommandDef, ValueSource } from '../types.js';

function cmd(args: ArgsDef, extra?: Partial<CommandDef>): CommandDef {
  return { meta: { name: 'test' }, args, ...extra };
}

function parseAndValidate(argv: string[], command: CommandDef) {
  const result = parseArgs(argv, command);
  validate(result, command);
  return result;
}

// ---- Value source ----

describe('valueSources', () => {
  afterEach(() => {
    delete process.env['CLAP_TS_SRC'];
  });

  const command = cmd({
    fromCli: { type: 'string' },
    fromEnv: { type: 'string', env: 'CLAP_TS_SRC' },
    fromDefault: { type: 'string', default: 'd' },
    unset: { type: 'string' },
  });

  test('distinguishes cli, env and default', () => {
    process.env['CLAP_TS_SRC'] = 'e';
    const { valueSources } = parseArgs(['--fromCli', 'c'], command);
    expect(valueSources.get('fromCli')).toBe('cli');
    expect(valueSources.get('fromEnv')).toBe('env');
    expect(valueSources.get('fromDefault')).toBe('default');
  });

  test('an unset arg has no source', () => {
    expect(parseArgs([], command).valueSources.get('unset')).toBeUndefined();
  });

  test('the command line beats an env value', () => {
    process.env['CLAP_TS_SRC'] = 'e';
    const { args, valueSources } = parseArgs(['--fromEnv', 'c'], command);
    expect(args.fromEnv).toBe('c');
    expect(valueSources.get('fromEnv')).toBe('cli');
  });

  test('the command line beats a default', () => {
    const { valueSources } = parseArgs(['--fromDefault', 'x'], command);
    expect(valueSources.get('fromDefault')).toBe('cli');
  });

  test('reaches the run handler through the context', async () => {
    let seen: ReadonlyMap<string, ValueSource> = new Map();
    const root = defineCommand({
      meta: { name: 'app' },
      args: { port: { type: 'number', default: 80 }, host: { type: 'string' } },
      run({ valueSources }) {
        seen = valueSources;
      },
    });
    await runMain(root, { argv: ['--host', 'h'], exit: false });
    expect(seen.get('host')).toBe('cli');
    expect(seen.get('port')).toBe('default');
  });

  test('a conditional default reports as a default', () => {
    const c = cmd({
      mode: { type: 'string' },
      level: { type: 'string', defaultValueIf: ['mode', 'fast', '9'] },
    });
    expect(parseArgs(['--mode', 'fast'], c).valueSources.get('level')).toBe('default');
  });
});

// ---- Actions ----

describe('setTrue and setFalse actions', () => {
  test('setFalse turns the flag into a switch-off', () => {
    const c = cmd({ color: { type: 'boolean', action: 'setFalse', long: 'no-color' } });
    expect(parseArgs(['--no-color'], c).args.color).toBe(false);
  });

  test('setTrue is the plain flag behaviour', () => {
    const c = cmd({ color: { type: 'boolean', action: 'setTrue' } });
    expect(parseArgs(['--color'], c).args.color).toBe(true);
  });

  test('neither consumes a following token', () => {
    const c = cmd({
      color: { type: 'boolean', action: 'setFalse' },
      file: { type: 'positional' },
    });
    const result = parseArgs(['--color', 'x'], c);
    expect(result.args.color).toBe(false);
    expect(result.args.file).toBe('x');
  });
});

describe('help and version actions', () => {
  test('an arg can trigger help', () => {
    const c = cmd({ usage: { type: 'boolean', short: '?', action: 'help' } });
    expect(parseArgs(['-?'], c).helpRequested).toBe(true);
  });

  test('helpShort asks for the short form', () => {
    const c = cmd({ brief: { type: 'boolean', action: 'helpShort' } });
    const result = parseArgs(['--brief'], c);
    expect(result.helpRequested).toBe(true);
    expect(result.helpIsShort).toBe(true);
  });

  test('an arg can trigger version', () => {
    const c = cmd({ rev: { type: 'boolean', action: 'version' } });
    expect(parseArgs(['--rev'], c).versionRequested).toBe(true);
  });
});

describe('defaultMissingValues', () => {
  test('a bare multi-value flag falls back to the listed values', () => {
    const c = cmd({
      point: {
        type: 'string',
        numArgs: { min: 0, max: 3 },
        defaultMissingValues: ['0', '0', '0'],
      },
      other: { type: 'boolean' },
    });
    expect(parseArgs(['--point', '--other'], c).args.point).toEqual(['0', '0', '0']);
    expect(parseArgs(['--point', '1', '2', '3'], c).args.point).toEqual(['1', '2', '3']);
  });
});

// ---- Conditional requires ----

describe('requiresIf', () => {
  const c = cmd({
    mode: { type: 'string', requiresIf: ['remote', 'url'] },
    url: { type: 'string' },
  });

  test('requires the named arg only at the matching value', () => {
    expect(() => parseAndValidate(['--mode', 'remote'], c)).toThrow('--url');
    expect(() => parseAndValidate(['--mode', 'local'], c)).not.toThrow();
    expect(() => parseAndValidate(['--mode', 'remote', '--url', 'u'], c)).not.toThrow();
  });

  test('requiresIfs handles several values', () => {
    const many = cmd({
      mode: {
        type: 'string',
        requiresIfs: [
          ['remote', 'url'],
          ['file', 'path'],
        ],
      },
      url: { type: 'string' },
      path: { type: 'string' },
    });
    expect(() => parseAndValidate(['--mode', 'remote'], many)).toThrow('--url');
    expect(() => parseAndValidate(['--mode', 'file'], many)).toThrow('--path');
    expect(() => parseAndValidate(['--mode', 'other'], many)).not.toThrow();
  });
});

describe('singular group', () => {
  test('group joins the arg to a named group', () => {
    const c = cmd({
      json: { type: 'boolean', group: 'format' },
      yaml: { type: 'boolean', group: 'format' },
    });
    expect(() => parseAndValidate(['--json', '--yaml'], c)).toThrow('cannot be used together');
    expect(() => parseAndValidate(['--json'], c)).not.toThrow();
  });

  test('it errors like any other constraint', () => {
    const c = cmd({ a: { type: 'boolean', group: 'g' }, b: { type: 'boolean', group: 'g' } });
    expect(() => parseAndValidate(['--a', '--b'], c)).toThrow(CliParseError);
  });
});
