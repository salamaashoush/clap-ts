/**
 * Tests for discovering subcommands from installed packages.
 */

import { describe, test, expect, afterEach, beforeEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  discoverPlugins,
  pluginSubCommands,
  nodeModulesPaths,
} from '../plugins.js';
import type { DiscoveredPlugin } from '../plugins.js';
import { defineCommand } from '../runner.js';
import { runCli, captureArgs } from '../testing.js';
import type { CommandDef } from '../types.js';

let dir: string;

function makePackage(root: string, name: string, description?: string): void {
  const target = join(root, 'node_modules', name);
  mkdirSync(target, { recursive: true });
  writeFileSync(
    join(target, 'package.json'),
    JSON.stringify({ name, version: '1.0.0', ...(description === undefined ? {} : { description }) }),
  );
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'clap-ts-plugins-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('nodeModulesPaths', () => {
  test('walks up to the root', () => {
    const paths = nodeModulesPaths('/a/b/c');
    expect(paths[0]).toBe(join('/a/b/c', 'node_modules'));
    expect(paths).toContain(join('/a', 'node_modules'));
  });
});

describe('discoverPlugins', () => {
  test('finds packages matching the prefix', () => {
    makePackage(dir, 'demo-plugin-deploy');
    makePackage(dir, 'demo-plugin-build');
    makePackage(dir, 'unrelated');
    const found = discoverPlugins('demo', { searchPaths: [join(dir, 'node_modules')] });
    expect(found.map((p) => p.name)).toEqual(['build', 'deploy']);
  });

  test('handles scoped packages', () => {
    makePackage(dir, '@acme/demo-plugin-ship');
    const found = discoverPlugins('demo', { searchPaths: [join(dir, 'node_modules')] });
    expect(found).toHaveLength(1);
    expect(found[0]!.name).toBe('ship');
    expect(found[0]!.packageName).toBe('@acme/demo-plugin-ship');
  });

  test('ignores a bare prefix with nothing after it', () => {
    makePackage(dir, 'demo-plugin-');
    expect(discoverPlugins('demo', { searchPaths: [join(dir, 'node_modules')] })).toEqual([]);
  });

  test('a missing search path is not an error', () => {
    expect(discoverPlugins('demo', { searchPaths: [join(dir, 'nope')] })).toEqual([]);
  });

  test('the nearest copy shadows one further up', () => {
    const near = join(dir, 'near');
    const far = join(dir, 'far');
    makePackage(near, 'demo-plugin-x');
    makePackage(far, 'demo-plugin-x');
    const found = discoverPlugins('demo', {
      searchPaths: [join(near, 'node_modules'), join(far, 'node_modules')],
    });
    expect(found).toHaveLength(1);
    expect(found[0]!.dir).toContain('near');
  });

  test('the prefix is configurable', () => {
    makePackage(dir, 'demo-ext-thing');
    const found = discoverPlugins('demo', {
      prefix: 'demo-ext-',
      searchPaths: [join(dir, 'node_modules')],
    });
    expect(found.map((p) => p.name)).toEqual(['thing']);
  });
});

describe('pluginSubCommands', () => {
  function withStub(load: (p: DiscoveredPlugin) => CommandDef<any> | undefined) {
    makePackage(dir, 'demo-plugin-deploy', 'Ship it');
    return pluginSubCommands('demo', { searchPaths: [join(dir, 'node_modules')], load });
  }

  test('names the subcommand after the package suffix', () => {
    const thunk = withStub(() => ({ meta: { name: 'ignored' }, run() {} }));
    expect(Object.keys(thunk())).toEqual(['deploy']);
    expect(thunk()['deploy']!.meta.name).toBe('deploy');
  });

  test("falls back to the package description for help", () => {
    const thunk = withStub(() => ({ meta: { name: 'x' }, run() {} }));
    expect(thunk()['deploy']!.meta.description).toBe('Ship it');
  });

  test("a plugin's own description wins", () => {
    const thunk = withStub(() => ({ meta: { name: 'x', description: 'Own' }, run() {} }));
    expect(thunk()['deploy']!.meta.description).toBe('Own');
  });

  test('a plugin exporting nothing usable is skipped', () => {
    expect(Object.keys(withStub(() => undefined)())).toEqual([]);
  });

  test('a failing plugin names itself in the error', () => {
    const thunk = withStub(() => {
      throw new Error('boom');
    });
    expect(() => thunk()).toThrow("plugin 'demo-plugin-deploy' failed to load: boom");
  });

  test('onError can downgrade a failure to a skip', () => {
    const seen: string[] = [];
    makePackage(dir, 'demo-plugin-deploy');
    const thunk = pluginSubCommands('demo', {
      searchPaths: [join(dir, 'node_modules')],
      load: () => {
        throw new Error('boom');
      },
      onError: (plugin) => seen.push(plugin.name),
    });
    expect(Object.keys(thunk())).toEqual([]);
    expect(seen).toEqual(['deploy']);
  });
});

describe('plugins as lazy subcommands', () => {
  test('discovery is deferred until a token could be a subcommand', async () => {
    makePackage(dir, 'demo-plugin-deploy');
    let loads = 0;
    const main = defineCommand({
      meta: { name: 'demo', version: '1.0' },
      args: { verbose: { type: 'boolean' } },
      run() {},
      lazySubCommands: pluginSubCommands('demo', {
        searchPaths: [join(dir, 'node_modules')],
        load: () => {
          loads++;
          return { meta: { name: 'x' }, run() {} };
        },
      }),
    });

    await runCli(main, ['--verbose']);
    expect(loads).toBe(0);

    await runCli(main, ['deploy']);
    expect(loads).toBe(1);
  });

  test('a discovered plugin runs and parses its own args', async () => {
    makePackage(dir, 'demo-plugin-deploy');
    const main = defineCommand({
      meta: { name: 'demo' },
      lazySubCommands: pluginSubCommands('demo', {
        searchPaths: [join(dir, 'node_modules')],
        load: () => ({
          meta: { name: 'x' },
          args: { target: { type: 'string' } },
          run() {},
        }),
      }),
    });

    const { args } = await captureArgs(main, ['deploy', '--target', 'prod']);
    expect(args['target']).toBe('prod');
  });
});
