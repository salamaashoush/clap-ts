/**
 * Tests for shell completion generation and dynamic completions.
 */

import { describe, test, expect } from 'bun:test';
import { generateCompletions, completeEnv, withCompletions } from '../completions.js';
import { defineCommand, runMain } from '../runner.js';
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

// ---- Dynamic Completion (completeEnv) ----

describe('completeEnv', () => {
  test('returns false when CLAP_COMPLETE not set', () => {
    delete process.env['CLAP_COMPLETE'];
    expect(completeEnv(testCommand)).toBe(false);
  });

  test('returns true and outputs completions when CLAP_COMPLETE is set', () => {
    const original = {
      CLAP_COMPLETE: process.env['CLAP_COMPLETE'],
      COMP_LINE: process.env['COMP_LINE'],
      COMP_POINT: process.env['COMP_POINT'],
    };

    let output = '';
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string) => {
      output += chunk;
      return true;
    }) as typeof process.stdout.write;

    try {
      process.env['CLAP_COMPLETE'] = 'bash';
      process.env['COMP_LINE'] = 'myapp --';
      process.env['COMP_POINT'] = '10';

      const result = completeEnv(testCommand);
      expect(result).toBe(true);
      expect(output).toContain('--verbose');
      expect(output).toContain('--port');
      expect(output).toContain('--env');
      expect(output).not.toContain('--secret'); // hidden
    } finally {
      process.stdout.write = originalWrite;
      for (const [k, v] of Object.entries(original)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  test('completes subcommands', () => {
    const original = {
      CLAP_COMPLETE: process.env['CLAP_COMPLETE'],
      COMP_LINE: process.env['COMP_LINE'],
      COMP_POINT: process.env['COMP_POINT'],
    };

    let output = '';
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string) => {
      output += chunk;
      return true;
    }) as typeof process.stdout.write;

    try {
      process.env['CLAP_COMPLETE'] = 'bash';
      process.env['COMP_LINE'] = 'myapp s';
      process.env['COMP_POINT'] = '7';

      completeEnv(testCommand);
      expect(output).toContain('serve');
    } finally {
      process.stdout.write = originalWrite;
      for (const [k, v] of Object.entries(original)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  test('completes subcommand flags after subcommand', () => {
    const original = {
      CLAP_COMPLETE: process.env['CLAP_COMPLETE'],
      COMP_LINE: process.env['COMP_LINE'],
      COMP_POINT: process.env['COMP_POINT'],
    };

    let output = '';
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string) => {
      output += chunk;
      return true;
    }) as typeof process.stdout.write;

    try {
      process.env['CLAP_COMPLETE'] = 'bash';
      process.env['COMP_LINE'] = 'myapp serve --';
      process.env['COMP_POINT'] = '16';

      completeEnv(testCommand);
      expect(output).toContain('--host');
      expect(output).not.toContain('--port'); // parent flag, not in serve
    } finally {
      process.stdout.write = originalWrite;
      for (const [k, v] of Object.entries(original)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  test('completes enum values after flag', () => {
    const original = {
      CLAP_COMPLETE: process.env['CLAP_COMPLETE'],
      COMP_LINE: process.env['COMP_LINE'],
      COMP_POINT: process.env['COMP_POINT'],
    };

    let output = '';
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string) => {
      output += chunk;
      return true;
    }) as typeof process.stdout.write;

    try {
      process.env['CLAP_COMPLETE'] = 'bash';
      process.env['COMP_LINE'] = 'myapp --env ';
      process.env['COMP_POINT'] = '12';

      completeEnv(testCommand);
      expect(output).toContain('dev');
      expect(output).toContain('staging');
      expect(output).toContain('prod');
    } finally {
      process.stdout.write = originalWrite;
      for (const [k, v] of Object.entries(original)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
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

    let output = '';
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string) => {
      output += chunk;
      return true;
    }) as typeof process.stdout.write;

    try {
      await runMain(withCompletions(root), { argv: ['completions', 'bash'], exit: false });
      expect(output).toContain('# bash completion for myapp');
      expect(output).toContain('complete -o default');
      expect(output).toContain('--verbose');
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  test('completions subcommand outputs zsh script', async () => {
    const root = defineCommand({
      meta: { name: 'myapp' },
      args: { port: { type: 'number', short: 'p', description: 'Port' } },
    });

    let output = '';
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string) => {
      output += chunk;
      return true;
    }) as typeof process.stdout.write;

    try {
      await runMain(withCompletions(root), { argv: ['completions', 'zsh'], exit: false });
      expect(output).toContain('#compdef myapp');
      expect(output).toContain('--port');
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  test('completions subcommand errors on invalid shell', async () => {
    const root = defineCommand({ meta: { name: 'myapp' } });

    let errOutput = '';
    const originalWrite = process.stderr.write;
    const originalExit = process.exit;
    let exitCode: number | undefined;

    process.stderr.write = ((chunk: string) => {
      errOutput += chunk;
      return true;
    }) as typeof process.stderr.write;
    process.exit = ((code: number) => {
      exitCode = code;
      throw new Error('exit');
    }) as typeof process.exit;

    try {
      await runMain(withCompletions(root), { argv: ['completions', 'invalid'], exit: false });
    } catch {
      // expected from mocked process.exit
    } finally {
      process.stderr.write = originalWrite;
      process.exit = originalExit;
    }

    expect(errOutput).toContain("invalid shell 'invalid'");
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
