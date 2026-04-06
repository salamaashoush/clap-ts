/**
 * Tests verifying that clap-ts matches Rust clap's exact behavior.
 * Each test case corresponds to a specific clap behavior rule.
 */

import { describe, test, expect } from 'bun:test';
import { parseArgs, CliParseError, validate } from '../index.js';
import { renderHelp, renderUsage, showError } from '../help.js';
import type { CommandDef, ArgsDef } from '../types.js';

// ---- Test Helpers ----

function parse(rawArgs: string[], command: CommandDef) {
  return parseArgs(rawArgs, command);
}

function parseAndValidate(rawArgs: string[], command: CommandDef) {
  const result = parseArgs(rawArgs, command);
  validate(result, command);
  return result;
}

function expectParseError(rawArgs: string[], command: CommandDef, expectedMsg: string | RegExp) {
  try {
    parseAndValidate(rawArgs, command);
    throw new Error('Expected CliParseError to be thrown');
  } catch (error) {
    expect(error).toBeInstanceOf(CliParseError);
    if (typeof expectedMsg === 'string') {
      expect((error as CliParseError).message).toBe(expectedMsg);
    } else {
      expect((error as CliParseError).message).toMatch(expectedMsg);
    }
  }
}

// ---- Shared Command Definitions ----

const simpleCmd: CommandDef = {
  meta: { name: 'program', version: '1.0.0', description: 'A test program' },
  args: {
    env: {
      type: 'string',
      short: 'e',
      long: 'env',
      valueName: 'ENV',
      valueParser: ['dev', 'staging', 'prod'],
      description: 'Box API environment',
    },
    user: {
      type: 'string',
      short: 'u',
      long: 'user',
      valueName: 'USER',
      env: 'BOX_USER',
      description: 'User key',
    },
    port: {
      type: 'number',
      short: 'p',
      long: 'port',
      valueName: 'PORT',
      default: 3003,
      description: 'Port number',
    },
    verbose: {
      type: 'boolean',
      long: 'verbose',
      description: 'Verbose output',
    },
  },
};

// ---- 1. Error Format ----

describe('clap error format', () => {
  test('error output has correct structure: error + usage + help tip', () => {
    // We test showError indirectly through the error message format
    const cmd: CommandDef = {
      meta: { name: 'myapp', version: '1.0.0' },
      args: {
        name: { type: 'string', long: 'name', required: true },
      },
    };

    // Capture stderr output
    let output = '';
    const originalWrite = process.stderr.write;
    process.stderr.write = ((chunk: string) => {
      output += chunk;
      return true;
    }) as typeof process.stderr.write;

    try {
      showError('test error message', cmd);
    } finally {
      process.stderr.write = originalWrite;
    }

    // Strip ANSI codes for comparison
    const stripped = output.replace(/\x1b\[[0-9;]*m/g, '');
    expect(stripped).toContain('error: test error message');
    expect(stripped).toContain('Usage: myapp [OPTIONS]');
    expect(stripped).toContain("For more information, try '--help'.");
  });
});

// ---- 2. conflictsWith ----

describe('clap conflictsWith behavior', () => {
  const conflictCmd: CommandDef = {
    meta: { name: 'program' },
    args: {
      dev: {
        type: 'boolean',
        long: 'dev',
        conflictsWith: ['env', 'staging', 'prod'],
      },
      staging: {
        type: 'boolean',
        long: 'staging',
        conflictsWith: ['env', 'dev', 'prod'],
      },
      prod: {
        type: 'boolean',
        long: 'prod',
        conflictsWith: ['env', 'dev', 'staging'],
      },
      env: {
        type: 'string',
        long: 'env',
        valueName: 'ENV',
        conflictsWith: ['dev', 'staging', 'prod'],
      },
    },
  };

  test('--dev --staging produces clap-style conflict error', () => {
    expectParseError(
      ['--dev', '--staging'],
      conflictCmd,
      "the argument '--dev' cannot be used with '--staging'",
    );
  });

  test('--env dev --dev produces conflict error with value name', () => {
    // Object.entries iteration order: dev comes before env, so dev's conflict fires first.
    // dev is boolean so no value name, env has value name <ENV>.
    expectParseError(
      ['--env', 'dev', '--dev'],
      conflictCmd,
      "the argument '--dev' cannot be used with '--env <ENV>'",
    );
  });

  test('no conflict when only one is set', () => {
    const result = parseAndValidate(['--dev'], conflictCmd);
    expect(result.args['dev']).toBe(true);
  });
});

// ---- 3. requires ----

describe('clap requires behavior', () => {
  const requiresCmd: CommandDef = {
    meta: { name: 'program' },
    args: {
      tls: {
        type: 'boolean',
        long: 'tls',
      },
      'tls-cert': {
        type: 'string',
        long: 'tls-cert',
        valueName: 'PATH',
        requires: ['tls'],
      },
      'tls-key': {
        type: 'string',
        long: 'tls-key',
        valueName: 'PATH',
        requires: ['tls'],
      },
    },
  };

  test('--tls-cert without --tls says required arguments not provided', () => {
    expectParseError(
      ['--tls-cert', 'foo.pem'],
      requiresCmd,
      'the following required arguments were not provided:\n  --tls',
    );
  });

  test('--tls-cert and --tls-key without --tls lists --tls once', () => {
    // Each arg independently requires --tls, first one to fail throws
    expectParseError(
      ['--tls-cert', 'foo.pem', '--tls-key', 'bar.pem'],
      requiresCmd,
      'the following required arguments were not provided:\n  --tls',
    );
  });

  test('--tls-cert with --tls passes validation', () => {
    const result = parseAndValidate(['--tls', '--tls-cert', 'foo.pem'], requiresCmd);
    expect(result.args['tls']).toBe(true);
    expect(result.args['tls-cert']).toBe('foo.pem');
  });
});

// ---- 4. valueParser (possible values) ----

describe('clap valueParser behavior', () => {
  test('invalid enum value shows clap-style error with value name', () => {
    expectParseError(
      ['--env', 'production'],
      simpleCmd,
      "invalid value 'production' for '--env <ENV>'\n  [possible values: dev, staging, prod]",
    );
  });

  test('valid enum value passes', () => {
    const result = parseAndValidate(['--env', 'dev'], simpleCmd);
    expect(result.args['env']).toBe('dev');
  });

  test('all valid enum values pass', () => {
    for (const val of ['dev', 'staging', 'prod']) {
      const result = parseAndValidate(['--env', val], simpleCmd);
      expect(result.args['env']).toBe(val);
    }
  });
});

// ---- 5. Unknown args with Levenshtein suggestion ----

describe('clap unknown argument behavior', () => {
  test('unknown flag with similar match gets suggestion', () => {
    expectParseError(
      ['--verbos'],
      simpleCmd,
      /unexpected argument '--verbos' found[\s\S]*tip: a similar argument exists: '--verbose'/,
    );
  });

  test('completely unknown flag without close match', () => {
    expectParseError(['--zzzzz'], simpleCmd, "unexpected argument '--zzzzz' found");
  });
});

// ---- 6. Missing required args ----

describe('clap missing required args behavior', () => {
  const requiredCmd: CommandDef = {
    meta: { name: 'program' },
    args: {
      name: {
        type: 'string',
        long: 'name',
        valueName: 'NAME',
        required: true,
      },
      port: {
        type: 'number',
        long: 'port',
        valueName: 'PORT',
        required: true,
      },
      verbose: {
        type: 'boolean',
        long: 'verbose',
      },
    },
  };

  test('multiple missing required args are all listed', () => {
    expectParseError(
      ['--verbose'],
      requiredCmd,
      'the following required arguments were not provided:\n  --name\n  --port',
    );
  });

  test('one missing required arg', () => {
    expectParseError(
      ['--name', 'test'],
      requiredCmd,
      'the following required arguments were not provided:\n  --port',
    );
  });

  test('all required args provided passes', () => {
    const result = parseAndValidate(['--name', 'test', '--port', '8080'], requiredCmd);
    expect(result.args['name']).toBe('test');
    expect(result.args['port']).toBe(8080);
  });

  test('required positional uses angle bracket format', () => {
    const posCmd: CommandDef = {
      meta: { name: 'program' },
      args: {
        file: {
          type: 'positional',
          valueName: 'FILE',
          required: true,
        },
      },
    };

    expectParseError([], posCmd, 'the following required arguments were not provided:\n  <FILE>');
  });
});

// ---- 7. Help format ----

describe('clap help format', () => {
  const helpCmd: CommandDef = {
    meta: { name: 'command', version: '1.0.0', description: 'Description' },
    args: {
      env: {
        type: 'string',
        short: 'e',
        long: 'env',
        valueName: 'ENV',
        valueParser: ['dev', 'staging', 'prod'],
        description: 'Box API environment',
      },
      user: {
        type: 'string',
        short: 'u',
        long: 'user',
        valueName: 'USER',
        env: 'BOX_USER',
        description: 'User key',
      },
      port: {
        type: 'number',
        short: 'p',
        long: 'port',
        valueName: 'PORT',
        default: 3003,
        description: 'Port number',
      },
      verbose: {
        type: 'boolean',
        long: 'verbose',
        description: 'Verbose output',
      },
    },
    subCommands: {
      proxy: {
        meta: {
          name: 'proxy',
          description: 'Run the proxy server',
          aliases: ['p'],
        },
      },
      auth: {
        meta: {
          name: 'auth',
          description: 'Run the auth server',
          aliases: ['a'],
        },
      },
    },
  };

  test('help output has correct structure', () => {
    const help = renderHelp(helpCmd);
    const stripped = help.replace(/\x1b\[[0-9;]*m/g, '');

    // Header: "Description (command v1.0.0)"
    expect(stripped).toContain('Description (command v1.0.0)');

    // Usage line
    expect(stripped).toContain('Usage: command [OPTIONS] [COMMAND]');

    // Commands section with aliases in parens
    expect(stripped).toContain('Commands:');
    expect(stripped).toMatch(/proxy \(p\)\s+Run the proxy server/);
    expect(stripped).toMatch(/auth \(a\)\s+Run the auth server/);

    // Options section
    expect(stripped).toContain('Options:');

    // Short+long on same line with value name
    expect(stripped).toMatch(/-e, --env <ENV>/);
    expect(stripped).toMatch(/-u, --user <USER>/);
    expect(stripped).toMatch(/-p, --port <PORT>/);

    // Metadata in brackets (may wrap across lines; normalize whitespace)
    const normalized = stripped.replaceAll(/\s+/g, ' ');
    expect(normalized).toContain('[possible values: dev, staging, prod]');
    expect(normalized).toContain('[env: BOX_USER]');
    expect(normalized).toContain('[default: 3003]');

    // Flags without short get 4-space indent
    expect(stripped).toMatch(/    --verbose/);

    // Built-in help and version
    expect(stripped).toMatch(/-h, --help\s+Print help/);
    expect(stripped).toMatch(/-V, --version\s+Print version/);
  });

  test('subcommand aliases shown in parens', () => {
    const help = renderHelp(helpCmd);
    const stripped = help.replace(/\x1b\[[0-9;]*m/g, '');
    expect(stripped).toMatch(/proxy \(p\)/);
    expect(stripped).toMatch(/auth \(a\)/);
  });
});

// ---- 8. --help and --version auto-added ----

describe('clap --help and --version auto behavior', () => {
  const minimalCmd: CommandDef = {
    meta: { name: 'tool', version: '2.0.0' },
    args: {},
  };

  test('--help is recognized even without explicit arg def', () => {
    const result = parse(['--help'], minimalCmd);
    expect(result.helpRequested).toBe(true);
  });

  test('-h is recognized as --help', () => {
    const result = parse(['-h'], minimalCmd);
    expect(result.helpRequested).toBe(true);
  });

  test('--version is recognized even without explicit arg def', () => {
    const result = parse(['--version'], minimalCmd);
    expect(result.versionRequested).toBe(true);
  });

  test('-V is recognized as --version', () => {
    const result = parse(['-V'], minimalCmd);
    expect(result.versionRequested).toBe(true);
  });
});

// ---- 9. Subcommand aliases ----

describe('clap subcommand alias behavior', () => {
  const subCmd: CommandDef = {
    meta: { name: 'program' },
    args: {},
    subCommands: {
      proxy: {
        meta: {
          name: 'proxy',
          description: 'Run proxy',
          aliases: ['p', 'px'],
        },
        args: {
          port: { type: 'number', short: 'p', long: 'port', default: 3003 },
        },
      },
    },
  };

  test('help shows alias in parens', () => {
    const help = renderHelp(subCmd);
    const stripped = help.replace(/\x1b\[[0-9;]*m/g, '');
    expect(stripped).toMatch(/proxy \(p, px\)/);
  });
});

// ---- 10. Exit codes ----

describe('clap exit code behavior', () => {
  test('usage errors should use exit code 2', () => {
    // This is tested indirectly - the runner.ts uses process.exit(2) for CliParseError.
    // We verify the error type is CliParseError so the runner handles it correctly.
    const cmd: CommandDef = {
      meta: { name: 'program' },
      args: {
        name: { type: 'string', long: 'name', required: true },
      },
    };

    expect(() => parseAndValidate([], cmd)).toThrow(CliParseError);
  });
});

// ---- Additional: env fallback ----

describe('env variable fallback', () => {
  test('env var is used when flag not provided', () => {
    const original = process.env['BOX_TEST_PORT'];
    process.env['BOX_TEST_PORT'] = '9999';
    try {
      const cmd: CommandDef = {
        meta: { name: 'program' },
        args: {
          port: { type: 'number', long: 'port', env: 'BOX_TEST_PORT' },
        },
      };
      const result = parse([], cmd);
      expect(result.args['port']).toBe(9999);
    } finally {
      if (original === undefined) {
        delete process.env['BOX_TEST_PORT'];
      } else {
        process.env['BOX_TEST_PORT'] = original;
      }
    }
  });

  test('explicit flag overrides env var', () => {
    const original = process.env['BOX_TEST_PORT'];
    process.env['BOX_TEST_PORT'] = '9999';
    try {
      const cmd: CommandDef = {
        meta: { name: 'program' },
        args: {
          port: { type: 'number', long: 'port', env: 'BOX_TEST_PORT' },
        },
      };
      const result = parse(['--port', '8080'], cmd);
      expect(result.args['port']).toBe(8080);
    } finally {
      if (original === undefined) {
        delete process.env['BOX_TEST_PORT'];
      } else {
        process.env['BOX_TEST_PORT'] = original;
      }
    }
  });
});

// ---- Additional: default values ----

describe('default values', () => {
  test('default is used when not provided', () => {
    const result = parse([], simpleCmd);
    expect(result.args['port']).toBe(3003);
  });

  test('explicit value overrides default', () => {
    const result = parse(['--port', '8080'], simpleCmd);
    expect(result.args['port']).toBe(8080);
  });
});

// ---- Additional: count action ----

describe('count action', () => {
  test('-vvv counts to 3', () => {
    const cmd: CommandDef = {
      meta: { name: 'program' },
      args: {
        verbose: { type: 'boolean', short: 'v', long: 'verbose', action: 'count' },
      },
    };
    const result = parse(['-v', '-v', '-v'], cmd);
    expect(result.args['verbose']).toBe(3);
  });
});

// ---- Additional: append action ----

describe('append action', () => {
  test('multiple --header values collected into array', () => {
    const cmd: CommandDef = {
      meta: { name: 'program' },
      args: {
        header: { type: 'string', short: 'H', long: 'header', action: 'append' },
      },
    };
    const result = parse(['-H', 'X-Foo: bar', '-H', 'X-Baz: qux'], cmd);
    expect(result.args['header']).toEqual(['X-Foo: bar', 'X-Baz: qux']);
  });
});

// ---- Additional: -- separator ----

describe('-- separator', () => {
  test('args after -- go to rest', () => {
    const cmd: CommandDef = {
      meta: { name: 'program' },
      args: {
        verbose: { type: 'boolean', long: 'verbose' },
      },
    };
    const result = parse(['--verbose', '--', '--not-a-flag', 'positional'], cmd);
    expect(result.args['verbose']).toBe(true);
    expect(result.rest).toEqual(['--not-a-flag', 'positional']);
  });
});

// ---- Additional: boolean negation ----

describe('boolean negation', () => {
  test('--no-verbose sets verbose to false', () => {
    const cmd: CommandDef = {
      meta: { name: 'program' },
      args: {
        verbose: { type: 'boolean', long: 'verbose', default: true },
      },
    };
    const result = parse(['--no-verbose'], cmd);
    expect(result.args['verbose']).toBe(false);
  });
});

// ---- Additional: kebab to camelCase ----

describe('kebab to camelCase mapping', () => {
  test('--config-path is accessible as configPath', () => {
    const cmd: CommandDef = {
      meta: { name: 'program' },
      args: {
        'config-path': { type: 'string', long: 'config-path' },
      },
    };
    const result = parse(['--config-path', '/etc/config.yaml'], cmd);
    expect(result.args['configPath']).toBe('/etc/config.yaml');
    expect(result.args['config-path']).toBe('/etc/config.yaml');
  });
});

// ---- Additional: numArgs validation ----

describe('numArgs validation', () => {
  test('too few values rejected', () => {
    const cmd: CommandDef = {
      meta: { name: 'program' },
      args: {
        files: {
          type: 'string',
          long: 'files',
          action: 'append',
          numArgs: { min: 2, max: 5 },
        },
      },
    };
    expectParseError(
      ['--files', 'one'],
      cmd,
      "the argument '--files' requires at least 2 values but 1 were provided",
    );
  });
});

// ---- Additional: argument groups ----

describe('argument groups', () => {
  const groupCmd: CommandDef = {
    meta: { name: 'program' },
    args: {
      json: { type: 'boolean', long: 'json' },
      yaml: { type: 'boolean', long: 'yaml' },
      table: { type: 'boolean', long: 'table' },
    },
    groups: [
      {
        name: 'output-format',
        args: ['json', 'yaml', 'table'],
        required: false,
        multiple: false,
      },
    ],
  };

  test('mutually exclusive group rejects multiple', () => {
    expectParseError(
      ['--json', '--yaml'],
      groupCmd,
      /the following arguments cannot be used together/,
    );
  });

  test('single arg from group is fine', () => {
    const result = parseAndValidate(['--json'], groupCmd);
    expect(result.args['json']).toBe(true);
  });
});

// ---- Additional: renderUsage ----

describe('renderUsage', () => {
  test('renders compact usage line', () => {
    const usage = renderUsage(simpleCmd);
    const stripped = usage.replace(/\x1b\[[0-9;]*m/g, '');
    expect(stripped).toContain('Usage: program [OPTIONS]');
  });
});
