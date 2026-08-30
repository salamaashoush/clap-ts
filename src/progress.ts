/**
 * Spinners and progress bars that know when nobody is watching.
 *
 * ```ts
 * import { spinner, progressBar } from 'clap-ts/progress';
 *
 * const spin = spinner('Fetching');
 * spin.start();
 * await work();
 * spin.succeed('Fetched 12 items');
 * ```
 *
 * Both write to stderr and both go quiet when it is not a terminal, so piping a
 * command's output never fills a log file with redraw escapes. `NO_COLOR` and
 * `CI` are honoured the same way.
 */

import { styleText } from 'node:util';
import type { OutputSink } from './types.js';
import { displayWidth, truncate } from './output.js';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const ASCII_FRAMES = ['-', '\\', '|', '/'];

/** A stream that can also be interrogated about being a terminal. */
interface MaybeTty extends OutputSink {
  isTTY?: boolean;
  columns?: number;
}

export interface ProgressOptions {
  /** Where to draw (default process.stderr). */
  readonly sink?: OutputSink;
  /**
   * Draw at all. Defaults to true only when the sink is a terminal and CI is
   * unset, so redirected output stays clean.
   */
  readonly enabled?: boolean;
  /** Use ASCII frames instead of braille. */
  readonly ascii?: boolean;
  /** Milliseconds between spinner frames (default 80). */
  readonly interval?: number;
  /** Force colour on or off. */
  readonly color?: boolean;
  /**
   * Shortest gap between redraws, in milliseconds (default 16, about 60 a
   * second). A loop that updates thousands of times a second would otherwise
   * spend its time writing escape sequences nobody can read.
   */
  readonly throttle?: number;
}

const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const CLEAR_LINE = '\r\x1b[2K';

/** Columns available to draw into. */
function widthOf(sink: MaybeTty): number {
  return typeof sink.columns === 'number' && sink.columns > 0 ? sink.columns : 80;
}

function resolveSink(opts?: ProgressOptions): MaybeTty {
  return (opts?.sink ?? process.stderr) as MaybeTty;
}

function shouldDraw(sink: MaybeTty, opts?: ProgressOptions): boolean {
  if (opts?.enabled !== undefined) {
    return opts.enabled;
  }
  // A pipe, a file or a CI log gets no redraws.
  return sink.isTTY === true && process.env['CI'] === undefined;
}

function paint(color: boolean, codes: Parameters<typeof styleText>[0], text: string): string {
  return color ? styleText(codes, text, { validateStream: false }) : text;
}

export interface Spinner {
  /** Begin animating. Safe to call twice. */
  start(text?: string): Spinner;
  /** Change the message without interrupting the animation. */
  update(text: string): Spinner;
  /** Stop and leave a green tick. */
  succeed(text?: string): Spinner;
  /** Stop and leave a red cross. */
  fail(text?: string): Spinner;
  /** Stop and leave a yellow warning mark. */
  warn(text?: string): Spinner;
  /** Stop and erase, leaving nothing behind. */
  stop(): Spinner;
  /** Whether this spinner draws anything at all. */
  readonly enabled: boolean;
}

/**
 * A spinner for work of unknown length.
 *
 * When drawing is off the terminating calls still print their message once, so
 * a piped run reports what happened without any animation.
 */
export function spinner(initialText = '', opts?: ProgressOptions): Spinner {
  const sink = resolveSink(opts);
  const enabled = shouldDraw(sink, opts);
  const frames = opts?.ascii === true ? ASCII_FRAMES : FRAMES;
  const interval = opts?.interval ?? 80;
  const color = opts?.color ?? styleText('red', 'x') !== 'x';

  let text = initialText;
  let frame = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let cursorHidden = false;

  const restoreCursor = (): void => {
    if (cursorHidden) {
      sink.write(SHOW_CURSOR);
      cursorHidden = false;
    }
  };

  const clear = (): void => {
    sink.write(CLEAR_LINE);
  };

  const draw = (): void => {
    clear();
    // Two columns for the frame and its space; anything longer wraps, and a
    // wrapped line cannot be erased by a single carriage return.
    const room = widthOf(sink) - 2;
    sink.write(`${paint(color, 'cyan', frames[frame]!)} ${truncate(text, room)}`);
    frame = (frame + 1) % frames.length;
  };

  const finish = (mark: string, codes: Parameters<typeof styleText>[0], done?: string): Spinner => {
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
    const message = done ?? text;
    if (enabled) {
      clear();
      restoreCursor();
    }
    if (message.length > 0) {
      sink.write(`${paint(color, codes, mark)} ${message}\n`);
    }
    return api;
  };

  const api: Spinner = {
    enabled,
    start(next) {
      if (next !== undefined) {
        text = next;
      }
      if (!enabled || timer !== undefined) {
        return api;
      }
      // A visible cursor flickers over the animating frame.
      sink.write(HIDE_CURSOR);
      cursorHidden = true;
      draw();
      timer = setInterval(draw, interval);
      // Never hold the event loop open for a spinner.
      timer.unref?.();
      return api;
    },
    update(next) {
      text = next;
      if (enabled && timer !== undefined) {
        draw();
      }
      return api;
    },
    succeed: (done) => finish('✔', 'green', done),
    fail: (done) => finish('✖', 'red', done),
    warn: (done) => finish('⚠', 'yellow', done),
    stop() {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
      if (enabled) {
        clear();
        restoreCursor();
      }
      return api;
    },
  };

  return api;
}

export interface ProgressBar {
  /** Move to an absolute position. */
  update(current: number, text?: string): ProgressBar;
  /** Move forward by an amount (default 1). */
  tick(by?: number, text?: string): ProgressBar;
  /** Fill the bar and finish the line. */
  finish(text?: string): ProgressBar;
  /** Abandon the bar, erasing it. */
  stop(): ProgressBar;
  /** Render the current line without drawing it, for tests. */
  render(): string;
  readonly enabled: boolean;
}

export interface ProgressBarOptions extends ProgressOptions {
  /** Total the bar counts up to. */
  readonly total: number;
  /** Bar width in characters (default: a third of the terminal, 20 to 40). */
  readonly width?: number;
  /** Label shown before the bar. */
  readonly text?: string;
}

/**
 * A determinate progress bar.
 *
 * `render` returns the line it would draw, which is what makes this testable
 * without a terminal.
 */
export function progressBar(opts: ProgressBarOptions): ProgressBar {
  const sink = resolveSink(opts);
  const enabled = shouldDraw(sink, opts);
  const color = opts.color ?? styleText('red', 'x') !== 'x';
  const total = Math.max(1, opts.total);
  const columns = widthOf(sink);
  const width = opts.width ?? Math.min(40, Math.max(20, Math.floor(columns / 3)));
  const throttle = opts.throttle ?? 16;

  let current = 0;
  let text = opts.text ?? '';
  let lastDraw = 0;

  const render = (): string => {
    const ratio = Math.min(1, current / total);
    const filled = Math.round(ratio * width);
    const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
    const percent = `${String(Math.round(ratio * 100)).padStart(3)}%`;
    const counts = `${String(current)}/${String(total)}`;
    const line = `${bar} ${percent} ${counts}${text.length > 0 ? ` ${text}` : ''}`;

    // Fit the terminal: a line that wraps cannot be erased by a carriage
    // return, so the next redraw would stack instead of replacing.
    const fitted = displayWidth(line) > columns ? truncate(line, columns) : line;
    return color ? fitted.replace(bar, paint(color, 'cyan', bar)) : fitted;
  };

  const draw = (force: boolean): void => {
    const now = Date.now();
    // The final frame always lands; the ones in between can be skipped.
    if (!force && throttle > 0 && now - lastDraw < throttle) {
      return;
    }
    lastDraw = now;
    sink.write(`${CLEAR_LINE}${render()}`);
  };

  const api: ProgressBar = {
    enabled,
    render,
    update(next, nextText) {
      current = Math.max(0, Math.min(total, next));
      if (nextText !== undefined) {
        text = nextText;
      }
      if (enabled) {
        draw(false);
      }
      return api;
    },
    tick: (by = 1, nextText) => api.update(current + by, nextText),
    finish(done) {
      current = total;
      if (done !== undefined) {
        text = done;
      }
      if (enabled) {
        draw(true);
        sink.write('\n');
      } else if (text.length > 0) {
        sink.write(`${text}\n`);
      }
      return api;
    },
    stop() {
      if (enabled) {
        sink.write(CLEAR_LINE);
      }
      return api;
    },
  };

  return api;
}
