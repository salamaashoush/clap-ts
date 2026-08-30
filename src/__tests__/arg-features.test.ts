/**
 * Tests for the clap Arg features added on top of the tokenizer rewrite.
 */

import { describe, test, expect, afterEach } from 'bun:test';
import { parseArgs, CliParseError } from '../parser.js';
import { validate } from '../validation.js';
import { renderHelp } from '../help.js';
import type { ArgsDef, CommandDef } from '../types.js';

function cmd(args: ArgsDef, extra?: Partial<CommandDef>): CommandDef {
  return { meta: { name: 'test' }, args, ...extra };
}

function parseAndValidate(argv: string[], command: CommandDef) {
  const result = parseArgs(argv, command);
  validate(result, command);
  return result;
}

function plain(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

// ---- overridesWith ----

describe('overridesWith', () => {
  const c = cmd({
    debug: { type: 'boolean', overridesWith: ['release'] },
    release: { type: 'boolean', overridesWith: ['debug'] },
  });

  test('the later flag wins', () => {
    const result = parseArgs(['--debug', '--release'], c);
    expect(result.args.release).toBe(true);
    expect(result.args.debug).toBeUndefined();
  });

  test('order is what decides, not declaration', () => {
    const result = parseArgs(['--release', '--debug'], c);
    expect(result.args.debug).toBe(true);
    expect(result.args.release).toBeUndefined();
  });

  test('an overridden arg falls back to its default', () => {
    const withDefault = cmd({
      mode: { type: 'string', default: 'auto' },
      fast: { type: 'boolean', overridesWith: ['mode'] },
    });
    const result = parseArgs(['--mode', 'slow', '--fast'], withDefault);
    expect(result.args.mode).toBe('auto');
    expect(result.args.fast).toBe(true);
  });
});

// ---- ignoreCase ----

describe('ignoreCase', () => {
  test('matches possible values case-insensitively', () => {
    const c = cmd({ env: { type: 'string', valueParser: ['dev', 'prod'], ignoreCase: true } });
    // clap keeps the value as typed rather than canonicalising it.
    expect(parseAndValidate(['--env', 'DEV'], c).args.env).toBe('DEV');
  });

  test('still rejects a value that is not in the list', () => {
    const c = cmd({ env: { type: 'string', valueParser: ['dev', 'prod'], ignoreCase: true } });
    expect(() => parseAndValidate(['--env', 'stage'], c)).toThrow(CliParseError);
  });

  test('case still matters without the flag', () => {
    const c = cmd({ env: { type: 'string', valueParser: ['dev', 'prod'] } });
    expect(() => parseAndValidate(['--env', 'DEV'], c)).toThrow(CliParseError);
  });
});

// ---- PossibleValue objects ----

describe('possible values with help and aliases', () => {
  const c = cmd({
    mode: {
      type: 'string',
      description: 'Build mode',
      valueParser: [
        { name: 'fast', help: 'Skip the slow checks' },
        { name: 'thorough', aliases: ['full'] },
        { name: 'legacy', hidden: true },
      ],
    },
  });

  test('accepts a name', () => {
    expect(parseAndValidate(['--mode', 'fast'], c).args.mode).toBe('fast');
  });

  test('accepts an alias, keeping the value as typed', () => {
    expect(parseAndValidate(['--mode', 'full'], c).args.mode).toBe('full');
  });

  test('accepts a hidden value', () => {
    expect(parseAndValidate(['--mode', 'legacy'], c).args.mode).toBe('legacy');
  });

  test('rejects anything else', () => {
    expect(() => parseAndValidate(['--mode', 'nope'], c)).toThrow(CliParseError);
  });

  test('help lists visible values only', () => {
    const help = plain(renderHelp(c));
    expect(help).toContain('[possible values: fast, thorough]');
    expect(help).not.toContain('legacy');
  });

  test('long help renders per-value help', () => {
    const help = plain(renderHelp(c));
    expect(help).toContain('Possible values:');
    expect(help).toContain('- fast: Skip the slow checks');
  });

  test('short help omits the per-value block', () => {
    expect(plain(renderHelp(c, undefined, true))).not.toContain('Possible values:');
  });
});

// ---- Help presentation ----

describe('help presentation', () => {
  test('valueNames renders one placeholder per value', () => {
    const c = cmd({
      point: { type: 'string', numArgs: { min: 3, max: 3 }, valueNames: ['X', 'Y', 'Z'] },
    });
    expect(plain(renderHelp(c))).toContain('--point <X> <Y> <Z>');
  });

  test('displayOrder sorts within a section', () => {
    const c = cmd({
      zebra: { type: 'boolean', description: 'Z', displayOrder: 1 },
      alpha: { type: 'boolean', description: 'A', displayOrder: 2 },
    });
    const help = plain(renderHelp(c));
    expect(help.indexOf('--zebra')).toBeLessThan(help.indexOf('--alpha'));
  });

  test('longDescription is used only in long help', () => {
    const c = cmd({
      verbose: { type: 'boolean', description: 'Short', longDescription: 'The longer story' },
    });
    expect(plain(renderHelp(c))).toContain('The longer story');
    expect(plain(renderHelp(c, undefined, true))).toContain('Short');
    expect(plain(renderHelp(c, undefined, true))).not.toContain('The longer story');
  });

  test('nextLineHelp puts the description on its own line', () => {
    const c = cmd({ verbose: { type: 'boolean', description: 'Talk a lot', nextLineHelp: true } });
    const lines = plain(renderHelp(c)).split('\n');
    const flagLine = lines.findIndex((l) => l.includes('--verbose'));
    expect(lines[flagLine]).not.toContain('Talk a lot');
    expect(lines[flagLine + 1]).toContain('Talk a lot');
  });

  test('hideDefaultValue suppresses the default note', () => {
    const c = cmd({ port: { type: 'number', default: 80, hideDefaultValue: true } });
    expect(plain(renderHelp(c))).not.toContain('[default:');
  });
});

describe('env in help', () => {
  afterEach(() => {
    delete process.env['CLAP_TS_TOKEN'];
  });

  test('shows the current value by default', () => {
    process.env['CLAP_TS_TOKEN'] = 'secret';
    const c = cmd({ token: { type: 'string', env: 'CLAP_TS_TOKEN' } });
    expect(plain(renderHelp(c))).toContain('[env: CLAP_TS_TOKEN=secret]');
  });

  test('hideEnvValues keeps the name but drops the value', () => {
    process.env['CLAP_TS_TOKEN'] = 'secret';
    const c = cmd({ token: { type: 'string', env: 'CLAP_TS_TOKEN', hideEnvValues: true } });
    const help = plain(renderHelp(c));
    expect(help).toContain('[env: CLAP_TS_TOKEN]');
    expect(help).not.toContain('secret');
  });

  test('hideEnv drops the note entirely', () => {
    process.env['CLAP_TS_TOKEN'] = 'secret';
    const c = cmd({ token: { type: 'string', env: 'CLAP_TS_TOKEN', hideEnv: true } });
    expect(plain(renderHelp(c))).not.toContain('[env:');
  });
});

// ---- Positional index ----

describe('positional index', () => {
  test('an explicit index overrides declaration order', () => {
    const c = cmd({
      second: { type: 'positional', index: 2 },
      first: { type: 'positional', index: 1 },
    });
    const result = parseArgs(['a', 'b'], c);
    expect(result.args.first).toBe('a');
    expect(result.args.second).toBe('b');
  });
});

// ---- Conditional defaults and requirements ----

describe('defaultValueIfs', () => {
  const c = cmd({
    mode: { type: 'string' },
    level: {
      type: 'string',
      defaultValueIfs: [
        ['mode', 'fast', '1'],
        ['mode', 'thorough', '9'],
      ],
    },
  });

  test('applies the first matching condition', () => {
    expect(parseArgs(['--mode', 'thorough'], c).args.level).toBe('9');
    expect(parseArgs(['--mode', 'fast'], c).args.level).toBe('1');
  });

  test('applies nothing when no condition holds', () => {
    expect(parseArgs(['--mode', 'other'], c).args.level).toBeUndefined();
  });
});

describe('requiredIfEqAny and requiredIfEqAll', () => {
  test('any: one matching condition is enough', () => {
    const c = cmd({
      env: { type: 'string' },
      region: { type: 'string' },
      token: {
        type: 'string',
        requiredIfEqAny: [
          ['env', 'prod'],
          ['region', 'eu'],
        ],
      },
    });
    expect(() => parseAndValidate(['--env', 'prod'], c)).toThrow('--token');
    expect(() => parseAndValidate(['--region', 'eu'], c)).toThrow('--token');
    expect(() => parseAndValidate(['--env', 'dev'], c)).not.toThrow();
  });

  test('all: every condition must hold', () => {
    const c = cmd({
      env: { type: 'string' },
      region: { type: 'string' },
      token: {
        type: 'string',
        requiredIfEqAll: [
          ['env', 'prod'],
          ['region', 'eu'],
        ],
      },
    });
    expect(() => parseAndValidate(['--env', 'prod', '--region', 'eu'], c)).toThrow('--token');
    expect(() => parseAndValidate(['--env', 'prod'], c)).not.toThrow();
  });
});

describe('requiredUnlessPresentAll', () => {
  const c = cmd({
    a: { type: 'boolean' },
    b: { type: 'boolean' },
    config: { type: 'string', required: true, requiredUnlessPresentAll: ['a', 'b'] },
  });

  test('waived only when every named arg is present', () => {
    expect(() => parseAndValidate(['--a', '--b'], c)).not.toThrow();
  });

  test('still required when only one is present', () => {
    expect(() => parseAndValidate(['--a'], c)).toThrow('--config');
  });
});

// ---- Groups ----

describe('arg-level group membership', () => {
  const c = cmd({
    json: { type: 'boolean', groups: ['format'] },
    yaml: { type: 'boolean', groups: ['format'] },
  });

  test('members of an implicit group are mutually exclusive', () => {
    expect(() => parseAndValidate(['--json', '--yaml'], c)).toThrow('cannot be used together');
  });

  test('one member alone is fine', () => {
    expect(() => parseAndValidate(['--json'], c)).not.toThrow();
  });
});

describe('group constraints', () => {
  test('conflictsWith rejects the named arg', () => {
    const c = cmd(
      {
        json: { type: 'boolean' },
        quiet: { type: 'boolean' },
      },
      { groups: [{ name: 'format', args: ['json'], conflictsWith: ['quiet'] }] },
    );
    expect(() => parseAndValidate(['--json', '--quiet'], c)).toThrow('cannot be used with');
    expect(() => parseAndValidate(['--json'], c)).not.toThrow();
  });

  test('requires demands the named arg', () => {
    const c = cmd(
      {
        json: { type: 'boolean' },
        out: { type: 'string' },
      },
      { groups: [{ name: 'format', args: ['json'], requires: ['out'] }] },
    );
    expect(() => parseAndValidate(['--json'], c)).toThrow('--out');
    expect(() => parseAndValidate(['--json', '--out', 'f'], c)).not.toThrow();
  });
});
