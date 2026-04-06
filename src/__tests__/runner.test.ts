/**
 * Runner tests - tests for defineCommand, defineArgs, runCommand, and subcommand resolution.
 */

import { describe, test, expect } from 'bun:test';
import { defineCommand, defineArgs, defineArg, runCommand, runMain } from '../runner.js';
import type { ArgsDef, ParsedArgs } from '../types.js';

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

describe('subcommand resolution via runMain', () => {
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

    await runMain(root, { argv: ['serve', '--port', '8080'], exit: false });
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

    await runMain(root, { argv: ['s'], exit: false });
    expect(ranSubcommand).toBe(true);
  });
});
