/**
 * Tests for deprecating arguments and commands.
 */

import { describe, test, expect } from 'bun:test';
import { parseArgs } from '../parser.js';
import { renderHelp } from '../help.js';
import { defineCommand } from '../runner.js';
import { runCli, captureArgs, stripAnsi } from '../testing.js';
import type { CommandDef } from '../types.js';

describe('deprecated arguments', () => {
  const command = defineCommand({
    meta: { name: 'app' },
    args: {
      old: { type: 'string', deprecated: true, description: 'Old flag' },
      stale: { type: 'string', deprecated: 'no longer read', description: 'Stale flag' },
      current: { type: 'string', description: 'Current flag' },
      legacy: { type: 'string', deprecated: true, replacedBy: 'current' },
    },
    run() {},
  });

  test('using one warns on stderr', async () => {
    const { plainStderr } = await runCli(command, ['--old', 'x']);
    expect(plainStderr).toContain("warning: '--old' is deprecated");
  });

  test('a string deprecation carries its reason', async () => {
    const { plainStderr } = await runCli(command, ['--stale', 'x']);
    expect(plainStderr).toContain("'--stale' is deprecated: no longer read");
  });

  test('replacedBy names the replacement in the warning', async () => {
    const { plainStderr } = await runCli(command, ['--legacy', 'x']);
    expect(plainStderr).toContain("use '--current' instead");
  });

  test('replacedBy forwards the value', async () => {
    const { args } = await captureArgs(command, ['--legacy', 'x']);
    expect(args['current']).toBe('x');
  });

  test('an explicit replacement wins over the forwarded value', async () => {
    const { args } = await captureArgs(command, ['--legacy', 'old', '--current', 'new']);
    expect(args['current']).toBe('new');
  });

  test('a current argument warns about nothing', async () => {
    const { plainStderr } = await runCli(command, ['--current', 'x']);
    expect(plainStderr).toBe('');
  });

  test('the warning does not fail the run', async () => {
    const { exitCode } = await runCli(command, ['--old', 'x']);
    expect(exitCode).toBe(0);
  });

  test('it warns once even when repeated', () => {
    const appendable: CommandDef = {
      meta: { name: 'app' },
      args: { old: { type: 'string', action: 'append', deprecated: true } },
    };
    expect(parseArgs(['--old', 'a', '--old', 'b'], appendable).warnings).toHaveLength(1);
  });

  test('help labels it', () => {
    const help = stripAnsi(renderHelp(command));
    expect(help).toContain('[deprecated]');
    expect(help).toContain('[deprecated: no longer read]');
  });
});

describe('deprecated commands', () => {
  const root = defineCommand({
    meta: { name: 'app' },
    subCommands: {
      publish: defineCommand({ meta: { name: 'publish', description: 'Publish' }, run() {} }),
      push: defineCommand({
        meta: {
          name: 'push',
          description: 'Push',
          deprecated: 'renamed',
          replacedBy: 'publish',
        },
        run() {},
      }),
    },
  });

  test('running one warns', async () => {
    const { plainStderr, exitCode } = await runCli(root, ['push']);
    expect(plainStderr).toContain("warning: 'push' is deprecated: renamed; use 'publish' instead");
    expect(exitCode).toBe(0);
  });

  test('the current command is quiet', async () => {
    expect((await runCli(root, ['publish'])).plainStderr).toBe('');
  });

  test('help labels it in the command list', () => {
    expect(stripAnsi(renderHelp(root))).toContain('[deprecated: renamed]');
  });
});
