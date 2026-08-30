/**
 * Tests for the clap Command settings added on top of the tokenizer rewrite.
 */

import { describe, test, expect } from 'bun:test';
import { parseArgs, CliParseError, getRawArgs } from '../parser.js';
import { defineCommand } from '../runner.js';
import { runCli } from '../testing.js';
import { renderHelp, renderUsage } from '../help.js';
import type { CommandDef } from '../types.js';

function plain(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
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
    expect(plain(renderHelp(root))).toContain('help');
  });

  test('disableHelpSubcommand takes it away', () => {
    const off: CommandDef = { ...root, meta: { ...root.meta, disableHelpSubcommand: true } };
    const listed = plain(renderHelp(off))
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
    expect(plain(renderHelp(c))).not.toContain('--help');
  });

  test('disableVersionFlag drops -V and --version', () => {
    const c: CommandDef = { meta: { name: 'x', version: '1.0.0', disableVersionFlag: true } };
    expect(parseArgs(['--version'], c).versionRequested).toBe(false);
    expect(plain(renderHelp(c))).not.toContain('--version');
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
    for (const line of plain(renderHelp(c)).split('\n')) {
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
    for (const line of plain(renderHelp(c)).split('\n')) {
      expect(line.length).toBeLessThanOrEqual(30);
    }
  });

  test('overrideUsage replaces the usage line', () => {
    const c: CommandDef = { meta: { name: 'x', overrideUsage: 'x <thing> [--flag]' } };
    expect(plain(renderHelp(c))).toContain('Usage: x <thing> [--flag]');
    expect(plain(renderUsage(c))).toContain('Usage: x <thing> [--flag]');
  });

  test('overrideHelp replaces the whole output', () => {
    const c: CommandDef = { meta: { name: 'x', overrideHelp: 'just this' } };
    expect(renderHelp(c)).toBe('just this\n');
  });

  test('disableColoredHelp strips styling', () => {
    const c: CommandDef = { meta: { name: 'x', version: '1.0.0', disableColoredHelp: true } };
    expect(renderHelp(c)).toBe(plain(renderHelp(c)));
  });

  test('long-only before and after text', () => {
    const c: CommandDef = {
      meta: { name: 'x', beforeLongHelp: 'PREAMBLE', afterLongHelp: 'POSTSCRIPT' },
    };
    const long = plain(renderHelp(c));
    expect(long).toContain('PREAMBLE');
    expect(long).toContain('POSTSCRIPT');
    const short = plain(renderHelp(c, undefined, true));
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
    const help = plain(renderHelp(root));
    expect(help).toContain('Operations:');
    expect(help).toContain('[OP]');
  });

  test('displayOrder sorts the list', () => {
    const help = plain(renderHelp(root));
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
    expect(plain(renderHelp(root))).toContain('sync (-S, --sync)');
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
    const help = plain(renderHelp(root));
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
