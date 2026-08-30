/**
 * Tests for the settings declared on a command: every CommandMeta field, plus
 * the dispatch and help behaviour each one changes.
 */

import { describe, test, expect } from 'bun:test';
import { parseArgs, CliParseError, getRawArgs } from '../parser.js';
import { defineCommand } from '../runner.js';
import { runCli, stripAnsi } from '../testing.js';
import { renderHelp, renderUsage } from '../help.js';
import type { ArgsDef, CommandDef } from '../types.js';

function cmd(args: ArgsDef, extra?: Partial<CommandDef>): CommandDef {
  return { meta: { name: 'test' }, args, ...extra };
}

// ---- help subcommand ----

describe('built-in help subcommand', () => {
  const root = defineCommand({
    meta: { name: 'app' },
    subCommands: {
      serve: defineCommand({
        meta: { name: 'serve', description: 'Run the server' },
        args: { port: { type: 'number', description: 'Port to bind' } },
        run() {},
      }),
    },
  });

  test('app help prints the root help', async () => {
    const { plainStdout: out } = await runCli(root, ['help']);
    expect(out).toContain('Usage: app');
    expect(out).toContain('serve');
  });

  test('app help serve prints the subcommand help', async () => {
    const { plainStdout: out } = await runCli(root, ['help', 'serve']);
    expect(out).toContain('Usage: app serve');
    expect(out).toContain('Port to bind');
  });

  test('it is listed in the commands section', () => {
    expect(stripAnsi(renderHelp(root))).toContain('help');
  });

  test('disableHelpSubcommand takes it away', () => {
    const off: CommandDef = { ...root, meta: { ...root.meta, disableHelpSubcommand: true } };
    const listed = stripAnsi(renderHelp(off))
      .split('\n')
      .filter((l) => l.trimStart().startsWith('help'));
    expect(listed).toEqual([]);
  });
});

// ---- built-in flags ----

describe('disabling built-in flags', () => {
  test('disableHelpFlag drops -h and --help', () => {
    const c: CommandDef = { meta: { name: 'x', disableHelpFlag: true } };
    const result = parseArgs(['--help'], c);
    expect(result.helpRequested).toBe(false);
    expect(result.unknown).toEqual(['--help']);
    expect(stripAnsi(renderHelp(c))).not.toContain('--help');
  });

  test('disableVersionFlag drops -V and --version', () => {
    const c: CommandDef = { meta: { name: 'x', version: '1.0.0', disableVersionFlag: true } };
    expect(parseArgs(['--version'], c).versionRequested).toBe(false);
    expect(stripAnsi(renderHelp(c))).not.toContain('--version');
  });
});

// ---- version ----

describe('version output', () => {
  const root = defineCommand({
    meta: {
      name: 'app',
      version: '1.2.3',
      longVersion: '1.2.3 (build abcdef)',
      propagateVersion: true,
    },
    subCommands: {
      serve: defineCommand({ meta: { name: 'serve' }, run() {} }),
    },
  });

  test('-V prints the short version', async () => {
    const { plainStdout: out } = await runCli(root, ['-V']);
    expect(out.trim()).toBe('app 1.2.3');
  });

  test('--version prints the long version', async () => {
    const { plainStdout: out } = await runCli(root, ['--version']);
    expect(out.trim()).toBe('app 1.2.3 (build abcdef)');
  });

  test('propagateVersion gives the subcommand a --version', async () => {
    const { plainStdout: out } = await runCli(root, ['serve', '--version']);
    expect(out).toContain('1.2.3');
  });

  test('without propagateVersion the subcommand has none', () => {
    const sub: CommandDef = { meta: { name: 'serve' } };
    expect(parseArgs(['--version'], sub).unknown).toEqual(['--version']);
  });
});

// ---- help layout ----

describe('help layout settings', () => {
  test('termWidth fixes the wrap width', () => {
    const c: CommandDef = {
      meta: { name: 'x', termWidth: 40 },
      args: {
        verbose: {
          type: 'boolean',
          description: 'A description long enough that it has to wrap somewhere sensible',
        },
      },
    };
    for (const line of stripAnsi(renderHelp(c)).split('\n')) {
      expect(line.length).toBeLessThanOrEqual(40);
    }
  });

  test('maxTermWidth caps the terminal width', () => {
    const c: CommandDef = {
      meta: { name: 'x', maxTermWidth: 30 },
      args: {
        verbose: { type: 'boolean', description: 'Another description that will need wrapping' },
      },
    };
    for (const line of stripAnsi(renderHelp(c)).split('\n')) {
      expect(line.length).toBeLessThanOrEqual(30);
    }
  });

  test('overrideUsage replaces the usage line', () => {
    const c: CommandDef = { meta: { name: 'x', overrideUsage: 'x <thing> [--flag]' } };
    expect(stripAnsi(renderHelp(c))).toContain('Usage: x <thing> [--flag]');
    expect(stripAnsi(renderUsage(c))).toContain('Usage: x <thing> [--flag]');
  });

  test('overrideHelp replaces the whole output', () => {
    const c: CommandDef = { meta: { name: 'x', overrideHelp: 'just this' } };
    expect(renderHelp(c)).toBe('just this\n');
  });

  test('disableColoredHelp strips styling', () => {
    const c: CommandDef = { meta: { name: 'x', version: '1.0.0', disableColoredHelp: true } };
    expect(renderHelp(c)).toBe(stripAnsi(renderHelp(c)));
  });

  test('long-only before and after text', () => {
    const c: CommandDef = {
      meta: { name: 'x', beforeLongHelp: 'PREAMBLE', afterLongHelp: 'POSTSCRIPT' },
    };
    const long = stripAnsi(renderHelp(c));
    expect(long).toContain('PREAMBLE');
    expect(long).toContain('POSTSCRIPT');
    const short = stripAnsi(renderHelp(c, undefined, true));
    expect(short).not.toContain('PREAMBLE');
    expect(short).not.toContain('POSTSCRIPT');
  });

  test('author is available to a template', () => {
    const c: CommandDef = {
      meta: { name: 'x', author: 'Salama Ashoush', helpTemplate: '{name} by {author}\n' },
    };
    expect(renderHelp(c)).toBe('x by Salama Ashoush\n');
  });
});

describe('subcommand presentation', () => {
  const root: CommandDef = {
    meta: { name: 'app', subcommandHelpHeading: 'Operations', subcommandValueName: 'OP' },
    subCommands: {
      zebra: { meta: { name: 'zebra', description: 'Z', displayOrder: 2 } },
      alpha: { meta: { name: 'alpha', description: 'A', displayOrder: 1 } },
    },
  };

  test('custom heading and usage placeholder', () => {
    const help = stripAnsi(renderHelp(root));
    expect(help).toContain('Operations:');
    expect(help).toContain('[OP]');
  });

  test('displayOrder sorts the list', () => {
    const help = stripAnsi(renderHelp(root));
    expect(help.indexOf('alpha')).toBeLessThan(help.indexOf('zebra'));
  });
});

// ---- flag-invoked subcommands ----

describe('flag-invoked subcommands', () => {
  const sync = defineCommand({
    meta: { name: 'sync', description: 'Sync', shortFlag: 'S', longFlag: 'sync' },
    args: { refresh: { type: 'boolean', short: 'y' } },
    run() {},
  });
  const root = defineCommand({ meta: { name: 'pac' }, subCommands: { sync } });

  test('-S selects the subcommand', () => {
    const result = parseArgs(['-S', '-y'], root);
    expect(result.subCommand).toBe('sync');
    expect(result.subCommandArgs).toEqual(['-y']);
  });

  test('--sync selects the subcommand', () => {
    expect(parseArgs(['--sync'], root).subCommand).toBe('sync');
  });

  test('the flag forms show up in help', () => {
    expect(stripAnsi(renderHelp(root))).toContain('sync (-S, --sync)');
  });
});

describe('hidden command aliases', () => {
  const root: CommandDef = {
    meta: { name: 'app' },
    subCommands: {
      install: { meta: { name: 'install', aliases: ['i'], hiddenAliases: ['add'] } },
    },
  };

  test('a hidden alias resolves', () => {
    expect(parseArgs(['add'], root).subCommand).toBe('install');
  });

  test('but does not appear in help', () => {
    const help = stripAnsi(renderHelp(root));
    expect(help).toContain('install (i)');
    expect(help).not.toContain('add');
  });
});

// ---- parsing settings ----

describe('command-level value settings', () => {
  test('allowHyphenValues applies to every arg', () => {
    const c: CommandDef = {
      meta: { name: 'x', allowHyphenValues: true },
      args: { grep: { type: 'string' } },
    };
    expect(parseArgs(['--grep', '-pattern'], c).args.grep).toBe('-pattern');
  });

  test('allowNegativeNumbers applies to every arg', () => {
    const c: CommandDef = {
      meta: { name: 'x', allowNegativeNumbers: true },
      args: { offset: { type: 'number' } },
    };
    expect(parseArgs(['--offset', '-10'], c).args.offset).toBe(-10);
  });
});

describe('allowMissingPositional', () => {
  const c: CommandDef = {
    meta: { name: 'cp', allowMissingPositional: true },
    args: {
      src: { type: 'positional' },
      dest: { type: 'positional', required: true },
    },
  };

  test('one value fills the trailing required positional', () => {
    const result = parseArgs(['only'], c);
    expect(result.args.src).toBeUndefined();
    expect(result.args.dest).toBe('only');
  });

  test('two values fill both in order', () => {
    const result = parseArgs(['a', 'b'], c);
    expect(result.args.src).toBe('a');
    expect(result.args.dest).toBe('b');
  });
});

describe('argsOverrideSelf', () => {
  test('repeating a single-value arg is an error by default', () => {
    const c: CommandDef = { meta: { name: 'd' }, args: { port: { type: 'number' } } };
    expect(() => parseArgs(['--port', '1', '--port', '2'], c)).toThrow(
      "the argument '--port' cannot be used multiple times",
    );
  });

  test('the setting makes the last one win', () => {
    const c: CommandDef = {
      meta: { name: 'd', argsOverrideSelf: true },
      args: { port: { type: 'number' } },
    };
    expect(parseArgs(['--port', '1', '--port', '2'], c).args.port).toBe(2);
  });

  test('append args are unaffected', () => {
    const c: CommandDef = {
      meta: { name: 'd' },
      args: { header: { type: 'string', short: 'H', action: 'append' } },
    };
    expect(parseArgs(['-H', 'a', '-H', 'b'], c).args.header).toEqual(['a', 'b']);
  });
});

describe('subcommandPrecedenceOverArg', () => {
  const args = { arg: { type: 'string' as const, action: 'append' as const, numArgs: { min: 1, max: 99 } } };
  const subCommands = { sub: { meta: { name: 'sub' } } };

  test('by default a multi-value arg swallows the subcommand name', () => {
    const c: CommandDef = { meta: { name: 'cmd' }, args, subCommands };
    const result = parseArgs(['--arg', '1', '2', '3', 'sub'], c);
    expect(result.args.arg).toEqual(['1', '2', '3', 'sub']);
    expect(result.subCommand).toBeUndefined();
  });

  test('the setting stops collection at the subcommand', () => {
    const c: CommandDef = {
      meta: { name: 'cmd', subcommandPrecedenceOverArg: true },
      args,
      subCommands,
    };
    const result = parseArgs(['--arg', '1', '2', '3', 'sub'], c);
    expect(result.args.arg).toEqual(['1', '2', '3']);
    expect(result.subCommand).toBe('sub');
  });
});

describe('noBinaryName', () => {
  test('nothing is stripped from the front of argv', () => {
    const original = process.argv;
    try {
      process.argv = ['node', 'script.js', '--flag'];
      expect(getRawArgs(undefined, true)).toEqual(['node', 'script.js', '--flag']);
      expect(getRawArgs(undefined, false)).toEqual(['--flag']);
    } finally {
      process.argv = original;
    }
  });
});

describe('errors still surface as CliParseError', () => {
  test('an unknown flag on a disabled-help command', () => {
    const c: CommandDef = { meta: { name: 'x' }, args: { a: { type: 'string' } } };
    expect(() => parseArgs(['--a'], c)).toThrow(CliParseError);
  });
});

describe('binName and displayName', () => {
  const command: CommandDef = {
    meta: { name: 'stash', binName: 'git stash', displayName: 'git-stash', version: '1.0' },
    args: { verbose: { type: 'boolean' } },
  };

  test('binName drives the usage line', () => {
    expect(stripAnsi(renderHelp(command))).toContain('Usage: git stash');
    expect(stripAnsi(renderUsage(command))).toContain('Usage: git stash');
  });

  test('displayName drives the help header', () => {
    expect(stripAnsi(renderHelp(command))).toContain('git-stash v1.0');
  });
});

describe('color choice', () => {
  const args = { verbose: { type: 'boolean' as const, description: 'V' } };

  test("'never' strips styling", () => {
    const c: CommandDef = { meta: { name: 'x', color: 'never' }, args };
    expect(renderHelp(c)).toBe(stripAnsi(renderHelp(c)));
  });

  test("'always' emits codes even when stdout is not a terminal", () => {
    const c: CommandDef = { meta: { name: 'x', color: 'always' }, args };
    expect(renderHelp(c)).not.toBe(stripAnsi(renderHelp(c)));
  });

  test("'auto' is the default, and defers to stream detection", () => {
    // Asserting whether detection says yes here would pin the test to the
    // runner: bun 1.2 and bun 1.4 disagree about a piped stdout. The contract
    // is that 'auto' behaves exactly as setting nothing does.
    const auto: CommandDef = { meta: { name: 'x', color: 'auto' }, args };
    const unset: CommandDef = { meta: { name: 'x' }, args };
    expect(renderHelp(auto)).toBe(renderHelp(unset));
  });

  test("'never' and 'always' both override detection, whichever way it went", () => {
    const never: CommandDef = { meta: { name: 'x', color: 'never' }, args };
    const always: CommandDef = { meta: { name: 'x', color: 'always' }, args };
    expect(renderHelp(never)).not.toBe(renderHelp(always));
    expect(stripAnsi(renderHelp(always))).toBe(renderHelp(never));
  });
});

describe('flattenHelp', () => {
  const command: CommandDef = {
    meta: { name: 'stash', flattenHelp: true },
    subCommands: {
      push: {
        meta: { name: 'push', description: 'Save changes' },
        args: {
          message: { type: 'string', short: 'm', description: 'Note' },
          all: { type: 'boolean', description: 'Everything' },
          secret: { type: 'boolean', hidden: true },
        },
      },
      pop: { meta: { name: 'pop', description: 'Restore' } },
    },
  };

  test("summarises each subcommand's own args in place", () => {
    const help = stripAnsi(renderHelp(command));
    expect(help).toContain('--message');
    expect(help).toContain('Everything');
  });

  test('keeps hidden args out', () => {
    expect(stripAnsi(renderHelp(command))).not.toContain('--secret');
  });

  test('aligns the flattened descriptions', () => {
    const lines = stripAnsi(renderHelp(command)).split('\n');
    const message = lines.find((l) => l.includes('--message'))!;
    const all = lines.find((l) => l.includes('--all'))!;
    expect(message.indexOf('Note')).toBe(all.indexOf('Everything'));
  });

  test('is off by default', () => {
    const off: CommandDef = { ...command, meta: { name: 'stash' } };
    expect(stripAnsi(renderHelp(off))).not.toContain('--message');
  });
});

describe('nextHelpHeading and nextDisplayOrder', () => {
  test('nextHelpHeading renames the default section', () => {
    const c: CommandDef = {
      meta: { name: 'x', nextHelpHeading: 'Global' },
      args: { verbose: { type: 'boolean', description: 'V' } },
    };
    const help = stripAnsi(renderHelp(c));
    expect(help).toContain('Global:');
    expect(help).not.toContain('Options:');
  });

  test('an explicit displayOrder still sorts ahead of the implicit base', () => {
    const c: CommandDef = {
      meta: { name: 'x', nextDisplayOrder: 100 },
      args: {
        zulu: { type: 'boolean', description: 'z' },
        alpha: { type: 'boolean', description: 'a', displayOrder: 1 },
        mike: { type: 'boolean', description: 'm' },
      },
    };
    const help = stripAnsi(renderHelp(c));
    expect(help.indexOf('--alpha')).toBeLessThan(help.indexOf('--zulu'));
    // The two without an order keep declaration order between themselves.
    expect(help.indexOf('--zulu')).toBeLessThan(help.indexOf('--mike'));
  });
});

describe('ignoreErrors', () => {
  const c: CommandDef = {
    meta: { name: 'x', ignoreErrors: true },
    args: { port: { type: 'number' }, flag: { type: 'boolean' } },
  };

  test('collects the message instead of throwing', () => {
    const result = parseArgs(['--port', 'abc', '--flag'], c);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("invalid value 'abc'");
  });

  test('keeps parsing the tokens after the bad one', () => {
    expect(parseArgs(['--port', 'abc', '--flag'], c).args.flag).toBe(true);
  });

  test('without it the same input throws', () => {
    const strict: CommandDef = { meta: { name: 'x' }, args: { port: { type: 'number' } } };
    expect(() => parseArgs(['--port', 'abc'], strict)).toThrow(CliParseError);
  });

  test('errors is empty on a clean parse', () => {
    expect(parseArgs(['--flag'], c).errors).toEqual([]);
  });
});

describe('subcommand flag aliases', () => {
  const command: CommandDef = {
    meta: { name: 'pac' },
    subCommands: {
      sync: {
        meta: {
          name: 'sync',
          description: 'Sync',
          shortFlag: 'S',
          longFlagAliases: ['syncdb'],
          visibleLongFlagAliases: ['sy'],
          visibleShortFlagAliases: ['Y'],
        },
      },
    },
  };

  test('every flag form resolves to the subcommand', () => {
    for (const argv of [['-S'], ['--syncdb'], ['--sy'], ['-Y']]) {
      expect(parseArgs(argv, command).subCommand).toBe('sync');
    }
  });

  test('only the visible forms appear in help', () => {
    const help = stripAnsi(renderHelp(command));
    expect(help).toContain('-S');
    expect(help).toContain('--sy');
    expect(help).toContain('-Y');
    expect(help).not.toContain('syncdb');
  });
});

describe('helpExpected', () => {
  test('rejects an arg with no description', () => {
    const c: CommandDef = {
      meta: { name: 'x', helpExpected: true },
      args: { undocumented: { type: 'boolean' } },
    };
    expect(() => parseArgs([], c)).toThrow('helpExpected is set');
  });

  test('accepts a described arg, and ignores hidden ones', () => {
    const c: CommandDef = {
      meta: { name: 'x', helpExpected: true },
      args: {
        documented: { type: 'boolean', description: 'Yes' },
        internal: { type: 'boolean', hidden: true },
      },
    };
    expect(() => parseArgs([], c)).not.toThrow();
  });
});

describe('dontDelimitTrailingValues', () => {
  test('a value taken from after -- is left unsplit', () => {
    const c: CommandDef = {
      meta: { name: 'x', dontDelimitTrailingValues: true },
      args: { tags: { type: 'positional', last: true, valueDelimiter: ',' } },
    };
    expect(parseArgs(['--', 'a,b,c'], c).args.tags).toBe('a,b,c');
  });

  test('without it the same value is split', () => {
    const c: CommandDef = {
      meta: { name: 'x' },
      args: { tags: { type: 'positional', last: true, valueDelimiter: ',' } },
    };
    expect(parseArgs(['--', 'a,b,c'], c).args.tags).toEqual(['a', 'b', 'c']);
  });
});

describe('inferLongArgs', () => {
  test('resolves partial long flag when unambiguous', () => {
    const command = cmd(
      { verbose: { type: 'boolean', long: 'verbose' } },
      { meta: { name: 'test', inferLongArgs: true } },
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
      { meta: { name: 'test', inferLongArgs: true } },
    );
    const result = parseArgs(['--ver'], command);
    // ambiguous: matches both verbose and version-check
    expect(result.unknown).toContain('--ver');
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
    await runCli(root, ['init']);
    expect(ran).toBe(true);
  });
});

describe('subcommandRequired', () => {
  test('errors when no subcommand provided', async () => {
    const root = defineCommand({
      meta: { name: 'app', subcommandRequired: true },
      subCommands: {
        serve: defineCommand({ meta: { name: 'serve' }, run() {} }),
      },
    });
    const { plainStderr, exitCode } = await runCli(root, [], { showHelpOnEmpty: false });
    expect(plainStderr).toContain('a subcommand is required but one was not provided');
    expect(exitCode).toBe(2);
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
    await runCli(root, ['serve']);
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
    await runCli(root, ['ser']);
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
    await runCli(root, ['b']);
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
    await runCli(root, ['my-plugin', 'arg1']);
    expect(receivedSubCmd).toBe('my-plugin');
  });
});

describe('argsConflictsWithSubcommands', () => {
  test('errors when args and subcommand both present', async () => {
    const root = defineCommand({
      meta: { name: 'app', argsConflictsWithSubcommands: true },
      args: {
        verbose: { type: 'boolean', long: 'verbose' },
      },
      subCommands: {
        serve: defineCommand({ meta: { name: 'serve' }, run() {} }),
      },
    });
    const { plainStderr, exitCode } = await runCli(root, ['--verbose', 'serve']);
    expect(plainStderr).toContain('cannot be used with subcommands');
    expect(exitCode).toBe(2);
  });
});

describe('argRequiredElseHelp', () => {
  test('shows help when no args provided', async () => {
    const root = defineCommand({
      meta: { name: 'tool', argRequiredElseHelp: true },
      args: {
        input: { type: 'string', long: 'input' },
      },
      run() {
        throw new Error('should not run');
      },
    });
    const { plainStdout, exitCode } = await runCli(root, [], { showHelpOnEmpty: false });
    expect(plainStdout).toContain('Usage:');
    expect(exitCode).toBe(0);
  });
});
