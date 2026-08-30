/**
 * Tests for spinners and progress bars, including that they stay quiet when
 * the destination is not a terminal.
 */

import { describe, test, expect } from 'bun:test';
import { spinner, progressBar } from '../progress.js';
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

const off = { enabled: false as const, color: false };
const on = { enabled: true as const, color: false, interval: 10_000 };

describe('spinner when nothing is watching', () => {
  test('start and update draw nothing', () => {
    const sink = collector();
    spinner('working', { sink, ...off }).start().update('still working');
    expect(sink.text()).toBe('');
  });

  test('succeed still reports once', () => {
    const sink = collector();
    spinner('working', { sink, ...off }).start().succeed('done');
    expect(sink.text()).toBe('✔ done\n');
  });

  test('fail and warn use their own marks', () => {
    const failed = collector();
    spinner('', { sink: failed, ...off }).fail('bad');
    expect(failed.text()).toBe('✖ bad\n');

    const warned = collector();
    spinner('', { sink: warned, ...off }).warn('careful');
    expect(warned.text()).toBe('⚠ careful\n');
  });

  test('stop leaves nothing behind', () => {
    const sink = collector();
    spinner('working', { sink, ...off }).start().stop();
    expect(sink.text()).toBe('');
  });

  test('an empty message prints no line at all', () => {
    const sink = collector();
    spinner('', { sink, ...off }).succeed();
    expect(sink.text()).toBe('');
  });

  test('enabled reports the decision', () => {
    expect(spinner('x', { sink: collector(), ...off }).enabled).toBe(false);
    expect(spinner('x', { sink: collector(), ...on }).enabled).toBe(true);
  });
});

describe('spinner when drawing', () => {
  test('start draws a frame and the message', () => {
    const sink = collector();
    const spin = spinner('working', { sink, ...on }).start();
    expect(sink.text()).toContain('working');
    expect(sink.text()).toContain('\r\x1b[2K');
    spin.stop();
  });

  test('ascii mode avoids braille frames', () => {
    const sink = collector();
    spinner('working', { sink, ...on, ascii: true }).start().stop();
    expect(sink.text()).not.toMatch(/[⠋⠙⠹]/);
  });

  test('succeed clears the line before reporting', () => {
    const sink = collector();
    spinner('working', { sink, ...on }).start().succeed('done');
    expect(sink.text().endsWith('✔ done\n')).toBe(true);
  });
});

describe('progressBar', () => {
  test('render reflects the position', () => {
    const bar = progressBar({ total: 10, width: 10, sink: collector(), ...off });
    expect(bar.render()).toContain('  0% 0/10');
    bar.update(5);
    expect(bar.render()).toContain(' 50% 5/10');
    expect(bar.render()).toContain('█████░░░░░');
  });

  test('tick moves forward', () => {
    const bar = progressBar({ total: 4, width: 4, sink: collector(), ...off });
    bar.tick().tick(2);
    expect(bar.render()).toContain('3/4');
  });

  test('the position is clamped at both ends', () => {
    const bar = progressBar({ total: 5, width: 5, sink: collector(), ...off });
    bar.update(-3);
    expect(bar.render()).toContain('0/5');
    bar.update(99);
    expect(bar.render()).toContain('5/5');
  });

  test('a label is appended', () => {
    const bar = progressBar({ total: 2, width: 2, text: 'files', sink: collector(), ...off });
    expect(bar.render()).toContain('files');
    bar.update(1, 'more files');
    expect(bar.render()).toContain('more files');
  });

  test('nothing is drawn when disabled', () => {
    const sink = collector();
    progressBar({ total: 3, sink, ...off }).update(1).tick();
    expect(sink.text()).toBe('');
  });

  test('finish reports the label once when disabled', () => {
    const sink = collector();
    progressBar({ total: 3, sink, ...off }).finish('all done');
    expect(sink.text()).toBe('all done\n');
  });

  test('finish fills the bar and ends the line when drawing', () => {
    const sink = collector();
    const bar = progressBar({ total: 3, width: 3, sink, ...on });
    bar.finish();
    expect(bar.render()).toContain('100% 3/3');
    expect(sink.text().endsWith('\n')).toBe(true);
  });

  test('a zero total does not divide by zero', () => {
    // Clamped to one unit, so an empty job renders sanely rather than as NaN.
    const bar = progressBar({ total: 0, width: 4, sink: collector(), ...off });
    expect(bar.render()).toContain('0% 0/1');
    expect(bar.render()).not.toContain('NaN');
    bar.finish();
    expect(bar.render()).toContain('100% 1/1');
  });
});
