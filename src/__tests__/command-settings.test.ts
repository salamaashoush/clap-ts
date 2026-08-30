/**
 * Tests for the remaining clap Command settings: naming, colour, help layout,
 * error tolerance and flag-form subcommand aliases.
 */

import { describe, test, expect } from 'bun:test';
import { parseArgs, CliParseError } from '../parser.js';
import { renderHelp, renderUsage } from '../help.js';
import type { CommandDef } from '../types.js';

function plain(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

describe('binName and displayName', () => {
  const command: CommandDef = {
    meta: { name: 'stash', binName: 'git stash', displayName: 'git-stash', version: '1.0' },
    args: { verbose: { type: 'boolean' } },
  };

  test('binName drives the usage line', () => {
    expect(plain(renderHelp(command))).toContain('Usage: git stash');
    expect(plain(renderUsage(command))).toContain('Usage: git stash');
  });

  test('displayName drives the help header', () => {
    expect(plain(renderHelp(command))).toContain('git-stash v1.0');
  });
});

describe('color choice', () => {
  const args = { verbose: { type: 'boolean' as const, description: 'V' } };

  test("'never' strips styling", () => {
    const c: CommandDef = { meta: { name: 'x', color: 'never' }, args };
    expect(renderHelp(c)).toBe(plain(renderHelp(c)));
  });

  test("'always' emits codes even when stdout is not a terminal", () => {
    const c: CommandDef = { meta: { name: 'x', color: 'always' }, args };
    expect(renderHelp(c)).not.toBe(plain(renderHelp(c)));
  });

  test("'auto' follows stream detection, which is off under the test runner", () => {
    const c: CommandDef = { meta: { name: 'x', color: 'auto' }, args };
    expect(renderHelp(c)).toBe(plain(renderHelp(c)));
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
    const help = plain(renderHelp(command));
    expect(help).toContain('--message');
    expect(help).toContain('Everything');
  });

  test('keeps hidden args out', () => {
    expect(plain(renderHelp(command))).not.toContain('--secret');
  });

  test('aligns the flattened descriptions', () => {
    const lines = plain(renderHelp(command)).split('\n');
    const message = lines.find((l) => l.includes('--message'))!;
    const all = lines.find((l) => l.includes('--all'))!;
    expect(message.indexOf('Note')).toBe(all.indexOf('Everything'));
  });

  test('is off by default', () => {
    const off: CommandDef = { ...command, meta: { name: 'stash' } };
    expect(plain(renderHelp(off))).not.toContain('--message');
  });
});

describe('nextHelpHeading and nextDisplayOrder', () => {
  test('nextHelpHeading renames the default section', () => {
    const c: CommandDef = {
      meta: { name: 'x', nextHelpHeading: 'Global' },
      args: { verbose: { type: 'boolean', description: 'V' } },
    };
    const help = plain(renderHelp(c));
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
    const help = plain(renderHelp(c));
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
    const help = plain(renderHelp(command));
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
