/**
 * Help renderer tests - tests for clap-style help output generation.
 */

import { describe, test, expect } from 'bun:test';
import { renderHelp } from '../help.js';
import { stripAnsi } from '../testing.js';
import type { ArgsDef, CommandDef } from '../types.js';

/** Strip ANSI escape sequences for assertion on content. */
function cmd(args: ArgsDef, extra?: Partial<CommandDef>): CommandDef {
  return { meta: { name: 'test' }, args, ...extra };
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
