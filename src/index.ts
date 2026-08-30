/**
 * clap-ts - A type-safe CLI argument parser for TypeScript, inspired by Rust's clap.
 *
 * Re-exports all public API.
 */

// Types
export type {
  ArgType,
  ArgAction,
  NumArgs,
  ValueParserFn,
  PossibleValue,
  ValueHint,
  ColorChoice,
  ValueSource,
  Shell,
  OutputSink,
  MissingArg,
  ArgDef,
  ArgsDef,
  StyleFn,
  StylesDef,
  CommandMeta,
  ArgGroup,
  ParsedArgs,
  CommandContext,
  CommandDef,
  RunOptions,
  ParseResult,
  InferArgValue,
  InferArgOptional,
} from './types.js';

// Parser
export {
  parseArgs,
  getRawArgs,
  collectGlobalArgs,
  mergeGlobalArgs,
  subCommandsOf,
  hasSubCommands,
  possibleValues,
  matchesPossibleValue,
  CliParseError,
} from './parser.js';

// Validation
export { validate } from './validation.js';

// Help renderer
export { renderHelp, renderUsage, showHelp, showVersion, showError } from './help.js';

// Runner (main API)
export { defineCommand, defineArgs, defineArg, runCommand, runMain } from './runner.js';

// Generators live behind subpaths so a running CLI never loads them:
//   clap-ts/completions, clap-ts/man, clap-ts/markdown
