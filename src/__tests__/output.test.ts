/**
 * Tests for structured terminal output: tables, key-value blocks and trees.
 */

import { describe, test, expect } from 'bun:test';
import { table, keyValue, tree, truncate, displayWidth } from '../output.js';
import { stripAnsi } from '../testing.js';

const rows = [
  { name: 'parser.ts', size: 32832, kind: 'source' },
  { name: 'completions.ts', size: 26550, kind: 'source' },
  { name: 'index.ts', size: 828, kind: 'entry' },
];

const plainHeader = { headerStyle: (t: string) => t };

describe('displayWidth and truncate', () => {
  test('width ignores ANSI escapes', () => {
    expect(displayWidth('\x1b[1mbold\x1b[22m')).toBe(4);
  });

  test('truncate leaves short text alone', () => {
    expect(truncate('abc', 10)).toBe('abc');
  });

  test('truncate ends in an ellipsis', () => {
    expect(truncate('abcdefgh', 4)).toBe('abc…');
  });

  test('truncate handles degenerate widths', () => {
    expect(truncate('abc', 1)).toBe('…');
    expect(truncate('abc', 0)).toBe('');
  });
});

describe('table', () => {
  const opts = { columns: [{ key: 'name' as const }, { key: 'size' as const }], ...plainHeader };

  test('aligns columns to their widest cell', () => {
    const lines = table(rows, opts).trimEnd().split('\n');
    // 'completions.ts' is the widest name, so every size starts two past it.
    const column = 'completions.ts'.length + 2;
    expect(lines[0]!.indexOf('size')).toBe(column);
    expect(lines[1]!.indexOf('32832')).toBe(column);
    expect(lines[3]!.indexOf('828')).toBe(column);
  });

  test('emits a header by default and drops it on request', () => {
    expect(table(rows, opts)).toContain('name');
    expect(table(rows, { ...opts, header: false })).not.toContain('name  ');
  });

  test('right alignment pushes values to the column edge', () => {
    const out = table(rows, {
      columns: [{ key: 'name' }, { key: 'size', align: 'right' }],
      ...plainHeader,
    });
    const lines = out.trimEnd().split('\n');
    const ends = lines.slice(1).map((l) => l.length);
    expect(new Set(ends).size).toBe(1);
  });

  test('a render function formats the cell', () => {
    const out = table(rows, {
      columns: [{ key: 'name' }, { key: 'size', render: (v) => `${String(v)} B` }],
      ...plainHeader,
    });
    expect(out).toContain('32832 B');
  });

  test('never exceeds the requested width', () => {
    for (const width of [80, 40, 24, 16]) {
      const out = table(rows, {
        columns: [{ key: 'name' }, { key: 'size' }, { key: 'kind' }],
        width,
        ...plainHeader,
      });
      for (const line of out.trimEnd().split('\n')) {
        expect(stripAnsi(line).length).toBeLessThanOrEqual(width);
      }
    }
  });

  test('maxWidth truncates a single column', () => {
    const out = table(rows, {
      columns: [{ key: 'name', maxWidth: 6 }],
      ...plainHeader,
    });
    expect(out).toContain('compl…');
  });

  test('indent shifts every line', () => {
    const out = table(rows, { ...opts, indent: 4 });
    for (const line of out.trimEnd().split('\n')) {
      expect(line.startsWith('    ')).toBe(true);
    }
  });

  test('a rule sits under the header', () => {
    expect(table(rows, { ...opts, rule: true }).split('\n')[1]).toMatch(/^─+\s+─+$/);
  });

  test('no columns yields nothing', () => {
    expect(table(rows, { columns: [] })).toBe('');
  });

  test('no rows still yields the header', () => {
    expect(table([], opts).trimEnd()).toBe('name  size');
  });

  test('undefined and null cells render empty', () => {
    const sparse = [{ a: undefined, b: null, c: 'x' }];
    const out = table(sparse as never, {
      columns: [{ key: 'a' }, { key: 'b' }, { key: 'c' }],
      ...plainHeader,
    });
    expect(out.trimEnd().split('\n')[1]?.trim()).toBe('x');
  });
});

describe('keyValue', () => {
  const plainKey = { keyStyle: (t: string) => t };

  test('aligns values past the widest key', () => {
    const [first, second] = keyValue({ Name: 'clap-ts', Version: '0.3.0' }, plainKey)
      .trimEnd()
      .split('\n');
    expect(first!.indexOf('clap-ts')).toBe(second!.indexOf('0.3.0'));
  });

  test('accepts pairs as well as an object', () => {
    expect(keyValue([['a', '1']], plainKey)).toBe(keyValue({ a: '1' }, plainKey));
  });

  test('wraps a long value under its key', () => {
    const out = keyValue({ Key: 'one two three four five six seven eight' }, { width: 20, ...plainKey });
    const lines = out.trimEnd().split('\n');
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[1]!.startsWith('     ')).toBe(true);
  });

  test('nothing in, nothing out', () => {
    expect(keyValue({})).toBe('');
  });

  test('the separator is configurable', () => {
    expect(keyValue({ a: '1' }, { separator: ' = ', ...plainKey })).toBe('a = 1\n');
  });
});

describe('tree', () => {
  const sample = {
    label: 'demo',
    children: [{ label: 'serve', children: [{ label: '--port' }] }, { label: 'build' }],
  };

  test('draws connectors, with the last child closing the branch', () => {
    expect(tree(sample)).toBe('demo\n├── serve\n│   └── --port\n└── build\n');
  });

  test('ascii mode avoids box-drawing characters', () => {
    const out = tree(sample, { ascii: true });
    expect(out).toContain('|-- serve');
    expect(out).toContain('`-- build');
    expect(out).not.toMatch(/[├└│─]/);
  });

  test('a leaf is just its label', () => {
    expect(tree({ label: 'only' })).toBe('only\n');
  });

  test('several roots each start at column zero', () => {
    expect(tree([{ label: 'a' }, { label: 'b' }])).toBe('a\nb\n');
  });

  test('indent shifts every line', () => {
    for (const line of tree(sample, { indent: 2 }).trimEnd().split('\n')) {
      expect(line.startsWith('  ')).toBe(true);
    }
  });
});

// ---- Character width ----

describe('width of characters a terminal renders differently', () => {
  test('wide East Asian characters count as two columns', () => {
    expect(displayWidth('日本語')).toBe(6);
    expect(displayWidth('한국어')).toBe(6);
    expect(displayWidth('ａｂｃ')).toBe(6); // fullwidth latin
  });

  test('emoji count as two columns', () => {
    expect(displayWidth('\u{1f389}')).toBe(2);
    expect(displayWidth('\u{1f680}\u{1f680}')).toBe(4);
  });

  test('a skin tone modifier adds nothing of its own', () => {
    expect(displayWidth('\u{1f44d}\u{1f3fd}')).toBe(2);
  });

  test('combining marks add nothing', () => {
    expect(displayWidth('é')).toBe(1); // decomposed
    expect(displayWidth('é')).toBe(1); // precomposed
  });

  test('zero width and control characters add nothing', () => {
    expect(displayWidth('a​b')).toBe(2);
    expect(displayWidth('ab')).toBe(2);
  });

  test('ANSI escapes are skipped, including non-colour ones', () => {
    expect(displayWidth('\x1b[1m\x1b[32mhi\x1b[39m\x1b[22m')).toBe(2);
    expect(displayWidth('\x1b[2Khi')).toBe(2);
  });

  test('a table of wide text still aligns', () => {
    const out = table(
      [
        { a: '日本語のファイル', b: '1' },
        { a: 'ascii.ts', b: '22' },
      ],
      { columns: [{ key: 'a' }, { key: 'b' }], headerStyle: (t) => t },
    );
    const [, wide, plain] = out.trimEnd().split('\n');
    // Both second columns start at the same visible column.
    expect(displayWidth(wide!.slice(0, wide!.indexOf('1')))).toBe(
      displayWidth(plain!.slice(0, plain!.indexOf('22'))),
    );
  });
});

describe('truncate respects character boundaries', () => {
  test('never leaves half a surrogate pair', () => {
    for (const width of [1, 2, 3, 4, 5]) {
      const out = truncate('\u{1f389}\u{1f389}\u{1f389}', width);
      expect(out).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
      expect(displayWidth(out)).toBeLessThanOrEqual(width);
    }
  });

  test('the result never exceeds the requested width', () => {
    const samples = ['abcdefghij', '日本語のフ', '\u{1f389} party', 'éé'];
    for (const text of samples) {
      for (const width of [1, 2, 3, 5, 8]) {
        expect(displayWidth(truncate(text, width))).toBeLessThanOrEqual(width);
      }
    }
  });
});
