/**
 * Command runner - entry point for CLI execution.
 * Handles subcommand resolution, lifecycle hooks, error handling.
 * Supports inferSubcommands, subcommandRequired, allowExternalSubcommands,
 * argsConflictsWithSubcommands, argRequiredElseHelp, and custom styles.
 */

import type {
  ArgDef,
  ArgsDef,
  CommandContext,
  CommandDef,
  ParsedArgs,
  ParseResult,
  OutputSink,
  RunOptions,
  StylesDef,
  ValueSource,
} from './types.js';
import {
  CliParseError,
  coerceValue,
  collectGlobalArgs,
  getRawArgs,
  hasSubCommands,
  kebabToCamel,
  mergeGlobalArgs,
  parseArgs,
  subCommandsOf,
} from './parser.js';
import { validate } from './validation.js';
import { showError, showHelp, showVersion } from './help.js';

// ---- defineCommand ----

/**
 * Define a command with full type inference on arguments.
 * This is the primary API for creating commands.
 *
 * ```ts
 * const cmd = defineCommand({
 *   meta: { name: 'my-tool', version: '1.0.0', description: 'My tool' },
 *   args: {
 *     verbose: { type: 'boolean', short: 'v', description: 'Verbose output' },
 *     port: { type: 'number', short: 'p', default: 3000, description: 'Port' },
 *   },
 *   run({ args }) {
 *     console.log(args.verbose, args.port);
 *   },
 * });
 * ```
 */
export function defineCommand<const T extends ArgsDef>(def: CommandDef<T>): CommandDef<T> {
  return def;
}

// ---- defineArgs / defineArg ----

/**
 * Define a reusable argument group with full type inference.
 * Use this for shared args that are spread into multiple commands.
 *
 * ```ts
 * const envArgs = defineArgs({
 *   env: { type: 'string', valueParser: ['dev', 'staging', 'prod'] },
 *   dev: { type: 'boolean', conflictsWith: ['env', 'staging', 'prod'] },
 * });
 * ```
 */
export function defineArgs<const T extends ArgsDef>(args: T): T {
  return args;
}

/**
 * Define a single argument with full type inference.
 *
 * ```ts
 * const portArg = defineArg({ type: 'number', short: 'p', default: 3003 });
 * ```
 */
export function defineArg<const T extends ArgDef>(arg: T): T {
  return arg;
}

// ---- Config Layer ----

/**
 * The config section that applies to a command, built by walking the path from
 * the root. A nested object named for a subcommand scopes its contents to that
 * command; scalar keys stay in scope all the way down.
 */
function configForPath(
  config: Record<string, unknown>,
  path: readonly string[],
): Record<string, unknown> {
  let scope: Record<string, unknown> = config;
  const merged: Record<string, unknown> = {};

  const takeScalars = (from: Record<string, unknown>): void => {
    for (const key of Object.keys(from)) {
      const value = from[key];
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        continue;
      }
      merged[key] = value;
    }
  };

  takeScalars(scope);
  for (const segment of path) {
    const next = scope[segment];
    if (next === null || typeof next !== 'object' || Array.isArray(next)) {
      break;
    }
    scope = next as Record<string, unknown>;
    takeScalars(scope);
  }
  return merged;
}

/**
 * Fill args the command line and environment left alone from the config.
 * A default already applied during parsing loses to a config value, which is
 * what makes the precedence CLI > env > config > default.
 */
function applyConfig(
  result: ParseResult,
  command: CommandDef,
  source: Record<string, unknown> | (() => Record<string, unknown> | undefined),
  path: readonly string[],
): ParseResult {
  const argsDef: ArgsDef = command.args ?? {};

  // Nothing to fill means nothing to load: with a thunk, a command line that
  // answered every argument never touches the filesystem.
  let anyOpen = false;
  for (const key of Object.keys(argsDef)) {
    const from = result.valueSources.get(key);
    if (from !== 'cli' && from !== 'env') {
      anyOpen = true;
      break;
    }
  }
  if (!anyOpen) {
    return result;
  }

  const config = typeof source === 'function' ? source() : source;
  if (config === undefined) {
    return result;
  }
  const section = configForPath(config, path);

  const args = { ...result.args };
  const valueSources = new Map(result.valueSources);
  let changed = false;

  for (const key of Object.keys(argsDef)) {
    const raw = section[key];
    if (raw === undefined) {
      continue;
    }
    const source = valueSources.get(key);
    if (source === 'cli' || source === 'env') {
      continue;
    }

    const def = argsDef[key]!;
    const name = def.type === 'positional' ? `<${def.valueName ?? key}>` : `--${def.long ?? key}`;
    const coerce = (value: unknown): string | number | boolean =>
      coerceValue(String(value), def, `config:${name}`);

    args[key] = Array.isArray(raw) ? raw.map((v) => String(coerce(v))) : coerce(raw);
    args[kebabToCamel(key)] = args[key]!;
    valueSources.set(key, 'config');
    changed = true;
  }

  return changed ? { ...result, args, valueSources } : result;
}

// ---- Global Args ----

/**
 * Overlay inherited global args onto a command. The command's own args win, and
 * a command with nothing to inherit is returned untouched so the parser's spec
 * cache still hits.
 */
function applyGlobals(
  command: CommandDef,
  globals: ArgsDef,
  propagatedVersion: string | undefined,
): CommandDef {
  let hasGlobals = false;
  for (const _key in globals) {
    hasGlobals = true;
    break;
  }
  const needsVersion = propagatedVersion !== undefined && command.meta.version === undefined;

  if (!hasGlobals && !needsVersion) {
    return command;
  }
  return {
    ...command,
    meta: needsVersion ? { ...command.meta, version: propagatedVersion } : command.meta,
    args: hasGlobals ? mergeGlobalArgs(globals, command.args ?? {}) : command.args,
  };
}

/**
 * Walk a chain of subcommand names from a command, for `app help sub subsub`.
 * Returns the deepest command reached and the names of its ancestors.
 */
function resolveHelpTarget(
  root: CommandDef,
  rootParents: readonly string[],
  path: readonly string[],
): { command: CommandDef; parentNames: string[] } {
  let current = root;
  const parentNames = [...rootParents];
  for (const name of path) {
    const next = subCommandsOf(current)[name];
    if (next === undefined) {
      break;
    }
    parentNames.push(current.meta.name);
    current = next;
  }
  return { command: current, parentNames };
}

/**
 * Overlay global values captured at ancestor levels onto the resolved command's
 * result. A value given again at this level always wins.
 */
function applyInheritedGlobals(
  result: ParseResult,
  inherited: ReadonlyMap<string, string | number | boolean | string[]>,
): ParseResult {
  if (inherited.size === 0) {
    return result;
  }

  const args = { ...result.args };
  const explicitlySet = new Set(result.explicitlySet);
  const valueSources = new Map(result.valueSources);
  for (const [key, value] of inherited) {
    if (explicitlySet.has(key)) {
      continue;
    }
    args[kebabToCamel(key)] = value;
    args[key] = value;
    explicitlySet.add(key);
    valueSources.set(key, 'cli');
  }

  return { ...result, args, explicitlySet, valueSources };
}

// ---- runCommand ----

/**
 * Run a specific command with pre-parsed arguments.
 * Executes the setup -> run -> cleanup lifecycle.
 */
export async function runCommand<T extends ArgsDef>(
  command: CommandDef<T>,
  args: ParsedArgs<T>,
  rawArgs: readonly string[] = [],
  subCommand?: string,
  valueSources: ReadonlyMap<string, ValueSource> = new Map(),
  io?: { stdout: OutputSink; stderr: OutputSink },
): Promise<void> {
  const ctx: CommandContext<T> = {
    rawArgs,
    args,
    cmd: command,
    subCommand,
    valueSources,
    stdout: io?.stdout ?? process.stdout,
    stderr: io?.stderr ?? process.stderr,
    data: {},
  };

  let runError: unknown;

  // Setup phase
  if (command.setup) {
    await command.setup(ctx);
  }

  // Run phase
  try {
    if (command.run) {
      await command.run(ctx);
    }
  } catch (error) {
    runError = error;
  }

  // Cleanup phase (always runs)
  if (command.cleanup) {
    try {
      await command.cleanup(ctx);
    } catch (error) {
      runError ??= error;
    }
  }

  if (runError) {
    if (runError instanceof Error) {
      throw runError;
    }
    throw new Error(JSON.stringify(runError));
  }
}

// ---- Typo Suggestion ----

/** Collect all known subcommand names and aliases from a command. */
function collectSubcommandNames(subCommands: Record<string, CommandDef>): string[] {
  const names: string[] = Object.keys(subCommands);
  for (const def of Object.values(subCommands)) {
    if (def.meta.aliases) {
      names.push(...def.meta.aliases);
    }
  }
  return names;
}

/**
 * Find the closest match for a string among candidates using simple character diff.
 */
function findClosestSubcommand(target: string, candidates: string[]): string | undefined {
  const a = target.toLowerCase();
  let bestMatch: string | undefined;
  let bestDist = 4;

  for (const name of candidates) {
    const b = name.toLowerCase();
    const dist = simpleCharDistance(a, b, bestDist);
    if (dist < bestDist) {
      bestDist = dist;
      bestMatch = name;
    }
  }

  return bestMatch;
}

/** Quick character-level distance heuristic. */
function simpleCharDistance(a: string, b: string, maxDist: number): number {
  if (Math.abs(a.length - b.length) >= maxDist) {
    return maxDist;
  }

  let dist = Math.abs(a.length - b.length);
  const minLen = Math.min(a.length, b.length);
  for (let i = 0; i < minLen; i++) {
    if (a[i] !== b[i]) {
      dist++;
    }
  }
  return dist;
}

// ---- runMain helpers ----

/** Handle --help request with mode and style support. */
function handleHelpRequest(
  command: CommandDef,
  parentNames: string[],
  isShortHelp: boolean,
  io: RunIO,
): void {
  showHelp(command, parentNames.length > 0 ? parentNames : undefined, isShortHelp, io.styles, io.stdout);
  io.finish(0);
}

/** Handle --version request. */
function handleVersionRequest(
  effectiveCommand: CommandDef,
  rootCommand: CommandDef,
  isShort: boolean,
  io: RunIO,
): void {
  const versionMeta = effectiveCommand.meta.version ? effectiveCommand.meta : rootCommand.meta;
  showVersion(versionMeta, isShort, io.stdout);
  io.finish(0);
}

/** Handle an unrecognized subcommand with typo suggestion. */
function handleUnrecognizedSubcommand(
  unknownName: string,
  command: CommandDef,
  parentNames: string[],
  io: RunIO,
): void {
  const allNames = collectSubcommandNames(subCommandsOf(command));
  let msg = `unrecognized subcommand '${unknownName}'`;

  const bestMatch = findClosestSubcommand(unknownName, allNames);
  if (bestMatch) {
    msg += `\n\n  tip: a similar subcommand exists: '${bestMatch}'`;
  }

  fail(msg, command, parentNames, io);
}

/**
 * Where a run writes and how it ends. `finish` reports the code to any onExit
 * hook and exits the process unless the caller opted out.
 */
interface RunIO {
  readonly stdout: OutputSink;
  readonly stderr: OutputSink;
  readonly styles?: Partial<StylesDef>;
  finish(code: number): void;
}

function makeRunIO(opts?: RunOptions): RunIO {
  const shouldExit = opts?.exit !== false;
  return {
    stdout: opts?.stdout ?? process.stdout,
    stderr: opts?.stderr ?? process.stderr,
    styles: opts?.styles,
    finish(code) {
      opts?.onExit?.(code);
      if (shouldExit) {
        process.exit(code);
      }
    },
  };
}

/** Print a usage error against the given command and settle on exit code 2. */
function fail(message: string, command: CommandDef, parentNames: string[], io: RunIO): void {
  showError(message, command, parentNames.length > 0 ? parentNames : undefined, io.styles, io.stderr);
  io.finish(2);
}

// ---- runMain ----

/**
 * Main entry point for CLI applications.
 * Parses args, resolves subcommands, validates, and runs.
 *
 * ```ts
 * const main = defineCommand({ ... });
 * runMain(main);
 * ```
 */
export async function runMain(rootCommand: CommandDef<any>, opts?: RunOptions): Promise<void> {
  const io = makeRunIO(opts);
  const shouldExit = opts?.exit !== false;
  const showHelpOnEmpty = opts?.showHelpOnEmpty !== false;

  // Tracked through the descent so an error names the command that failed,
  // not the root.
  let errorCommand: CommandDef = rootCommand;
  let errorParents: string[] = [];

  try {
    let rawArgs = getRawArgs(opts?.argv, rootCommand.meta.noBinaryName === true);

    // multicall: the name the binary was invoked under selects the subcommand.
    if (rootCommand.meta.multicall && opts?.argv === undefined) {
      const invoked = process.argv[1];
      if (invoked !== undefined) {
        const base = invoked.slice(invoked.lastIndexOf('/') + 1).replace(/\.[cm]?[jt]s$/, '');
        rawArgs = [base, ...rawArgs];
      }
    }

    let command: CommandDef = rootCommand;
    let effectiveCommand: CommandDef = rootCommand;
    let inheritedGlobals: ArgsDef = {};
    // Values of global args given at an ancestor level. clap carries these down
    // to the command that finally runs, so `app --verbose serve` reaches serve.
    const inheritedValues = new Map<string, string | number | boolean | string[]>();
    let propagatedVersion: string | undefined;
    let argv: readonly string[] = rawArgs;
    const parentNames: string[] = [];
    let parseResult = parseArgs([], rootCommand);
    let externalSubcommand: string | undefined;

    // Descend the subcommand chain one level at a time, parsing as we go: only
    // the arg spec can say whether a bare token is a subcommand or the value of
    // a preceding flag.
    for (;;) {
      inheritedGlobals = mergeGlobalArgs(inheritedGlobals, collectGlobalArgs(command));
      if (command.meta.propagateVersion && command.meta.version !== undefined) {
        propagatedVersion = command.meta.version;
      }
      effectiveCommand = applyGlobals(command, inheritedGlobals, propagatedVersion);
      errorCommand = effectiveCommand;
      errorParents = [...parentNames];

      parseResult = parseArgs(argv, effectiveCommand);

      for (const warning of parseResult.warnings) {
        io.stderr.write(`warning: ${warning}\n`);
      }
      if (command.meta.deprecated !== undefined && command.meta.deprecated !== false) {
        const reason =
          typeof command.meta.deprecated === 'string' ? `: ${command.meta.deprecated}` : '';
        const instead =
          command.meta.replacedBy === undefined ? '' : `; use '${command.meta.replacedBy}' instead`;
        io.stderr.write(`warning: '${command.meta.name}' is deprecated${reason}${instead}\n`);
      }

      // The built-in `help` subcommand: `app help`, `app help sub sub`.
      if (
        parseResult.subCommand === undefined &&
        hasSubCommands(command) &&
        command.meta.disableHelpSubcommand !== true &&
        parseResult.positionals[0] === 'help'
      ) {
        const target = resolveHelpTarget(
          effectiveCommand,
          parentNames,
          parseResult.positionals.slice(1),
        );
        handleHelpRequest(target.command, target.parentNames, false, io);
        return;
      }

      for (const key of Object.keys(inheritedGlobals)) {
        if (parseResult.explicitlySet.has(key)) {
          const value = parseResult.args[key];
          if (value !== undefined) {
            inheritedValues.set(key, value);
          }
        }
      }

      if (
        parseResult.subCommand === undefined ||
        parseResult.helpRequested ||
        parseResult.versionRequested
      ) {
        break;
      }

      if (parseResult.subCommandIsExternal) {
        externalSubcommand = parseResult.subCommand;
        break;
      }

      if (command.meta.argsConflictsWithSubcommands && parseResult.explicitlySet.size > 0) {
        fail('arguments cannot be used with subcommands', effectiveCommand, parentNames, io);
        return;
      }

      const next = subCommandsOf(command)[parseResult.subCommand];
      if (next === undefined) {
        break;
      }

      // A parent's own constraints still apply to the flags given before the
      // subcommand, unless it opted out with subcommandNegatesReqs.
      if (!command.meta.subcommandNegatesReqs) {
        validate(parseResult, effectiveCommand);
      }

      parentNames.push(command.meta.name);
      command = next;
      argv = parseResult.subCommandArgs;
    }

    // External subcommand: hand the name and the untouched remainder to the
    // command that declared allowExternalSubcommands.
    if (externalSubcommand !== undefined) {
      if (effectiveCommand.run) {
        const parser = effectiveCommand.externalSubcommandValueParser;
        const externalArgs =
          parser === undefined
            ? parseResult.subCommandArgs
            : parseResult.subCommandArgs.map((value) => {
                try {
                  return String(parser(value));
                } catch (error) {
                  const message = error instanceof Error ? error.message : String(error);
                  throw new CliParseError(`invalid value '${value}': ${message}`);
                }
              });
        await runCommand(
          effectiveCommand,
          parseResult.args as ParsedArgs<ArgsDef>,
          externalArgs,
          externalSubcommand,
          parseResult.valueSources,
          io,
        );
      }
      io.finish(0);
      return;
    }

    // Handle --help
    if (parseResult.helpRequested) {
      handleHelpRequest(effectiveCommand, parentNames, parseResult.helpIsShort, io);
      return;
    }

    // Handle --version
    if (parseResult.versionRequested) {
      handleVersionRequest(effectiveCommand, rootCommand, parseResult.versionIsShort, io);
      return;
    }

    // Show help if no args and command has subcommands
    if (
      showHelpOnEmpty &&
      rawArgs.length === 0 &&
      hasSubCommands(rootCommand)
    ) {
      handleHelpRequest(rootCommand, [], false, io);
      return;
    }

    // argRequiredElseHelp: show help if no args were explicitly provided
    if (command.meta.argRequiredElseHelp && parseResult.explicitlySet.size === 0) {
      handleHelpRequest(effectiveCommand, parentNames, false, io);
      return;
    }

    // If we resolved to a parent command that has subcommands but no run handler,
    // and the user didn't pass a valid subcommand, show help or error
    if (
      hasSubCommands(command) &&
      !command.run &&
      !parseResult.subCommand
    ) {
      // subcommandRequired: error if no subcommand
      if (command.meta.subcommandRequired) {
        if (parseResult.positionals.length > 0) {
          handleUnrecognizedSubcommand(
            parseResult.positionals[0]!, effectiveCommand, parentNames, io,
          );
        } else {
          fail('a subcommand is required but one was not provided', effectiveCommand, parentNames, io);
        }
        return;
      }

      if (parseResult.positionals.length > 0) {
        handleUnrecognizedSubcommand(
          parseResult.positionals[0]!, effectiveCommand, parentNames, io,
        );
        return;
      }

      handleHelpRequest(effectiveCommand, parentNames, false, io);
      return;
    }

    // Fold ancestor-provided global values into the command that runs, then
    // let the config fill whatever is still on its default.
    let finalResult = applyInheritedGlobals(parseResult, inheritedValues);
    if (opts?.config !== undefined) {
      finalResult = applyConfig(finalResult, effectiveCommand, opts.config, [
        ...parentNames.slice(1),
        ...(parentNames.length > 0 ? [command.meta.name] : []),
      ]);
    }

    // Validate parsed args
    validate(finalResult, effectiveCommand);

    // Run the command
    await runCommand(
      effectiveCommand,
      finalResult.args as ParsedArgs<ArgsDef>,
      rawArgs,
      undefined,
      finalResult.valueSources,
      io,
    );

    // If the command's run() didn't call process.exit() itself, exit cleanly.
    // This prevents the process from hanging when the caller uses `void runMain()`
    // instead of `await runMain()` — the unawaited Promise would otherwise keep
    // the event loop alive due to pending NAPI handles or other resources.
    io.finish(0);
  } catch (error) {
    if (error instanceof CliParseError) {
      fail(error.message, errorCommand, errorParents, io);
      return;
    }

    // Unexpected error
    if (shouldExit || opts?.onExit !== undefined) {
      const message = error instanceof Error ? error.message : String(error);
      io.stderr.write(`error: ${message}\n`);
      io.finish(1);
      if (!shouldExit) {
        return;
      }
    }
    throw error;
  }
}
