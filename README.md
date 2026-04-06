# clap-ts

A type-safe CLI argument parser for TypeScript, inspired by Rust's [clap](https://docs.rs/clap/latest/clap/) crate.

Full clap-style parsing, validation, help generation, and subcommand support. Zero runtime dependencies -- built on `node:util parseArgs` with a rich layer on top.

## Features

- **Full type inference** -- `defineCommand` infers exact types for parsed args, no casts needed
- **Clap-compatible argument model** -- boolean, string, number, enum, positional args with short/long flags
- **Subcommands** -- nested command trees with alias support and automatic resolution
- **Validation** -- required, conflictsWith, requires, valueParser (enum), numArgs, argument groups
- **Clap-style help** -- colored, terminal-width-aware help output matching clap's format
- **Clap-style errors** -- "did you mean?" typo suggestions via Levenshtein distance
- **Environment variable fallback** -- `env` field on args, with CLI > env > default precedence
- **Lifecycle hooks** -- setup/run/cleanup pattern for resource management
- **Actions** -- `set` (default), `append` (collect into array), `count` (e.g. `-vvv` = 3)
- **Boolean negation** -- `--no-verbose` automatically supported for boolean flags
- **Global args** -- `global: true` args inherited by all subcommands
- **Reusable arg groups** -- `defineArgs()` + spread for sharing args across commands
- **Zero dependencies** -- only uses `node:util` (parseArgs + styleText)
- **Bun and Node.js** -- works on both runtimes

## Install

```bash
# npm
npm install clap-ts

# bun
bun add clap-ts

# pnpm
pnpm add clap-ts
```

## Quick Start

```ts
import { defineCommand, runMain } from 'clap-ts';

const main = defineCommand({
  meta: {
    name: 'my-tool',
    version: '1.0.0',
    description: 'A great CLI tool',
  },
  args: {
    name: {
      type: 'string',
      short: 'n',
      description: 'Your name',
      required: true,
    },
    verbose: {
      type: 'boolean',
      short: 'v',
      description: 'Enable verbose output',
    },
    port: {
      type: 'number',
      short: 'p',
      default: 3000,
      description: 'Port to listen on',
    },
  },
  run({ args }) {
    // args.name is string (required, so never undefined)
    // args.verbose is boolean | undefined
    // args.port is number (has default, so never undefined)
    console.log(`Hello ${args.name} on port ${args.port}`);
  },
});

runMain(main);
```

```
$ my-tool --name World -p 8080
Hello World on port 8080

$ my-tool --help
A great CLI tool (my-tool v1.0.0)

Usage: my-tool [OPTIONS]

Options:
  -n, --name <STRING>    Your name [required]
  -v, --verbose          Enable verbose output
  -p, --port <PORT>      Port to listen on [default: 3000]
  -h, --help             Print help
  -V, --version          Print version
```

## API Reference

### defineCommand

The primary API for creating commands. Returns the same object with full type inference.

```ts
import { defineCommand } from 'clap-ts';

const cmd = defineCommand({
  meta: {
    name: 'serve',
    version: '1.0.0',
    description: 'Start the server',       // one-line, shown in parent's subcommand list
    about: 'Start the development server',  // shown at top of this command's help
    longAbout: 'Extended description...',   // shown with --help (not -h)
    afterHelp: 'Examples:\n  serve -p 8080',
    hidden: false,                          // hide from parent help
    aliases: ['s', 'start'],               // subcommand aliases
  },
  args: { /* ... */ },
  subCommands: { /* ... */ },
  groups: [ /* ... */ ],
  setup(ctx) { /* pre-run init */ },
  run(ctx) { /* main handler */ },
  cleanup(ctx) { /* always runs, even on error */ },
});
```

### Argument Definition

Each argument is defined with an `ArgDef`:

```ts
const cmd = defineCommand({
  meta: { name: 'tool' },
  args: {
    // String argument
    name: {
      type: 'string',
      short: 'n',            // -n
      long: 'name',          // --name (defaults to key if omitted)
      description: 'User name',
      required: true,
      valueName: 'NAME',     // shown in help: --name <NAME>
      env: 'TOOL_NAME',      // fallback to $TOOL_NAME
    },

    // Number argument
    port: {
      type: 'number',
      short: 'p',
      default: 3000,
      description: 'Port number',
    },

    // Boolean flag
    verbose: {
      type: 'boolean',
      short: 'v',
      description: 'Verbose output',
      negativeDescription: 'Disable verbose output', // help text for --no-verbose
    },

    // Enum (restricted values)
    env: {
      type: 'enum',
      short: 'e',
      valueParser: ['dev', 'staging', 'prod'],
      description: 'Environment',
    },

    // Positional argument
    file: {
      type: 'positional',
      valueName: 'FILE',
      required: true,
      description: 'Input file path',
    },

    // Append action (collect multiple values)
    header: {
      type: 'string',
      short: 'H',
      action: 'append',
      description: 'HTTP headers',
    },

    // Count action (-vvv = 3)
    verbosity: {
      type: 'boolean',
      short: 'V',
      action: 'count',
      description: 'Increase verbosity',
    },

    // Optional value (--flag or --flag=value)
    level: {
      type: 'string',
      numArgs: { min: 0, max: 1 },
      defaultMissingValue: 'info',
      description: 'Log level (default: info when flag present)',
    },

    // Aliases
    config: {
      type: 'string',
      alias: ['c', 'conf', 'configuration'],
      description: 'Config file path',
    },
  },
});
```

### Argument Constraints

```ts
const cmd = defineCommand({
  meta: { name: 'tool' },
  args: {
    json: {
      type: 'boolean',
      conflictsWith: ['yaml', 'table'],   // mutually exclusive
    },
    yaml: { type: 'boolean' },
    table: { type: 'boolean' },

    'tls-cert': {
      type: 'string',
      requires: ['tls'],                   // must also pass --tls
    },
    tls: { type: 'boolean' },

    files: {
      type: 'string',
      action: 'append',
      numArgs: { min: 1, max: 10 },       // value count constraint
    },
  },

  // Argument groups
  groups: [
    {
      name: 'output-format',
      args: ['json', 'yaml', 'table'],
      required: true,    // at least one must be set
      multiple: false,   // only one allowed
    },
  ],
});
```

### Subcommands

```ts
const root = defineCommand({
  meta: { name: 'app', version: '1.0.0' },
  args: {
    verbose: { type: 'boolean', short: 'v', global: true }, // inherited by subcommands
  },
  subCommands: {
    serve: defineCommand({
      meta: { name: 'serve', description: 'Start server', aliases: ['s'] },
      args: {
        port: { type: 'number', short: 'p', default: 3000 },
      },
      run({ args }) {
        console.log(`Serving on :${args.port}`);
      },
    }),
    build: defineCommand({
      meta: { name: 'build', description: 'Build project' },
      args: {
        outDir: { type: 'string', default: 'dist' },
      },
      run({ args }) {
        console.log(`Building to ${args.outDir}`);
      },
    }),
  },
});

runMain(root);
// $ app serve -p 8080
// $ app s -p 8080       (alias)
// $ app build --out-dir ./out
```

### Reusable Argument Groups

```ts
import { defineArgs, defineCommand } from 'clap-ts';

const authArgs = defineArgs({
  user: { type: 'string', short: 'u', env: 'APP_USER' },
  token: { type: 'string', short: 't', env: 'APP_TOKEN', hidden: true },
});

const loggingArgs = defineArgs({
  verbose: { type: 'boolean', short: 'v' },
  quiet: { type: 'boolean', short: 'q', conflictsWith: ['verbose'] },
});

const cmd = defineCommand({
  meta: { name: 'deploy' },
  args: {
    ...authArgs,
    ...loggingArgs,
    target: { type: 'string', required: true },
  },
  run({ args }) {
    // args.user, args.token, args.verbose, args.quiet, args.target
    // all fully typed
  },
});
```

### Lifecycle Hooks

Commands support setup/run/cleanup lifecycle hooks. `cleanup` always runs, even if `run` throws.

```ts
const cmd = defineCommand({
  meta: { name: 'server' },
  args: { port: { type: 'number', default: 3000 } },

  async setup(ctx) {
    // Initialize resources
    ctx.data.db = await connectToDatabase();
  },

  async run(ctx) {
    // Main logic
    const db = ctx.data.db as Database;
    await startServer(ctx.args.port, db);
  },

  async cleanup(ctx) {
    // Always runs -- close connections, temp files, etc.
    const db = ctx.data.db as Database;
    await db?.close();
  },
});
```

### runMain

Entry point for CLI applications. Handles argv parsing, subcommand resolution, validation, help/version, and error display.

```ts
import { runMain } from 'clap-ts';

// Basic usage
runMain(rootCommand);

// With options
runMain(rootCommand, {
  argv: ['serve', '--port', '8080'],  // override argv (for testing)
  exit: false,                         // don't call process.exit (for testing)
  showHelpOnEmpty: true,               // show help when no args (default: true)
});
```

### Low-Level API

For advanced use cases, you can use the parser and validator directly:

```ts
import { parseArgs, validate, renderHelp, CliParseError } from 'clap-ts';

const command = defineCommand({
  meta: { name: 'tool' },
  args: { port: { type: 'number', default: 3000 } },
});

// Parse without validation
const result = parseArgs(['--port', '8080'], command);
// result.args, result.positionals, result.rest, result.unknown

// Validate separately
validate(result, command); // throws CliParseError on failure

// Render help text
const helpText = renderHelp(command);
```

## Value Precedence

Arguments are resolved in this order (highest wins):

1. **CLI flags** -- `--port 8080`
2. **Environment variables** -- `PORT=8080` (when `env: 'PORT'` is set)
3. **Default values** -- `default: 3000`

## Error Messages

Errors match clap's format with typo suggestions:

```
error: unexpected argument '--verbos' found

  tip: a similar argument exists: '--verbose'

Usage: my-tool [OPTIONS]

For more information, try '--help'.
```

```
error: the argument '--json' cannot be used with '--yaml'

Usage: my-tool [OPTIONS]

For more information, try '--help'.
```

```
error: the following required arguments were not provided:
  --name
  --port

Usage: my-tool [OPTIONS]

For more information, try '--help'.
```

## Help Output

Help is automatically generated in clap's format, respecting `NO_COLOR`, `TERM=dumb`, and terminal width:

```
A great CLI tool (my-tool v1.0.0)

Usage: my-tool [OPTIONS] <FILE> [COMMAND]

Arguments:
  <FILE>    Input file path [required]

Commands:
  serve (s)    Start the development server
  build        Build the project

Options:
  -n, --name <NAME>      User name [required]
  -e, --env <ENV>        Environment [possible values: dev, staging, prod]
  -p, --port <PORT>      Port number [default: 3000] [env: PORT]
      --verbose          Enable verbose output
  -h, --help             Print help
  -V, --version          Print version

Examples:
  my-tool -n World serve -p 8080
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0    | Success |
| 1    | Runtime error (unhandled exception in run/setup/cleanup) |
| 2    | Usage error (parse failure, validation failure, unknown flags) |

## Performance

clap-ts is built for performance. Core parsing delegates to the native `node:util parseArgs` and adds a thin layer for type coercion, env fallback, and validation.

Typical parsing times (measured with `bun bench`):

| Scenario | Time |
|----------|------|
| Minimal (no args) | ~3us |
| Simple (5 flags) | ~8us |
| Complex (22 flags) | ~20us |
| Full pipeline (parse + validate) | ~25us |

To run benchmarks yourself:

```bash
bun add -d mitata
bun run bench/parse.bench.ts
```

## Comparison with Rust clap

clap-ts implements the core feature set of Rust's clap:

| Feature | clap (Rust) | clap-ts |
|---------|------------|---------|
| Boolean/string/number args | Yes | Yes |
| Short and long flags | Yes | Yes |
| Flag aliases | Yes | Yes |
| Subcommands with aliases | Yes | Yes |
| Nested subcommands | Yes | Yes |
| Global args | Yes | Yes |
| Required args | Yes | Yes |
| Default values | Yes | Yes |
| Env var fallback | Yes | Yes |
| conflictsWith | Yes | Yes |
| requires | Yes | Yes |
| Argument groups | Yes | Yes |
| Enum values (valueParser) | Yes | Yes |
| numArgs (min/max) | Yes | Yes |
| append action | Yes | Yes |
| count action | Yes | Yes |
| Boolean negation (--no-X) | Yes | Yes |
| Positional args | Yes | Yes |
| -- rest separator | Yes | Yes |
| Typo suggestions | Yes | Yes |
| Colored help output | Yes | Yes |
| Hidden args/commands | Yes | Yes |
| Type-safe parsed args | derive macro | generics |
| Custom value parsers | Yes | Not yet |
| Shell completions | Yes | Not yet |
| Man page generation | Yes | Not yet |

## Roadmap

Features planned for future releases:

- Custom value parsers (beyond enum validation)
- Shell completion generation (bash/zsh/fish)
- Man page generation
- Markdown help output
- Custom error formatters
- Color theme customization
- Range validators for numeric args

## Requirements

- Node.js >= 18.0.0 or Bun >= 1.0
- TypeScript >= 5.0 (for `const` type parameter inference)

## License

MIT
