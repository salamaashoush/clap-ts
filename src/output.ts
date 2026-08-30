/**
 * Structured terminal output: tables, key-value blocks and trees.
 *
 * ```ts
 * import { table, keyValue, tree } from 'clap-ts/output';
 *
 * ctx.stdout.write(table(rows, { columns: [{ key: 'name' }, { key: 'size', align: 'right' }] }));
 * ```
 *
 * Everything returns a string rather than writing, so the same call works
 * against `ctx.stdout`, a file, or an assertion. Widths follow the terminal,
 * and colour is only emitted when the destination can show it.
 */

import { styleText } from 'node:util';

/**
 * Character width tables.
 *
 * Flat sorted [start, end, ...] pairs searched by bisection: a handful of
 * comparisons per non-ASCII code point, and no allocation. Covers the East
 * Asian Wide and Fullwidth ranges plus emoji, which is what actually breaks
 * column alignment in a terminal.
 */
const WIDE = Int32Array.from([
  0x1100, 0x115f, 0x2329, 0x232a, 0x2e80, 0x303e, 0x3041, 0x33ff,
  0x3400, 0x4dbf, 0x4e00, 0x9fff, 0xa000, 0xa4cf, 0xa960, 0xa97f,
  0xac00, 0xd7a3, 0xf900, 0xfaff, 0xfe10, 0xfe19, 0xfe30, 0xfe6f,
  0xff00, 0xff60, 0xffe0, 0xffe6,
  0x1f004, 0x1f004, 0x1f0cf, 0x1f0cf, 0x1f18e, 0x1f18e, 0x1f191, 0x1f19a,
  0x1f200, 0x1f320, 0x1f32d, 0x1f335, 0x1f337, 0x1f37c, 0x1f37e, 0x1f393,
  0x1f3a0, 0x1f3ca, 0x1f3cf, 0x1f3d3, 0x1f3e0, 0x1f3f0, 0x1f3f4, 0x1f3f4,
  0x1f3f8, 0x1f43e, 0x1f440, 0x1f440, 0x1f442, 0x1f4fc, 0x1f4ff, 0x1f53d,
  0x1f54b, 0x1f54e, 0x1f550, 0x1f567, 0x1f57a, 0x1f57a, 0x1f595, 0x1f596,
  0x1f5a4, 0x1f5a4, 0x1f5fb, 0x1f64f, 0x1f680, 0x1f6c5, 0x1f6cc, 0x1f6cc,
  0x1f6d0, 0x1f6d2, 0x1f6eb, 0x1f6ec, 0x1f6f4, 0x1f6fc, 0x1f7e0, 0x1f7eb,
  0x1f90c, 0x1f93a, 0x1f93c, 0x1f945, 0x1f947, 0x1f9ff, 0x1fa70, 0x1faff,
  0x20000, 0x3fffd,
]);

/** Marks, joiners and selectors that occupy no column of their own. */
const ZERO = Int32Array.from([
  0x0300, 0x036f, 0x0483, 0x0489, 0x0591, 0x05bd, 0x0610, 0x061a,
  0x064b, 0x065f, 0x0670, 0x0670, 0x06d6, 0x06dc, 0x0730, 0x074a,
  0x07eb, 0x07f3, 0x0816, 0x0819, 0x081b, 0x0823, 0x0825, 0x0827,
  0x0829, 0x082d, 0x0859, 0x085b, 0x08e3, 0x0903, 0x093a, 0x093c,
  0x0941, 0x0948, 0x094d, 0x094d, 0x0951, 0x0957, 0x1ab0, 0x1aff,
  0x1dc0, 0x1dff, 0x200b, 0x200f, 0x2028, 0x202e, 0x2060, 0x2064,
  0x20d0, 0x20f0, 0xfe00, 0xfe0f, 0xfe20, 0xfe2f, 0xfeff, 0xfeff,
  0x1f3fb, 0x1f3ff, 0xe0100, 0xe01ef,
]);

/** Whether a code point falls inside a flat sorted range table. */
function inRanges(table: Int32Array, cp: number): boolean {
  let low = 0;
  let high = table.length / 2 - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (cp < table[mid * 2]!) {
      high = mid - 1;
    } else if (cp > table[mid * 2 + 1]!) {
      low = mid + 1;
    } else {
      return true;
    }
  }
  return false;
}

/** Columns a single code point occupies: 0, 1 or 2. */
export function codePointWidth(cp: number): number {
  if (cp < 0x7f) {
    // C0 controls take no space; everything else printable takes one.
    return cp < 0x20 ? 0 : 1;
  }
  if (cp < 0xa0) {
    return 0;
  }
  if (inRanges(ZERO, cp)) {
    return 0;
  }
  return inRanges(WIDE, cp) ? 2 : 1;
}

const ESC = 0x1b;

/**
 * Visible width of a string: ANSI escapes skipped, wide characters counted as
 * two columns, combining marks as none.
 *
 * A single pass with no allocation. Measuring by `String.length` lines a table
 * up wrongly the moment a cell holds CJK or an emoji, and stripping escapes
 * with a replace allocates a string per cell.
 */
export function displayWidth(text: string): number {
  let width = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);

    if (code === ESC) {
      i = skipEscape(text, i);
      continue;
    }
    if (code < 0x7f) {
      if (code >= 0x20) {
        width++;
      }
      continue;
    }

    // Combine a surrogate pair into one code point before measuring.
    let cp = code;
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const low = text.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        cp = (code - 0xd800) * 0x400 + low - 0xdc00 + 0x10000;
        i++;
      }
    }
    width += codePointWidth(cp);
  }
  return width;
}

/** Index of the last character of a CSI sequence starting at `start`. */
function skipEscape(text: string, start: number): number {
  if (text.charCodeAt(start + 1) !== 0x5b) {
    return start;
  }
  let i = start + 2;
  while (i < text.length) {
    const code = text.charCodeAt(i);
    // Parameter and intermediate bytes run until a final byte in @ to ~.
    if (code >= 0x40 && code <= 0x7e) {
      return i;
    }
    i++;
  }
  return text.length;
}

const ANSI = /\x1b\[[0-9;]*m/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}

/**
 * Pad to a visible width, so styled text lines up with plain text.
 *
 * `known` skips re-measuring when the caller already has the width, which the
 * table always does after truncating.
 */
function pad(text: string, width: number, align: Align, known?: number): string {
  const filler = ' '.repeat(Math.max(0, width - (known ?? displayWidth(text))));
  if (align === 'right') {
    return filler + text;
  }
  if (align === 'center') {
    const left = Math.floor(filler.length / 2);
    return ' '.repeat(left) + text + ' '.repeat(filler.length - left);
  }
  return text + filler;
}

/**
 * Truncate to a visible width, ending in an ellipsis when it does not fit.
 *
 * Walks code points rather than code units, so a surrogate pair is never split
 * into a lone half, and a wide character is never counted as one column.
 */
export function truncate(text: string, width: number): string {
  return fit(text, width).text;
}

/** Truncate and report the resulting visible width, measuring only once. */
function fit(text: string, width: number): { text: string; width: number } {
  const actual = displayWidth(text);
  if (width <= 0) {
    return { text: '', width: 0 };
  }
  if (actual <= width) {
    return { text, width: actual };
  }
  if (width === 1) {
    return { text: '…', width: 1 };
  }

  const budget = width - 1;
  let used = 0;
  let out = '';
  for (const char of stripAnsi(text)) {
    const cost = codePointWidth(char.codePointAt(0)!);
    if (used + cost > budget) {
      break;
    }
    used += cost;
    out += char;
  }
  return { text: `${out}…`, width: used + 1 };
}

export type Align = 'left' | 'right' | 'center';

export interface Column<T> {
  /** Property to read from each row. */
  readonly key: keyof T & string;
  /** Header text; defaults to the key. */
  readonly header?: string;
  /** Column alignment (default left). */
  readonly align?: Align;
  /** Cap this column's width, truncating what does not fit. */
  readonly maxWidth?: number;
  /** Render a cell; defaults to String(value), with undefined and null as ''. */
  readonly render?: (value: T[keyof T & string], row: T) => string;
}

export interface TableOptions<T> {
  readonly columns: readonly Column<T>[];
  /** Show the header row (default true). */
  readonly header?: boolean;
  /** Gap between columns (default 2 spaces). */
  readonly gap?: number;
  /** Total width to fit; defaults to the terminal width. */
  readonly width?: number;
  /** Draw a rule under the header (default false). */
  readonly rule?: boolean;
  /** Left indent for every line. */
  readonly indent?: number;
  /** Style the header; defaults to bold when colour is on. */
  readonly headerStyle?: (text: string) => string;
}

function terminalWidth(): number {
  const columns = process.stdout?.columns;
  return typeof columns === 'number' && columns > 0 ? columns : 80;
}

/** Whether the destination can show colour, matching how help decides. */
export function colorEnabled(): boolean {
  return styleText('red', 'x') !== 'x';
}

function defaultCell(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}

/**
 * Render rows as aligned columns.
 *
 * Columns are sized to their widest cell, then shrunk from the widest down
 * until the whole table fits the available width. Nothing is truncated while
 * anything still fits, so a narrow terminal costs the sprawling column first
 * rather than every column equally.
 */
export function table<T extends Record<string, unknown>>(
  rows: readonly T[],
  opts: TableOptions<T>,
): string {
  const { columns } = opts;
  if (columns.length === 0) {
    return '';
  }

  const gap = opts.gap ?? 2;
  const indent = opts.indent ?? 0;
  const showHeader = opts.header !== false;
  const headerStyle =
    opts.headerStyle ?? (colorEnabled() ? (t: string) => styleText('bold', t) : (t: string) => t);

  const headers = columns.map((c) => c.header ?? c.key);
  const cells = rows.map((row) =>
    columns.map((c) => (c.render ? c.render(row[c.key] as never, row) : defaultCell(row[c.key]))),
  );

  const widths = columns.map((c, i) => {
    let width = showHeader ? displayWidth(headers[i]!) : 0;
    for (const line of cells) {
      width = Math.max(width, displayWidth(line[i]!));
    }
    return c.maxWidth === undefined ? width : Math.min(width, c.maxWidth);
  });

  // Shrink the widest column repeatedly until the table fits.
  const available = (opts.width ?? terminalWidth()) - indent;
  const overhead = gap * (columns.length - 1);
  let total = widths.reduce((sum, w) => sum + w, 0) + overhead;
  while (total > available) {
    let widest = 0;
    for (let i = 1; i < widths.length; i++) {
      if (widths[i]! > widths[widest]!) {
        widest = i;
      }
    }
    if (widths[widest]! <= 3) {
      break;
    }
    widths[widest]!--;
    total--;
  }

  const spacer = ' '.repeat(gap);
  const prefix = ' '.repeat(indent);
  const lines: string[] = [];

  const renderRow = (values: readonly string[], style?: (t: string) => string): string => {
    const parts = values.map((value, i) => {
      const cut = fit(value, widths[i]!);
      // Styling adds escapes but no columns, so the measured width still holds.
      const shown = style ? style(cut.text) : cut.text;
      return pad(shown, widths[i]!, columns[i]?.align ?? 'left', cut.width);
    });
    return (prefix + parts.join(spacer)).trimEnd();
  };

  if (showHeader) {
    lines.push(renderRow(headers, headerStyle));
    if (opts.rule === true) {
      lines.push(prefix + widths.map((w) => '─'.repeat(w)).join(spacer));
    }
  }
  for (const line of cells) {
    lines.push(renderRow(line));
  }

  return `${lines.join('\n')}\n`;
}

export interface KeyValueOptions {
  /** Left indent for every line. */
  readonly indent?: number;
  /** Separator between key and value (default ': '). */
  readonly separator?: string;
  /** Total width to wrap within; defaults to the terminal width. */
  readonly width?: number;
  /** Style the keys; defaults to bold when colour is on. */
  readonly keyStyle?: (text: string) => string;
}

/**
 * Render pairs as an aligned block, wrapping long values under their key.
 *
 * ```
 * Name:    clap-ts
 * Version: 0.3.0
 * ```
 */
export function keyValue(
  pairs: readonly (readonly [string, string])[] | Record<string, string>,
  opts?: KeyValueOptions,
): string {
  const entries = Array.isArray(pairs)
    ? (pairs as readonly (readonly [string, string])[])
    : Object.entries(pairs as Record<string, string>);
  if (entries.length === 0) {
    return '';
  }

  const separator = opts?.separator ?? ': ';
  const indent = opts?.indent ?? 0;
  const keyStyle =
    opts?.keyStyle ?? (colorEnabled() ? (t: string) => styleText('bold', t) : (t: string) => t);

  const keyWidth = Math.max(...entries.map(([key]) => displayWidth(key)));
  const valueColumn = indent + keyWidth + separator.length;
  const available = Math.max(20, (opts?.width ?? terminalWidth()) - valueColumn);

  const lines: string[] = [];
  for (const [key, value] of entries) {
    const label = ' '.repeat(indent) + keyStyle(key + separator) + ' '.repeat(keyWidth - displayWidth(key));
    const wrapped = wrap(value, available);
    lines.push((label + wrapped[0]!).trimEnd());
    for (const rest of wrapped.slice(1)) {
      lines.push(' '.repeat(valueColumn) + rest);
    }
  }
  return `${lines.join('\n')}\n`;
}

/** Break text into lines no wider than `width`, on whitespace. */
function wrap(text: string, width: number): string[] {
  if (displayWidth(text) <= width) {
    return [text];
  }
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/)) {
    if (current.length === 0) {
      current = word;
    } else if (displayWidth(current) + 1 + displayWidth(word) <= width) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current.length > 0) {
    lines.push(current);
  }
  return lines;
}

/** A node in a tree, with whatever children it has. */
export interface TreeNode {
  readonly label: string;
  readonly children?: readonly TreeNode[];
}

export interface TreeOptions {
  /** Use ASCII connectors instead of box-drawing characters. */
  readonly ascii?: boolean;
  /** Left indent for every line. */
  readonly indent?: number;
}

/**
 * Render a tree with connector lines.
 *
 * ```
 * root
 * ├── one
 * │   └── nested
 * └── two
 * ```
 */
export function tree(root: TreeNode | readonly TreeNode[], opts?: TreeOptions): string {
  const ascii = opts?.ascii === true;
  const glyphs = ascii
    ? { branch: '|-- ', last: '`-- ', pipe: '|   ', blank: '    ' }
    : { branch: '├── ', last: '└── ', pipe: '│   ', blank: '    ' };
  const prefix = ' '.repeat(opts?.indent ?? 0);
  const lines: string[] = [];

  const walk = (node: TreeNode, ancestry: string, isLast: boolean, isRoot: boolean): void => {
    if (isRoot) {
      lines.push(prefix + node.label);
    } else {
      lines.push(prefix + ancestry + (isLast ? glyphs.last : glyphs.branch) + node.label);
    }
    const children = node.children ?? [];
    const childAncestry = isRoot ? '' : ancestry + (isLast ? glyphs.blank : glyphs.pipe);
    children.forEach((child, i) => {
      walk(child, childAncestry, i === children.length - 1, false);
    });
  };

  const roots = Array.isArray(root) ? (root as readonly TreeNode[]) : [root as TreeNode];
  roots.forEach((node) => {
    walk(node, '', true, true);
  });

  return `${lines.join('\n')}\n`;
}
