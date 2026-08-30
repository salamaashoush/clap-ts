/**
 * Tests for config file loading and its place in the precedence chain.
 */

import { describe, test, expect, afterEach, beforeEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig, configOptions } from '../config.js';
import { defineCommand } from '../runner.js';
import { runCli, captureArgs } from '../testing.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'clap-ts-config-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env['DEMO_PORT'];
});

describe('loadConfig', () => {
  test('finds .<name>rc in the starting directory', () => {
    writeFileSync(join(dir, '.demorc'), JSON.stringify({ port: 1234 }));
    const loaded = loadConfig('demo', { cwd: dir, stopAt: dir });
    expect(loaded?.values).toEqual({ port: 1234 });
    expect(loaded?.path).toBe(join(dir, '.demorc'));
  });

  test('walks up to a parent directory', () => {
    const nested = join(dir, 'a', 'b');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(dir, 'demo.config.json'), JSON.stringify({ port: 7 }));
    expect(loadConfig('demo', { cwd: nested, stopAt: dir })?.values).toEqual({ port: 7 });
  });

  test('searchParents false stays in one directory', () => {
    const nested = join(dir, 'a');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(dir, '.demorc'), JSON.stringify({ port: 7 }));
    expect(loadConfig('demo', { cwd: nested, searchParents: false })).toBeUndefined();
  });

  test('reads a package.json section', () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', demo: { port: 99 } }));
    expect(loadConfig('demo', { cwd: dir, stopAt: dir })?.values).toEqual({ port: 99 });
  });

  test('ignores package.json when the key is null', () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ demo: { port: 99 } }));
    expect(loadConfig('demo', { cwd: dir, stopAt: dir, packageJsonKey: null })).toBeUndefined();
  });

  test('returns undefined when nothing is found', () => {
    expect(loadConfig('demo', { cwd: dir, stopAt: dir })).toBeUndefined();
  });

  test('an explicit path skips the search', () => {
    const file = join(dir, 'custom.json');
    writeFileSync(file, JSON.stringify({ port: 5 }));
    expect(loadConfig('demo', { path: file })?.values).toEqual({ port: 5 });
  });

  test('a broken file is loud, not silently skipped', () => {
    writeFileSync(join(dir, '.demorc'), '{ not json');
    expect(() => loadConfig('demo', { cwd: dir, stopAt: dir })).toThrow('cannot parse config');
  });

  test('a non-object config is rejected', () => {
    writeFileSync(join(dir, '.demorc'), '[1,2,3]');
    expect(() => loadConfig('demo', { cwd: dir, stopAt: dir })).toThrow('must be an object');
  });

  test('a custom parser handles other formats', () => {
    writeFileSync(join(dir, '.demorc'), 'port = 8080');
    const loaded = loadConfig('demo', {
      cwd: dir,
      stopAt: dir,
      parse: (text) => {
        const [key, value] = text.split('=').map((s) => s.trim());
        return { [key!]: Number(value) };
      },
    });
    expect(loaded?.values).toEqual({ port: 8080 });
  });
});

describe('config in the precedence chain', () => {
  const main = defineCommand({
    meta: { name: 'demo' },
    args: {
      port: { type: 'number', default: 3000, env: 'DEMO_PORT' },
      host: { type: 'string' },
      tags: { type: 'string', action: 'append' },
    },
    run() {},
  });

  test('config beats a default', async () => {
    const { args } = await captureArgs(main, [], { config: { port: 8080 } });
    expect(args['port']).toBe(8080);
  });

  test('the command line beats config', async () => {
    const { args } = await captureArgs(main, ['--port', '1'], { config: { port: 8080 } });
    expect(args['port']).toBe(1);
  });

  test('an env variable beats config', async () => {
    process.env['DEMO_PORT'] = '2';
    const { args } = await captureArgs(main, [], { config: { port: 8080 } });
    expect(args['port']).toBe(2);
  });

  test('the source is reported as config', async () => {
    let source: string | undefined;
    const probe = defineCommand({
      meta: { name: 'demo' },
      args: { port: { type: 'number', default: 3000 } },
      run({ valueSources }) {
        source = valueSources.get('port');
      },
    });
    await runCli(probe, [], { config: { port: 8080 } });
    expect(source).toBe('config');
  });

  test('config values are coerced to the arg type', async () => {
    const { args } = await captureArgs(main, [], { config: { port: '8080', host: 'h' } });
    expect(args['port']).toBe(8080);
    expect(args['host']).toBe('h');
  });

  test('an array in config feeds an append arg', async () => {
    const { args } = await captureArgs(main, [], { config: { tags: ['a', 'b'] } });
    expect(args['tags']).toEqual(['a', 'b']);
  });

  test('an unknown config key is ignored', async () => {
    const { args } = await captureArgs(main, [], { config: { nonsense: 1, port: 5 } });
    expect(args['port']).toBe(5);
    expect(args['nonsense']).toBeUndefined();
  });

  test('a bad config value reports where it came from', async () => {
    const { plainStderr, exitCode } = await runCli(main, [], { config: { port: 'abc' } });
    expect(plainStderr).toContain('config:--port');
    expect(exitCode).toBe(2);
  });
});

describe('config scoped by subcommand', () => {
  const main = defineCommand({
    meta: { name: 'demo' },
    args: { verbose: { type: 'boolean', global: true } },
    subCommands: {
      serve: defineCommand({
        meta: { name: 'serve' },
        args: { port: { type: 'number', default: 3000 } },
        run() {},
      }),
    },
  });

  test('a section named for the subcommand applies to it', async () => {
    const { args } = await captureArgs(main, ['serve'], {
      config: { serve: { port: 8080 } },
    });
    expect(args['port']).toBe(8080);
  });

  test('a scalar at the root stays in scope for subcommands', async () => {
    const { args } = await captureArgs(main, ['serve'], { config: { verbose: true } });
    expect(args['verbose']).toBe(true);
  });

  test('the deeper section wins over the root', async () => {
    const { args } = await captureArgs(main, ['serve'], {
      config: { port: 1, serve: { port: 2 } },
    });
    expect(args['port']).toBe(2);
  });
});

describe('configOptions', () => {
  test('hands back a thunk that reads the file', () => {
    writeFileSync(join(dir, '.demorc'), JSON.stringify({ port: 1 }));
    expect(configOptions('demo', { cwd: dir, stopAt: dir }).config()).toEqual({ port: 1 });
  });

  test('the thunk yields undefined when nothing is found', () => {
    expect(configOptions('missing', { cwd: dir, stopAt: dir }).config()).toBeUndefined();
  });

  test('the thunk searches at most once', () => {
    writeFileSync(join(dir, '.demorc'), JSON.stringify({ port: 1 }));
    const { config } = configOptions('demo', { cwd: dir, stopAt: dir });
    const first = config();
    rmSync(join(dir, '.demorc'));
    expect(config()).toBe(first);
  });
});

describe('lazy config loading', () => {
  const main = defineCommand({
    meta: { name: 'demo' },
    args: { port: { type: 'number', default: 3000 } },
    run() {},
  });

  test('the thunk is skipped when the command line answered everything', async () => {
    let loads = 0;
    await runCli(main, ['--port', '9'], {
      config: () => {
        loads++;
        return { port: 1 };
      },
    });
    expect(loads).toBe(0);
  });

  test('the thunk runs when an argument is still on its default', async () => {
    let loads = 0;
    const { args } = await captureArgs(main, [], {
      config: () => {
        loads++;
        return { port: 1 };
      },
    });
    expect(loads).toBe(1);
    expect(args['port']).toBe(1);
  });
});

describe('stopAtProjectRoot', () => {
  test('stops the walk at the directory holding package.json', () => {
    const nested = join(dir, 'proj', 'src', 'deep');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(dir, '.demorc'), JSON.stringify({ port: 1 }));
    writeFileSync(join(dir, 'proj', 'package.json'), JSON.stringify({ name: 'p' }));

    // Without the option the walk reaches the outer .demorc.
    expect(loadConfig('demo', { cwd: nested, stopAt: dir })?.values).toEqual({ port: 1 });
    // With it, the walk stops at proj and finds nothing.
    expect(
      loadConfig('demo', { cwd: nested, stopAt: dir, stopAtProjectRoot: true }),
    ).toBeUndefined();
  });

  test('stops at a .git directory too', () => {
    const nested = join(dir, 'repo', 'src');
    mkdirSync(nested, { recursive: true });
    mkdirSync(join(dir, 'repo', '.git'), { recursive: true });
    writeFileSync(join(dir, '.demorc'), JSON.stringify({ port: 1 }));
    expect(
      loadConfig('demo', { cwd: nested, stopAt: dir, stopAtProjectRoot: true }),
    ).toBeUndefined();
  });
});
