# clap-ts

A type-safe CLI argument parser for TypeScript, inspired by Rust's [clap](https://docs.rs/clap/latest/clap/) crate.

Full clap-style parsing, validation, help generation, and subcommand support. Zero runtime dependencies, with its own tokenizer rather than `node:util parseArgs`.

## Features

- **Full type inference** -- `defineCommand` infers exact types for parsed args, no casts needed
- **Clap-compatible argument model** -- boolean, string, number, enum, positional args with short/long flags
- **Subcommands** -- nested command trees with alias support, prefix inference, and external subcommands
- **Validation** -- required, exclusive, conflictsWith, requires, requiredUnlessPresent, requiredIfEq, valueParser, numArgs, argument groups
- **Custom value parsers** -- function-based parsers for custom validation and type conversion
- **Clap-style help** -- coloured, width-aware help with custom headings, templates, styles, and next-line layout on narrow terminals
- **Clap-style errors** -- "did you mean?" typo suggestions via Levenshtein distance
- **Environment variable fallback** -- `env` field on args, with CLI > env > default precedence
- **Lifecycle hooks** -- setup/run/cleanup pattern for resource management
- **Actions** -- `set` (default), `append` (collect into array), `count` (e.g. `-vvv` = 3)
- **Value delimiters** -- `--tags=a,b,c` splits into array with `valueDelimiter`
- **Boolean negation** -- `--no-verbose` automatically supported for boolean flags
- **Global args** -- `global: true` args inherited by all subcommands
- **Reusable arg groups** -- `defineArgs()` + spread for sharing args across commands
- **Trailing var args** -- last positional consumes all remaining args
- **Negative numbers** -- `--offset -10` with `allowNegativeNumbers`, positionals included
- **Hyphen values** -- `--grep -pattern` with `allowHyphenValues`
- **Multi-value options** -- `numArgs: { min: 3, max: 3 }` consumes `--point 1 2 3`
- **Value terminators** -- `--cmds ls -la ; file` with `valueTerminator: ';'`
- **Overrides** -- `overridesWith` lets the later flag win
- **Possible values with help** -- `valueParser` entries carrying help text, aliases and `hidden`
- **Built-in help subcommand** -- `app help serve`, alongside `-h` and `--help`
- **Flag subcommands** -- `pacman -S` style via `shortFlag` and `longFlag`
- **Value sources** -- tell a flag that was passed from one that fell back to env or a default
- **Lazy subcommands** -- `lazySubCommands` defers building a heavy command tree until it is needed
- **Shell completions** -- bash, zsh, fish, powershell, elvish and nushell
- **Man pages** -- roff output validated against `groff`
- **Markdown docs** -- one document for the whole command tree
- **Zero dependencies** -- only uses `node:util` (styleText, for colour detection)
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
    aliases: ['s', 'start'],                  // subcommand aliases, shown in help
    hiddenAliases: ['srv'],                   // aliases that work but stay hidden
    author: 'Salama Ashoush',                 // available to templates as {author}
    longVersion: '1.0.0 (build abc123)',      // --version; -V still shows `version`
    propagateVersion: true,                   // subcommands inherit this version
    displayOrder: 1,                          // position among sibling subcommands
    shortFlag: 's',                           // invoke as `tool -s`
    longFlag: 'serve',                        // invoke as `tool --serve`
    shortFlagAliases: ['S'],                  // extra forms, hidden from help
    longFlagAliases: ['start'],
    visibleShortFlagAliases: ['r'],           // extra forms shown in help
    visibleLongFlagAliases: ['run'],

    // Subcommand behavior
    subcommandRequired: true,                 // error if no subcommand
    inferSubcommands: true,                   // 'ser' matches 'serve'
    inferLongArgs: true,                      // '--verb' matches '--verbose'
    allowExternalSubcommands: true,           // accept undefined subcommands
    subcommandNegatesReqs: true,              // subcommand waives parent required args
    argsConflictsWithSubcommands: true,       // args and subcommands mutually exclusive
    argRequiredElseHelp: true,                // show help if no args provided
    subcommandPrecedenceOverArg: true,        // a subcommand name ends value collection
    multicall: true,                          // dispatch on the invoked binary name
    noBinaryName: true,                       // argv carries no binary name to strip

    // Naming
    binName: 'git stash',                     // shown in the usage line
    displayName: 'git-stash',                 // shown in the help header

    // Parsing behavior
    allowHyphenValues: true,                  // every arg may take -values
    allowNegativeNumbers: true,               // every arg may take negative numbers
    allowMissingPositional: true,             // `cp DEST` fills the trailing positional
    argsOverrideSelf: true,                   // repeating an arg replaces, not errors

    // Help customization
    helpTemplate: '{name} v{version}\n{usage}\n{options}',
    beforeLongHelp: 'Shown only with --help',
    afterLongHelp: 'Shown only with --help',
    subcommandHelpHeading: 'Operations',      // default "Commands"
    subcommandValueName: 'OP',                // usage placeholder, default "COMMAND"
    overrideUsage: 'serve <FILE> [--port N]', // replace the usage line
    overrideHelp: '...',                      // replace the whole help output
    termWidth: 100,                           // fixed help width
    maxTermWidth: 120,                        // cap on the detected terminal width
    disableHelpFlag: true,                    // drop the built-in -h/--help
    disableVersionFlag: true,                 // drop the built-in -V/--version
    disableHelpSubcommand: true,              // drop the built-in `help` subcommand
    disableColoredHelp: true,                 // render help without colour
    color: 'always',                          // 'auto' | 'always' | 'never'
    flattenHelp: true,                        // summarise subcommand args in place
    nextHelpHeading: 'Global',                // default heading for args that set none
    nextDisplayOrder: 100,                    // starting order for args that set none
    helpExpected: true,                       // reject a visible arg with no description

    // Error tolerance
    ignoreErrors: true,                       // collect on ParseResult.errors, keep going
    dontDelimitTrailingValues: true,          // leave values after -- unsplit
  },
  // Built on first use instead of at definition time
  lazySubCommands: () => ({ deploy: heavyDeployCommand }),
  // Applied to each argument of an external subcommand
  externalSubcommandValueParser: (v) => v.trim(),
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

    // Multi-value option: --point 1 2 3
    point: {
      type: 'string',
      numArgs: { min: 3, max: 3 },
      valueNames: ['X', 'Y', 'Z'],   // help shows --point <X> <Y> <Z>
      description: 'Coordinates',
    },

    // Value terminator: --cmds ls -la ; file.txt
    cmds: {
      type: 'string',
      action: 'append',
      numArgs: { min: 1, max: 99 },
      allowHyphenValues: true,
      valueTerminator: ';',
      description: 'Command to run',
    },

    // Require the equals form: --key=value, never --key value
    key: {
      type: 'string',
      requireEquals: true,
      description: 'API key',
    },

    // Possible values carrying help text, aliases and hidden entries
    mode: {
      type: 'string',
      ignoreCase: true,              // --mode FAST matches 'fast'
      valueParser: [
        { name: 'fast', help: 'Skip the slow checks' },
        { name: 'thorough', aliases: ['full'] },
        { name: 'legacy', hidden: true },
      ],
      description: 'Build mode',
    },

    // The later of the two wins
    dev: { type: 'boolean', overridesWith: ['release'] },
    release: { type: 'boolean', overridesWith: ['dev'] },

    // Help presentation
    bind: {
      type: 'string',
      longDescription: 'The longer explanation, shown with --help only',
      displayOrder: 1,               // position within its help section
      nextLineHelp: true,            // description on its own line
      hideDefaultValue: true,        // drop the [default: ...] note
      description: 'Address to bind',
    },
    token: {
      type: 'string',
      env: 'TOOL_TOKEN',
      hideEnvValues: true,           // show [env: TOOL_TOKEN], not its value
      description: 'API token',
    },

    // Explicit positional position, and group membership
    dest: { type: 'positional', index: 2 },
    src: { type: 'positional', index: 1 },
    yaml: { type: 'boolean', group: 'format' },     // or groups: ['format', 'output']

    // Actions beyond set, append and count
    colour: { type: 'boolean', action: 'setTrue' },
    noColour: { type: 'boolean', long: 'no-colour', action: 'setFalse' },
    usage: { type: 'boolean', short: '?', action: 'help' },      // also helpShort, helpLong
    revision: { type: 'boolean', action: 'version' },

    // Values for a bare multi-value flag
    origin: {
      type: 'string',
      numArgs: { min: 0, max: 3 },
      defaultMissingValues: ['0', '0', '0'],
    },

    // Requires another arg only at a particular value
    source: {
      type: 'string',
      requiresIf: ['remote', 'url'],                 // or requiresIfs: [[v, arg], ...]
    },
    url: { type: 'string' },
  },
});
```

By default a value shown for `env` in help includes the variable's current value,
matching clap. Use `hideEnvValues` to show only the name, or `hideEnv` to drop the
note entirely, when the variable holds a secret.

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

### Shell Completions

Add Tab completion for bash, zsh, fish, and powershell with one line:

```ts
import { defineCommand, runMain, withCompletions } from 'clap-ts';

const root = defineCommand({
  meta: { name: 'my-cli', version: '1.0.0' },
  args: { /* ... */ },
  subCommands: { /* ... */ },
});

// Auto-adds a `completions` subcommand
runMain(withCompletions(root));
```

Users then enable completions in their shell:

```bash
# bash - add to ~/.bashrc
eval "$(my-cli completions bash)"

# zsh - add to ~/.zshrc
eval "$(my-cli completions zsh)"

# fish - save to completions dir
my-cli completions fish > ~/.config/fish/completions/my-cli.fish

# powershell - add to $PROFILE
my-cli completions powershell >> $PROFILE
```

Generated scripts support flags, subcommands, aliases, enum values, and value hints (file/dir completion):

```ts
const cmd = defineCommand({
  meta: { name: 'tool' },
  args: {
    config: { type: 'string', valueHint: 'filePath' },   // Tab completes files
    outDir: { type: 'string', valueHint: 'dirPath' },    // Tab completes directories
    host: { type: 'string', valueHint: 'hostname' },     // Tab completes hostnames
    env: { type: 'string', valueParser: ['dev', 'prod'] }, // Tab shows dev, prod
  },
});
```

You can also generate scripts manually without the subcommand:

```ts
import { generateCompletions } from 'clap-ts';

const bashScript = generateCompletions(root, 'bash');
const zshScript = generateCompletions(root, 'zsh', 'custom-binary-name');
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

### Value Sources

Every handler gets a `valueSources` map saying where each argument's value came
from, which is the only way to tell `--port 3000` from a default of the same
number.

```ts
defineCommand({
  meta: { name: 'serve' },
  args: {
    port: { type: 'number', default: 3000, env: 'PORT' },
  },
  run({ args, valueSources }) {
    // 'cli' | 'env' | 'default', or undefined when the arg has no value
    if (valueSources.get('port') === 'default') {
      console.log(`Using the default port ${args.port}`);
    }
  },
});
```

### Lazy Subcommands

`lazySubCommands` takes a thunk, so a command tree whose branches each pull in
heavy modules only builds the branch being run. It is merged with `subCommands`,
which wins on a name collision.

```ts
const main = defineCommand({
  meta: { name: 'tool' },
  lazySubCommands: () => ({
    build: require('./commands/build').default,
    deploy: require('./commands/deploy').default,
  }),
});
```

The thunk runs on the first token that could be a subcommand, so `tool --version`
never calls it.

### Man Pages

```ts
import { renderManPage, generateManPages } from 'clap-ts';
import { writeFileSync } from 'node:fs';

// One page
writeFileSync('my-tool.1', renderManPage(main));

// One page per command, named my-tool.1, my-tool-serve.1, and so on
for (const [file, roff] of generateManPages(main, { section: '1' })) {
  writeFileSync(`man/${file}`, roff);
}
```

The output carries NAME, SYNOPSIS, DESCRIPTION, OPTIONS, SUBCOMMANDS, EXTRA,
VERSION and AUTHORS, with possible values as a bullet list and notes for
defaults and environment variables. Check it with `man -l my-tool.1`.

### Markdown Documentation

```ts
import { renderMarkdownHelp } from 'clap-ts';

writeFileSync('docs/cli.md', renderMarkdownHelp(main, {
  title: 'CLI Reference',   // optional, demotes command headings by one level
  footer: 'Generated from the command definitions.',
}));
```

Produces one heading per command with its usage line and Commands, Arguments and
Options lists, nesting subcommands as deeper headings.

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

Parsing is a single pass over argv against a spec compiled once per command and
cached, so flag lookup, value counts and camelCase keys are all resolved ahead of
time. Feature fields short-circuit on `undefined`, so an unused one costs nothing.
Subcommand maps are built only when a token could actually be a subcommand, which
is also what keeps `lazySubCommands` from running its thunk on a flags-only
invocation.

Earlier versions delegated to `node:util parseArgs`, which re-validates its whole
`options` object on every call, roughly 170ns per declared option regardless of how
long argv is. A 33-option command spent 5.8us there before reading a single token.

Benchmarks on AMD Ryzen 9 9950X3D (Bun 1.4), against that `node:util` baseline:

| Scenario | Before | After | Change |
|----------|--------|-------|--------|
| Minimal (no args) | 1.47us | 40ns | 36x |
| Simple (5 flags) | 9.01us | 494ns | 18x |
| Complex (22 flags) | 14.15us | 1.80us | 8x |
| Subcommand detection | 9.96us | 418ns | 24x |
| Full pipeline (parse + validate) | 23.01us | 1.45us | 16x |

Figures are the minimum of nine pinned runs. Microbenchmarks on this machine are
bimodal by roughly 1.5x depending on core placement, so a single run tells you
very little.

To run benchmarks yourself:

```bash
bun run bench
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
| Multi-token numArgs (`--point 1 2 3`) | Yes | Yes |
| requireEquals | Yes | Yes |
| valueTerminator | Yes | Yes |
| overridesWith | Yes | Yes |
| ignoreCase | Yes | Yes |
| Possible values with help/aliases | Yes | Yes |
| valueNames, index, displayOrder, nextLineHelp | Yes | Yes |
| hideDefaultValue / hideEnv / hideEnvValues | Yes | Yes |
| defaultValueIfs, requiredIfEqAny/All | Yes | Yes |
| Arg-level group membership | Yes | Yes |
| Group conflictsWith / requires | Yes | Yes |
| Built-in `help` subcommand | Yes | Yes |
| disableHelpFlag / disableVersionFlag | Yes | Yes |
| termWidth / maxTermWidth | Yes | Yes |
| overrideUsage / overrideHelp | Yes | Yes |
| propagateVersion / longVersion | Yes | Yes |
| Flag subcommands (`pacman -S`) | Yes | Yes |
| allowMissingPositional | Yes | Yes |
| argsOverrideSelf | Yes | Yes |
| subcommandPrecedenceOverArg | Yes | Yes |
| multicall / noBinaryName | Yes | Yes |
| Type-safe parsed args | derive macro | generics |
| Shell completions (bash/zsh/fish/powershell) | Yes | Yes |
| Shell completions (elvish, nushell) | Yes | Yes |
| Man page generation | Yes | Yes |
| Value source (CLI vs env vs default) | Yes | Yes |
| setTrue / setFalse / help / version actions | Yes | Yes |
| defaultMissingValues, requiresIf, singular group | Yes | Yes |
| binName, displayName, color, helpExpected | Yes | Yes |
| flattenHelp, ignoreErrors, nextHelpHeading | Yes | Yes |
| nextDisplayOrder, dontDelimitTrailingValues | Yes | Yes |
| Subcommand flag aliases (short and long) | Yes | Yes |
| Lazy subcommand building (`defer`) | Yes | Yes |
| externalSubcommandValueParser | Yes | Yes |
| Markdown documentation | clap-markdown | Yes |
| Derive macro | Yes | n/a in TypeScript |
| dontCollapseArgsInUsage | deprecated no-op | Not implemented |

Two clap settings are deliberately absent. `dont_collapse_args_in_usage` is a
deprecated no-op upstream, and this usage line never collapsed positionals in the
first place. The derive macro has no analogue: `defineCommand` already infers the
parsed argument types from the definition object.

## Roadmap

Feature parity with clap is complete as far as the builder API goes. What is left
is polish:

- A `docs` subcommand helper, the way `withCompletions` wraps completion output
- Coloured `--help` output in the markdown and man renderers' examples

## Upgrading from 0.2

The parser was rewritten to tokenize argv directly, which brought several defaults
in line with clap. Each of these was previously wrong or silently permissive:

- `--version` and `-V` exist only where `meta.version` is set. A subcommand that
  needs the root's version should set `propagateVersion: true` on the root.
- Repeating a single-value arg is an error. `argsOverrideSelf: true` restores the
  old behaviour of keeping the last one.
- A flag missing its value is an error. `--name` with nothing after it used to
  yield the boolean `true` in a string-typed arg, and `--name --verbose` used to
  swallow the next flag as the value.
- `--flag=true` is now `true`. Every `--flag=<value>` form used to yield `false`.
- `-p=80` yields `80`. The leading `=` used to end up in the value.
- Flags before a subcommand no longer break dispatch. `app --verbose serve` used
  to run nothing at all, and a subcommand's flags are now parsed against the
  subcommand rather than its parent.
- `global: true` args declared on an intermediate command now reach its
  grandchildren, not just the root's.
- Errors print the usage line of the command that failed rather than the root's.
- Help shows `[env: VAR=value]`; see `hideEnvValues` and `hideEnv`.
- The `completions` subcommand validates its shell through `valueParser`, so an
  unknown one now reports the accepted values and honours a caller's
  `exit: false` instead of calling `process.exit` from inside its handler.
- `ParseResult` gained `valueSources`, `errors`, `subCommandArgs`,
  `subCommandIsExternal` and `versionIsShort`. Only the low-level API sees these;
  `defineCommand` and `runMain` are unaffected.

## Requirements

- Node.js >= 20.0.0 or Bun >= 1.0
- TypeScript >= 5.0 (for `const` type parameter inference)

## License

MIT
