/**
 * Tests for the options declared on an argument: every ArgDef field and how it
 * shows up in parsing, validation and help.
 */

import { describe, test, expect, afterEach } from 'bun:test';
import { parseArgs, CliParseError } from '../parser.js';
import { validate } from '../validation.js';
import { renderHelp } from '../help.js';
import { defineCommand } from '../runner.js';
import { runCli, stripAnsi } from '../testing.js';
import type { ArgsDef, CommandDef, ValueSource } from '../types.js';

function cmd(args: ArgsDef, extra?: Partial<CommandDef>): CommandDef {
  return { meta: { name: 'test' }, args, ...extra };
}

function parseAndValidate(argv: string[], command: CommandDef) {
  const result = parseArgs(argv, command);
  validate(result, command);
  return result;
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
    const help = stripAnsi(renderHelp(c));
    expect(help).toContain('[possible values: fast, thorough]');
    expect(help).not.toContain('legacy');
  });

  test('long help renders per-value help', () => {
    const help = stripAnsi(renderHelp(c));
    expect(help).toContain('Possible values:');
    expect(help).toContain('- fast: Skip the slow checks');
  });

  test('short help omits the per-value block', () => {
    expect(stripAnsi(renderHelp(c, undefined, true))).not.toContain('Possible values:');
  });
});

// ---- Help presentation ----

describe('help presentation', () => {
  test('valueNames renders one placeholder per value', () => {
    const c = cmd({
      point: { type: 'string', numArgs: { min: 3, max: 3 }, valueNames: ['X', 'Y', 'Z'] },
    });
    expect(stripAnsi(renderHelp(c))).toContain('--point <X> <Y> <Z>');
  });

  test('displayOrder sorts within a section', () => {
    const c = cmd({
      zebra: { type: 'boolean', description: 'Z', displayOrder: 1 },
      alpha: { type: 'boolean', description: 'A', displayOrder: 2 },
    });
    const help = stripAnsi(renderHelp(c));
    expect(help.indexOf('--zebra')).toBeLessThan(help.indexOf('--alpha'));
  });

  test('longDescription is used only in long help', () => {
    const c = cmd({
      verbose: { type: 'boolean', description: 'Short', longDescription: 'The longer story' },
    });
    expect(stripAnsi(renderHelp(c))).toContain('The longer story');
    expect(stripAnsi(renderHelp(c, undefined, true))).toContain('Short');
    expect(stripAnsi(renderHelp(c, undefined, true))).not.toContain('The longer story');
  });

  test('nextLineHelp puts the description on its own line', () => {
    const c = cmd({ verbose: { type: 'boolean', description: 'Talk a lot', nextLineHelp: true } });
    const lines = stripAnsi(renderHelp(c)).split('\n');
    const flagLine = lines.findIndex((l) => l.includes('--verbose'));
    expect(lines[flagLine]).not.toContain('Talk a lot');
    expect(lines[flagLine + 1]).toContain('Talk a lot');
  });

  test('hideDefaultValue suppresses the default note', () => {
    const c = cmd({ port: { type: 'number', default: 80, hideDefaultValue: true } });
    expect(stripAnsi(renderHelp(c))).not.toContain('[default:');
  });
});

describe('env in help', () => {
  afterEach(() => {
    delete process.env['CLAP_TS_TOKEN'];
  });

  test('shows the current value by default', () => {
    process.env['CLAP_TS_TOKEN'] = 'secret';
    const c = cmd({ token: { type: 'string', env: 'CLAP_TS_TOKEN' } });
    expect(stripAnsi(renderHelp(c))).toContain('[env: CLAP_TS_TOKEN=secret]');
  });

  test('hideEnvValues keeps the name but drops the value', () => {
    process.env['CLAP_TS_TOKEN'] = 'secret';
    const c = cmd({ token: { type: 'string', env: 'CLAP_TS_TOKEN', hideEnvValues: true } });
    const help = stripAnsi(renderHelp(c));
    expect(help).toContain('[env: CLAP_TS_TOKEN]');
    expect(help).not.toContain('secret');
  });

  test('hideEnv drops the note entirely', () => {
    process.env['CLAP_TS_TOKEN'] = 'secret';
    const c = cmd({ token: { type: 'string', env: 'CLAP_TS_TOKEN', hideEnv: true } });
    expect(stripAnsi(renderHelp(c))).not.toContain('[env:');
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
    await runCli(root, ['--host', 'h']);
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

describe('allowHyphenValues', () => {
  test('accepts values starting with - when enabled', () => {
    const command = cmd({
      grep: { type: 'string', long: 'grep', allowHyphenValues: true },
    });
    const result = parseArgs(['--grep', '-pattern'], command);
    expect(result.args['grep']).toBe('-pattern');
  });

  test('with =value syntax works without allowHyphenValues', () => {
    const command = cmd({
      grep: { type: 'string', long: 'grep' },
    });
    const result = parseArgs(['--grep=-pattern'], command);
    expect(result.args['grep']).toBe('-pattern');
  });

  test('allowHyphenValues rewrites short flag -p -value to --long=-value in prescan', () => {
    const command = cmd({
      pattern: { type: 'string', short: 'p', long: 'pattern', allowHyphenValues: true },
    });
    const result = parseArgs(['-p', '-hello'], command);
    expect(result.args['pattern']).toBe('-hello');
  });
});

describe('allowNegativeNumbers', () => {
  test('accepts negative numbers as values', () => {
    const command = cmd({
      offset: { type: 'number', long: 'offset', allowNegativeNumbers: true },
    });
    const result = parseArgs(['--offset', '-10'], command);
    expect(result.args['offset']).toBe(-10);
  });

  test('accepts negative floats', () => {
    const command = cmd({
      rate: { type: 'number', long: 'rate', allowNegativeNumbers: true },
    });
    const result = parseArgs(['--rate', '-3.14'], command);
    expect(result.args['rate']).toBe(-3.14);
  });
});

describe('valueDelimiter', () => {
  test('splits comma-separated values into array', () => {
    const command = cmd({
      tags: { type: 'string', long: 'tags', valueDelimiter: ',' },
    });
    const result = parseArgs(['--tags', 'a,b,c'], command);
    expect(result.args['tags']).toEqual(['a', 'b', 'c']);
  });

  test('splits with append action', () => {
    const command = cmd({
      tags: { type: 'string', long: 'tags', action: 'append', valueDelimiter: ',' },
    });
    const result = parseArgs(['--tags', 'a,b', '--tags', 'c,d'], command);
    expect(result.args['tags']).toEqual(['a', 'b', 'c', 'd']);
  });

  test('splits env var values by delimiter', () => {
    const original = process.env['TEST_TAGS'];
    process.env['TEST_TAGS'] = 'x,y,z';
    try {
      const command = cmd({
        tags: { type: 'string', long: 'tags', env: 'TEST_TAGS', valueDelimiter: ',' },
      });
      const result = parseArgs([], command);
      expect(result.args['tags']).toEqual(['x', 'y', 'z']);
    } finally {
      if (original === undefined) {
        delete process.env['TEST_TAGS'];
      } else {
        process.env['TEST_TAGS'] = original;
      }
    }
  });
});

describe('trailingVarArg', () => {
  test('last positional consumes all remaining args', () => {
    const command = cmd({
      cmd: { type: 'positional', valueName: 'CMD' },
      rest: { type: 'positional', valueName: 'ARGS', trailingVarArg: true },
    });
    const result = parseArgs(['echo', 'hello', 'world', 'foo'], command);
    expect(result.args['cmd']).toBe('echo');
    expect(result.args['rest']).toEqual(['hello', 'world', 'foo']);
  });

  test('empty trailing var arg', () => {
    const command = cmd({
      cmd: { type: 'positional', valueName: 'CMD' },
      rest: { type: 'positional', valueName: 'ARGS', trailingVarArg: true },
    });
    const result = parseArgs(['echo'], command);
    expect(result.args['cmd']).toBe('echo');
    expect(result.args['rest']).toBeUndefined();
  });
});

describe('last (positional after --)', () => {
  test('positional only assigned from rest args', () => {
    const command = cmd({
      verbose: { type: 'boolean', long: 'verbose' },
      script: { type: 'positional', valueName: 'SCRIPT', last: true },
    });
    const result = parseArgs(['--verbose', '--', 'run.sh'], command);
    expect(result.args['verbose']).toBe(true);
    expect(result.args['script']).toBe('run.sh');
  });

  test('not assigned without --', () => {
    const command = cmd({
      script: { type: 'positional', valueName: 'SCRIPT', last: true },
    });
    const result = parseArgs(['run.sh'], command);
    // run.sh goes to regular positionals, not to the `last` positional
    expect(result.args['script']).toBeUndefined();
  });
});

describe('defaultValueIf', () => {
  test('applies conditional default when condition met', () => {
    const command = cmd({
      env: { type: 'string', long: 'env' },
      port: { type: 'number', long: 'port', defaultValueIf: ['env', 'prod', 443] },
    });
    const result = parseArgs(['--env', 'prod'], command);
    expect(result.args['port']).toBe(443);
  });

  test('does not apply when condition not met', () => {
    const command = cmd({
      env: { type: 'string', long: 'env' },
      port: { type: 'number', long: 'port', defaultValueIf: ['env', 'prod', 443] },
    });
    const result = parseArgs(['--env', 'dev'], command);
    expect(result.args['port']).toBeUndefined();
  });

  test('explicit value overrides conditional default', () => {
    const command = cmd({
      env: { type: 'string', long: 'env' },
      port: { type: 'number', long: 'port', defaultValueIf: ['env', 'prod', 443] },
    });
    const result = parseArgs(['--env', 'prod', '--port', '8080'], command);
    expect(result.args['port']).toBe(8080);
  });
});

describe('valueParser as function', () => {
  test('custom parser transforms value', () => {
    const command = cmd({
      port: {
        type: 'string',
        long: 'port',
        valueParser: (v: string) => {
          const n = Number.parseInt(v, 10);
          if (n < 1 || n > 65535) {
            throw new Error('port must be 1-65535');
          }
          return n;
        },
      },
    });
    const result = parseArgs(['--port', '8080'], command);
    expect(result.args['port']).toBe(8080);
  });

  test('custom parser error produces CliParseError', () => {
    const command = cmd({
      port: {
        type: 'string',
        long: 'port',
        valueParser: (v: string) => {
          const n = Number.parseInt(v, 10);
          if (n < 1 || n > 65535) {
            throw new Error('port must be 1-65535');
          }
          return n;
        },
      },
    });
    expect(() => parseArgs(['--port', '99999'], command)).toThrow(CliParseError);
  });
});

describe('visibleAlias', () => {
  test('visible aliases work as parse-time aliases', () => {
    const command = cmd({
      output: { type: 'string', long: 'output', visibleAlias: ['out'] },
    });
    const result = parseArgs(['--out', 'file.txt'], command);
    expect(result.args['output']).toBe('file.txt');
  });
});
