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

/** Visible width of a string, ignoring ANSI escapes. */
export function displayWidth(text: string): number {
  return stripAnsi(text).length;
}

const ANSI = /\x1b\[[0-9;]*m/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}

/** Pad to a visible width, so styled text lines up with plain text. */
function pad(text: string, width: number, align: Align): string {
  const filler = ' '.repeat(Math.max(0, width - displayWidth(text)));
  if (align === 'right') {
    return filler + text;
  }
  if (align === 'center') {
    const left = Math.floor(filler.length / 2);
    return ' '.repeat(left) + text + ' '.repeat(filler.length - left);
  }
  return text + filler;
}

/** Truncate to a visible width, ending in an ellipsis when it does not fit. */
export function truncate(text: string, width: number): string {
  if (width <= 0) {
    return '';
  }
  const plain = stripAnsi(text);
  if (plain.length <= width) {
    return text;
  }
  return width === 1 ? '…' : `${plain.slice(0, width - 1)}…`;
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
      const cut = truncate(value, widths[i]!);
      return pad(style ? style(cut) : cut, widths[i]!, columns[i]?.align ?? 'left');
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
