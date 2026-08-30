/**
 * Response files and stdin, the `@file` convention git, gcc and java use for
 * command lines too long to type or to pass through the shell's ARG_MAX.
 *
 * ```ts
 * import { expandArgFiles, readStdin } from 'clap-ts/argfile';
 *
 * await runMain(main, { argv: expandArgFiles() });
 * ```
 *
 * clap has no equivalent, so the shape here follows gcc: one argument per line,
 * `#` comments and blank lines skipped, quoted runs kept together, and a
 * literal `@` escaped as `@@`.
 */

import { readFileSync } from 'node:fs';
import { getRawArgs } from './parser.js';

export interface ArgFileOptions {
  /** Prefix marking a response file (default '@'). */
  readonly prefix?: string;
  /** How deep a response file may reference another (default 5). */
  readonly maxDepth?: number;
  /** Read a file's text. Defaults to reading UTF-8 from disk. */
  readonly read?: (path: string) => string;
}

/**
 * Split response-file text into arguments.
 *
 * Whitespace separates, `#` at the start of a line comments the rest of it out,
 * and single or double quotes group a run containing spaces. A backslash
 * escapes the next character inside or outside quotes.
 */
export function parseArgFile(text: string): string[] {
  const args: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;
  let hasToken = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;

    if (ch === '\\' && i + 1 < text.length) {
      current += text[i + 1]!;
      hasToken = true;
      i++;
      continue;
    }

    if (quote !== undefined) {
      if (ch === quote) {
        quote = undefined;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      hasToken = true;
      continue;
    }

    // A comment runs to the end of its line, and only starts a token boundary.
    if (ch === '#' && !hasToken) {
      while (i < text.length && text[i] !== '\n') {
        i++;
      }
      continue;
    }

    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      if (hasToken) {
        args.push(current);
        current = '';
        hasToken = false;
      }
      continue;
    }

    current += ch;
    hasToken = true;
  }

  if (quote !== undefined) {
    throw new Error(`unterminated ${quote === '"' ? 'double' : 'single'} quote in response file`);
  }
  if (hasToken) {
    args.push(current);
  }
  return args;
}

/**
 * Replace every `@file` in argv with that file's arguments.
 *
 * Reads `process.argv` when given nothing. A response file may reference
 * another up to `maxDepth`; `@@` is a literal argument starting with `@`, and
 * everything after a bare `--` is left alone.
 */
export function expandArgFiles(
  argv: readonly string[] = getRawArgs(),
  opts?: ArgFileOptions,
): string[] {
  const prefix = opts?.prefix ?? '@';
  const maxDepth = opts?.maxDepth ?? 5;
  const read = opts?.read ?? ((path: string) => readFileSync(path, 'utf8'));

  const expand = (tokens: readonly string[], depth: number): string[] => {
    const out: string[] = [];
    let escaped = false;

    for (const token of tokens) {
      if (escaped || !token.startsWith(prefix) || token.length === prefix.length) {
        out.push(token);
        if (token === '--') {
          escaped = true;
        }
        continue;
      }

      // `@@file` means a literal argument that happens to start with `@`.
      if (token.startsWith(prefix + prefix)) {
        out.push(token.slice(prefix.length));
        continue;
      }

      if (depth >= maxDepth) {
        throw new Error(`response files nested more than ${String(maxDepth)} deep at '${token}'`);
      }

      const path = token.slice(prefix.length);
      let text: string;
      try {
        text = read(path);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`cannot read response file '${path}': ${message}`);
      }
      out.push(...expand(parseArgFile(text), depth + 1));
    }

    return out;
  };

  return expand(argv, 0);
}

/**
 * Read all of stdin as text, for the `-` convention meaning "read from stdin".
 *
 * Resolves to undefined when stdin is a terminal, so an interactive run does
 * not hang waiting for input that is never coming.
 */
export async function readStdin(): Promise<string | undefined> {
  if (process.stdin.isTTY === true) {
    return undefined;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Resolve a path argument, reading stdin when it is `-`.
 *
 * ```ts
 * const source = await readPathOrStdin(args.input);
 * ```
 */
export async function readPathOrStdin(
  path: string,
  opts?: { readonly read?: (path: string) => string },
): Promise<string> {
  if (path === '-') {
    const text = await readStdin();
    if (text === undefined) {
      throw new Error('reading from stdin was requested but stdin is a terminal');
    }
    return text;
  }
  const read = opts?.read ?? ((p: string) => readFileSync(p, 'utf8'));
  return read(path);
}
