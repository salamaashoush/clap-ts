/**
 * Tests for installing completions and man pages.
 */

import { describe, test, expect, afterEach, beforeEach } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { completionTarget, installCompletions, installManPages, withInstallers } from '../install.js';
import { defineCommand } from '../runner.js';
import { runCli } from '../testing.js';
import type { Shell } from '../types.js';

const main = defineCommand({
  meta: { name: 'demo', version: '1.0', description: 'A demo' },
  args: { verbose: { type: 'boolean', short: 'v', description: 'Verbose' } },
  subCommands: { serve: defineCommand({ meta: { name: 'serve', description: 'Serve' }, run() {} }) },
  run() {},
});

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'clap-ts-install-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('completionTarget', () => {
  test('names the file the way each shell expects', () => {
    expect(completionTarget('bash', 'demo').file).toBe('demo');
    expect(completionTarget('zsh', 'demo').file).toBe('_demo');
    expect(completionTarget('fish', 'demo').file).toBe('demo.fish');
    expect(completionTarget('nushell', 'demo').file).toBe('demo.nu');
  });

  test('reports a manual step only where sourcing is not automatic', () => {
    expect(completionTarget('bash', 'demo').manualStep).toBeUndefined();
    expect(completionTarget('fish', 'demo').manualStep).toBeUndefined();
    expect(completionTarget('zsh', 'demo').manualStep).toContain('fpath');
    expect(completionTarget('powershell', 'demo').manualStep).toContain('$PROFILE');
  });
});

describe('installCompletions', () => {
  test('writes the script and reports the path', () => {
    const result = installCompletions(main, 'bash', { dir });
    expect(result.paths).toEqual([join(dir, 'demo')]);
    expect(readFileSync(result.paths[0]!, 'utf8')).toContain('# bash completion for demo');
  });

  test('a dry run reports the path and writes nothing', () => {
    const result = installCompletions(main, 'bash', { dir: join(dir, 'nested'), dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(existsSync(join(dir, 'nested'))).toBe(false);
  });

  test('creates the directory when it is missing', () => {
    installCompletions(main, 'fish', { dir: join(dir, 'a', 'b') });
    expect(existsSync(join(dir, 'a', 'b', 'demo.fish'))).toBe(true);
  });

  test('every shell installs', () => {
    for (const shell of ['bash', 'zsh', 'fish', 'powershell', 'elvish', 'nushell'] as Shell[]) {
      const result = installCompletions(main, shell, { dir: join(dir, shell) });
      expect(readFileSync(result.paths[0]!, 'utf8').length).toBeGreaterThan(0);
    }
  });
});

describe('installManPages', () => {
  test('writes one page per command', () => {
    const result = installManPages(main, { dir });
    expect(readdirSync(dir).sort()).toEqual(['demo-serve.1', 'demo.1']);
    expect(result.paths).toHaveLength(2);
    expect(readFileSync(join(dir, 'demo.1'), 'utf8')).toContain('.TH demo 1');
  });

  test('a dry run writes nothing', () => {
    installManPages(main, { dir: join(dir, 'nested'), dryRun: true });
    expect(existsSync(join(dir, 'nested'))).toBe(false);
  });
});

describe('withInstallers', () => {
  const wrapped = withInstallers(main);

  test('printing still works', async () => {
    const { stdout } = await runCli(wrapped, ['completions', 'bash']);
    expect(stdout).toContain('# bash completion for demo');
  });

  test('man prints roff', async () => {
    const { stdout } = await runCli(wrapped, ['man']);
    expect(stdout).toContain('.TH demo 1');
  });

  test('install reports what it would do', async () => {
    const { stdout, exitCode } = await runCli(wrapped, [
      'completions',
      'install',
      'zsh',
      '--dryRun',
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('would write');
    expect(stdout).toContain('_demo');
    expect(stdout).toContain('note:');
  });

  test('an unknown shell is rejected with the valid ones listed', async () => {
    const { plainStderr, exitCode } = await runCli(wrapped, ['completions', 'nope']);
    expect(exitCode).toBe(2);
    expect(plainStderr).toContain('possible values: bash, zsh, fish, powershell, elvish, nushell');
  });

  test('the original subcommands survive', async () => {
    expect(wrapped.subCommands!['serve']).toBeDefined();
  });
});
