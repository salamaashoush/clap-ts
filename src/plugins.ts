/**
 * Subcommands discovered from installed packages, the way git, eslint and kubectl
 * grow: drop `my-tool-plugin-deploy` next to the CLI and `my-tool deploy` works.
 *
 * ```ts
 * import { pluginSubCommands } from 'clap-ts/plugins';
 *
 * const main = defineCommand({
 *   meta: { name: 'my-tool' },
 *   lazySubCommands: pluginSubCommands('my-tool'),
 * });
 * ```
 *
 * Pairs with `lazySubCommands`: discovery is a directory scan and each plugin is
 * a module import, so neither happens until a token could be a subcommand.
 */

import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import type { CommandDef } from './types.js';

/** A plugin package found on disk, before it has been loaded. */
export interface DiscoveredPlugin {
  /** Subcommand name, the part after the prefix. */
  readonly name: string;
  /** Full package name. */
  readonly packageName: string;
  /** Directory the package lives in. */
  readonly dir: string;
}

export interface PluginOptions {
  /**
   * Package name prefix. Defaults to `<tool>-plugin-`, so `my-tool-plugin-deploy`
   * becomes the `deploy` subcommand.
   */
  readonly prefix?: string;
  /** Directories to scan. Defaults to every `node_modules` up from `cwd`. */
  readonly searchPaths?: readonly string[];
  /** Where to start the walk (default `process.cwd()`). */
  readonly cwd?: string;
  /** Load a package and return its command. Defaults to a dynamic import of the package. */
  readonly load?: (plugin: DiscoveredPlugin) => CommandDef<any> | undefined;
  /** Called when a plugin fails to load. Defaults to rethrowing. */
  readonly onError?: (plugin: DiscoveredPlugin, error: unknown) => void;
}

/** Every `node_modules` directory from `cwd` up to the filesystem root. */
export function nodeModulesPaths(cwd: string = process.cwd()): string[] {
  const paths: string[] = [];
  let dir = cwd;
  for (;;) {
    if (!dir.endsWith(`${'/'}node_modules`)) {
      paths.push(join(dir, 'node_modules'));
    }
    const parent = join(dir, '..');
    if (parent === dir) {
      return paths;
    }
    dir = parent;
  }
}

/**
 * Find plugin packages without loading any of them.
 *
 * Scoped packages are handled: `@acme/my-tool-plugin-deploy` is found under its
 * scope directory and reported as `deploy`. The nearest copy of a package wins,
 * matching how resolution works.
 */
export function discoverPlugins(tool: string, opts?: PluginOptions): DiscoveredPlugin[] {
  const prefix = opts?.prefix ?? `${tool}-plugin-`;
  const roots = opts?.searchPaths ?? nodeModulesPaths(opts?.cwd);

  const found = new Map<string, DiscoveredPlugin>();

  const consider = (packageName: string, dir: string): void => {
    const base = packageName.includes('/') ? packageName.slice(packageName.indexOf('/') + 1) : packageName;
    if (!base.startsWith(prefix) || base.length === prefix.length) {
      return;
    }
    const name = base.slice(prefix.length);
    // The first root wins, so a local copy shadows one further up.
    if (!found.has(name)) {
      found.set(name, { name, packageName, dir });
    }
  };

  for (const root of roots) {
    let entries: string[];
    try {
      entries = readdirSync(root);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.startsWith('.')) {
        continue;
      }
      if (entry.startsWith('@')) {
        let scoped: string[];
        try {
          scoped = readdirSync(join(root, entry));
        } catch {
          continue;
        }
        for (const inner of scoped) {
          consider(`${entry}/${inner}`, join(root, entry, inner));
        }
        continue;
      }
      consider(entry, join(root, entry));
    }
  }

  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Read a discovered package's own name and description, for help before it loads. */
function packageMeta(plugin: DiscoveredPlugin): { description?: string } {
  const pkgPath = join(plugin.dir, 'package.json');
  if (!existsSync(pkgPath)) {
    return {};
  }
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { description?: string };
    return pkg.description === undefined ? {} : { description: pkg.description };
  } catch {
    return {};
  }
}

function defaultLoad(plugin: DiscoveredPlugin): CommandDef<any> | undefined {
  const require = createRequire(join(plugin.dir, 'package.json'));
  const loaded = require(plugin.packageName) as
    | CommandDef<any>
    | { default?: CommandDef<any>; command?: CommandDef<any> };

  if ('meta' in loaded && loaded.meta !== undefined) {
    return loaded as CommandDef<any>;
  }
  const mod = loaded as { default?: CommandDef<any>; command?: CommandDef<any> };
  return mod.default ?? mod.command;
}

/**
 * A thunk for `lazySubCommands` that discovers and loads plugin packages.
 *
 * Nothing is scanned or imported until the thunk runs, which the parser only
 * does when a token could be a subcommand.
 */
export function pluginSubCommands(
  tool: string,
  opts?: PluginOptions,
): () => Record<string, CommandDef<any>> {
  return () => {
    const load = opts?.load ?? defaultLoad;
    const commands: Record<string, CommandDef<any>> = {};

    for (const plugin of discoverPlugins(tool, opts)) {
      let command: CommandDef<any> | undefined;
      try {
        command = load(plugin);
      } catch (error) {
        if (opts?.onError === undefined) {
          throw new Error(
            `plugin '${plugin.packageName}' failed to load: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
        opts.onError(plugin, error);
        continue;
      }

      if (command === undefined) {
        continue;
      }

      // Fall back to the package description so help says something useful
      // even when the plugin did not set one.
      const meta = command.meta.description === undefined ? packageMeta(plugin) : {};
      commands[plugin.name] = {
        ...command,
        meta: { ...command.meta, name: plugin.name, ...meta },
      };
    }

    return commands;
  };
}
