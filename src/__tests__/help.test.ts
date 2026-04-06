/**
 * Help renderer tests - tests for clap-style help output generation.
 */

import { describe, test, expect } from 'bun:test';
import { renderHelp } from '../help.js';
import type { CommandDef } from '../types.js';

/** Strip ANSI escape sequences for assertion on content. */
const ANSI_RE = new RegExp(String.raw`\u001B\[[0-9;]*m`, 'g');
function stripAnsi(s: string): string {
  return s.replaceAll(ANSI_RE, '');
}

const basicCommand: CommandDef = {
  meta: {
    name: 'my-tool',
    version: '1.0.0',
    description: 'A great tool',
    about: 'A tool that does great things',
  },
  args: {
    verbose: {
      type: 'boolean',
      short: 'v',
      description: 'Enable verbose output',
    },
    port: {
      type: 'number',
      short: 'p',
      default: 3000,
      valueName: 'PORT',
      description: 'Port to listen on',
    },
    env: {
      type: 'string',
      short: 'e',
      env: 'MY_TOOL_ENV',
      valueParser: ['dev', 'staging', 'prod'],
      description: 'Environment to use',
    },
    file: {
      type: 'positional',
      valueName: 'FILE',
      required: true,
      description: 'Input file',
    },
  },
};

describe('help rendering', () => {
  test('includes all sections', () => {
    const help = stripAnsi(renderHelp(basicCommand));
    // Header with name and version
    expect(help).toContain('my-tool');
    expect(help).toContain('v1.0.0');
    // About text
    expect(help).toContain('A tool that does great things');
    // Usage line
    expect(help).toContain('Usage:');
    expect(help).toContain('my-tool');
    // Arguments section
    expect(help).toContain('Arguments:');
    expect(help).toContain('FILE');
    // Options section
    expect(help).toContain('Options:');
    expect(help).toContain('--verbose');
    expect(help).toContain('--port');
    expect(help).toContain('--env');
    // Built-in flags
    expect(help).toContain('--help');
    expect(help).toContain('--version');
  });

  test('aliases shown in help (subcommands)', () => {
    const command: CommandDef = {
      meta: { name: 'app' },
      subCommands: {
        serve: {
          meta: { name: 'serve', description: 'Start server', aliases: ['s', 'start'] },
        },
      },
    };
    const help = stripAnsi(renderHelp(command));
    expect(help).toContain('serve');
    expect(help).toContain('s, start');
  });

  test('default values shown', () => {
    const help = stripAnsi(renderHelp(basicCommand));
    expect(help).toContain('[default: 3000]');
  });

  test('env var names shown', () => {
    const help = stripAnsi(renderHelp(basicCommand));
    expect(help).toContain('[env: MY_TOOL_ENV]');
  });

  test('required markers shown for positionals', () => {
    const help = stripAnsi(renderHelp(basicCommand));
    // Required positionals appear as <FILE> in usage line
    expect(help).toContain('<FILE>');
  });

  test('possible values shown', () => {
    const help = stripAnsi(renderHelp(basicCommand));
    // Help text may wrap across lines; normalize whitespace for matching
    const normalized = help.replaceAll(/\s+/g, ' ');
    expect(normalized).toContain('[possible values: dev, staging, prod]');
  });

  test('short flags shown', () => {
    const help = stripAnsi(renderHelp(basicCommand));
    expect(help).toContain('-v');
    expect(help).toContain('-p');
    expect(help).toContain('-e');
  });

  test('hidden args not shown', () => {
    const command: CommandDef = {
      meta: { name: 'tool' },
      args: {
        visible: { type: 'boolean', description: 'Visible flag' },
        secret: { type: 'boolean', description: 'Secret flag', hidden: true },
      },
    };
    const help = stripAnsi(renderHelp(command));
    expect(help).toContain('--visible');
    expect(help).not.toContain('--secret');
  });

  test('subcommands section rendered', () => {
    const command: CommandDef = {
      meta: { name: 'app' },
      subCommands: {
        serve: { meta: { name: 'serve', description: 'Start the server' } },
        build: { meta: { name: 'build', description: 'Build the project' } },
      },
    };
    const help = stripAnsi(renderHelp(command));
    expect(help).toContain('Commands:');
    expect(help).toContain('serve');
    expect(help).toContain('Start the server');
    expect(help).toContain('build');
    expect(help).toContain('Build the project');
  });

  test('after help text shown', () => {
    const command: CommandDef = {
      meta: { name: 'tool', afterHelp: 'For more info visit https://example.com' },
    };
    const help = stripAnsi(renderHelp(command));
    expect(help).toContain('For more info visit https://example.com');
  });

  test('optional value indicator shown for numArgs.min=0', () => {
    const command: CommandDef = {
      meta: { name: 'tool' },
      args: {
        level: {
          type: 'string',
          valueName: 'LEVEL',
          numArgs: { min: 0, max: 1 },
          description: 'Log level',
        },
      },
    };
    const help = stripAnsi(renderHelp(command));
    // Optional values shown as [LEVEL] instead of <LEVEL>
    expect(help).toContain('[LEVEL]');
  });
});
