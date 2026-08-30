/**
 * Parser tests - comprehensive coverage of clap-ts argument parsing.
 */

import { describe, test, expect, afterEach } from 'bun:test';
import { parseArgs, CliParseError } from '../parser.js';
import type { CommandDef, ArgsDef } from '../types.js';

/** Helper to create a CommandDef from ArgsDef for testing. */
function cmd(args: ArgsDef, subCommands?: Record<string, CommandDef>): CommandDef {
  return { meta: { name: 'test' }, args, subCommands };
}

// ---- Basic Parsing ----

describe('basic parsing', () => {
  test('boolean flags', () => {
    const result = parseArgs(['--verbose'], cmd({ verbose: { type: 'boolean' } }));
    expect(result.args.verbose).toBe(true);
  });

  test('boolean flag absent defaults to undefined', () => {
    const result = parseArgs([], cmd({ verbose: { type: 'boolean' } }));
    expect(result.args.verbose).toBeUndefined();
  });

  test('--no-<flag> negation', () => {
    const result = parseArgs(['--no-verbose'], cmd({ verbose: { type: 'boolean' } }));
    expect(result.args.verbose).toBe(false);
  });

  test('string args', () => {
    const result = parseArgs(['--name', 'alice'], cmd({ name: { type: 'string' } }));
    expect(result.args.name).toBe('alice');
  });

  test('string args with = syntax', () => {
    const result = parseArgs(['--name=alice'], cmd({ name: { type: 'string' } }));
    expect(result.args.name).toBe('alice');
  });

  test('number args', () => {
    const result = parseArgs(['--port', '3003'], cmd({ port: { type: 'number' } }));
    expect(result.args.port).toBe(3003);
  });

  test('number args with float', () => {
    const result = parseArgs(['--rate', '1.5'], cmd({ rate: { type: 'number' } }));
    expect(result.args.rate).toBe(1.5);
  });

  test('number args rejects non-numeric', () => {
    expect(() => {
      parseArgs(['--port', 'abc'], cmd({ port: { type: 'number' } }));
    }).toThrow(CliParseError);
  });

  test('short flags', () => {
    const result = parseArgs(['-v'], cmd({ verbose: { type: 'boolean', short: 'v' } }));
    expect(result.args.verbose).toBe(true);
  });

  test('short flags with value', () => {
    const result = parseArgs(['-p', '3003'], cmd({ port: { type: 'number', short: 'p' } }));
    expect(result.args.port).toBe(3003);
  });

  test('combined short boolean flags', () => {
    const result = parseArgs(
      ['-vd'],
      cmd({
        verbose: { type: 'boolean', short: 'v' },
        debug: { type: 'boolean', short: 'd' },
      }),
    );
    expect(result.args.verbose).toBe(true);
    expect(result.args.debug).toBe(true);
  });
});

// ---- Default Values ----

describe('defaults', () => {
  test('default value applied when arg not provided', () => {
    const result = parseArgs([], cmd({ port: { type: 'number', default: 3000 } }));
    expect(result.args.port).toBe(3000);
  });

  test('default string value', () => {
    const result = parseArgs([], cmd({ env: { type: 'string', default: 'dev' } }));
    expect(result.args.env).toBe('dev');
  });

  test('default boolean value', () => {
    const result = parseArgs([], cmd({ verbose: { type: 'boolean', default: false } }));
    expect(result.args.verbose).toBe(false);
  });

  test('default array value for append', () => {
    const result = parseArgs(
      [],
      cmd({ headers: { type: 'string', action: 'append', default: ['X-Default: 1'] } }),
    );
    expect(result.args.headers).toEqual(['X-Default: 1']);
  });

  test('explicit value overrides default', () => {
    const result = parseArgs(['--port', '8080'], cmd({ port: { type: 'number', default: 3000 } }));
    expect(result.args.port).toBe(8080);
  });
});

// ---- Enum Validation (valueParser) ----

describe('valueParser (enum validation)', () => {
  test('valid value passes', () => {
    const result = parseArgs(
      ['--env', 'dev'],
      cmd({ env: { type: 'string', valueParser: ['dev', 'staging', 'prod'] } }),
    );
    expect(result.args.env).toBe('dev');
  });

  test('all valid values pass', () => {
    for (const val of ['dev', 'staging', 'prod']) {
      const result = parseArgs(
        ['--env', val],
        cmd({ env: { type: 'string', valueParser: ['dev', 'staging', 'prod'] } }),
      );
      expect(result.args.env).toBe(val);
    }
  });
});

// ---- Env Fallback ----

describe('env fallback', () => {
  const originalEnv = process.env['TEST_PORT'];

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env['TEST_PORT'];
    } else {
      process.env['TEST_PORT'] = originalEnv;
    }
  });

  test('falls back to env var when arg not on CLI', () => {
    process.env['TEST_PORT'] = '9090';
    const result = parseArgs([], cmd({ port: { type: 'number', env: 'TEST_PORT' } }));
    expect(result.args.port).toBe(9090);
  });

  test('CLI arg takes precedence over env var', () => {
    process.env['TEST_PORT'] = '9090';
    const result = parseArgs(
      ['--port', '3003'],
      cmd({ port: { type: 'number', env: 'TEST_PORT' } }),
    );
    expect(result.args.port).toBe(3003);
  });

  test('empty env var is ignored', () => {
    process.env['TEST_PORT'] = '';
    const result = parseArgs([], cmd({ port: { type: 'number', env: 'TEST_PORT' } }));
    expect(result.args.port).toBeUndefined();
  });
});

// ---- numArgs + defaultMissingValue ----

describe('numArgs + defaultMissingValue', () => {
  test('flag present without value uses defaultMissingValue', () => {
    const result = parseArgs(
      ['--level'],
      cmd({
        level: {
          type: 'string',
          numArgs: { min: 0, max: 1 },
          defaultMissingValue: 'info',
        },
      }),
    );
    expect(result.args.level).toBe('info');
  });

  test('flag present with value uses the value', () => {
    const result = parseArgs(
      ['--level', 'debug'],
      cmd({
        level: {
          type: 'string',
          numArgs: { min: 0, max: 1 },
          defaultMissingValue: 'info',
        },
      }),
    );
    expect(result.args.level).toBe('debug');
  });
});

// ---- action: 'append' ----

describe("action: 'append'", () => {
  test('multiple values collected into array', () => {
    const result = parseArgs(
      ['-H', 'X-A: 1', '-H', 'X-B: 2'],
      cmd({ header: { type: 'string', short: 'H', action: 'append' } }),
    );
    expect(result.args.header).toEqual(['X-A: 1', 'X-B: 2']);
  });

  test('single value becomes array', () => {
    const result = parseArgs(
      ['-H', 'X-A: 1'],
      cmd({ header: { type: 'string', short: 'H', action: 'append' } }),
    );
    expect(result.args.header).toEqual(['X-A: 1']);
  });
});

// ---- action: 'count' ----

describe("action: 'count'", () => {
  test('multiple flags counted', () => {
    const result = parseArgs(
      ['-v', '-v', '-v'],
      cmd({ verbose: { type: 'boolean', short: 'v', action: 'count' } }),
    );
    expect(result.args.verbose).toBe(3);
  });

  test('single flag counts to 1', () => {
    const result = parseArgs(
      ['-v'],
      cmd({ verbose: { type: 'boolean', short: 'v', action: 'count' } }),
    );
    expect(result.args.verbose).toBe(1);
  });
});

// ---- Global Args ----

describe('global args', () => {
  test('global args merged into subcommand parsing', () => {
    const parentCmd = cmd(
      {
        verbose: { type: 'boolean', short: 'v', global: true },
      },
      {
        serve: {
          meta: { name: 'serve' },
          args: { port: { type: 'number', short: 'p' } },
        },
      },
    );

    // Global args are merged by the runner, but we can test mergeGlobalArgs directly
    const { collectGlobalArgs, mergeGlobalArgs } = require('../parser.js');
    const globals = collectGlobalArgs(parentCmd);
    expect(globals.verbose).toBeDefined();

    const childArgs = parentCmd.subCommands!['serve']!.args!;
    const merged = mergeGlobalArgs(globals, childArgs);
    expect(merged.verbose).toBeDefined();
    expect(merged.port).toBeDefined();
  });
});

// ---- Positionals ----

describe('positionals', () => {
  test('positional args parsed in order', () => {
    const result = parseArgs(
      ['input.txt', 'output.txt'],
      cmd({
        source: { type: 'positional', valueName: 'SOURCE' },
        dest: { type: 'positional', valueName: 'DEST' },
      }),
    );
    expect(result.args.source).toBe('input.txt');
    expect(result.args.dest).toBe('output.txt');
  });

  test('positional mixed with flags', () => {
    const result = parseArgs(
      ['--verbose', 'input.txt'],
      cmd({
        verbose: { type: 'boolean' },
        file: { type: 'positional' },
      }),
    );
    expect(result.args.verbose).toBe(true);
    expect(result.args.file).toBe('input.txt');
  });
});

// ---- -- Separator ----

describe('-- separator', () => {
  test('everything after -- goes to rest', () => {
    const result = parseArgs(
      ['--verbose', '--', 'extra1', 'extra2'],
      cmd({ verbose: { type: 'boolean' } }),
    );
    expect(result.args.verbose).toBe(true);
    expect(result.rest).toEqual(['extra1', 'extra2']);
  });

  test('empty rest when no -- present', () => {
    const result = parseArgs(['--verbose'], cmd({ verbose: { type: 'boolean' } }));
    expect(result.rest).toEqual([]);
  });
});

// ---- Kebab to CamelCase ----

describe('kebab-to-camelCase', () => {
  test('--config-path accessible as configPath', () => {
    const result = parseArgs(
      ['--config-path', './config.yaml'],
      cmd({ 'config-path': { type: 'string' } }),
    );
    expect(result.args['configPath']).toBe('./config.yaml');
    // Also accessible with original key
    expect(result.args['config-path']).toBe('./config.yaml');
  });

  test('--mocks-dir accessible as mocksDir', () => {
    const result = parseArgs(['--mocks-dir', './mocks'], cmd({ 'mocks-dir': { type: 'string' } }));
    expect(result.args['mocksDir']).toBe('./mocks');
  });
});

// ---- type: 'number' ----

describe("type: 'number'", () => {
  test('auto parseInt for integer strings', () => {
    const result = parseArgs(['--port', '3003'], cmd({ port: { type: 'number' } }));
    expect(result.args.port).toBe(3003);
    expect(typeof result.args.port).toBe('number');
  });

  test('auto parseFloat for decimal strings', () => {
    const result = parseArgs(['--rate', '0.5'], cmd({ rate: { type: 'number' } }));
    expect(result.args.rate).toBe(0.5);
    expect(typeof result.args.rate).toBe('number');
  });
});

// ---- Unknown Args (strict: false) ----

describe('unknown args', () => {
  test('unknown args should NOT throw (collected in unknown array)', () => {
    const result = parseArgs(
      ['--verbose', '--unknown-flag'],
      cmd({ verbose: { type: 'boolean' } }),
    );
    expect(result.args.verbose).toBe(true);
    expect(result.unknown).toContain('--unknown-flag');
  });

  test('multiple unknown args collected', () => {
    const result = parseArgs(['--foo', '--bar'], cmd({}));
    expect(result.unknown).toContain('--foo');
    expect(result.unknown).toContain('--bar');
  });
});

// ---- Long name different from key ----

describe('long name different from key', () => {
  test('arg with long name different from key is recognized', () => {
    const result = parseArgs(
      ['--port', '3003'],
      cmd({ portNum: { type: 'number', long: 'port' } }),
    );
    expect(result.args.portNum).toBe(3003);
  });

  test('arg with long name and short flag', () => {
    const result = parseArgs(
      ['-p', '3003'],
      cmd({ portNum: { type: 'number', long: 'port', short: 'p' } }),
    );
    expect(result.args.portNum).toBe(3003);
  });
});

// ---- Help and Version ----

describe('help and version', () => {
  test('--help sets helpRequested', () => {
    const result = parseArgs(['--help'], cmd({}));
    expect(result.helpRequested).toBe(true);
  });

  test('-h sets helpRequested', () => {
    const result = parseArgs(['-h'], cmd({}));
    expect(result.helpRequested).toBe(true);
  });

  test('--version sets versionRequested', () => {
    const versioned: CommandDef = { meta: { name: 'test', version: '1.0.0' } };
    expect(parseArgs(['--version'], versioned).versionRequested).toBe(true);
  });

  test('-V sets versionRequested', () => {
    const versioned: CommandDef = { meta: { name: 'test', version: '1.0.0' } };
    expect(parseArgs(['-V'], versioned).versionRequested).toBe(true);
  });

  test('no --version flag without a declared version, as in clap', () => {
    const result = parseArgs(['--version'], cmd({}));
    expect(result.versionRequested).toBe(false);
    expect(result.unknown).toEqual(['--version']);
  });
});

// ---- Aliases ----

describe('aliases', () => {
  test('long alias recognized', () => {
    const result = parseArgs(
      ['--directory', './mocks'],
      cmd({ dir: { type: 'string', long: 'dir', alias: ['directory'] } }),
    );
    expect(result.args.dir).toBe('./mocks');
  });

  test('single-char alias as short flag', () => {
    const result = parseArgs(
      ['-d', './mocks'],
      cmd({ dir: { type: 'string', long: 'dir', alias: ['d'] } }),
    );
    expect(result.args.dir).toBe('./mocks');
  });
});

// ---- Tokenizer regressions ----

describe('boolean values via =', () => {
  test('--flag=true is true', () => {
    const result = parseArgs(['--verbose=true'], cmd({ verbose: { type: 'boolean' } }));
    expect(result.args.verbose).toBe(true);
  });

  test('--flag=1 and --flag=yes are true', () => {
    const c = cmd({ verbose: { type: 'boolean' } });
    expect(parseArgs(['--verbose=1'], c).args.verbose).toBe(true);
    expect(parseArgs(['--verbose=yes'], c).args.verbose).toBe(true);
  });

  test('--flag=false and --flag=junk are false', () => {
    const c = cmd({ verbose: { type: 'boolean' } });
    expect(parseArgs(['--verbose=false'], c).args.verbose).toBe(false);
    expect(parseArgs(['--verbose=junk'], c).args.verbose).toBe(false);
  });
});

describe('missing values are rejected', () => {
  test('flag at end of argv', () => {
    expect(() => parseArgs(['--name'], cmd({ name: { type: 'string' } }))).toThrow(
      "a value is required for '--name' but none was supplied",
    );
  });

  test('flag followed by another flag', () => {
    const c = cmd({ name: { type: 'string' }, verbose: { type: 'boolean' } });
    expect(() => parseArgs(['--name', '--verbose'], c)).toThrow(
      "a value is required for '--name' but none was supplied",
    );
  });

  test('append flag with no value', () => {
    const c = cmd({ header: { type: 'string', short: 'H', action: 'append' } });
    expect(() => parseArgs(['-H'], c)).toThrow(CliParseError);
  });
});

describe('short flag values', () => {
  test('-p=80 strips the equals like clap', () => {
    const result = parseArgs(['-p=80'], cmd({ port: { type: 'number', short: 'p' } }));
    expect(result.args.port).toBe(80);
  });

  test('-c= yields an empty string', () => {
    const result = parseArgs(['-c='], cmd({ config: { type: 'string', short: 'c' } }));
    expect(result.args.config).toBe('');
  });

  test('unknown short flag is reported with a single dash', () => {
    const result = parseArgs(['-Z'], cmd({ verbose: { type: 'boolean', short: 'v' } }));
    expect(result.unknown).toEqual(['-Z']);
  });
});

describe('numArgs consumes multiple tokens', () => {
  const multi = cmd({
    verbose: { type: 'boolean' },
    files: { type: 'string', action: 'append', numArgs: { min: 2, max: 5 } },
  });

  test('collects up to max values', () => {
    expect(parseArgs(['--files', 'a', 'b'], multi).args.files).toEqual(['a', 'b']);
  });

  test('stops at the next flag', () => {
    const result = parseArgs(['--files', 'a', 'b', '--verbose'], multi);
    expect(result.args.files).toEqual(['a', 'b']);
    expect(result.args.verbose).toBe(true);
    expect(result.positionals).toEqual([]);
  });

  test('too few values is an error', () => {
    expect(() => parseArgs(['--files', 'a'], multi)).toThrow(
      "the argument '--files' requires at least 2 values but 1 were provided",
    );
  });

  test('valueTerminator ends collection', () => {
    const c = cmd({
      cmds: {
        type: 'string',
        action: 'append',
        numArgs: { min: 1, max: 99 },
        allowHyphenValues: true,
        valueTerminator: ';',
      },
      location: { type: 'positional' },
    });
    const result = parseArgs(['--cmds', 'ls', '-la', ';', '/tmp'], c);
    expect(result.args.cmds).toEqual(['ls', '-la']);
    expect(result.args.location).toBe('/tmp');
  });
});

describe('requireEquals', () => {
  const c = cmd({ config: { type: 'string', short: 'c', requireEquals: true } });

  test('accepts --config=value', () => {
    expect(parseArgs(['--config=x'], c).args.config).toBe('x');
  });

  test('rejects --config value', () => {
    expect(() => parseArgs(['--config', 'x'], c)).toThrow(
      "equal sign is needed when assigning values to '--config'",
    );
  });

  test('rejects -c value', () => {
    expect(() => parseArgs(['-c', 'x'], c)).toThrow(CliParseError);
  });
});

describe('negative numbers as positionals', () => {
  test('allowNegativeNumbers lets a positional take -5', () => {
    const c = cmd({
      n: { type: 'positional', allowNegativeNumbers: true },
      m: { type: 'positional' },
    });
    const result = parseArgs(['-5', 'x'], c);
    expect(result.args.n).toBe('-5');
    expect(result.args.m).toBe('x');
    expect(result.unknown).toEqual([]);
  });
});

describe('subcommand boundary', () => {
  const c = cmd(
    { verbose: { type: 'boolean', short: 'v' }, name: { type: 'string' } },
    { serve: { meta: { name: 'serve' } } },
  );

  test('tokens after the subcommand are handed on untouched', () => {
    const result = parseArgs(['-v', 'serve', '--port', '9'], c);
    expect(result.subCommand).toBe('serve');
    expect(result.args.verbose).toBe(true);
    expect(result.subCommandArgs).toEqual(['--port', '9']);
  });

  test('a flag value is never mistaken for a subcommand', () => {
    const result = parseArgs(['--name', 'serve'], c);
    expect(result.subCommand).toBeUndefined();
    expect(result.args.name).toBe('serve');
  });
});

describe('inferLongArgs ambiguity', () => {
  test('an ambiguous prefix is not resolved', () => {
    const c: CommandDef = {
      meta: { name: 'test', version: '1.0.0', inferLongArgs: true },
      args: { verbose: { type: 'boolean' } },
    };
    // --v is a prefix of both --verbose and the built-in --version.
    expect(parseArgs(['--v'], c).unknown).toEqual(['--v']);
    expect(parseArgs(['--verb'], c).args.verbose).toBe(true);
  });
});
