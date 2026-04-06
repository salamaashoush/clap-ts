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
  RunOptions,
  StylesDef,
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
import { completeEnv } from './completions.js';

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

// ---- Subcommand Resolution ----

/**
 * Find a subcommand by prefix matching (inferSubcommands).
 * Returns the match if exactly one, 'ambiguous' if multiple, undefined if none.
 */
function findSubcommandByPrefix(
  subCommands: Record<string, CommandDef>,
  token: string,
): { name: string; def: CommandDef } | 'ambiguous' | undefined {
  const matches: { name: string; def: CommandDef }[] = [];
  for (const [name, def] of Object.entries(subCommands)) {
    if (name.startsWith(token)) {
      matches.push({ name, def });
    } else if (def.meta.aliases?.some((a) => a.startsWith(token))) {
      matches.push({ name, def });
    }
  }
  if (matches.length === 1) {
    return matches[0];
  }
  if (matches.length > 1) {
    return 'ambiguous';
  }
  return undefined;
}

/**
 * Resolve the command chain from the root command and raw args.
 * Supports inferSubcommands for prefix matching.
 */
function resolveCommandChain(
  rootCommand: CommandDef,
  rawArgs: readonly string[],
): {
  command: CommandDef;
  remainingArgs: string[];
  parentNames: string[];
  externalSubcommand?: string;
} {
  let current = rootCommand;
  const parentNames: string[] = [];
  const remaining = [...rawArgs];

  while (remaining.length > 0 && (current.subCommands || current.meta.allowExternalSubcommands)) {
    const token = remaining[0]!;

    // Don't interpret flags as subcommands
    if (token.startsWith('-')) {
      break;
    }

    // Direct match
    if (current.subCommands) {
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

      // inferSubcommands: try prefix matching
      if (current.meta.inferSubcommands) {
        const prefixMatch = findSubcommandByPrefix(current.subCommands, token);
        if (prefixMatch === 'ambiguous') {
          break;
        }
        if (prefixMatch) {
          parentNames.push(current.meta.name);
          current = prefixMatch.def;
          remaining.shift();
          continue;
        }
      }
    }

    // allowExternalSubcommands: accept unknown subcommand and stop
    if (current.meta.allowExternalSubcommands) {
      remaining.shift();
      return { command: current, remainingArgs: remaining, parentNames, externalSubcommand: token };
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
  subCommand?: string,
): Promise<void> {
  const ctx: CommandContext<T> = {
    rawArgs,
    args,
    cmd: command,
    subCommand,
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

  // Dynamic shell completions: check env var before any parsing
  if (opts?.enableCompletions && completeEnv(rootCommand)) {
    if (shouldExit) {
      process.exit(0);
    }
    return;
  }

  try {
    const rawArgs = getRawArgs(opts?.argv);

    // Resolve subcommand chain (with inferSubcommands and allowExternalSubcommands)
    const { command, remainingArgs, parentNames, externalSubcommand } =
      resolveCommandChain(rootCommand, rawArgs);

    // Handle external subcommand: pass to parent command's run handler
    if (externalSubcommand) {
      if (command.run) {
        await runCommand(
          command,
          { } as ParsedArgs<ArgsDef>,
          remainingArgs,
          externalSubcommand,
        );
      }
      return;
    }

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
      handleHelpRequest(effectiveCommand, parentNames, shouldExit, parseResult.helpIsShort, styles);
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
      handleHelpRequest(rootCommand, [], shouldExit, false, styles);
      return;
    }

    // argRequiredElseHelp: show help if no args were explicitly provided
    if (command.meta.argRequiredElseHelp && parseResult.explicitlySet.size === 0) {
      handleHelpRequest(command, parentNames, shouldExit, false, styles);
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
            parseResult.positionals[0]!, command, parentNames, shouldExit, styles,
          );
        } else {
          showError("a subcommand is required but one was not provided", command,
            parentNames.length > 0 ? parentNames : undefined, styles);
          if (shouldExit) {
            process.exit(2);
          }
        }
        return;
      }

      if (parseResult.positionals.length > 0) {
        handleUnrecognizedSubcommand(
          parseResult.positionals[0]!, command, parentNames, shouldExit, styles,
        );
        return;
      }

      handleHelpRequest(command, parentNames, shouldExit, false, styles);
      return;
    }

    // argsConflictsWithSubcommands: error if args + subcommand both present
    if (
      command.meta.argsConflictsWithSubcommands &&
      parseResult.subCommand &&
      parseResult.explicitlySet.size > 0
    ) {
      showError(
        "arguments cannot be used with subcommands",
        command,
        parentNames.length > 0 ? parentNames : undefined,
        styles,
      );
      if (shouldExit) {
        process.exit(2);
      }
      return;
    }

    // Validate parsed args
    validate(parseResult, effectiveCommand);

    // Run the command
    await runCommand(effectiveCommand, parseResult.args as ParsedArgs<ArgsDef>, rawArgs);
  } catch (error) {
    if (error instanceof CliParseError) {
      showError(error.message, rootCommand, undefined, styles);
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
