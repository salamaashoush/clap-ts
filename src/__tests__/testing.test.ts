/**
 * Tests for the test helpers themselves.
 */

import { describe, test, expect } from 'bun:test';
import { runCli, captureArgs, stripAnsi } from '../testing.js';
import { defineCommand } from '../runner.js';

const main = defineCommand({
  meta: { name: 'demo', version: '1.0.0', description: 'A demo' },
  args: {
    port: { type: 'number', default: 3000, description: 'Port' },
    name: { type: 'string', required: true, description: 'Name' },
  },
  run({ args, stdout }) {
    stdout.write(`hello ${args.name} on ${String(args.port)}\n`);
  },
});

describe('runCli', () => {
  test('captures stdout and a clean exit', async () => {
    const result = await runCli(main, ['--name', 'world']);
    expect(result.stdout).toBe('hello world on 3000\n');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
    expect(result.error).toBeUndefined();
  });

  test('captures a usage error and its exit code', async () => {
    const result = await runCli(main, []);
    expect(result.exitCode).toBe(2);
    expect(result.plainStderr).toContain('the following required arguments were not provided');
    expect(result.plainStderr).toContain('Usage: demo');
    expect(result.stdout).toBe('');
  });

  test('captures help without exiting the process', async () => {
    const result = await runCli(main, ['--help']);
    expect(result.exitCode).toBe(0);
    expect(result.plainStdout).toContain('Usage: demo');
    expect(result.plainStdout).toContain('--port');
  });

  test('captures version', async () => {
    const result = await runCli(main, ['--version']);
    expect(result.plainStdout.trim()).toBe('demo 1.0.0');
  });

  test('reports an error thrown by the handler', async () => {
    const boom = defineCommand({
      meta: { name: 'boom' },
      run() {
        throw new Error('kaboom');
      },
    });
    const result = await runCli(boom, []);
    expect(result.exitCode).toBe(1);
    expect(result.plainStderr).toContain('kaboom');
  });

  test('leaves the real streams alone', async () => {
    const before = process.stdout.write;
    await runCli(main, ['--name', 'x']);
    expect(process.stdout.write).toBe(before);
  });

  test('plain variants strip colour', async () => {
    const coloured = defineCommand({
      meta: { name: 'c', color: 'always', description: 'D' },
      args: { flag: { type: 'boolean', description: 'F' } },
    });
    const result = await runCli(coloured, ['--help']);
    expect(result.stdout).not.toBe(result.plainStdout);
    expect(result.plainStdout).toBe(stripAnsi(result.stdout));
  });
});

describe('captureArgs', () => {
  test('reports the parsed args without running the body', async () => {
    let ran = false;
    const cmd = defineCommand({
      meta: { name: 'x' },
      args: { port: { type: 'number', default: 80 } },
      run() {
        ran = true;
      },
    });
    const { args, result } = await captureArgs(cmd, ['--port', '9']);
    expect(args['port']).toBe(9);
    expect(ran).toBe(false);
    expect(result.exitCode).toBe(0);
  });
});
