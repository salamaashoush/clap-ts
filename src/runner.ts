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
  RunOptions,
  StylesDef,
  ValueSource,
} from './types.js';
import {
  CliParseError,
  collectGlobalArgs,
  getRawArgs,
  kebabToCamel,
  mergeGlobalArgs,
  parseArgs,
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
    const next = current.subCommands?.[name];
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
): Promise<void> {
  const ctx: CommandContext<T> = {
    rawArgs,
    args,
    cmd: command,
    subCommand,
    valueSources,
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
  shouldExit: boolean,
  isShortHelp: boolean,
  styles?: Partial<StylesDef>,
): void {
  showHelp(command, parentNames.length > 0 ? parentNames : undefined, isShortHelp, styles);
  if (shouldExit) {
    process.exit(0);
  }
}

/** Handle --version request. */
function handleVersionRequest(
  effectiveCommand: CommandDef,
  rootCommand: CommandDef,
  shouldExit: boolean,
  isShort: boolean,
): void {
  const versionMeta = effectiveCommand.meta.version ? effectiveCommand.meta : rootCommand.meta;
  showVersion(versionMeta, isShort);
  if (shouldExit) {
    process.exit(0);
  }
}

/** Handle an unrecognized subcommand with typo suggestion. */
function handleUnrecognizedSubcommand(
  unknownName: string,
  command: CommandDef,
  parentNames: string[],
  shouldExit: boolean,
  styles?: Partial<StylesDef>,
): void {
  const allNames = collectSubcommandNames(command.subCommands!);
  let msg = `unrecognized subcommand '${unknownName}'`;

  const bestMatch = findClosestSubcommand(unknownName, allNames);
  if (bestMatch) {
    msg += `\n\n  tip: a similar subcommand exists: '${bestMatch}'`;
  }

  showError(msg, command, parentNames.length > 0 ? parentNames : undefined, styles);
  if (shouldExit) {
    process.exit(2);
  }
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
  const shouldExit = opts?.exit !== false;
  const showHelpOnEmpty = opts?.showHelpOnEmpty !== false;
  const styles = opts?.styles;

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

      // The built-in `help` subcommand: `app help`, `app help sub sub`.
      if (
        parseResult.subCommand === undefined &&
        command.subCommands !== undefined &&
        command.meta.disableHelpSubcommand !== true &&
        parseResult.positionals[0] === 'help'
      ) {
        const target = resolveHelpTarget(
          effectiveCommand,
          parentNames,
          parseResult.positionals.slice(1),
        );
        handleHelpRequest(target.command, target.parentNames, shouldExit, false, styles);
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
        showError(
          'arguments cannot be used with subcommands',
          effectiveCommand,
          parentNames.length > 0 ? parentNames : undefined,
          styles,
        );
        if (shouldExit) {
          process.exit(2);
        }
        return;
      }

      const next = command.subCommands?.[parseResult.subCommand];
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
        await runCommand(
          effectiveCommand,
          parseResult.args as ParsedArgs<ArgsDef>,
          parseResult.subCommandArgs,
          externalSubcommand,
          parseResult.valueSources,
        );
      }
      if (shouldExit) {
        process.exit(0);
      }
      return;
    }

    // Handle --help
    if (parseResult.helpRequested) {
      handleHelpRequest(effectiveCommand, parentNames, shouldExit, parseResult.helpIsShort, styles);
      return;
    }

    // Handle --version
    if (parseResult.versionRequested) {
      handleVersionRequest(effectiveCommand, rootCommand, shouldExit, parseResult.versionIsShort);
      return;
    }

    // Show help if no args and command has subcommands
    if (
      showHelpOnEmpty &&
      rawArgs.length === 0 &&
      rootCommand.subCommands &&
      Object.keys(rootCommand.subCommands).length > 0
    ) {
      handleHelpRequest(rootCommand, [], shouldExit, false, styles);
      return;
    }

    // argRequiredElseHelp: show help if no args were explicitly provided
    if (command.meta.argRequiredElseHelp && parseResult.explicitlySet.size === 0) {
      handleHelpRequest(effectiveCommand, parentNames, shouldExit, false, styles);
      return;
    }

    // If we resolved to a parent command that has subcommands but no run handler,
    // and the user didn't pass a valid subcommand, show help or error
    if (
      command.subCommands &&
      Object.keys(command.subCommands).length > 0 &&
      !command.run &&
      !parseResult.subCommand
    ) {
      // subcommandRequired: error if no subcommand
      if (command.meta.subcommandRequired) {
        if (parseResult.positionals.length > 0) {
          handleUnrecognizedSubcommand(
            parseResult.positionals[0]!, effectiveCommand, parentNames, shouldExit, styles,
          );
        } else {
          showError("a subcommand is required but one was not provided", effectiveCommand,
            parentNames.length > 0 ? parentNames : undefined, styles);
          if (shouldExit) {
            process.exit(2);
          }
        }
        return;
      }

      if (parseResult.positionals.length > 0) {
        handleUnrecognizedSubcommand(
          parseResult.positionals[0]!, effectiveCommand, parentNames, shouldExit, styles,
        );
        return;
      }

      handleHelpRequest(effectiveCommand, parentNames, shouldExit, false, styles);
      return;
    }

    // Fold ancestor-provided global values into the command that runs.
    const finalResult = applyInheritedGlobals(parseResult, inheritedValues);

    // Validate parsed args
    validate(finalResult, effectiveCommand);

    // Run the command
    await runCommand(
      effectiveCommand,
      finalResult.args as ParsedArgs<ArgsDef>,
      rawArgs,
      undefined,
      finalResult.valueSources,
    );

    // If the command's run() didn't call process.exit() itself, exit cleanly.
    // This prevents the process from hanging when the caller uses `void runMain()`
    // instead of `await runMain()` — the unawaited Promise would otherwise keep
    // the event loop alive due to pending NAPI handles or other resources.
    if (shouldExit) {
      process.exit(0);
    }
  } catch (error) {
    if (error instanceof CliParseError) {
      showError(error.message, errorCommand, errorParents.length > 0 ? errorParents : undefined, styles);
      if (shouldExit) {
        process.exit(2);
      }
      return;
    }

    // Unexpected error
    if (shouldExit) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`error: ${message}\n`);
      process.exit(1);
    }
    throw error;
  }
}
