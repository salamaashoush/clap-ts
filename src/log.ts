/**
 * A levelled logger wired to the verbosity arguments a CLI already declares.
 *
 * ```ts
 * import { loggerFrom } from 'clap-ts/log';
 *
 * const main = defineCommand({
 *   meta: { name: 'tool' },
 *   args: {
 *     verbose: { type: 'boolean', short: 'v', action: 'count', description: 'More output' },
 *     quiet: { type: 'boolean', short: 'q', description: 'Errors only' },
 *   },
 *   run(ctx) {
 *     const log = loggerFrom(ctx);
 *     log.info('starting');   // shown by default
 *     log.debug('details');   // shown with -v
 *   },
 * });
 * ```
 *
 * Everything goes to stderr, leaving stdout for the command's actual output so
 * a pipeline is not polluted by progress chatter.
 */

import { styleText } from 'node:util';
import type { OutputSink } from './types.js';

/** Ordered from quietest to loudest. */
export const LEVELS = ['silent', 'error', 'warn', 'info', 'debug', 'trace'] as const;

export type LogLevel = (typeof LEVELS)[number];

const RANK: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  trace: 5,
};

export interface Logger {
  readonly level: LogLevel;
  /** Whether a message at this level would be shown. */
  enabled(level: LogLevel): boolean;
  error(message: string, ...rest: unknown[]): void;
  warn(message: string, ...rest: unknown[]): void;
  info(message: string, ...rest: unknown[]): void;
  debug(message: string, ...rest: unknown[]): void;
  trace(message: string, ...rest: unknown[]): void;
  /** A logger writing the same place at a different level. */
  withLevel(level: LogLevel): Logger;
}

export interface LoggerOptions {
  /** Level to log at (default 'info'). */
  readonly level?: LogLevel;
  /** Where messages go (default process.stderr). */
  readonly sink?: OutputSink;
  /** Prefix each line, for instance with the tool name. */
  readonly prefix?: string;
  /** Force colour on or off; defaults to whatever the stream supports. */
  readonly color?: boolean;
}

type Paint = (text: string) => string;

const PLAIN: Paint = (text) => text;

function labels(color: boolean): Record<Exclude<LogLevel, 'silent'>, string> {
  const paint = (codes: Parameters<typeof styleText>[0], text: string): string =>
    color ? styleText(codes, text, { validateStream: false }) : text;
  return {
    error: paint('red', 'error'),
    warn: paint('yellow', 'warning'),
    info: paint('cyan', 'info'),
    debug: paint('magenta', 'debug'),
    trace: paint('gray', 'trace'),
  };
}

function format(rest: readonly unknown[]): string {
  if (rest.length === 0) {
    return '';
  }
  return ` ${rest
    .map((value) => (typeof value === 'string' ? value : JSON.stringify(value)))
    .join(' ')}`;
}

/** Build a logger writing to a sink. */
export function createLogger(opts?: LoggerOptions): Logger {
  const level = opts?.level ?? 'info';
  const sink = opts?.sink ?? process.stderr;
  const color = opts?.color ?? styleText('red', 'x') !== 'x';
  const tag = labels(color);
  const prefix = opts?.prefix === undefined ? '' : `${opts.prefix} `;
  const threshold = RANK[level];

  const write = (at: Exclude<LogLevel, 'silent'>, message: string, rest: unknown[]): void => {
    if (RANK[at] > threshold) {
      return;
    }
    sink.write(`${prefix}${tag[at]}: ${message}${format(rest)}\n`);
  };

  const logger: Logger = {
    level,
    enabled: (at) => RANK[at] <= threshold,
    error: (message, ...rest) => {
      write('error', message, rest);
    },
    warn: (message, ...rest) => {
      write('warn', message, rest);
    },
    info: (message, ...rest) => {
      write('info', message, rest);
    },
    debug: (message, ...rest) => {
      write('debug', message, rest);
    },
    trace: (message, ...rest) => {
      write('trace', message, rest);
    },
    withLevel: (next) => createLogger({ ...opts, level: next }),
  };
  return logger;
}

export interface LevelFromArgsOptions {
  /** Name of the count-action verbosity arg (default 'verbose'). */
  readonly verboseKey?: string;
  /** Name of the quiet flag (default 'quiet'). */
  readonly quietKey?: string;
  /** Name of an explicit level arg, which overrides the other two. */
  readonly levelKey?: string;
  /** Level with no flags given (default 'info'). */
  readonly base?: LogLevel;
}

/**
 * Work out a level from parsed arguments.
 *
 * An explicit level wins. Otherwise `--quiet` drops to errors only, and each
 * `-v` climbs one step, so `-vv` reaches trace from the default of info.
 */
export function levelFromArgs(
  args: Record<string, unknown>,
  opts?: LevelFromArgsOptions,
): LogLevel {
  const explicit = args[opts?.levelKey ?? 'logLevel'];
  if (typeof explicit === 'string' && (LEVELS as readonly string[]).includes(explicit)) {
    return explicit as LogLevel;
  }

  if (args[opts?.quietKey ?? 'quiet'] === true) {
    return 'error';
  }

  const base = RANK[opts?.base ?? 'info'];
  const verbose = args[opts?.verboseKey ?? 'verbose'];
  const steps = typeof verbose === 'number' ? verbose : verbose === true ? 1 : 0;
  return LEVELS[Math.min(base + steps, LEVELS.length - 1)]!;
}

/**
 * A logger for a command context, taking its level from the parsed arguments
 * and writing to the context's stderr so the testing helpers capture it.
 */
export function loggerFrom(
  // Structural rather than CommandContext<T>, so any command's context fits
  // without the generic having to be named at the call site.
  ctx: { readonly args: unknown; readonly stderr: OutputSink },
  opts?: LoggerOptions & LevelFromArgsOptions,
): Logger {
  return createLogger({
    ...opts,
    sink: opts?.sink ?? ctx.stderr,
    level: opts?.level ?? levelFromArgs(ctx.args as Record<string, unknown>, opts),
  });
}

/** A logger that discards everything, for tests and dry runs. */
export const silentLogger: Logger = createLogger({ level: 'silent', sink: { write: PLAIN } });
