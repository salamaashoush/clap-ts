/**
 * Configuration file loading, layered under the command line and environment.
 *
 * ```ts
 * import { loadConfig } from 'clap-ts/config';
 *
 * const config = loadConfig('mytool');
 * await runMain(main, { config: config?.values });
 * ```
 *
 * Precedence ends up as command line, then environment, then config file, then
 * the argument's own default. `ctx.valueSources` reports which one won.
 *
 * Only JSON is understood out of the box, which keeps this dependency-free.
 * Point `parse` at a TOML or YAML reader to accept those.
 *
 * The search costs one `existsSync` per candidate per directory, so it is
 * O(directories x candidates) and independent of how many files those
 * directories hold. Listing each directory once instead would be one syscall
 * per level, but `readdirSync` is O(entries): measured against a 2000-entry
 * directory it took 117us where four `existsSync` calls took 2.4us. Walking up
 * through a large directory is exactly the case that has to stay cheap.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';

/** A loaded configuration file. */
export interface LoadedConfig {
  /** The parsed contents, ready for `RunOptions.config`. */
  readonly values: Record<string, unknown>;
  /** Absolute path of the file the values came from. */
  readonly path: string;
}

export interface ConfigOptions {
  /**
   * File names to look for, in order of preference. Defaults to
   * `.<name>rc`, `.<name>rc.json`, `<name>.config.json` and `.config/<name>.json`.
   */
  readonly files?: readonly string[];
  /** Directory to start searching from (default: `process.cwd()`). */
  readonly cwd?: string;
  /** Stop searching at this directory, inclusive (default: the home directory). */
  readonly stopAt?: string;
  /**
   * Read this key out of a `package.json` found during the walk. Defaults to
   * the tool name; pass `null` to skip package.json entirely.
   */
  readonly packageJsonKey?: string | null;
  /** Parse a file's text. Defaults to `JSON.parse`. */
  readonly parse?: (text: string, path: string) => unknown;
  /** Load exactly this file and skip the search. */
  readonly path?: string;
  /** Search parent directories as well as `cwd` (default: true). */
  readonly searchParents?: boolean;
  /**
   * Stop once a directory holding `package.json` or `.git` has been examined.
   * Cuts the walk to the project, which is where a project's config lives.
   */
  readonly stopAtProjectRoot?: boolean;
}

/** The home directory never changes within a process. */
const HOME = homedir();

const defaultFileCache = new Map<string, readonly string[]>();

function defaultFiles(name: string): readonly string[] {
  let files = defaultFileCache.get(name);
  if (files === undefined) {
    files = [`.${name}rc`, `.${name}rc.json`, `${name}.config.json`, `.config/${name}.json`];
    defaultFileCache.set(name, files);
  }
  return files;
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`config at ${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function readOne(path: string, parse: (text: string, path: string) => unknown): LoadedConfig {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`cannot read config at ${path}: ${message}`);
  }
  try {
    return { values: asRecord(parse(text, path), path), path };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`cannot parse config at ${path}: ${message}`);
  }
}

/**
 * Find and read the nearest configuration file, walking up from `cwd`.
 *
 * Returns `undefined` when nothing is found, and throws only when a file exists
 * but cannot be read or parsed: a broken config should be loud, a missing one
 * should not.
 */
export function loadConfig(name: string, opts?: ConfigOptions): LoadedConfig | undefined {
  const parse = opts?.parse ?? ((text: string) => JSON.parse(text) as unknown);

  if (opts?.path !== undefined) {
    return readOne(resolve(opts.path), parse);
  }

  const files = opts?.files ?? defaultFiles(name);
  const packageKey = opts?.packageJsonKey === undefined ? name : opts.packageJsonKey;
  const stopAt = resolve(opts?.stopAt ?? HOME);
  const searchParents = opts?.searchParents !== false;

  let dir = resolve(opts?.cwd ?? process.cwd());
  for (;;) {
    for (const file of files) {
      // Template concatenation rather than join(): join normalises, which this
      // does not need, and the walk runs this on every candidate at every level.
      const candidate = `${dir}/${file}`;
      if (existsSync(candidate)) {
        return readOne(candidate, parse);
      }
    }

    let atProjectRoot = false;
    if (packageKey !== null || opts?.stopAtProjectRoot === true) {
      const pkgPath = `${dir}/package.json`;
      if (existsSync(pkgPath)) {
        atProjectRoot = true;
        if (packageKey !== null) {
          const section = readOne(pkgPath, parse).values[packageKey];
          if (section !== undefined) {
            return { values: asRecord(section, pkgPath), path: pkgPath };
          }
        }
      }
    }

    if (!searchParents) {
      return undefined;
    }
    if (opts?.stopAtProjectRoot === true && (atProjectRoot || existsSync(`${dir}/.git`))) {
      return undefined;
    }
    const parent = dirname(dir);
    if (parent === dir || dir === stopAt) {
      return undefined;
    }
    dir = parent;
  }
}

/**
 * Load a config and hand back the run options to spread into `runMain`.
 *
 * ```ts
 * await runMain(main, { ...configOptions('mytool') });
 * ```
 */
export function configOptions(
  name: string,
  opts?: ConfigOptions,
): { config: () => Record<string, unknown> | undefined } {
  // A thunk, so runMain only searches the filesystem when some argument is
  // still on its default.
  let cached: Record<string, unknown> | undefined;
  let loadedOnce = false;
  return {
    config: () => {
      if (!loadedOnce) {
        cached = loadConfig(name, opts)?.values;
        loadedOnce = true;
      }
      return cached;
    },
  };
}
