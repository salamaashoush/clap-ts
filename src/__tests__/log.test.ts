/**
 * Tests for the levelled logger and how it reads verbosity arguments.
 */

import { describe, test, expect } from 'bun:test';
import { createLogger, levelFromArgs, loggerFrom, LEVELS } from '../log.js';
import { defineCommand } from '../runner.js';
import { runCli } from '../testing.js';
import type { OutputSink } from '../types.js';

function collector(): OutputSink & { text(): string } {
  const chunks: string[] = [];
  return {
    write(chunk: string) {
      chunks.push(chunk);
    },
    text: () => chunks.join(''),
  };
}

const plain = { color: false };

describe('createLogger', () => {
  test('info is the default level', () => {
    const sink = collector();
    const log = createLogger({ sink, ...plain });
    log.info('shown');
    log.debug('hidden');
    expect(sink.text()).toBe('info: shown\n');
  });

  test('a higher level lets more through', () => {
    const sink = collector();
    createLogger({ sink, level: 'trace', ...plain }).trace('deep');
    expect(sink.text()).toBe('trace: deep\n');
  });

  test('silent writes nothing at all', () => {
    const sink = collector();
    const log = createLogger({ sink, level: 'silent', ...plain });
    for (const level of LEVELS) {
      if (level !== 'silent') {
        log[level]('anything');
      }
    }
    expect(sink.text()).toBe('');
  });

  test('enabled answers without writing', () => {
    const log = createLogger({ sink: collector(), level: 'warn', ...plain });
    expect(log.enabled('error')).toBe(true);
    expect(log.enabled('warn')).toBe(true);
    expect(log.enabled('info')).toBe(false);
  });

  test('extra values are appended, objects as JSON', () => {
    const sink = collector();
    createLogger({ sink, ...plain }).info('msg', 'a', { b: 1 });
    expect(sink.text()).toBe('info: msg a {"b":1}\n');
  });

  test('a prefix leads every line', () => {
    const sink = collector();
    createLogger({ sink, prefix: '[tool]', ...plain }).info('hi');
    expect(sink.text()).toBe('[tool] info: hi\n');
  });

  test('withLevel keeps the sink', () => {
    const sink = collector();
    createLogger({ sink, ...plain }).withLevel('debug').debug('now shown');
    expect(sink.text()).toBe('debug: now shown\n');
  });

  test('colour is off when asked', () => {
    const sink = collector();
    createLogger({ sink, color: false }).error('e');
    expect(sink.text()).not.toContain('\x1b[');
  });

  test('colour is emitted when forced', () => {
    const sink = collector();
    createLogger({ sink, color: true }).error('e');
    expect(sink.text()).toContain('\x1b[');
  });
});

describe('levelFromArgs', () => {
  test('no flags means info', () => {
    expect(levelFromArgs({})).toBe('info');
  });

  test('each -v climbs a step', () => {
    expect(levelFromArgs({ verbose: 1 })).toBe('debug');
    expect(levelFromArgs({ verbose: 2 })).toBe('trace');
  });

  test('a boolean verbose counts as one step', () => {
    expect(levelFromArgs({ verbose: true })).toBe('debug');
  });

  test('climbing stops at the loudest level', () => {
    expect(levelFromArgs({ verbose: 99 })).toBe('trace');
  });

  test('quiet drops to errors only', () => {
    expect(levelFromArgs({ quiet: true })).toBe('error');
  });

  test('quiet wins over verbose', () => {
    expect(levelFromArgs({ quiet: true, verbose: 3 })).toBe('error');
  });

  test('an explicit level beats both', () => {
    expect(levelFromArgs({ logLevel: 'warn', quiet: true, verbose: 3 })).toBe('warn');
  });

  test('an unknown explicit level is ignored', () => {
    expect(levelFromArgs({ logLevel: 'nonsense' })).toBe('info');
  });

  test('the key names are configurable', () => {
    expect(levelFromArgs({ loud: 2 }, { verboseKey: 'loud' })).toBe('trace');
  });
});

describe('loggerFrom', () => {
  test('takes its level from the args and writes to the context stderr', async () => {
    const command = defineCommand({
      meta: { name: 'tool' },
      args: {
        verbose: { type: 'boolean', short: 'v', action: 'count' },
        quiet: { type: 'boolean', short: 'q' },
      },
      run(ctx) {
        const log = loggerFrom(ctx, { color: false });
        log.info('info line');
        log.debug('debug line');
      },
    });

    const quiet = await runCli(command, []);
    expect(quiet.plainStderr).toContain('info line');
    expect(quiet.plainStderr).not.toContain('debug line');

    const loud = await runCli(command, ['-v']);
    expect(loud.plainStderr).toContain('debug line');

    const silent = await runCli(command, ['-q']);
    expect(silent.plainStderr).toBe('');
  });

  test('nothing reaches stdout', async () => {
    const command = defineCommand({
      meta: { name: 'tool' },
      run(ctx) {
        loggerFrom(ctx, { color: false }).info('to stderr');
      },
    });
    const { stdout, plainStderr } = await runCli(command, []);
    expect(stdout).toBe('');
    expect(plainStderr).toContain('to stderr');
  });
});

describe('values that break a naive serialiser', () => {
  test('an Error keeps its message rather than becoming {}', () => {
    const sink = collector();
    createLogger({ sink, ...plain }).error('failed', new Error('boom'));
    expect(sink.text()).toContain('boom');
    expect(sink.text()).not.toContain('{}');
  });

  test('a cyclic object is named, not thrown on', () => {
    const sink = collector();
    const circular: Record<string, unknown> = { a: 1 };
    circular['self'] = circular;
    expect(() => createLogger({ sink, ...plain }).info('cycle', circular)).not.toThrow();
    expect(sink.text()).toContain('[Circular]');
    expect(sink.text()).toContain('"a":1');
  });

  test('undefined, bigint and symbol survive', () => {
    const sink = collector();
    createLogger({ sink, ...plain }).info('values', undefined, 10n, Symbol('s'));
    expect(sink.text()).toContain('undefined');
    expect(sink.text()).toContain('10');
    expect(sink.text()).toContain('Symbol(s)');
  });
});
