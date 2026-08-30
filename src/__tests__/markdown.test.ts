/**
 * Tests for markdown documentation output.
 */

import { describe, test, expect } from 'bun:test';
import { renderMarkdownHelp } from '../markdown.js';
import type { CommandDef } from '../types.js';

const command: CommandDef = {
  meta: { name: 'my-app', version: '3.0', description: 'Does things' },
  args: {
    config: { type: 'string', short: 'c', description: 'Config file', env: 'APP_CONFIG' },
    mode: {
      type: 'string',
      description: 'Build mode',
      valueParser: [{ name: 'fast', help: 'Skip checks' }, { name: 'safe' }],
    },
    port: { type: 'number', default: 8080, description: 'Port' },
    plain: { type: 'string', valueParser: ['a', 'b'], description: 'Plain choices' },
    secret: { type: 'string', hidden: true },
    file: { type: 'positional', required: true, description: 'Input file' },
  },
  subCommands: {
    test: {
      meta: { name: 'test', description: 'Tests things', aliases: ['t'] },
      args: { case: { type: 'string', description: 'Case' } },
    },
    ghost: { meta: { name: 'ghost', hidden: true } },
  },
};

const doc = renderMarkdownHelp(command);

describe('markdown structure', () => {
  test('heads each command with its full path', () => {
    expect(doc).toContain('# `my-app`');
    expect(doc).toContain('## `my-app test`');
  });

  test('nests sections one level under their command', () => {
    expect(doc).toContain('## Options');
    expect(doc).toContain('### Options');
  });

  test('gives a usage line per command', () => {
    expect(doc).toContain('**Usage:** `my-app [OPTIONS] <FILE> [COMMAND]`');
    expect(doc).toContain('**Usage:** `my-app test [OPTIONS]`');
  });

  test('lists subcommands with their aliases', () => {
    expect(doc).toContain('* `test` (`t`) - Tests things');
  });

  test('pairs the long flag and its placeholder in one code span', () => {
    expect(doc).toContain('* `-c`, `--config <CONFIG>` - Config file');
  });

  test('includes the built-in flags', () => {
    expect(doc).toContain('* `-h`, `--help` - Print help');
    expect(doc).toContain('* `-V`, `--version` - Print version');
  });
});

describe('markdown argument notes', () => {
  test('spells out possible values that carry help', () => {
    expect(doc).toContain('Possible values:');
    expect(doc).toContain('- `fast`: Skip checks');
  });

  test('keeps plain possible values on one line', () => {
    expect(doc).toContain('Possible values: `a`, `b`');
  });

  test('reports defaults, environment and required', () => {
    expect(doc).toContain('Default value: `8080`');
    expect(doc).toContain('Environment: `APP_CONFIG`');
    expect(doc).toContain('Required.');
  });

  test('omits hidden args and commands', () => {
    expect(doc).not.toContain('secret');
    expect(doc).not.toContain('ghost');
  });
});

describe('markdown formatting', () => {
  test('never leaves three blank lines in a row', () => {
    expect(doc).not.toContain('\n\n\n');
  });

  test('ends with exactly one newline', () => {
    expect(doc.endsWith('\n')).toBe(true);
    expect(doc.endsWith('\n\n')).toBe(false);
  });

  test('escapes markdown that would break a list item', () => {
    const tricky: CommandDef = {
      meta: { name: 'x' },
      args: { a: { type: 'boolean', description: 'Uses *stars* and _score_ and <tags>' } },
    };
    const out = renderMarkdownHelp(tricky);
    expect(out).toContain('\\*stars\\*');
    expect(out).toContain('\\_score\\_');
    expect(out).toContain('\\<tags\\>');
  });

  test('a title demotes the command headings by one level', () => {
    const out = renderMarkdownHelp(command, { title: 'CLI Reference', footer: 'Bye.' });
    expect(out.startsWith('# CLI Reference\n')).toBe(true);
    expect(out).toContain('## `my-app`');
    expect(out).toContain('### `my-app test`');
    expect(out.trimEnd().endsWith('Bye.')).toBe(true);
  });
});
