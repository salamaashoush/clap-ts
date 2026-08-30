/**
 * Validation tests - tests for constraint enforcement after parsing.
 */

import { describe, test, expect } from 'bun:test';
import { parseArgs } from '../parser.js';
import { validate } from '../validation.js';
import type { CommandDef, ArgsDef } from '../types.js';

/** Helper to create a CommandDef from ArgsDef for testing. */
function cmd(args: ArgsDef): CommandDef {
  return { meta: { name: 'test' }, args };
}

/** Parse and validate in one step. */
function parseAndValidate(rawArgs: string[], command: CommandDef): void {
  const result = parseArgs(rawArgs, command);
  validate(result, command);
}

// ---- Required Args Missing ----

describe('required args missing', () => {
  test('throws when required arg is not provided', () => {
    const command = cmd({ port: { type: 'number', required: true } });
    expect(() => parseAndValidate([], command)).toThrow('required arguments were not provided');
  });

  test('required arg with default does not throw', () => {
    const command = cmd({ port: { type: 'number', required: true, default: 3000 } });
    expect(() => parseAndValidate([], command)).not.toThrow();
  });

  test('required positional throws', () => {
    const command = cmd({
      file: { type: 'positional', valueName: 'FILE', required: true },
    });
    expect(() => parseAndValidate([], command)).toThrow('required arguments were not provided');
  });

  test('required arg provided does not throw', () => {
    const command = cmd({ port: { type: 'number', required: true } });
    expect(() => parseAndValidate(['--port', '3003'], command)).not.toThrow();
  });
});

// ---- conflictsWith Violation ----

describe('conflictsWith violation', () => {
  test('throws when conflicting args are both provided', () => {
    const command = cmd({
      json: { type: 'boolean', conflictsWith: ['csv'] },
      csv: { type: 'boolean' },
    });
    expect(() => parseAndValidate(['--json', '--csv'], command)).toThrow('cannot be used with');
  });

  test('does not throw when only one is provided', () => {
    const command = cmd({
      json: { type: 'boolean', conflictsWith: ['csv'] },
      csv: { type: 'boolean' },
    });
    expect(() => parseAndValidate(['--json'], command)).not.toThrow();
  });

  test('does not throw when neither is provided', () => {
    const command = cmd({
      json: { type: 'boolean', conflictsWith: ['csv'] },
      csv: { type: 'boolean' },
    });
    expect(() => parseAndValidate([], command)).not.toThrow();
  });
});

// ---- requires Violation ----

describe('requires violation', () => {
  test('throws when required companion is missing', () => {
    const command = cmd({
      'tls-cert': { type: 'string', long: 'tls-cert', requires: ['tls'] },
      tls: { type: 'boolean' },
    });
    expect(() => parseAndValidate(['--tls-cert', './cert.pem'], command)).toThrow(
      'required arguments were not provided',
    );
  });

  test('does not throw when companion is present', () => {
    const command = cmd({
      'tls-cert': { type: 'string', long: 'tls-cert', requires: ['tls'] },
      tls: { type: 'boolean' },
    });
    expect(() => parseAndValidate(['--tls-cert', './cert.pem', '--tls'], command)).not.toThrow();
  });

  test('does not throw when the arg itself is not provided', () => {
    const command = cmd({
      'tls-cert': { type: 'string', long: 'tls-cert', requires: ['tls'] },
      tls: { type: 'boolean' },
    });
    expect(() => parseAndValidate([], command)).not.toThrow();
  });
});

// ---- valueParser Enum Violation ----

describe('valueParser enum violation', () => {
  test('throws on invalid enum value', () => {
    const command = cmd({
      env: { type: 'string', valueParser: ['dev', 'staging', 'prod'] },
    });
    expect(() => parseAndValidate(['--env', 'invalid'], command)).toThrow(
      "invalid value 'invalid'",
    );
  });

  test('error message includes possible values', () => {
    const command = cmd({
      env: { type: 'string', valueParser: ['dev', 'staging', 'prod'] },
    });
    try {
      parseAndValidate(['--env', 'invalid'], command);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as Error).message).toContain('possible values: dev, staging, prod');
    }
  });

  test('valid enum value passes', () => {
    const command = cmd({
      env: { type: 'string', valueParser: ['dev', 'staging', 'prod'] },
    });
    expect(() => parseAndValidate(['--env', 'dev'], command)).not.toThrow();
  });
});

// ---- Typo Suggestions (Levenshtein) ----

describe('typo suggestions', () => {
  test('suggests close match for typo', () => {
    const command = cmd({
      verbose: { type: 'boolean' },
    });
    const result = parseArgs(['--verbos'], command);
    try {
      validate(result, command);
      expect.unreachable('should have thrown');
    } catch (error) {
      const msg = (error as Error).message;
      expect(msg).toContain("unexpected argument '--verbos' found");
      expect(msg).toContain('tip: a similar argument exists');
      expect(msg).toContain('verbose');
    }
  });

  test('no suggestion when distance is too large', () => {
    const command = cmd({
      verbose: { type: 'boolean' },
    });
    const result = parseArgs(['--xyzzy'], command);
    try {
      validate(result, command);
      expect.unreachable('should have thrown');
    } catch (error) {
      const msg = (error as Error).message;
      expect(msg).toContain("unexpected argument '--xyzzy' found");
      expect(msg).not.toContain('tip');
    }
  });
});

// ---- numArgs Validation ----

describe('numArgs validation', () => {
  test('respects min constraint', () => {
    const command = cmd({
      files: {
        type: 'string',
        action: 'append',
        numArgs: { min: 2, max: 10 },
      },
    });
    expect(() => parseAndValidate(['--files', 'a.txt'], command)).toThrow(
      'requires at least 2 values',
    );
  });
});

describe('exclusive', () => {
  test('exclusive arg cannot be used with any other', () => {
    const command = cmd({
      init: { type: 'boolean', long: 'init', exclusive: true },
      verbose: { type: 'boolean', long: 'verbose' },
    });
    expect(() => parseAndValidate(['--init', '--verbose'], command)).toThrow(
      /cannot be used with/,
    );
  });

  test('exclusive arg alone is fine', () => {
    const command = cmd({
      init: { type: 'boolean', long: 'init', exclusive: true },
      verbose: { type: 'boolean', long: 'verbose' },
    });
    expect(() => parseAndValidate(['--init'], command)).not.toThrow();
  });
});

describe('requiredUnlessPresent', () => {
  test('not required when alternative is present', () => {
    const command = cmd({
      file: { type: 'string', long: 'file', required: true, requiredUnlessPresent: 'stdin' },
      stdin: { type: 'boolean', long: 'stdin' },
    });
    expect(() => parseAndValidate(['--stdin'], command)).not.toThrow();
  });

  test('required when alternative is absent', () => {
    const command = cmd({
      file: { type: 'string', long: 'file', required: true, requiredUnlessPresent: 'stdin' },
      stdin: { type: 'boolean', long: 'stdin' },
    });
    expect(() => parseAndValidate([], command)).toThrow('required arguments');
  });

  test('works with array of alternatives', () => {
    const command = cmd({
      file: {
        type: 'string',
        long: 'file',
        required: true,
        requiredUnlessPresent: ['stdin', 'generate'],
      },
      stdin: { type: 'boolean', long: 'stdin' },
      generate: { type: 'boolean', long: 'generate' },
    });
    expect(() => parseAndValidate(['--generate'], command)).not.toThrow();
  });
});

describe('requiredIfEq', () => {
  test('required when condition met', () => {
    const command = cmd({
      format: { type: 'string', long: 'format' },
      output: { type: 'string', long: 'output', requiredIfEq: ['format', 'file'] },
    });
    expect(() => parseAndValidate(['--format', 'file'], command)).toThrow('required arguments');
  });

  test('not required when condition not met', () => {
    const command = cmd({
      format: { type: 'string', long: 'format' },
      output: { type: 'string', long: 'output', requiredIfEq: ['format', 'file'] },
    });
    expect(() => parseAndValidate(['--format', 'stdout'], command)).not.toThrow();
  });

  test('passes when arg is provided', () => {
    const command = cmd({
      format: { type: 'string', long: 'format' },
      output: { type: 'string', long: 'output', requiredIfEq: ['format', 'file'] },
    });
    expect(() =>
      parseAndValidate(['--format', 'file', '--output', '/tmp/out'], command),
    ).not.toThrow();
  });
});
