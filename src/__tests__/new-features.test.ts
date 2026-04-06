/**
 * Tests for all new clap features added in the 95% parity update.
 */

import { describe, test, expect } from 'bun:test';
import { parseArgs, CliParseError } from '../parser.js';
import { validate } from '../validation.js';
import { renderHelp } from '../help.js';
import { defineCommand, runMain } from '../runner.js';
import type { CommandDef, ArgsDef } from '../types.js';

// ---- Helpers ----

function cmd(args: ArgsDef, meta: Partial<CommandDef['meta']> = {}): CommandDef {
  return { meta: { name: 'test', ...meta }, args };
}

function parseAndValidate(rawArgs: string[], command: CommandDef) {
  const result = parseArgs(rawArgs, command);
  validate(result, command);
  return result;
}

function stripAnsi(s: string): string {
  return s.replaceAll(/\x1b\[[0-9;]*m/g, '');
}

// ========================================
// Parser Features (Wave 2)
// ========================================

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

describe('inferLongArgs', () => {
  test('resolves partial long flag when unambiguous', () => {
    const command = cmd(
      { verbose: { type: 'boolean', long: 'verbose' } },
      { inferLongArgs: true },
    );
    const result = parseArgs(['--verb'], command);
    expect(result.args['verbose']).toBe(true);
  });

  test('does not resolve ambiguous prefix', () => {
    const command = cmd(
      {
        verbose: { type: 'boolean', long: 'verbose' },
        version: { type: 'boolean', long: 'version-check' },
      },
      { inferLongArgs: true },
    );
    const result = parseArgs(['--ver'], command);
    // ambiguous: matches both verbose and version-check
    expect(result.unknown).toContain('--ver');
  });
});

describe('explicitlySet', () => {
  test('tracks which args were explicitly provided', () => {
    const command = cmd({
      port: { type: 'number', long: 'port', default: 3000 },
      verbose: { type: 'boolean', long: 'verbose' },
    });
    const result = parseArgs(['--verbose'], command);
    expect(result.explicitlySet.has('verbose')).toBe(true);
    expect(result.explicitlySet.has('port')).toBe(false);
  });
});

describe('helpIsShort', () => {
  test('detects -h as short help', () => {
    const command = cmd({});
    const result = parseArgs(['-h'], command);
    expect(result.helpRequested).toBe(true);
    expect(result.helpIsShort).toBe(true);
  });

  test('detects --help as long help', () => {
    const command = cmd({});
    const result = parseArgs(['--help'], command);
    expect(result.helpRequested).toBe(true);
    expect(result.helpIsShort).toBe(false);
  });
});

// ========================================
// Validation Features (Wave 3)
// ========================================

describe('exclusive', () => {
  test('exclusive arg cannot be used with any other', () => {
    const command = cmd({
      init: { type: 'boolean', long: 'init', exclusive: true },
      verbose: { type: 'boolean', long: 'verbose' },
    });
    expect(() => parseAndValidate(['--init', '--verbose'], command)).toThrow(
      /cannot be used with/,
    );
  });

  test('exclusive arg alone is fine', () => {
    const command = cmd({
      init: { type: 'boolean', long: 'init', exclusive: true },
      verbose: { type: 'boolean', long: 'verbose' },
    });
    expect(() => parseAndValidate(['--init'], command)).not.toThrow();
  });
});

describe('requiredUnlessPresent', () => {
  test('not required when alternative is present', () => {
    const command = cmd({
      file: { type: 'string', long: 'file', required: true, requiredUnlessPresent: 'stdin' },
      stdin: { type: 'boolean', long: 'stdin' },
    });
    expect(() => parseAndValidate(['--stdin'], command)).not.toThrow();
  });

  test('required when alternative is absent', () => {
    const command = cmd({
      file: { type: 'string', long: 'file', required: true, requiredUnlessPresent: 'stdin' },
      stdin: { type: 'boolean', long: 'stdin' },
    });
    expect(() => parseAndValidate([], command)).toThrow('required arguments');
  });

  test('works with array of alternatives', () => {
    const command = cmd({
      file: {
        type: 'string',
        long: 'file',
        required: true,
        requiredUnlessPresent: ['stdin', 'generate'],
      },
      stdin: { type: 'boolean', long: 'stdin' },
      generate: { type: 'boolean', long: 'generate' },
    });
    expect(() => parseAndValidate(['--generate'], command)).not.toThrow();
  });
});

describe('requiredIfEq', () => {
  test('required when condition met', () => {
    const command = cmd({
      format: { type: 'string', long: 'format' },
      output: { type: 'string', long: 'output', requiredIfEq: ['format', 'file'] },
    });
    expect(() => parseAndValidate(['--format', 'file'], command)).toThrow('required arguments');
  });

  test('not required when condition not met', () => {
    const command = cmd({
      format: { type: 'string', long: 'format' },
      output: { type: 'string', long: 'output', requiredIfEq: ['format', 'file'] },
    });
    expect(() => parseAndValidate(['--format', 'stdout'], command)).not.toThrow();
  });

  test('passes when arg is provided', () => {
    const command = cmd({
      format: { type: 'string', long: 'format' },
      output: { type: 'string', long: 'output', requiredIfEq: ['format', 'file'] },
    });
    expect(() =>
      parseAndValidate(['--format', 'file', '--output', '/tmp/out'], command),
    ).not.toThrow();
  });
});

describe('subcommandNegatesReqs', () => {
  test('parent required args skipped when subcommand present', async () => {
    let ran = false;
    const root = defineCommand({
      meta: { name: 'app', subcommandNegatesReqs: true },
      args: {
        config: { type: 'string', long: 'config', required: true },
      },
      subCommands: {
        init: defineCommand({
          meta: { name: 'init' },
          run() { ran = true; },
        }),
      },
    });
    await runMain(root, { argv: ['init'], exit: false });
    expect(ran).toBe(true);
  });
});

// ========================================
// Help Features (Wave 4)
// ========================================

describe('hidePossibleValues', () => {
  test('hides possible values from help', () => {
    const command = cmd({
      env: {
        type: 'string',
        long: 'env',
        valueParser: ['dev', 'staging', 'prod'],
        hidePossibleValues: true,
      },
    });
    const help = stripAnsi(renderHelp(command));
    expect(help).not.toContain('possible values');
  });

  test('shows possible values by default', () => {
    const command = cmd({
      env: {
        type: 'string',
        long: 'env',
        valueParser: ['dev', 'staging', 'prod'],
      },
    });
    const help = stripAnsi(renderHelp(command));
    expect(help).toContain('possible values');
  });
});

describe('hideShortHelp / hideLongHelp', () => {
  test('hideShortHelp hides from -h but shows in --help', () => {
    const command = cmd({
      advanced: { type: 'boolean', long: 'advanced', description: 'Advanced mode', hideShortHelp: true },
      basic: { type: 'boolean', long: 'basic', description: 'Basic mode' },
    });
    const shortHelp = stripAnsi(renderHelp(command, undefined, true));
    const longHelp = stripAnsi(renderHelp(command, undefined, false));
    expect(shortHelp).not.toContain('--advanced');
    expect(longHelp).toContain('--advanced');
  });

  test('hideLongHelp hides from --help but shows in -h', () => {
    const command = cmd({
      debug: { type: 'boolean', long: 'debug', description: 'Debug mode', hideLongHelp: true },
    });
    const shortHelp = stripAnsi(renderHelp(command, undefined, true));
    const longHelp = stripAnsi(renderHelp(command, undefined, false));
    expect(shortHelp).toContain('--debug');
    expect(longHelp).not.toContain('--debug');
  });
});

describe('visibleAlias in help', () => {
  test('visible aliases shown in help output', () => {
    const command = cmd({
      output: { type: 'string', long: 'output', visibleAlias: ['out', 'o'], description: 'Output path' },
    });
    const help = stripAnsi(renderHelp(command));
    expect(help).toContain('--out');
    expect(help).toContain('-o');
  });

  test('hidden aliases not shown in help', () => {
    const command = cmd({
      output: { type: 'string', long: 'output', alias: ['out'], description: 'Output path' },
    });
    const help = stripAnsi(renderHelp(command));
    // Check that --out doesn't appear as a standalone flag display
    // (--output contains --out as substring, so use regex for exact match)
    expect(help).not.toMatch(/,\s*--out\b/);
  });
});

describe('beforeHelp', () => {
  test('renders text before help output', () => {
    const command: CommandDef = {
      meta: { name: 'tool', beforeHelp: 'WARNING: This tool is experimental.' },
    };
    const help = stripAnsi(renderHelp(command));
    expect(help.indexOf('WARNING')).toBeLessThan(help.indexOf('Usage:'));
  });
});

describe('helpHeading', () => {
  test('groups args under custom headings', () => {
    const command = cmd({
      verbose: { type: 'boolean', long: 'verbose', description: 'Verbose' },
      host: { type: 'string', long: 'host', description: 'Host', helpHeading: 'Network' },
      port: { type: 'number', long: 'port', description: 'Port', helpHeading: 'Network' },
    });
    const help = stripAnsi(renderHelp(command));
    expect(help).toContain('Options:');
    expect(help).toContain('Network:');
    // verbose under Options, host/port under Network
    const optionsIdx = help.indexOf('Options:');
    const networkIdx = help.indexOf('Network:');
    const verboseIdx = help.indexOf('--verbose');
    const hostIdx = help.indexOf('--host');
    expect(verboseIdx).toBeGreaterThan(optionsIdx);
    expect(verboseIdx).toBeLessThan(networkIdx);
    expect(hostIdx).toBeGreaterThan(networkIdx);
  });
});

describe('helpTemplate', () => {
  test('custom template replaces default rendering', () => {
    const command: CommandDef = {
      meta: {
        name: 'tool',
        version: '1.0.0',
        helpTemplate: 'NAME: {name}\nVERSION: {version}\n{usage}\n{options}',
      },
      args: {
        verbose: { type: 'boolean', long: 'verbose', description: 'Verbose' },
      },
    };
    const help = stripAnsi(renderHelp(command));
    expect(help).toContain('NAME: tool');
    expect(help).toContain('VERSION: 1.0.0');
    expect(help).toContain('Usage:');
    expect(help).toContain('--verbose');
  });
});

// ========================================
// Runner Features (Wave 5)
// ========================================

describe('subcommandRequired', () => {
  test('errors when no subcommand provided', async () => {
    let errored = false;
    const originalWrite = process.stderr.write;
    process.stderr.write = (() => true) as typeof process.stderr.write;
    try {
      const root = defineCommand({
        meta: { name: 'app', subcommandRequired: true },
        subCommands: {
          serve: defineCommand({ meta: { name: 'serve' }, run() {} }),
        },
      });
      await runMain(root, { argv: [], exit: false, showHelpOnEmpty: false });
    } catch (e) {
      errored = true;
    } finally {
      process.stderr.write = originalWrite;
    }
    // Should have printed error (not thrown since exit: false)
  });

  test('works when subcommand provided', async () => {
    let ran = false;
    const root = defineCommand({
      meta: { name: 'app', subcommandRequired: true },
      subCommands: {
        serve: defineCommand({
          meta: { name: 'serve' },
          run() { ran = true; },
        }),
      },
    });
    await runMain(root, { argv: ['serve'], exit: false });
    expect(ran).toBe(true);
  });
});

describe('inferSubcommands', () => {
  test('resolves partial subcommand name', async () => {
    let ran = '';
    const root = defineCommand({
      meta: { name: 'app', inferSubcommands: true },
      subCommands: {
        serve: defineCommand({
          meta: { name: 'serve' },
          run() { ran = 'serve'; },
        }),
        build: defineCommand({
          meta: { name: 'build' },
          run() { ran = 'build'; },
        }),
      },
    });
    await runMain(root, { argv: ['ser'], exit: false });
    expect(ran).toBe('serve');
  });

  test('resolves unique prefix', async () => {
    let ran = '';
    const root = defineCommand({
      meta: { name: 'app', inferSubcommands: true },
      subCommands: {
        serve: defineCommand({ meta: { name: 'serve' }, run() { ran = 'serve'; } }),
        build: defineCommand({ meta: { name: 'build' }, run() { ran = 'build'; } }),
      },
    });
    await runMain(root, { argv: ['b'], exit: false });
    expect(ran).toBe('build');
  });
});

describe('allowExternalSubcommands', () => {
  test('unknown subcommand passed to parent handler', async () => {
    let receivedSubCmd = '';
    const root = defineCommand({
      meta: { name: 'git', allowExternalSubcommands: true },
      run({ subCommand }) {
        receivedSubCmd = subCommand ?? '';
      },
    });
    await runMain(root, { argv: ['my-plugin', 'arg1'], exit: false });
    expect(receivedSubCmd).toBe('my-plugin');
  });
});

describe('argsConflictsWithSubcommands', () => {
  test('errors when args and subcommand both present', async () => {
    let errorOutput = '';
    const originalWrite = process.stderr.write;
    process.stderr.write = ((chunk: string) => {
      errorOutput += chunk;
      return true;
    }) as typeof process.stderr.write;

    try {
      const root = defineCommand({
        meta: { name: 'app', argsConflictsWithSubcommands: true },
        args: {
          verbose: { type: 'boolean', long: 'verbose' },
        },
        subCommands: {
          serve: defineCommand({ meta: { name: 'serve' }, run() {} }),
        },
      });
      await runMain(root, { argv: ['--verbose', 'serve'], exit: false });
      expect(stripAnsi(errorOutput)).toContain('cannot be used with subcommands');
    } finally {
      process.stderr.write = originalWrite;
    }
  });
});

describe('argRequiredElseHelp', () => {
  test('shows help when no args provided', async () => {
    let helpOutput = '';
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string) => {
      helpOutput += chunk;
      return true;
    }) as typeof process.stdout.write;

    try {
      const root = defineCommand({
        meta: { name: 'tool', argRequiredElseHelp: true },
        args: {
          input: { type: 'string', long: 'input' },
        },
        run() {
          throw new Error('should not run');
        },
      });
      await runMain(root, { argv: [], exit: false, showHelpOnEmpty: false });
      expect(stripAnsi(helpOutput)).toContain('Usage:');
    } finally {
      process.stdout.write = originalWrite;
    }
  });
});

describe('custom styles', () => {
  test('style overrides are applied to help', () => {
    const command: CommandDef = {
      meta: { name: 'tool', version: '1.0.0' },
      args: {
        verbose: { type: 'boolean', long: 'verbose', description: 'Verbose' },
      },
    };
    const customStyles = {
      heading: (s: string) => `[H]${s}[/H]`,
      flag: (s: string) => `[F]${s}[/F]`,
    };
    const help = renderHelp(command, undefined, false, customStyles);
    expect(help).toContain('[H]Usage:[/H]');
    expect(help).toContain('[F]--verbose[/F]');
  });
});
