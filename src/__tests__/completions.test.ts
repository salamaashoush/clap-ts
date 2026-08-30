/**
 * Tests for shell completion generation across every supported shell.
 */

import { describe, test, expect } from 'bun:test';
import { generateCompletions, withCompletions } from '../completions.js';
import { defineCommand } from '../runner.js';
import { runCli } from '../testing.js';
import type { CommandDef } from '../types.js';

// ---- Test Command ----

const testCommand = defineCommand({
  meta: { name: 'myapp', version: '1.0.0', description: 'Test app' },
  args: {
    verbose: { type: 'boolean', short: 'v', description: 'Verbose output' },
    port: { type: 'number', short: 'p', description: 'Port number', valueName: 'PORT' },
    env: {
      type: 'string',
      short: 'e',
      description: 'Environment',
      valueParser: ['dev', 'staging', 'prod'],
    },
    config: {
      type: 'string',
      short: 'c',
      description: 'Config file',
      valueHint: 'filePath',
    },
    outDir: {
      type: 'string',
      description: 'Output directory',
      valueHint: 'dirPath',
    },
    secret: { type: 'string', description: 'Secret value', hidden: true },
  },
  subCommands: {
    serve: defineCommand({
      meta: { name: 'serve', description: 'Start server', aliases: ['s'] },
      args: {
        host: { type: 'string', description: 'Host to bind' },
      },
    }),
    build: defineCommand({
      meta: { name: 'build', description: 'Build project' },
      args: {
        target: {
          type: 'string',
          description: 'Build target',
          valueParser: ['debug', 'release'],
        },
      },
    }),
  },
});

// ---- Bash ----

describe('bash completion', () => {
  test('generates valid bash script', () => {
    const script = generateCompletions(testCommand, 'bash');
    expect(script).toContain('# bash completion for myapp');
    expect(script).toContain('_myapp()');
    expect(script).toContain('complete -o default -o bashdefault -F _myapp myapp');
  });

  test('includes flags', () => {
    const script = generateCompletions(testCommand, 'bash');
    expect(script).toContain('--verbose');
    expect(script).toContain('-v');
    expect(script).toContain('--port');
    expect(script).toContain('--env');
  });

  test('includes subcommands', () => {
    const script = generateCompletions(testCommand, 'bash');
    expect(script).toContain('serve');
    expect(script).toContain('build');
  });

  test('generates child functions for subcommands', () => {
    const script = generateCompletions(testCommand, 'bash');
    expect(script).toContain('_myapp_serve()');
    expect(script).toContain('_myapp_build()');
  });

  test('includes possible values for enum args', () => {
    const script = generateCompletions(testCommand, 'bash');
    expect(script).toContain("compgen -W 'dev staging prod'");
  });

  test('includes file completion for valueHint filePath', () => {
    const script = generateCompletions(testCommand, 'bash');
    expect(script).toContain('compgen -f');
  });

  test('includes dir completion for valueHint dirPath', () => {
    const script = generateCompletions(testCommand, 'bash');
    expect(script).toContain('compgen -d');
  });

  test('excludes hidden args', () => {
    const script = generateCompletions(testCommand, 'bash');
    expect(script).not.toContain('--secret');
  });

  test('handles subcommand aliases in dispatch', () => {
    const script = generateCompletions(testCommand, 'bash');
    expect(script).toContain('serve|s)');
  });

  test('respects custom binary name', () => {
    const script = generateCompletions(testCommand, 'bash', 'my-tool');
    expect(script).toContain('_my_tool()');
    expect(script).toContain('complete -o default -o bashdefault -F _my_tool my-tool');
  });
});

// ---- Zsh ----

describe('zsh completion', () => {
  test('generates valid zsh script', () => {
    const script = generateCompletions(testCommand, 'zsh');
    expect(script).toContain('#compdef myapp');
    expect(script).toContain('_myapp()');
    expect(script).toContain('compdef _myapp myapp');
  });

  test('includes _arguments specs for flags', () => {
    const script = generateCompletions(testCommand, 'zsh');
    expect(script).toContain('--verbose');
    expect(script).toContain('--port');
    expect(script).toContain('_arguments');
  });

  test('includes subcommand values', () => {
    const script = generateCompletions(testCommand, 'zsh');
    expect(script).toContain("'serve:Start server'");
    expect(script).toContain("'build:Build project'");
  });

  test('includes possible values for enum args', () => {
    const script = generateCompletions(testCommand, 'zsh');
    expect(script).toContain('dev staging prod');
  });

  test('includes file completion for valueHint', () => {
    const script = generateCompletions(testCommand, 'zsh');
    expect(script).toContain('_files');
  });

  test('includes dir completion for valueHint', () => {
    const script = generateCompletions(testCommand, 'zsh');
    expect(script).toContain('_directories');
  });

  test('generates child functions', () => {
    const script = generateCompletions(testCommand, 'zsh');
    expect(script).toContain('_myapp_serve()');
    expect(script).toContain('_myapp_build()');
  });
});

// ---- Fish ----

describe('fish completion', () => {
  test('generates valid fish script', () => {
    const script = generateCompletions(testCommand, 'fish');
    expect(script).toContain('# fish completion for myapp');
    expect(script).toContain('complete -c myapp');
  });

  test('includes flags with descriptions', () => {
    const script = generateCompletions(testCommand, 'fish');
    expect(script).toContain("-l verbose -d 'Verbose output'");
    expect(script).toContain('-s v');
    expect(script).toContain('-l port');
  });

  test('includes subcommands', () => {
    const script = generateCompletions(testCommand, 'fish');
    expect(script).toContain("-a 'serve' -d 'Start server'");
    expect(script).toContain("-a 'build' -d 'Build project'");
  });

  test('includes possible values', () => {
    const script = generateCompletions(testCommand, 'fish');
    expect(script).toContain("'dev staging prod'");
  });

  test('uses -F for filePath hint', () => {
    const script = generateCompletions(testCommand, 'fish');
    expect(script).toContain('-F');
  });

  test('uses condition for subcommand scoping', () => {
    const script = generateCompletions(testCommand, 'fish');
    expect(script).toContain('__fish_seen_subcommand_from');
  });

  test('excludes hidden args', () => {
    const script = generateCompletions(testCommand, 'fish');
    expect(script).not.toContain('secret');
  });
});

// ---- PowerShell ----

describe('powershell completion', () => {
  test('generates valid powershell script', () => {
    const script = generateCompletions(testCommand, 'powershell');
    expect(script).toContain("Register-ArgumentCompleter -CommandName 'myapp'");
    expect(script).toContain('CompletionResult');
  });

  test('includes flags', () => {
    const script = generateCompletions(testCommand, 'powershell');
    expect(script).toContain("'--verbose'");
    expect(script).toContain("'-v'");
    expect(script).toContain("'--port'");
  });

  test('includes subcommands', () => {
    const script = generateCompletions(testCommand, 'powershell');
    expect(script).toContain("'serve'");
    expect(script).toContain("'build'");
  });
});

// ---- No subcommands command ----

describe('completion for simple command (no subcommands)', () => {
  const simpleCmd = defineCommand({
    meta: { name: 'simple' },
    args: {
      name: { type: 'string', short: 'n', description: 'Your name' },
      count: { type: 'number', short: 'c', description: 'Count' },
    },
  });

  test('bash generates without subcommand dispatch', () => {
    const script = generateCompletions(simpleCmd, 'bash');
    expect(script).toContain('_simple()');
    expect(script).toContain('--name');
    expect(script).not.toContain('subcmd');
  });

  test('fish generates without subcommand conditions', () => {
    const script = generateCompletions(simpleCmd, 'fish');
    expect(script).toContain('-l name');
    expect(script).not.toContain('__fish_seen_subcommand_from');
  });
});

// ---- withCompletions ----

describe('withCompletions', () => {
  test('injects completions subcommand', () => {
    const root = defineCommand({
      meta: { name: 'myapp' },
      subCommands: {
        serve: defineCommand({ meta: { name: 'serve' }, run() {} }),
      },
    });

    const wrapped = withCompletions(root);
    expect(wrapped.subCommands).toBeDefined();
    expect(wrapped.subCommands!['completions']).toBeDefined();
    expect(wrapped.subCommands!['serve']).toBeDefined();
  });

  test('completions subcommand outputs bash script', async () => {
    const root = defineCommand({
      meta: { name: 'myapp', version: '1.0.0' },
      args: { verbose: { type: 'boolean', description: 'Verbose' } },
    });

    const { stdout } = await runCli(withCompletions(root), ['completions', 'bash']);
    expect(stdout).toContain('# bash completion for myapp');
    expect(stdout).toContain('complete -o default');
    expect(stdout).toContain('--verbose');
  });

  test('completions subcommand outputs zsh script', async () => {
    const root = defineCommand({
      meta: { name: 'myapp' },
      args: { port: { type: 'number', short: 'p', description: 'Port' } },
    });

    const { stdout } = await runCli(withCompletions(root), ['completions', 'zsh']);
    expect(stdout).toContain('#compdef myapp');
    expect(stdout).toContain('--port');
  });

  test('completions subcommand errors on invalid shell', async () => {
    const root = defineCommand({ meta: { name: 'myapp' } });

    const { plainStderr, exitCode } = await runCli(withCompletions(root), [
      'completions',
      'invalid',
    ]);
    expect(plainStderr).toContain("invalid value 'invalid' for '<SHELL>'");
    expect(plainStderr).toContain('[possible values: bash, zsh, fish, powershell, elvish, nushell]');
    expect(exitCode).toBe(2);
  });

  test('preserves existing subcommands', () => {
    const root = defineCommand({
      meta: { name: 'myapp' },
      subCommands: {
        serve: defineCommand({ meta: { name: 'serve' } }),
        build: defineCommand({ meta: { name: 'build' } }),
      },
    });

    const wrapped = withCompletions(root);
    expect(Object.keys(wrapped.subCommands!)).toContain('serve');
    expect(Object.keys(wrapped.subCommands!)).toContain('build');
    expect(Object.keys(wrapped.subCommands!)).toContain('completions');
  });

  test('works on command with no existing subcommands', () => {
    const root = defineCommand({
      meta: { name: 'myapp' },
      args: { name: { type: 'string' } },
    });

    const wrapped = withCompletions(root);
    expect(wrapped.subCommands!['completions']).toBeDefined();
  });
});

// ---- Elvish and nushell ----

describe('elvish completions', () => {
  const command: CommandDef = {
    meta: { name: 'demo', version: '1.0', description: 'A demo' },
    args: {
      verbose: { type: 'boolean', short: 'v', description: 'Verbose' },
      secret: { type: 'string', hidden: true },
    },
    subCommands: {
      serve: { meta: { name: 'serve', description: 'Serve', aliases: ['s'] } },
      ghost: { meta: { name: 'ghost', hidden: true } },
    },
  };
  const script = generateCompletions(command, 'elvish');

  test('registers an arg completer for the binary', () => {
    expect(script).toContain('set edit:completion:arg-completer[demo] =');
  });

  test('keys each command path with semicolons', () => {
    expect(script).toContain("&'demo'=");
    expect(script).toContain("&'demo;serve'=");
  });

  test('emits both flag forms with their help', () => {
    expect(script).toContain("cand -v 'Verbose'");
    expect(script).toContain("cand --verbose 'Verbose'");
  });

  test('includes subcommand aliases', () => {
    expect(script).toContain("cand s 'Serve'");
  });

  test('never suggests hidden args or commands', () => {
    expect(script).not.toContain('--secret');
    expect(script).not.toContain("cand ghost");
  });

  test('but a hidden command still completes its own flags once typed', () => {
    // Matching clap: hidden only means unlisted, the command still works.
    expect(script).toContain("&'demo;ghost'=");
  });
});

describe('nushell completions', () => {
  const command: CommandDef = {
    meta: { name: 'demo', version: '1.0', description: 'A demo' },
    args: {
      verbose: { type: 'boolean', short: 'v', description: 'Verbose' },
      out: { type: 'string', valueHint: 'filePath' },
      dir: { type: 'string', valueHint: 'dirPath' },
      file: { type: 'positional', required: true, description: 'Input' },
    },
    subCommands: {
      serve: {
        meta: { name: 'serve', description: 'Serve' },
        args: { mode: { type: 'string', valueParser: ['fast', 'safe'] } },
      },
    },
  };
  const script = generateCompletions(command, 'nushell');

  test('wraps the externs in a module', () => {
    expect(script).toContain('module completions {');
    expect(script).toContain('export use completions *');
  });

  test('declares one extern per command path', () => {
    expect(script).toContain('export extern "demo" [');
    expect(script).toContain('export extern "demo serve" [');
  });

  test('pairs short and long flag forms', () => {
    expect(script).toContain('--verbose(-v)');
  });

  test('maps value hints to nushell types', () => {
    expect(script).toContain('--out: path');
    expect(script).toContain('--dir: directory');
  });

  test('includes positionals with their optionality', () => {
    expect(script).toContain('file: string # Input');
  });

  test('scopes a value completer to its command path', () => {
    expect(script).toContain('def "nu-complete demo serve mode" []');
    expect(script).toContain('[ "fast" "safe" ]');
  });
});
