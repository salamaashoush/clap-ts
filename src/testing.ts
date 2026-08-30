/**
 * Test helpers: run a command definition and get back what it wrote and the
 * code it settled on, without spawning a process or stubbing globals.
 *
 * ```ts
 * import { runCli } from 'clap-ts/testing';
 *
 * const result = await runCli(main, ['serve', '--port', '8080']);
 * expect(result.exitCode).toBe(0);
 * expect(result.stdout).toContain('listening');
 * ```
 */

import type { CommandDef, RunOptions } from './types.js';
import { runMain } from './runner.js';

/** Everything a run produced. */
export interface CliResult {
  /** Text written to stdout, with ANSI escapes intact. */
  readonly stdout: string;
  /** Text written to stderr, with ANSI escapes intact. */
  readonly stderr: string;
  /** stdout with ANSI escapes removed, for readable assertions. */
  readonly plainStdout: string;
  /** stderr with ANSI escapes removed. */
  readonly plainStderr: string;
  /** The code the run settled on. 0 unless something failed. */
  readonly exitCode: number;
  /** An error that escaped the command handler, if any. */
  readonly error?: unknown;
}

const ANSI = /\x1b\[[0-9;]*m/g;

/** Strip ANSI colour codes from text. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}

/** A sink that keeps everything written to it. */
function collector(): { write(chunk: string): void; text(): string } {
  const chunks: string[] = [];
  return {
    write(chunk) {
      chunks.push(chunk);
    },
    text() {
      return chunks.join('');
    },
  };
}

/** Options for runCli, minus the ones it controls itself. */
export type RunCliOptions = Omit<RunOptions, 'argv' | 'exit' | 'stdout' | 'stderr' | 'onExit'>;

/**
 * Run a command against an argv and capture the result.
 *
 * The process is never exited and no global is patched: output goes to
 * collectors and the exit code is observed through `onExit`. An error thrown by
 * a handler is returned on `error` rather than rethrown, so one assertion style
 * covers success and failure alike.
 */
export async function runCli(
  command: CommandDef<any>,
  argv: readonly string[] = [],
  opts?: RunCliOptions,
): Promise<CliResult> {
  const out = collector();
  const err = collector();
  let exitCode = 0;
  let error: unknown;

  try {
    await runMain(command, {
      ...opts,
      argv,
      exit: false,
      stdout: out,
      stderr: err,
      onExit: (code) => {
        exitCode = code;
      },
    });
  } catch (caught) {
    error = caught;
    if (exitCode === 0) {
      exitCode = 1;
    }
  }

  const stdout = out.text();
  const stderr = err.text();
  return {
    stdout,
    stderr,
    plainStdout: stripAnsi(stdout),
    plainStderr: stripAnsi(stderr),
    exitCode,
    ...(error === undefined ? {} : { error }),
  };
}

/**
 * Capture the args a command's handler receives, without running its body.
 *
 * Useful for asserting on parsing alone: the original `run` is replaced, so
 * side effects stay out of the test.
 *
 * ```ts
 * const { args, result } = await captureArgs(main, ['--port', '9']);
 * expect(args.port).toBe(9);
 * ```
 */
export async function captureArgs(
  command: CommandDef<any>,
  argv: readonly string[] = [],
  opts?: RunCliOptions,
): Promise<{ args: Record<string, unknown>; result: CliResult }> {
  let args: Record<string, unknown> = {};

  const probe: CommandDef<any> = {
    ...command,
    run(ctx) {
      args = ctx.args as Record<string, unknown>;
    },
  };

  const result = await runCli(probe, argv, opts);
  return { args, result };
}
