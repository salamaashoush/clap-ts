/**
 * Runner tests: defineCommand and friends, subcommand dispatch, global argument
 * inheritance, lazy subcommands and the introspection helpers.
 */

import { describe, test, expect } from 'bun:test';
import { defineCommand, defineArgs, defineArg, runCommand } from '../runner.js';
import { parseArgs, subCommandsOf, hasSubCommands } from '../parser.js';
import { validate } from '../validation.js';
import { renderHelp } from '../help.js';
import { runCli } from '../testing.js';
import type { ArgsDef, CommandDef, ParsedArgs } from '../types.js';

// ---- defineCommand ----

describe('defineCommand', () => {
  test('returns same object', () => {
    const input = {
      meta: { name: 'test', version: '1.0.0' },
      args: { verbose: { type: 'boolean' as const } },
    };
    const result = defineCommand(input);
    expect(result).toBe(input);
  });

  test('preserves type inference on args', () => {
    const cmd = defineCommand({
      meta: { name: 'test' },
      args: {
        port: { type: 'number' as const, default: 3000 },
        name: { type: 'string' as const },
        verbose: { type: 'boolean' as const },
      },
    });
    // Type-level check: cmd.args should be defined
    expect(cmd.args).toBeDefined();
    expect(cmd.args!.port.type).toBe('number');
    expect(cmd.args!.name.type).toBe('string');
    expect(cmd.args!.verbose.type).toBe('boolean');
  });
});

// ---- defineArgs ----

describe('defineArgs', () => {
  test('returns same object with preserved types', () => {
    const input = {
      env: { type: 'string' as const, valueParser: ['dev', 'staging'] as const },
      verbose: { type: 'boolean' as const },
    };
    const result = defineArgs(input);
    expect(result).toBe(input);
  });
});

// ---- defineArg ----

describe('defineArg', () => {
  test('returns same object', () => {
    const input = { type: 'number' as const, short: 'p', default: 3003 };
    const result = defineArg(input);
    expect(result).toBe(input);
  });
});

// ---- runCommand ----

describe('runCommand', () => {
  test('calls setup -> run -> cleanup in order', async () => {
    const order: string[] = [];
    const cmd = defineCommand({
      meta: { name: 'test' },
      args: {},
      setup() {
        order.push('setup');
      },
      run() {
        order.push('run');
      },
      cleanup() {
        order.push('cleanup');
      },
    });

    await runCommand(cmd, {} as ParsedArgs<ArgsDef>);
    expect(order).toEqual(['setup', 'run', 'cleanup']);
  });

  test('calls cleanup even on run error', async () => {
    const order: string[] = [];
    const cmd = defineCommand({
      meta: { name: 'test' },
      args: {},
      run() {
        order.push('run');
        throw new Error('run failed');
      },
      cleanup() {
        order.push('cleanup');
      },
    });

    await expect(runCommand(cmd, {} as ParsedArgs<ArgsDef>)).rejects.toThrow('run failed');
    expect(order).toEqual(['run', 'cleanup']);
  });

  test('cleanup error does not mask run error', async () => {
    const cmd = defineCommand({
      meta: { name: 'test' },
      args: {},
      run() {
        throw new Error('run failed');
      },
      cleanup() {
        throw new Error('cleanup failed');
      },
    });

    await expect(runCommand(cmd, {} as ParsedArgs<ArgsDef>)).rejects.toThrow('run failed');
  });

  test('cleanup error thrown when run succeeds', async () => {
    const cmd = defineCommand({
      meta: { name: 'test' },
      args: {},
      run() {
        // success
      },
      cleanup() {
        throw new Error('cleanup failed');
      },
    });

    await expect(runCommand(cmd, {} as ParsedArgs<ArgsDef>)).rejects.toThrow('cleanup failed');
  });

  test('works with no lifecycle hooks', async () => {
    const cmd = defineCommand({
      meta: { name: 'test' },
      args: {},
    });

    // Should not throw
    await runCommand(cmd, {} as ParsedArgs<ArgsDef>);
  });

  test('passes args to run handler', async () => {
    let receivedArgs: unknown;
    const cmd = defineCommand({
      meta: { name: 'test' },
      args: { port: { type: 'number' as const } },
      run({ args }) {
        receivedArgs = args;
      },
    });

    await runCommand(cmd, { port: 3003 } as any);
    expect((receivedArgs as { port: number }).port).toBe(3003);
  });
});

// ---- Subcommand Resolution ----

describe('subcommand resolution', () => {
  test('resolves subcommand and runs it', async () => {
    let ranSubcommand = false;
    const root = defineCommand({
      meta: { name: 'app' },
      subCommands: {
        serve: defineCommand({
          meta: { name: 'serve' },
          args: { port: { type: 'number' as const, default: 3000 } },
          run({ args }) {
            ranSubcommand = true;
            expect(args.port).toBe(8080);
          },
        }),
      },
    });

    await runCli(root, ['serve', '--port', '8080']);
    expect(ranSubcommand).toBe(true);
  });

  test('resolves subcommand by alias', async () => {
    let ranSubcommand = false;
    const root = defineCommand({
      meta: { name: 'app' },
      subCommands: {
        serve: defineCommand({
          meta: { name: 'serve', aliases: ['s'] },
          run() {
            ranSubcommand = true;
          },
        }),
      },
    });

    await runCli(root, ['s']);
    expect(ranSubcommand).toBe(true);
  });
});

// ---- Dispatch regressions ----

describe('flags before a subcommand', () => {
  test('parent flags do not block dispatch', async () => {
    const seen: (number | undefined)[] = [];
    const root = defineCommand({
      meta: { name: 'app' },
      args: { verbose: { type: 'boolean', short: 'v' } },
      subCommands: {
        serve: defineCommand({
          meta: { name: 'serve' },
          args: { port: { type: 'number', default: 80 } },
          run({ args }) {
            seen.push(args.port);
          },
        }),
      },
    });

    for (const argv of [['serve'], ['--verbose', 'serve'], ['-v', 'serve']]) {
      await runCli(root, argv);
    }
    expect(seen).toEqual([80, 80, 80]);
  });
});

describe('global args inheritance', () => {
  test('a global on an intermediate command reaches a grandchild', async () => {
    let received: Record<string, unknown> = {};
    const leaf = defineCommand({
      meta: { name: 'leaf' },
      run({ args }) {
        received = args as Record<string, unknown>;
      },
    });
    const mid = defineCommand({
      meta: { name: 'mid' },
      args: { color: { type: 'string', global: true } },
      subCommands: { leaf },
    });
    const root = defineCommand({
      meta: { name: 'app' },
      args: { debug: { type: 'boolean', global: true } },
      subCommands: { mid },
    });

    await runCli(root, ['mid', 'leaf', '--color', 'red', '--debug']);
    expect(received['color']).toBe('red');
    expect(received['debug']).toBe(true);
  });
});

describe('error output names the failing command', () => {
  const root = defineCommand({
    meta: { name: 'app' },
    args: { verbose: { type: 'boolean' } },
    subCommands: {
      serve: defineCommand({
        meta: { name: 'serve' },
        args: { port: { type: 'number', required: true } },
        run() {},
      }),
    },
  });

  test('missing required arg shows the subcommand usage', async () => {
    const { plainStderr, exitCode } = await runCli(root, ['serve']);
    expect(plainStderr).toContain('Usage: app serve');
    expect(plainStderr).not.toContain('Usage: app [OPTIONS]');
    expect(exitCode).toBe(2);
  });

  test('unknown flag shows the subcommand usage and a suggestion', async () => {
    const { plainStderr } = await runCli(root, ['serve', '--prot', '3']);
    expect(plainStderr).toContain('Usage: app serve');
    expect(plainStderr).toContain("a similar argument exists: '--port'");
  });
});

describe('low-level API accepts a defineCommand result', () => {
  test('parseArgs, validate and renderHelp take a command with typed hooks', () => {
    // A regression guard for hook contravariance: CommandDef<{port: ...}> has to
    // stay assignable to the CommandDef<ArgsDef> these three declare. This is a
    // compile-time assertion; tsconfig.test.json is what enforces it.
    const command = defineCommand({
      meta: { name: 'tool' },
      args: { port: { type: 'number', default: 3000 } },
      setup() {},
      run({ args }) {
        void args.port;
      },
      cleanup() {},
    });

    const result = parseArgs(['--port', '8080'], command);
    validate(result, command);

    expect(result.args.port).toBe(8080);
    expect(renderHelp(command)).toContain('--port');
  });
});

describe('global arg values reach the running command', () => {
  const leaf = defineCommand({
    meta: { name: 'leaf' },
    args: { local: { type: 'string' } },
    run({ args }) {
      seen = args as Record<string, unknown>;
    },
  });
  const mid = defineCommand({
    meta: { name: 'mid' },
    args: { color: { type: 'string', global: true } },
    subCommands: { leaf },
  });
  const root = defineCommand({
    meta: { name: 'app' },
    args: { verbose: { type: 'boolean', short: 'v', global: true } },
    subCommands: { mid },
  });
  let seen: Record<string, unknown> = {};

  test('a global given before the subcommand still arrives', async () => {
    seen = {};
    await runCli(root, ['--verbose', 'mid', 'leaf']);
    expect(seen['verbose']).toBe(true);
  });

  test('a global from an intermediate level arrives too', async () => {
    seen = {};
    await runCli(root, ['-v', 'mid', '--color', 'red', 'leaf']);
    expect(seen['verbose']).toBe(true);
    expect(seen['color']).toBe('red');
  });

  test('the deepest occurrence wins', async () => {
    seen = {};
    await runCli(root, ['mid', '--color', 'red', 'leaf', '--color', 'blue']);
    expect(seen['color']).toBe('blue');
  });

  test('a required global satisfied at an ancestor level passes validation', async () => {
    let ran = false;
    const child = defineCommand({ meta: { name: 'child' }, run() { ran = true; } });
    const parent = defineCommand({
      meta: { name: 'parent' },
      args: { token: { type: 'string', global: true, required: true } },
      subCommands: { child },
    });
    await runCli(parent, ['--token', 'abc', 'child']);
    expect(ran).toBe(true);
  });
});

describe('lazy subcommands', () => {
  test('the thunk runs only when a subcommand is actually needed', async () => {
    let built = 0;
    const root = defineCommand({
      meta: { name: 'app', version: '1.0' },
      lazySubCommands: () => {
        built++;
        return { serve: defineCommand({ meta: { name: 'serve' }, run() {} }) };
      },
      args: { verbose: { type: 'boolean' } },
      run() {},
    });

    // A plain flag parse never touches the subcommand tree.
    await runCli(root, ['--verbose']);
    expect(built).toBe(0);

    await runCli(root, ['serve']);
    expect(built).toBe(1);
  });

  test('the thunk is built at most once per command', () => {
    let built = 0;
    const root: CommandDef = {
      meta: { name: 'app' },
      lazySubCommands: () => {
        built++;
        return { serve: { meta: { name: 'serve' } } };
      },
    };
    expect(parseArgs(['serve'], root).subCommand).toBe('serve');
    expect(parseArgs(['serve'], root).subCommand).toBe('serve');
    expect(built).toBe(1);
  });

  test('eager subCommands win a name collision and both are reachable', () => {
    const root: CommandDef = {
      meta: { name: 'app' },
      subCommands: { serve: { meta: { name: 'serve-eager' } } },
      lazySubCommands: () => ({
        serve: { meta: { name: 'serve-lazy' } },
        build: { meta: { name: 'build' } },
      }),
    };
    expect(parseArgs(['serve'], root).subCommand).toBe('serve');
    expect(parseArgs(['build'], root).subCommand).toBe('build');
    expect(renderHelp(root)).toContain('serve');
    expect(renderHelp(root)).toContain('build');
  });
});

describe('externalSubcommandValueParser', () => {
  test('each external argument goes through the parser', async () => {
    let received: readonly string[] = [];
    const root = defineCommand({
      meta: { name: 'git', allowExternalSubcommands: true },
      externalSubcommandValueParser: (v) => v.toUpperCase(),
      run({ rawArgs }) {
        received = rawArgs;
      },
    });
    await runCli(root, ['my-plugin', 'a', 'b']);
    expect(received).toEqual(['A', 'B']);
  });

  test('a throwing parser surfaces as a parse error', async () => {
    const root = defineCommand({
      meta: { name: 'git', allowExternalSubcommands: true },
      externalSubcommandValueParser: () => {
        throw new Error('nope');
      },
      run() {},
    });
    const { plainStderr } = await runCli(root, ['plugin', 'x']);
    expect(plainStderr).toContain("invalid value 'x': nope");
  });
});

describe('public introspection helpers', () => {
  test('subCommandsOf resolves lazy and eager alike', () => {
    const eager: CommandDef = { meta: { name: 'a' }, subCommands: { x: { meta: { name: 'x' } } } };
    const lazy: CommandDef = { meta: { name: 'b' }, lazySubCommands: () => ({ y: { meta: { name: 'y' } } }) };
    const none: CommandDef = { meta: { name: 'c' } };
    expect(Object.keys(subCommandsOf(eager))).toEqual(['x']);
    expect(Object.keys(subCommandsOf(lazy))).toEqual(['y']);
    expect(Object.keys(subCommandsOf(none))).toEqual([]);
  });

  test('hasSubCommands answers without running the thunk', () => {
    let built = 0;
    const lazy: CommandDef = {
      meta: { name: 'b' },
      lazySubCommands: () => {
        built++;
        return { y: { meta: { name: 'y' } } };
      },
    };
    expect(hasSubCommands(lazy)).toBe(true);
    expect(built).toBe(0);
    expect(hasSubCommands({ meta: { name: 'c' } })).toBe(false);
  });
});
