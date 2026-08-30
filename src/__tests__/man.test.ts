/**
 * Tests for man page generation. Where groff is installed the output is also
 * run through it, so a malformed request fails the suite rather than showing
 * up in someone's terminal.
 */

import { describe, test, expect } from 'bun:test';
import { renderManPage, generateManPages } from '../man.js';
import type { CommandDef } from '../types.js';

const command: CommandDef = {
  meta: {
    name: 'my-app',
    version: '3.0',
    description: 'Tests man pages',
    author: 'Salama Ashoush',
    afterHelp: "Don't forget the apostrophe.",
  },
  args: {
    config: { type: 'string', short: 'c', description: 'some config file', action: 'append' },
    mode: {
      type: 'string',
      description: 'Build mode',
      valueParser: [{ name: 'fast', help: 'Skip checks' }, { name: 'safe' }],
    },
    port: { type: 'number', default: 8080, env: 'APP_PORT', description: 'Port to bind' },
    secret: { type: 'string', hidden: true },
    file: { type: 'positional', required: true, description: 'some input file' },
    choice: { type: 'positional', description: 'a choice' },
  },
  subCommands: {
    test: {
      meta: { name: 'test', description: 'tests things' },
      args: { case: { type: 'string', description: 'the case to test' } },
    },
    ghost: { meta: { name: 'ghost', hidden: true } },
  },
};

const page = renderManPage(command);

describe('man page structure', () => {
  test('opens with the apostrophe preamble and a title', () => {
    expect(page.startsWith('.ie \\n(.g .ds Aq \\(aq\n')).toBe(true);
    expect(page).toContain('.TH my\\-app 1');
  });

  test('carries the standard sections in order', () => {
    const order = ['.SH NAME', '.SH SYNOPSIS', '.SH DESCRIPTION', '.SH OPTIONS', '.SH SUBCOMMANDS', '.SH VERSION', '.SH AUTHORS'];
    let at = -1;
    for (const section of order) {
      const found = page.indexOf(section);
      expect(found).toBeGreaterThan(at);
      at = found;
    }
  });

  test('escapes hyphens and apostrophes', () => {
    expect(page).toContain('my\\-app');
    expect(page).toContain('Don\\*(Aqt');
    // The two preamble lines define \\*(Aq and must keep their literal quotes.
    const body = page.split('\n').slice(2).join('\n');
    expect(body).not.toContain("'");
  });

  test('marks repeatable options and required positionals', () => {
    expect(page).toContain('\\fB\\-c\\fR|\\fB\\-\\-config\\fR=\\fICONFIG\\fR]...');
    expect(page).toContain('\\fIfile\\fR');
    expect(page).toContain('[\\fIchoice\\fR]');
  });

  test('renders possible values as a bullet list with their help', () => {
    expect(page).toContain('\\fIPossible values:\\fR');
    expect(page).toContain('.IP \\(bu 2');
    expect(page).toContain('fast: Skip checks');
  });

  test('notes defaults and environment variables', () => {
    expect(page).toContain('\\fIDefault value:\\fR 8080');
    expect(page).toContain('\\fIEnvironment:\\fR APP_PORT');
  });

  test('omits hidden args and subcommands', () => {
    expect(page).not.toContain('secret');
    expect(page).not.toContain('ghost');
  });

  test('lists subcommands by their own page name', () => {
    expect(page).toContain('my\\-app\\-test(1)');
  });
});

describe('generateManPages', () => {
  const pages = generateManPages(command);

  test('produces one page per visible command', () => {
    expect([...pages.keys()].sort()).toEqual(['my-app-test.1', 'my-app.1']);
  });

  test('honours a custom section number', () => {
    const section8 = generateManPages(command, { section: '8' });
    expect([...section8.keys()]).toContain('my-app.8');
    expect(section8.get('my-app.8')).toContain('.TH my\\-app 8');
  });

  test('a subcommand page describes only that subcommand', () => {
    const sub = pages.get('my-app-test.1')!;
    expect(sub).toContain('my\\-app\\-test \\- tests things');
    expect(sub).toContain('\\-\\-case');
    expect(sub).not.toContain('\\-\\-config');
  });
});

describe('groff accepts the output', () => {
  const groff = Bun.spawnSync(['sh', '-c', 'command -v groff']).exitCode === 0;

  test.if(groff)('renders every page with no warnings', () => {
    for (const [name, roff] of generateManPages(command)) {
      const result = Bun.spawnSync(['groff', '-man', '-Tascii', '-ww'], {
        stdin: Buffer.from(roff),
      });
      const warnings = new TextDecoder().decode(result.stderr).trim();
      expect(`${name}: ${warnings}`).toBe(`${name}: `);
      expect(result.exitCode).toBe(0);
    }
  });

  test.if(groff)('the rendered text reads back correctly', () => {
    const result = Bun.spawnSync(['groff', '-man', '-Tascii'], { stdin: Buffer.from(page) });
    const text = new TextDecoder().decode(result.stdout).replace(/.\x08/g, '');
    expect(text).toContain('my-app - Tests man pages');
    expect(text).toContain('Port to bind');
    expect(text).toContain("Don't forget the apostrophe.");
  });
});
