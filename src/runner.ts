/**
 * Command runner - entry point for CLI execution.
 * Handles subcommand resolution, lifecycle hooks, error handling.
 */

import type {
  ArgDef,
  ArgsDef,
  CommandContext,
  CommandDef,
  ParsedArgs,
  RunOptions,
} from './types.js';
import {
  CliParseError,
  collectGlobalArgs,
  getRawArgs,
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
 * // envArgs.env.type is 'string' (not ArgType)
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
 * // portArg.type is 'number' (not ArgType)
 * ```
 */
export function defineArg<const T extends ArgDef>(arg: T): T {
  return arg;
}

// ---- Subcommand Resolution ----

/**
 * Resolve the command chain from the root command and raw args.
 * Returns the resolved command, remaining args, and parent name chain.
 */
function resolveCommandChain(
  rootCommand: CommandDef,
  rawArgs: readonly string[],
): {
  command: CommandDef;
  remainingArgs: string[];
  parentNames: string[];
} {
  let current = rootCommand;
  const parentNames: string[] = [];
  const remaining = [...rawArgs];

  // Walk into subcommands
  while (remaining.length > 0 && current.subCommands) {
    const token = remaining[0]!;

    // Don't interpret flags as subcommands
    if (token.startsWith('-')) {
      break;
    }

    // Direct match
    const subCmd = current.subCommands[token];
    if (subCmd) {
      parentNames.push(current.meta.name);
      current = subCmd;
      remaining.shift();
      continue;
    }

    // Alias match
    const aliasMatch = findSubcommandByAlias(current.subCommands, token);
    if (aliasMatch) {
      parentNames.push(current.meta.name);
      current = aliasMatch;
      remaining.shift();
      continue;
    }

    // Not a subcommand, stop resolution
    break;
  }

  return { command: current, remainingArgs: remaining, parentNames };
}

/** Find a subcommand definition by alias. */
function findSubcommandByAlias(
  subCommands: Record<string, CommandDef>,
  token: string,
): CommandDef | undefined {
  for (const def of Object.values(subCommands)) {
    if (def.meta.aliases?.includes(token)) {
      return def;
    }
  }
  return undefined;
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
): Promise<void> {
  const ctx: CommandContext<T> = {
    rawArgs,
    args,
    cmd: command,
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
      // If run also failed, keep the original error
      runError ??= error;
    }
  }

  if (runError) {
    if (runError instanceof Error) {
      throw runError;
    }
    throw new Error(runError instanceof Error ? runError.message : JSON.stringify(runError));
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
 * Returns undefined if no candidate is within the distance threshold.
 */
function findClosestSubcommand(target: string, candidates: string[]): string | undefined {
  const a = target.toLowerCase();
  let bestMatch: string | undefined;
  let bestDist = 4; // max distance threshold

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

/** Handle --help request. */
function handleHelpRequest(command: CommandDef, parentNames: string[], shouldExit: boolean): void {
  showHelp(command, parentNames.length > 0 ? parentNames : undefined);
  if (shouldExit) {
    process.exit(0);
  }
}

/** Handle --version request. */
function handleVersionRequest(
  effectiveCommand: CommandDef,
  rootCommand: CommandDef,
  shouldExit: boolean,
): void {
  const versionMeta = effectiveCommand.meta.version ? effectiveCommand.meta : rootCommand.meta;
  showVersion(versionMeta);
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
): void {
  const allNames = collectSubcommandNames(command.subCommands!);
  let msg = `unrecognized subcommand '${unknownName}'`;

  const bestMatch = findClosestSubcommand(unknownName, allNames);
  if (bestMatch) {
    msg += `\n\n  tip: a similar subcommand exists: '${bestMatch}'`;
  }

  showError(msg, command, parentNames.length > 0 ? parentNames : undefined);
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

  try {
    const rawArgs = getRawArgs(opts?.argv);

    // Resolve subcommand chain
    const { command, remainingArgs, parentNames } = resolveCommandChain(rootCommand, rawArgs);

    // Merge global args from parent into resolved command
    const globalArgs = collectGlobalArgs(rootCommand);
    const effectiveCommand: CommandDef = {
      ...command,
      args: command.args ? mergeGlobalArgs(globalArgs, command.args) : globalArgs,
    };

    // Parse remaining args against the resolved command
    const parseResult = parseArgs(remainingArgs, effectiveCommand);

    // Handle --help
    if (parseResult.helpRequested) {
      handleHelpRequest(effectiveCommand, parentNames, shouldExit);
      return;
    }

    // Handle --version
    if (parseResult.versionRequested) {
      handleVersionRequest(effectiveCommand, rootCommand, shouldExit);
      return;
    }

    // Show help if no args and command has subcommands
    if (
      showHelpOnEmpty &&
      rawArgs.length === 0 &&
      rootCommand.subCommands &&
      Object.keys(rootCommand.subCommands).length > 0
    ) {
      handleHelpRequest(rootCommand, [], shouldExit);
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
      if (parseResult.positionals.length > 0) {
        handleUnrecognizedSubcommand(parseResult.positionals[0]!, command, parentNames, shouldExit);
        return;
      }

      handleHelpRequest(command, parentNames, shouldExit);
      return;
    }

    // Validate parsed args
    validate(parseResult, effectiveCommand);

    // Run the command
    await runCommand(effectiveCommand, parseResult.args as ParsedArgs<ArgsDef>, rawArgs);
  } catch (error) {
    if (error instanceof CliParseError) {
      showError(error.message, rootCommand);
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
