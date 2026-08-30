/**
 * Tests for response files and the stdin conventions.
 */

import { describe, test, expect } from 'bun:test';
import { parseArgFile, expandArgFiles, readPathOrStdin } from '../argfile.js';

describe('parseArgFile', () => {
  test('splits on whitespace and newlines', () => {
    expect(parseArgFile('--port 8080\n--host localhost')).toEqual([
      '--port',
      '8080',
      '--host',
      'localhost',
    ]);
  });

  test('skips blank lines', () => {
    expect(parseArgFile('\n\n--a\n\n  \n--b\n')).toEqual(['--a', '--b']);
  });

  test('treats # as a comment to end of line', () => {
    expect(parseArgFile('# a note\n--a  # trailing\n--b')).toEqual(['--a', '--b']);
  });

  test('keeps a quoted run together', () => {
    expect(parseArgFile('--msg "hello there" --other \'one two\'')).toEqual([
      '--msg',
      'hello there',
      '--other',
      'one two',
    ]);
  });

  test('a quoted empty string survives', () => {
    expect(parseArgFile('--msg ""')).toEqual(['--msg', '']);
  });

  test('a hash inside a token is not a comment', () => {
    expect(parseArgFile('--tag v1#2')).toEqual(['--tag', 'v1#2']);
  });

  test('backslash escapes the next character', () => {
    expect(parseArgFile(String.raw`--path a\ b`)).toEqual(['--path', 'a b']);
  });

  test('an unterminated quote is an error', () => {
    expect(() => parseArgFile('--msg "unclosed')).toThrow('unterminated double quote');
  });
});

describe('expandArgFiles', () => {
  const files: Record<string, string> = {
    'common.txt': '--verbose\n--port 8080',
    'outer.txt': '--first\n@inner.txt',
    'inner.txt': '--second',
    'loop.txt': '@loop.txt',
  };
  const read = (path: string): string => {
    const text = files[path];
    if (text === undefined) {
      throw new Error('ENOENT');
    }
    return text;
  };

  test('splices a response file in place', () => {
    expect(expandArgFiles(['--a', '@common.txt', '--b'], { read })).toEqual([
      '--a',
      '--verbose',
      '--port',
      '8080',
      '--b',
    ]);
  });

  test('leaves ordinary arguments alone', () => {
    expect(expandArgFiles(['--a', 'b'], { read })).toEqual(['--a', 'b']);
  });

  test('a response file may reference another', () => {
    expect(expandArgFiles(['@outer.txt'], { read })).toEqual(['--first', '--second']);
  });

  test('@@ escapes a literal leading at-sign', () => {
    expect(expandArgFiles(['@@notafile'], { read })).toEqual(['@notafile']);
  });

  test('a bare @ is left as itself', () => {
    expect(expandArgFiles(['@'], { read })).toEqual(['@']);
  });

  test('nothing after -- is expanded', () => {
    expect(expandArgFiles(['--', '@common.txt'], { read })).toEqual(['--', '@common.txt']);
  });

  test('a missing file names itself in the error', () => {
    expect(() => expandArgFiles(['@nope.txt'], { read })).toThrow(
      "cannot read response file 'nope.txt'",
    );
  });

  test('runaway nesting is caught', () => {
    expect(() => expandArgFiles(['@loop.txt'], { read })).toThrow('nested more than');
  });

  test('the prefix is configurable', () => {
    expect(expandArgFiles(['+common.txt'], { read, prefix: '+' })).toEqual([
      '--verbose',
      '--port',
      '8080',
    ]);
  });
});

describe('readPathOrStdin', () => {
  test('reads a path through the injected reader', async () => {
    const text = await readPathOrStdin('some.txt', { read: () => 'contents' });
    expect(text).toBe('contents');
  });

  test('- asks for stdin, which is a terminal under no redirection', async () => {
    if (process.stdin.isTTY === true) {
      await expect(readPathOrStdin('-')).rejects.toThrow('stdin is a terminal');
    }
  });
});
