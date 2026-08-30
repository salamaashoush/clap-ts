/**
 * Interactive prompts, derived from the argument definitions a command already
 * has.
 *
 * ```ts
 * import { promptMissing } from 'clap-ts/prompt';
 *
 * await runMain(main, { fillMissing: promptMissing() });
 * ```
 *
 * A required argument nobody supplied is asked for rather than rejected: a
 * boolean becomes a confirm, an argument with possible values becomes a
 * numbered list, and one marked `secret` is read without echoing. `ctx
 * .valueSources` reports those as `'prompt'`.
 *
 * Nothing prompts when stdin is not a terminal, so a script or a CI job still
 * fails fast with the usual error instead of hanging on input that will never
 * arrive.
 */

import { createInterface } from 'node:readline/promises';
import { styleText } from 'node:util';
import type { ArgDef, CommandDef, MissingArg, PossibleValue } from './types.js';
import { possibleValues } from './parser.js';

/** Somewhere to ask questions. The default talks to the terminal. */
export interface PromptIO {
  /** Show `text` and resolve with the reply. */
  question(text: string): Promise<string>;
  /** As `question`, but the reply is not echoed. */
  secret(text: string): Promise<string>;
  /** Write to the prompt's output, for lists and errors. */
  write(text: string): void;
  /** Release the terminal. */
  close(): void;
  /** Whether anyone is there to answer. */
  readonly interactive: boolean;
}

let sharedIO: PromptIO | undefined;

/**
 * The PromptIO backed by the real terminal.
 *
 * Shared, because a readline interface takes ownership of stdin: a second one
 * finds the stream already consumed, so two prompts in a row would fail with
 * the input reported as ended. `close()` releases it, and the next call builds
 * a fresh one.
 */
export function terminalIO(): PromptIO {
  sharedIO ??= createTerminalIO();
  return sharedIO;
}

function createTerminalIO(): PromptIO {
  const interactive = process.stdin.isTTY === true && process.stdout.isTTY === true;
  let rl: ReturnType<typeof createInterface> | undefined;
  let lines: AsyncIterator<string> | undefined;

  const iface = (): ReturnType<typeof createInterface> => {
    // terminal: true against a pipe makes readline echo the whole buffer and
    // reorder it, so this follows whatever stdin actually is.
    rl ??= createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: interactive,
    });
    return rl;
  };

  /**
   * Pull one line.
   *
   * readline consumes a pipe greedily, so a second `question()` would find the
   * stream already drained and never resolve. Reading through the async
   * iterator keeps the lines queued and hands them out one at a time.
   */
  const nextLine = async (): Promise<string> => {
    lines ??= iface()[Symbol.asyncIterator]();
    const { value, done } = await lines.next();
    if (done === true) {
      throw new Error('input ended while waiting for an answer');
    }
    return value;
  };

  /**
   * readline decides what to echo through `_writeToOutput`, so overriding that
   * for one question masks the reply without touching process.stdout. Swapping
   * the stream's own write instead breaks the interface: the next read reports
   * the input as ended.
   */
  interface Maskable {
    _writeToOutput?: (chunk: string) => void;
    output?: { write(chunk: string): void };
  }

  const ask = async (text: string, mask: boolean): Promise<string> => {
    const active = iface();
    process.stdout.write(text);
    if (!mask) {
      return nextLine();
    }

    const hooked = active as unknown as Maskable;
    const original = hooked._writeToOutput;
    // Echo a bullet per printable character, and nothing for control keys.
    hooked._writeToOutput = (chunk: string) => {
      if (chunk.length === 1 && chunk >= ' ') {
        hooked.output?.write('*');
      }
    };
    try {
      return await nextLine();
    } finally {
      if (original === undefined) {
        delete hooked._writeToOutput;
      } else {
        hooked._writeToOutput = original;
      }
      process.stdout.write('\n');
    }
  };

  return {
    interactive,
    question: (text) => ask(text, false),
    secret: (text) => ask(text, true),
    write: (text) => {
      process.stdout.write(text);
    },
    close: () => {
      rl?.close();
      rl = undefined;
      lines = undefined;
      sharedIO = undefined;
    },
  };
}

/** A PromptIO that answers from a list, for tests. */
export function scriptedIO(answers: readonly string[]): PromptIO & { output: string } {
  let index = 0;
  const io = {
    interactive: true,
    output: '',
    question: (text: string) => {
      io.output += text;
      const answer = answers[index++] ?? '';
      io.output += `${answer}\n`;
      return Promise.resolve(answer);
    },
    secret: (text: string) => io.question(text),
    write: (text: string) => {
      io.output += text;
    },
    close: () => {},
  };
  return io;
}

function paint(text: string, codes: Parameters<typeof styleText>[0]): string {
  return styleText('red', 'x') === 'x' ? text : styleText(codes, text);
}

/** Common to every prompt. */
export interface AskOptions {
  /** Where to ask (default: the terminal). */
  readonly io?: PromptIO;
}

/** A prompt that can offer a text default when the reply is empty. */
export interface TextAskOptions extends AskOptions {
  readonly defaultValue?: string;
}

/** A confirm, whose default is a boolean rather than text. */
export interface ConfirmOptions extends AskOptions {
  readonly defaultValue?: boolean;
}

/** Ask for a line of text, returning the default when the reply is empty. */
export async function input(message: string, opts?: TextAskOptions): Promise<string> {
  const io = opts?.io ?? terminalIO();
  const hint = opts?.defaultValue === undefined ? '' : ` (${opts.defaultValue})`;
  const answer = (await io.question(`${paint('?', 'green')} ${message}${hint}: `)).trim();
  return answer.length > 0 ? answer : (opts?.defaultValue ?? '');
}

/** Ask for a secret, without echoing it. */
export async function password(message: string, opts?: AskOptions): Promise<string> {
  const io = opts?.io ?? terminalIO();
  return (await io.secret(`${paint('?', 'green')} ${message}: `)).trim();
}

/** Ask a yes or no question. */
export async function confirm(message: string, opts?: ConfirmOptions): Promise<boolean> {
  const io = opts?.io ?? terminalIO();
  const fallback = opts?.defaultValue ?? false;
  const hint = fallback ? 'Y/n' : 'y/N';
  const answer = (await io.question(`${paint('?', 'green')} ${message} (${hint}): `))
    .trim()
    .toLowerCase();
  if (answer.length === 0) {
    return fallback;
  }
  return answer === 'y' || answer === 'yes' || answer === 'true' || answer === '1';
}

/**
 * Offer a numbered list and take an index or the value itself.
 *
 * A numbered list rather than an arrow-key menu, so it behaves the same over
 * ssh, in a dumb terminal and under a test.
 */
export async function select(
  message: string,
  choices: readonly (string | PossibleValue)[],
  opts?: TextAskOptions,
): Promise<string> {
  const io = opts?.io ?? terminalIO();
  const values = choices.map((c) => (typeof c === 'string' ? { name: c } : c));
  if (values.length === 0) {
    throw new Error('select needs at least one choice');
  }

  for (;;) {
    io.write(`${paint('?', 'green')} ${message}\n`);
    values.forEach((choice, i) => {
      const help = choice.help === undefined ? '' : `  ${choice.help}`;
      io.write(`  ${String(i + 1)}) ${choice.name}${help}\n`);
    });

    const hint = opts?.defaultValue === undefined ? '' : ` (${opts.defaultValue})`;
    const answer = (await io.question(`  choice${hint}: `)).trim();

    if (answer.length === 0 && opts?.defaultValue !== undefined) {
      return opts.defaultValue;
    }
    const index = Number.parseInt(answer, 10);
    if (!Number.isNaN(index) && index >= 1 && index <= values.length) {
      return values[index - 1]!.name;
    }
    const named = values.find((c) => c.name === answer);
    if (named !== undefined) {
      return named.name;
    }
    io.write(`  ${paint('not one of the choices', 'yellow')}\n`);
  }
}

/** Offer a numbered list and take several answers, separated by commas. */
export async function multiselect(
  message: string,
  choices: readonly (string | PossibleValue)[],
  opts?: AskOptions,
): Promise<string[]> {
  const io = opts?.io ?? terminalIO();
  const values = choices.map((c) => (typeof c === 'string' ? { name: c } : c));

  for (;;) {
    io.write(`${paint('?', 'green')} ${message}\n`);
    values.forEach((choice, i) => {
      io.write(`  ${String(i + 1)}) ${choice.name}\n`);
    });
    const answer = (await io.question('  choices (comma separated): ')).trim();
    if (answer.length === 0) {
      return [];
    }

    const picked: string[] = [];
    let bad = false;
    for (const part of answer.split(',').map((p) => p.trim())) {
      const index = Number.parseInt(part, 10);
      if (!Number.isNaN(index) && index >= 1 && index <= values.length) {
        picked.push(values[index - 1]!.name);
        continue;
      }
      const named = values.find((c) => c.name === part);
      if (named === undefined) {
        bad = true;
        break;
      }
      picked.push(named.name);
    }
    if (!bad) {
      return picked;
    }
    io.write(`  ${paint('not one of the choices', 'yellow')}\n`);
  }
}

/** The message shown when asking for an argument. */
function messageFor(key: string, def: ArgDef): string {
  return def.description ?? def.longDescription ?? `Value for ${def.long ?? key}`;
}

/**
 * Ask for one argument, choosing the prompt from its definition.
 *
 * A boolean is a confirm, an argument with possible values is a list, one
 * marked `secret` is not echoed, and everything else is a line of text. The
 * result is validated against the argument's own parser before being accepted.
 */
export async function promptForArg(
  key: string,
  def: ArgDef,
  opts?: AskOptions,
): Promise<string | boolean | string[]> {
  const io = opts?.io ?? terminalIO();
  const message = messageFor(key, def);
  const values = possibleValues(def).filter((v) => !v.hidden);

  if (def.type === 'boolean') {
    return confirm(message, { io });
  }
  if (values.length > 0) {
    return def.action === 'append'
      ? multiselect(message, values, { io })
      : select(message, values, { io });
  }
  if (def.secret === true) {
    return password(message, { io });
  }

  for (;;) {
    const answer = await input(message, {
      io,
      ...(def.default === undefined ? {} : { defaultValue: String(def.default) }),
    });
    if (answer.length === 0) {
      io.write(`  ${paint('a value is required', 'yellow')}\n`);
      continue;
    }
    if (typeof def.valueParser === 'function') {
      try {
        def.valueParser(answer);
      } catch (error) {
        io.write(`  ${paint(error instanceof Error ? error.message : String(error), 'yellow')}\n`);
        continue;
      }
    }
    if (def.type === 'number' && Number.isNaN(Number(answer))) {
      io.write(`  ${paint('expected a number', 'yellow')}\n`);
      continue;
    }
    return answer;
  }
}

export interface PromptMissingOptions {
  /** Where to ask (default: the terminal). */
  readonly io?: PromptIO;
  /**
   * Ask even when stdin is not a terminal. Off by default, so a script fails
   * with the usual error rather than waiting for input that never comes.
   */
  readonly force?: boolean;
}

/**
 * A `fillMissing` hook that asks for each required argument still empty.
 *
 * ```ts
 * await runMain(main, { fillMissing: promptMissing() });
 * ```
 */
export function promptMissing(
  opts?: PromptMissingOptions,
): (missing: readonly MissingArg[], command: CommandDef<any>) => Promise<Record<string, unknown> | undefined> {
  return async (missing) => {
    const io = opts?.io ?? terminalIO();
    if (!io.interactive && opts?.force !== true) {
      io.close();
      return undefined;
    }

    const filled: Record<string, unknown> = {};
    try {
      for (const { key, def } of missing) {
        filled[key] = await promptForArg(key, def, { io });
      }
    } finally {
      io.close();
    }
    return filled;
  };
}
