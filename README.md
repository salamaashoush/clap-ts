# clap-ts

A type-safe CLI argument parser for TypeScript, inspired by Rust's [clap](https://docs.rs/clap/latest/clap/) crate.

Full clap-style parsing, validation, help generation, and subcommand support. Zero runtime dependencies -- built on `node:util parseArgs` with a rich layer on top.

## Features

- **Full type inference** -- `defineCommand` infers exact types for parsed args, no casts needed
- **Clap-compatible argument model** -- boolean, string, number, enum, positional args with short/long flags
- **Subcommands** -- nested command trees with alias support, prefix inference, and external subcommands
- **Validation** -- required, exclusive, conflictsWith, requires, requiredUnlessPresent, requiredIfEq, valueParser, numArgs, argument groups
- **Custom value parsers** -- function-based parsers for custom validation and type conversion
- **Clap-style help** -- colored, terminal-width-aware help with custom headings, templates, and styles
- **Clap-style errors** -- "did you mean?" typo suggestions via Levenshtein distance
- **Environment variable fallback** -- `env` field on args, with CLI > env > default precedence
- **Lifecycle hooks** -- setup/run/cleanup pattern for resource management
- **Actions** -- `set` (default), `append` (collect into array), `count` (e.g. `-vvv` = 3)
- **Value delimiters** -- `--tags=a,b,c` splits into array with `valueDelimiter`
- **Boolean negation** -- `--no-verbose` automatically supported for boolean flags
- **Global args** -- `global: true` args inherited by all subcommands
- **Reusable arg groups** -- `defineArgs()` + spread for sharing args across commands
- **Trailing var args** -- last positional consumes all remaining args
- **Negative numbers** -- `--offset -10` with `allowNegativeNumbers`
- **Hyphen values** -- `--grep -pattern` with `allowHyphenValues`
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
    description: 'Start the server',         // one-line, shown in parent's subcommand list
    about: 'Start the development server',    // shown at top of this command's help
    longAbout: 'Extended description...',     // shown with --help (not -h)
    beforeHelp: 'NOTE: Requires auth.',       // text before help output
    afterHelp: 'Examples:\n  serve -p 8080',  // text after help output
    hidden: false,                            // hide from parent help
    aliases: ['s', 'start'],                  // subcommand aliases

    // Subcommand behavior
    subcommandRequired: true,                 // error if no subcommand
    inferSubcommands: true,                   // 'ser' matches 'serve'
    inferLongArgs: true,                      // '--verb' matches '--verbose'
    allowExternalSubcommands: true,           // accept undefined subcommands
    subcommandNegatesReqs: true,              // subcommand waives parent required args
    argsConflictsWithSubcommands: true,       // args and subcommands mutually exclusive
    argRequiredElseHelp: true,                // show help if no args provided

    // Help customization
    helpTemplate: '{name} v{version}\n{usage}\n{options}',
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
      short: 'n',              // -n
      long: 'name',            // --name (defaults to key if omitted)
      description: 'User name',
      required: true,
      valueName: 'NAME',       // shown in help: --name <NAME>
      env: 'TOOL_NAME',        // fallback to $TOOL_NAME
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

    // Aliases (hidden from help)
    config: {
      type: 'string',
      alias: ['c', 'conf', 'configuration'],  // hidden from help
      description: 'Config file path',
    },

    // Visible aliases (shown in help)
    output: {
      type: 'string',
      visibleAlias: ['out', 'o'],  // shown in help output
      description: 'Output path',
    },

    // Value delimiter (--tags=a,b,c -> ['a', 'b', 'c'])
    tags: {
      type: 'string',
      valueDelimiter: ',',
      description: 'Comma-separated tags',
    },

    // Allow negative numbers (--offset -10)
    offset: {
      type: 'number',
      allowNegativeNumbers: true,
      description: 'Offset (can be negative)',
    },

    // Allow hyphen values (--grep -pattern)
    grep: {
      type: 'string',
      allowHyphenValues: true,
      description: 'Search pattern (can start with -)',
    },

    // Custom value parser (function)
    port2: {
      type: 'string',
      valueParser: (v) => {
        const n = parseInt(v, 10);
        if (n < 1 || n > 65535) throw new Error('port must be 1-65535');
        return n;
      },
      description: 'Port with range validation',
    },

    // Help heading (group args under custom sections)
    host: {
      type: 'string',
      helpHeading: 'Network',
      description: 'Server host',
    },

    // Hide from specific help modes
    debug: {
      type: 'boolean',
      hideShortHelp: true,  // hidden from -h, shown in --help
      description: 'Debug mode',
    },
    internal: {
      type: 'boolean',
      hideLongHelp: true,   // hidden from --help, shown in -h
      description: 'Internal flag',
    },

    // Hide possible values from help
    format: {
      type: 'string',
      valueParser: ['json', 'yaml', 'toml'],
      hidePossibleValues: true,
      description: 'Output format',
    },
  },
});
```

### Argument Constraints

```ts
const cmd = defineCommand({
  meta: { name: 'tool' },
  args: {
    // Mutual exclusion
    json: {
      type: 'boolean',
      conflictsWith: ['yaml', 'table'],
    },
    yaml: { type: 'boolean' },
    table: { type: 'boolean' },

    // Exclusive: cannot be used with ANY other arg
    init: {
      type: 'boolean',
      exclusive: true,
    },

    // Companion requirement
    'tls-cert': {
      type: 'string',
      requires: ['tls'],
    },
    tls: { type: 'boolean' },

    // Required unless another arg is present
    file: {
      type: 'string',
      required: true,
      requiredUnlessPresent: 'stdin',   // or ['stdin', 'generate']
    },
    stdin: { type: 'boolean' },

    // Conditionally required
    output: {
      type: 'string',
      requiredIfEq: ['format', 'file'], // required when --format=file
    },
    format: { type: 'string' },

    // Conditional default
    port: {
      type: 'number',
      defaultValueIf: ['env', 'prod', 443], // default 443 when --env=prod
    },
    env: { type: 'string' },

    // Value count constraint
    files: {
      type: 'string',
      action: 'append',
      numArgs: { min: 1, max: 10 },
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

### Trailing Var Args and Last Positional

```ts
// trailingVarArg: last positional consumes all remaining args
const exec = defineCommand({
  meta: { name: 'exec' },
  args: {
    cmd: { type: 'positional', valueName: 'CMD' },
    rest: { type: 'positional', valueName: 'ARGS', trailingVarArg: true },
  },
  run({ args }) {
    // exec echo hello world
    // args.cmd = 'echo', args.rest = ['hello', 'world']
  },
});

// last: positional only assigned from args after --
const run = defineCommand({
  meta: { name: 'run' },
  args: {
    verbose: { type: 'boolean' },
    script: { type: 'positional', valueName: 'SCRIPT', last: true },
  },
  run({ args }) {
    // run --verbose -- myscript.sh
    // args.script = 'myscript.sh'
  },
});
```

### Subcommands

```ts
const root = defineCommand({
  meta: {
    name: 'app',
    version: '1.0.0',
    inferSubcommands: true,   // 'ser' matches 'serve'
  },
  args: {
    verbose: { type: 'boolean', short: 'v', global: true },
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
// $ app ser -p 8080     (inferred)
// $ app build --out-dir ./out
```

### External Subcommands

Accept undefined subcommands and handle them in the parent:

```ts
const git = defineCommand({
  meta: { name: 'git', allowExternalSubcommands: true },
  run({ subCommand, rawArgs }) {
    // $ git my-plugin arg1 arg2
    // subCommand = 'my-plugin', rawArgs = ['arg1', 'arg2']
    console.log(`Running plugin: ${subCommand}`);
  },
});
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
    ctx.data.db = await connectToDatabase();
  },

  async run(ctx) {
    const db = ctx.data.db as Database;
    await startServer(ctx.args.port, db);
  },

  async cleanup(ctx) {
    const db = ctx.data.db as Database;
    await db?.close();
  },
});
```

### Custom Styles

Override the default terminal colors for help and error output:

```ts
import { runMain } from 'clap-ts';

runMain(rootCommand, {
  styles: {
    heading: (s) => `\x1b[35m${s}\x1b[0m`,  // magenta headings
    flag: (s) => `\x1b[36m${s}\x1b[0m`,      // cyan flags
    command: (s) => `\x1b[1m${s}\x1b[0m`,    // bold commands
  },
});
```

### runMain

Entry point for CLI applications. Handles argv parsing, subcommand resolution, validation, help/version, and error display.

```ts
import { runMain } from 'clap-ts';

runMain(rootCommand);

runMain(rootCommand, {
  argv: ['serve', '--port', '8080'],  // override argv (for testing)
  exit: false,                         // don't call process.exit (for testing)
  showHelpOnEmpty: true,               // show help when no args (default: true)
  styles: { /* custom styles */ },     // override terminal colors
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
// result.explicitlySet -- Set of arg keys that were explicitly provided

// Validate separately
validate(result, command); // throws CliParseError on failure

// Render help text
const helpText = renderHelp(command);

// Render short help (-h style, hides hideShortHelp args)
const shortHelp = renderHelp(command, undefined, true);
```

## Value Precedence

Arguments are resolved in this order (highest wins):

1. **CLI flags** -- `--port 8080`
2. **Environment variables** -- `PORT=8080` (when `env: 'PORT'` is set)
3. **Conditional defaults** -- `defaultValueIf: ['env', 'prod', 443]`
4. **Static defaults** -- `default: 3000`

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

Network:
      --host <STRING>    Server host
      --proxy <STRING>   Proxy URL

Examples:
  my-tool -n World serve -p 8080
```

### Help Template

Use `helpTemplate` for full control over help layout:

```ts
const cmd = defineCommand({
  meta: {
    name: 'tool',
    version: '1.0.0',
    helpTemplate: `{before-help}{name} v{version}

{usage}

{all-args}
{commands}
{after-help}`,
  },
  // ...
});
```

Placeholders: `{name}`, `{version}`, `{about}`, `{usage}`, `{all-args}`, `{arguments}`, `{options}`, `{commands}`, `{before-help}`, `{after-help}`

## Exit Codes

| Code | Meaning |
|------|---------|
| 0    | Success |
| 1    | Runtime error (unhandled exception in run/setup/cleanup) |
| 2    | Usage error (parse failure, validation failure, unknown flags) |

## Performance

clap-ts is built for performance. Core parsing delegates to the native `node:util parseArgs` and adds a thin layer for type coercion, env fallback, and validation. Flag lookup uses precomputed `Map`s for O(1) resolution. All new feature fields short-circuit on `undefined` -- zero overhead when unused.

Benchmarks on Apple M3 Pro (Bun 1.3):

| Scenario | Time |
|----------|------|
| Minimal (no args) | ~1.7us |
| Simple (5 flags) | ~11us |
| Complex (22 flags) | ~16us |
| Subcommand detection | ~12us |
| Full pipeline (parse + validate) | ~26us |

To run benchmarks yourself:

```bash
bun run bench/parse.bench.ts
```

## Comparison with Rust clap

| Feature | clap (Rust) | clap-ts |
|---------|------------|---------|
| Boolean/string/number args | Yes | Yes |
| Short and long flags | Yes | Yes |
| Flag aliases (hidden + visible) | Yes | Yes |
| Subcommands with aliases | Yes | Yes |
| Nested subcommands | Yes | Yes |
| Global args | Yes | Yes |
| Required args | Yes | Yes |
| Default values | Yes | Yes |
| Conditional defaults (defaultValueIf) | Yes | Yes |
| Env var fallback | Yes | Yes |
| conflictsWith | Yes | Yes |
| requires | Yes | Yes |
| exclusive | Yes | Yes |
| requiredUnlessPresent | Yes | Yes |
| requiredIfEq | Yes | Yes |
| Argument groups | Yes | Yes |
| Enum values (valueParser) | Yes | Yes |
| Custom value parsers (function) | Yes | Yes |
| numArgs (min/max) | Yes | Yes |
| valueDelimiter | Yes | Yes |
| append action | Yes | Yes |
| count action | Yes | Yes |
| Boolean negation (--no-X) | Yes | Yes |
| Positional args | Yes | Yes |
| trailingVarArg | Yes | Yes |
| last (positional after --) | Yes | Yes |
| -- rest separator | Yes | Yes |
| allowHyphenValues | Yes | Yes |
| allowNegativeNumbers | Yes | Yes |
| Typo suggestions | Yes | Yes |
| inferSubcommands | Yes | Yes |
| inferLongArgs | Yes | Yes |
| subcommandRequired | Yes | Yes |
| subcommandNegatesReqs | Yes | Yes |
| allowExternalSubcommands | Yes | Yes |
| argsConflictsWithSubcommands | Yes | Yes |
| argRequiredElseHelp | Yes | Yes |
| Colored help output | Yes | Yes |
| Custom styles | Yes | Yes |
| beforeHelp / afterHelp | Yes | Yes |
| helpHeading (option grouping) | Yes | Yes |
| helpTemplate | Yes | Yes |
| hideShortHelp / hideLongHelp | Yes | Yes |
| hidePossibleValues | Yes | Yes |
| Hidden args/commands | Yes | Yes |
| Type-safe parsed args | derive macro | generics |
| Shell completions | Yes | Not yet |
| Man page generation | Yes | Not yet |

## Roadmap

- Shell completion generation (bash/zsh/fish)
- Man page generation
- Markdown help output

## Requirements

- Node.js >= 20.0.0 or Bun >= 1.0
- TypeScript >= 5.0 (for `const` type parameter inference)

## License

MIT
