/**
 * Core types for the clap-ts CLI framework.
 * Matches clap's feature set with TypeScript type safety.
 */

// ---- Argument Types ----

/** Argument value type - matches clap's value_parser types. */
export type ArgType = 'boolean' | 'string' | 'number' | 'enum' | 'positional';

/** How an argument collects values. */
export type ArgAction = 'set' | 'append' | 'count';

/** Min/max constraint for number of values an argument accepts. */
export interface NumArgs {
  readonly min: number;
  readonly max: number;
}

/** Full argument definition - matches clap::Arg. */
export interface ArgDef {
  /** Value type for this argument. */
  readonly type: ArgType;
  /** Human-readable description shown in help. */
  readonly description?: string;
  /** Short flag character (e.g., 'v' for -v). */
  readonly short?: string;
  /** Long flag name (e.g., 'verbose' for --verbose). Defaults to the arg key. */
  readonly long?: string;
  /** Additional long aliases (e.g., ['dir', 'directory']). */
  readonly alias?: readonly string[];
  /** Default value when the argument is not provided. */
  readonly default?: string | number | boolean | readonly string[];
  /** Value to use when the flag is present but no value given (e.g., --port vs --port=8080). */
  readonly defaultMissingValue?: string | number | boolean;
  /** Whether this argument is required. */
  readonly required?: boolean;
  /** Global arg -- inherited by all subcommands. */
  readonly global?: boolean;
  /** Environment variable fallback (checked if arg not provided on CLI). */
  readonly env?: string;
  /** Display name for the value in help (e.g., "PATH", "PORT"). */
  readonly valueName?: string;
  /** Restricted set of allowed values (like clap's PossibleValues). */
  readonly valueParser?: readonly string[];
  /** Min/max number of values this arg accepts. */
  readonly numArgs?: NumArgs;
  /** Names of args that conflict with this one (mutually exclusive). */
  readonly conflictsWith?: readonly string[];
  /** Names of args that must also be present when this one is used. */
  readonly requires?: readonly string[];
  /** How values are collected: set (replace), append (collect into array), count. */
  readonly action?: ArgAction;
  /** Hide this argument from help output. */
  readonly hidden?: boolean;
  /** Description for the --no-X variant of boolean flags. */
  readonly negativeDescription?: string;
}

/** Record of argument name to definition. */
export type ArgsDef = Record<string, ArgDef>;

// ---- Command Types ----

/** Command metadata - matches clap::Command attributes. */
export interface CommandMeta {
  /** Command name (used in usage line). */
  readonly name: string;
  /** Version string (shown with --version). */
  readonly version?: string;
  /** Short description (one line, shown in parent's subcommand list). */
  readonly description?: string;
  /** Longer "about" text (shown at top of this command's help). */
  readonly about?: string;
  /** Extended help text (shown with --help, not -h). */
  readonly longAbout?: string;
  /** Text appended after the help output. */
  readonly afterHelp?: string;
  /** Hide this command from parent's help subcommand list. */
  readonly hidden?: boolean;
  /** Visible aliases shown next to the command name in help. */
  readonly aliases?: readonly string[];
}

/** Argument group - for organizing related args (like clap's ArgGroup). */
export interface ArgGroup {
  /** Group name (for display). */
  readonly name: string;
  /** Arg names in this group. */
  readonly args: readonly string[];
  /** Whether the group is required (at least one must be set). */
  readonly required?: boolean;
  /** Whether args in the group are mutually exclusive. */
  readonly multiple?: boolean;
}

/**
 * Infer the parsed type from an ArgDef.
 * - boolean -> boolean
 * - number -> number
 * - string/enum/positional -> string
 * - action: 'append' -> string[]
 * - action: 'count' -> number
 */
export type InferArgValue<A extends ArgDef> = A['action'] extends 'append'
  ? string[]
  : A['action'] extends 'count'
    ? number
    : A['type'] extends 'boolean'
      ? boolean
      : A['type'] extends 'number'
        ? number
        : string;

/**
 * Infer whether an arg is optional based on required/default.
 * Args with `required: true` are always non-optional.
 * Args with a default are always non-optional.
 * All others may be undefined.
 */
export type InferArgOptional<A extends ArgDef, V> = A['required'] extends true
  ? V
  : A['default'] extends undefined
    ? V | undefined
    : V;

/** Map an ArgsDef record to parsed argument types. */
export type ParsedArgs<T extends ArgsDef> = {
  [K in keyof T]: InferArgOptional<T[K], InferArgValue<T[K]>>;
};

/** Context passed to command hooks. */
export interface CommandContext<T extends ArgsDef = ArgsDef> {
  /** Raw argv that was parsed. */
  readonly rawArgs: readonly string[];
  /** Parsed and validated arguments. */
  readonly args: ParsedArgs<T>;
  /** The command definition being executed. */
  readonly cmd: CommandDef<T>;
  /** Name of the resolved subcommand, if any. */
  readonly subCommand?: string;
  /** Arbitrary user data (for passing state between setup/run/cleanup). */
  data: Record<string, unknown>;
}

/** Full command definition - matches clap::Command. */
export interface CommandDef<T extends ArgsDef = ArgsDef> {
  /** Command metadata. */
  readonly meta: CommandMeta;
  /** Argument definitions. */
  readonly args?: T;
  /** Subcommand definitions (name -> command). */
  // CommandDef needs to accept any args type for subcommands
  readonly subCommands?: Record<string, CommandDef<any>>;
  /** Argument groups for validation and help grouping. */
  readonly groups?: readonly ArgGroup[];
  /** Called before run. Return value is ignored; throw to abort. */
  readonly setup?: (ctx: CommandContext<T>) => void | Promise<void>;
  /** Main command handler. */
  readonly run?: (ctx: CommandContext<T>) => void | Promise<void>;
  /** Called after run (even on error). */
  readonly cleanup?: (ctx: CommandContext<T>) => void | Promise<void>;
}

// ---- Options ----

/** Options for runMain / runCommand. */
export interface RunOptions {
  /** Override argv (defaults to Bun.argv / process.argv). */
  readonly argv?: readonly string[];
  /** Exit process on error (default: true). */
  readonly exit?: boolean;
  /** Show help on empty args when command has subcommands (default: true). */
  readonly showHelpOnEmpty?: boolean;
}

// ---- Parser Result ----

/** Result of parsing arguments. */
export interface ParseResult {
  /** Parsed argument values (key -> value). */
  readonly args: Record<string, string | number | boolean | string[]>;
  /** Positional arguments in order. */
  readonly positionals: readonly string[];
  /** Arguments after -- separator. */
  readonly rest: readonly string[];
  /** The subcommand name if one was matched. */
  readonly subCommand?: string;
  /** Whether --help / -h was requested. */
  readonly helpRequested: boolean;
  /** Whether --version / -V was requested. */
  readonly versionRequested: boolean;
  /** Unknown flags that were passed. */
  readonly unknown: readonly string[];
}
