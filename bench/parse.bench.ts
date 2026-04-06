/**
 * Benchmark: clap-ts argument parsing performance.
 *
 * Run: bun run bench/parse.bench.ts
 *
 * Requires: bun add -d mitata
 */

import { bench, run, group } from 'mitata';

import { defineCommand, parseArgs as clapParseArgs } from '../src/index.js';
import { validate } from '../src/validation.js';
import type { CommandDef } from '../src/types.js';

// ---- Test fixtures ----

const simpleArgs = ['--verbose', '--port', '3003', '--env', 'dev'];

const complexArgs = [
  '--verbose',
  '--port',
  '3003',
  '--env',
  'dev',
  '--user',
  'admin',
  '--mock',
  '--mocks-dir',
  './mocks',
  '--record',
  '--record-dir',
  './recordings',
  '--reload',
  '--config-path',
  './config.yaml',
  '-H',
  'X-Custom: value1',
  '-H',
  'X-Other: value2',
  '--kill-port',
  '--gcm',
  '--no-open',
  '--dev-panel',
  '--url-intercept',
  '--gundam-routes',
];

const subcommandArgs = ['proxy', '--port', '3003', '--mock', '--env', 'dev'];

// ---- clap-ts arg definitions ----

const clapArgDefs = {
  verbose: { type: 'boolean' as const, short: 'v', long: 'verbose' },
  port: { type: 'number' as const, short: 'p', long: 'port', valueName: 'PORT' },
  env: {
    type: 'string' as const,
    short: 'e',
    long: 'env',
    valueParser: ['dev', 'staging', 'prod'] as const,
  },
  user: { type: 'string' as const, short: 'u', long: 'user' },
  mock: { type: 'boolean' as const, short: 'M', long: 'mock' },
  'mocks-dir': { type: 'string' as const, long: 'mocks-dir' },
  record: { type: 'boolean' as const, short: 'R', long: 'record' },
  'record-dir': { type: 'string' as const, long: 'record-dir' },
  reload: { type: 'boolean' as const, long: 'reload' },
  'config-path': { type: 'string' as const, short: 'c', long: 'config-path' },
  header: { type: 'string' as const, short: 'H', long: 'header', action: 'append' as const },
  'kill-port': { type: 'boolean' as const, long: 'kill-port' },
  gcm: { type: 'boolean' as const, long: 'gcm' },
  'no-open': { type: 'boolean' as const, long: 'no-open' },
  'dev-panel': { type: 'boolean' as const, long: 'dev-panel' },
  'url-intercept': { type: 'boolean' as const, long: 'url-intercept' },
  'gundam-routes': { type: 'boolean' as const, long: 'gundam-routes' },
};

// ---- clap-ts with validation (full pipeline) ----

function clapParseAndValidate(rawArgs: string[], command: CommandDef) {
  const result = clapParseArgs(rawArgs, command);
  validate(result, command);
  return result;
}

// Args with clap-only features (conflictsWith, env, valueParser, requires)
const clapOnlyArgDefs = {
  ...clapArgDefs,
  env: {
    type: 'string' as const,
    short: 'e',
    long: 'env',
    valueName: 'ENV',
    valueParser: ['dev', 'staging', 'prod'] as const,
    conflictsWith: ['dev-shortcut', 'staging-shortcut', 'prod-shortcut'],
    env: 'BOX_ENV',
  },
  'dev-shortcut': {
    type: 'boolean' as const,
    long: 'dev',
    conflictsWith: ['env', 'staging-shortcut', 'prod-shortcut'],
  },
  'staging-shortcut': {
    type: 'boolean' as const,
    long: 'staging',
    conflictsWith: ['env', 'dev-shortcut', 'prod-shortcut'],
  },
  'prod-shortcut': {
    type: 'boolean' as const,
    long: 'prod',
    conflictsWith: ['env', 'dev-shortcut', 'staging-shortcut'],
  },
  'tls-cert': { type: 'string' as const, long: 'tls-cert', requires: ['tls'] },
  'tls-key': { type: 'string' as const, long: 'tls-key', requires: ['tls'] },
  tls: { type: 'boolean' as const, long: 'tls' },
  'local-app-service': {
    type: 'string' as const,
    long: 'local-app-service',
    action: 'append' as const,
  },
};

const fullPipelineArgs = [
  '--port',
  '3003',
  '--mock',
  '--mocks-dir',
  './mocks',
  '--tls',
  '--tls-cert',
  './cert.pem',
  '--tls-key',
  './key.pem',
  '--local-app-service',
  'sign-web:4000',
  '--local-app-service',
  'docgen-web:4001',
];

// ---- Wrap ArgsDef in CommandDef for clap-ts ----

const clapCmd: CommandDef = {
  meta: { name: 'bench', version: '1.0.0' },
  args: clapArgDefs,
};

const clapMinimalCmd: CommandDef = {
  meta: { name: 'bench' },
  args: { verbose: { type: 'boolean' as const } },
};

const clapOnlyCmd: CommandDef = {
  meta: { name: 'bench', version: '1.0.0' },
  args: clapOnlyArgDefs,
};

// ---- Benchmarks ----

group('parse: simple args (5 flags)', () => {
  bench('clap-ts', () => {
    clapParseArgs(simpleArgs, clapCmd);
  });
});

group('parse: complex args (22 flags)', () => {
  bench('clap-ts', () => {
    clapParseArgs(complexArgs, clapCmd);
  });
});

group('defineCommand: create command definition', () => {
  bench('clap-ts', () => {
    defineCommand({
      meta: { name: 'test', version: '1.0.0', description: 'A test command' },
      args: clapArgDefs,
      run({ args }) {
        void args;
      },
    });
  });
});

group('parse: minimal (no args)', () => {
  bench('clap-ts', () => {
    clapParseArgs([], clapMinimalCmd);
  });
});

group('parse: subcommand detection', () => {
  bench('clap-ts', () => {
    clapParseArgs(subcommandArgs, clapCmd);
  });
});

group('full pipeline: parse + validate', () => {
  bench('clap-ts', () => {
    clapParseAndValidate(fullPipelineArgs, clapOnlyCmd);
  });
});

await run();
