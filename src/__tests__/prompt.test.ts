/**
 * Tests for interactive prompts and filling missing arguments from them.
 */

import { describe, test, expect } from 'bun:test';
import {
  input,
  confirm,
  select,
  multiselect,
  password,
  promptForArg,
  promptMissing,
  scriptedIO,
  terminalIO,
} from '../prompt.js';
import { defineCommand } from '../runner.js';
import { runCli, captureArgs } from '../testing.js';
import type { ArgDef } from '../types.js';

describe('input', () => {
  test('returns the reply', async () => {
    expect(await input('Name', { io: scriptedIO(['alice']) })).toBe('alice');
  });

  test('trims whitespace', async () => {
    expect(await input('Name', { io: scriptedIO(['  alice  ']) })).toBe('alice');
  });

  test('an empty reply takes the default', async () => {
    expect(await input('Name', { io: scriptedIO(['']), defaultValue: 'bob' })).toBe('bob');
  });

  test('the default is shown in the prompt', async () => {
    const io = scriptedIO(['']);
    await input('Name', { io, defaultValue: 'bob' });
    expect(io.output).toContain('Name (bob):');
  });
});

describe('confirm', () => {
  test('accepts the usual affirmatives', async () => {
    for (const answer of ['y', 'Y', 'yes', 'true', '1']) {
      expect(await confirm('Sure', { io: scriptedIO([answer]) })).toBe(true);
    }
  });

  test('anything else is no', async () => {
    for (const answer of ['n', 'no', 'nope']) {
      expect(await confirm('Sure', { io: scriptedIO([answer]) })).toBe(false);
    }
  });

  test('an empty reply takes the default, and the hint shows which', async () => {
    const yes = scriptedIO(['']);
    expect(await confirm('Sure', { io: yes, defaultValue: true })).toBe(true);
    expect(yes.output).toContain('(Y/n)');

    const no = scriptedIO(['']);
    expect(await confirm('Sure', { io: no })).toBe(false);
    expect(no.output).toContain('(y/N)');
  });
});

describe('select', () => {
  const choices = ['fast', 'safe'];

  test('takes a number', async () => {
    expect(await select('Mode', choices, { io: scriptedIO(['2']) })).toBe('safe');
  });

  test('takes the value itself', async () => {
    expect(await select('Mode', choices, { io: scriptedIO(['fast']) })).toBe('fast');
  });

  test('numbers the options and shows their help', async () => {
    const io = scriptedIO(['1']);
    await select('Mode', [{ name: 'fast', help: 'Skip checks' }], { io });
    expect(io.output).toContain('1) fast  Skip checks');
  });

  test('re-asks after an answer that is not a choice', async () => {
    const io = scriptedIO(['nonsense', '1']);
    expect(await select('Mode', choices, { io })).toBe('fast');
    expect(io.output).toContain('not one of the choices');
  });

  test('an out of range number is refused', async () => {
    const io = scriptedIO(['9', '1']);
    expect(await select('Mode', choices, { io })).toBe('fast');
  });

  test('no choices at all is a programming error', async () => {
    await expect(select('Mode', [], { io: scriptedIO([]) })).rejects.toThrow('at least one choice');
  });
});

describe('multiselect', () => {
  test('takes several answers by number or name', async () => {
    const io = scriptedIO(['1, safe']);
    expect(await multiselect('Modes', ['fast', 'safe'], { io })).toEqual(['fast', 'safe']);
  });

  test('an empty reply picks nothing', async () => {
    expect(await multiselect('Modes', ['a'], { io: scriptedIO(['']) })).toEqual([]);
  });

  test('one bad entry re-asks for the lot', async () => {
    const io = scriptedIO(['1,nope', '1']);
    expect(await multiselect('Modes', ['fast', 'safe'], { io })).toEqual(['fast']);
    expect(io.output).toContain('not one of the choices');
  });
});

describe('password', () => {
  test('reads without echoing through the io', async () => {
    expect(await password('Token', { io: scriptedIO(['hunter2']) })).toBe('hunter2');
  });
});

describe('promptForArg', () => {
  const ask = (def: ArgDef, answers: string[]) =>
    promptForArg('thing', def, { io: scriptedIO(answers) });

  test('a boolean asks for confirmation', async () => {
    expect(await ask({ type: 'boolean', description: 'Enable' }, ['y'])).toBe(true);
  });

  test('possible values become a list', async () => {
    expect(await ask({ type: 'string', valueParser: ['fast', 'safe'] }, ['2'])).toBe('safe');
  });

  test('an append arg with possible values takes several', async () => {
    const def: ArgDef = { type: 'string', action: 'append', valueParser: ['a', 'b'] };
    expect(await ask(def, ['1,2'])).toEqual(['a', 'b']);
  });

  test('hidden possible values are not offered', async () => {
    const io = scriptedIO(['1']);
    await promptForArg('thing', {
      type: 'string',
      valueParser: [{ name: 'shown' }, { name: 'secret', hidden: true }],
    }, { io });
    expect(io.output).not.toContain('secret');
  });

  test('an empty answer is refused and asked again', async () => {
    const io = scriptedIO(['', 'value']);
    expect(await promptForArg('thing', { type: 'string' }, { io })).toBe('value');
    expect(io.output).toContain('a value is required');
  });

  test('a number that is not a number is refused', async () => {
    const io = scriptedIO(['abc', '8080']);
    expect(await promptForArg('port', { type: 'number' }, { io })).toBe('8080');
    expect(io.output).toContain('expected a number');
  });

  test("a custom parser's complaint is shown", async () => {
    const io = scriptedIO(['nope', 'ok']);
    const def: ArgDef = {
      type: 'string',
      valueParser: (v) => {
        if (v !== 'ok') {
          throw new Error('must be ok');
        }
        return v;
      },
    };
    expect(await promptForArg('thing', def, { io })).toBe('ok');
    expect(io.output).toContain('must be ok');
  });

  test('a default is offered', async () => {
    const io = scriptedIO(['']);
    expect(await promptForArg('thing', { type: 'string', default: 'fallback' }, { io })).toBe(
      'fallback',
    );
  });
});

describe('promptMissing', () => {
  const main = defineCommand({
    meta: { name: 'app' },
    args: {
      name: { type: 'string', required: true, description: 'Your name' },
      port: { type: 'number', required: true, description: 'Port' },
      given: { type: 'string' },
    },
    run() {},
  });

  test('asks only for what is missing', async () => {
    const io = scriptedIO(['alice', '8080']);
    const { args } = await captureArgs(main, ['--given', 'x'], {
      fillMissing: promptMissing({ io }),
    });
    expect(args['name']).toBe('alice');
    expect(args['port']).toBe(8080);
    expect(args['given']).toBe('x');
  });

  test('an argument supplied on the command line is not asked about', async () => {
    const io = scriptedIO(['8080']);
    await captureArgs(main, ['--name', 'bob'], { fillMissing: promptMissing({ io }) });
    expect(io.output).not.toContain('Your name');
    expect(io.output).toContain('Port');
  });

  test('the value is coerced to the argument type', async () => {
    const { args } = await captureArgs(main, [], {
      fillMissing: promptMissing({ io: scriptedIO(['alice', '8080']) }),
    });
    expect(args['port']).toBe(8080);
  });

  test('the source is reported as prompt', async () => {
    let source: string | undefined;
    const probe = defineCommand({
      meta: { name: 'app' },
      args: { name: { type: 'string', required: true } },
      run({ valueSources }) {
        source = valueSources.get('name');
      },
    });
    await runCli(probe, [], { fillMissing: promptMissing({ io: scriptedIO(['alice']) }) });
    expect(source).toBe('prompt');
  });

  test('a non-interactive terminal fails as usual rather than hanging', async () => {
    const io = { ...scriptedIO(['alice', '8080']), interactive: false };
    const { plainStderr, exitCode } = await runCli(main, [], { fillMissing: promptMissing({ io }) });
    expect(exitCode).toBe(2);
    expect(plainStderr).toContain('the following required arguments were not provided');
  });

  test('force asks even when nobody appears to be there', async () => {
    const io = { ...scriptedIO(['alice', '8080']), interactive: false };
    const { exitCode } = await runCli(main, [], {
      fillMissing: promptMissing({ io, force: true }),
    });
    expect(exitCode).toBe(0);
  });

  test('nothing missing means nothing asked', async () => {
    const io = scriptedIO([]);
    await runCli(main, ['--name', 'a', '--port', '1'], { fillMissing: promptMissing({ io }) });
    expect(io.output).toBe('');
  });
});

describe('terminalIO is shared', () => {
  test('successive calls hand back the same interface', () => {
    // A readline interface owns stdin: a second one finds the stream consumed,
    // so two standalone prompts in a row would fail with "input ended".
    expect(terminalIO()).toBe(terminalIO());
  });

  test('close releases it and the next call builds a fresh one', () => {
    const first = terminalIO();
    first.close();
    expect(terminalIO()).not.toBe(first);
    terminalIO().close();
  });
});
