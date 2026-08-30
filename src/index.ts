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
  ManOptions,
  MarkdownOptions,
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

// Shell completions
export { generateCompletions, withCompletions } from './completions.js';

// Man pages
export { renderManPage, generateManPages } from './man.js';

// Markdown documentation
export { renderMarkdownHelp } from './markdown.js';
