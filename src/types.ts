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

/** Custom value parser function. Receives raw string, returns parsed value or throws. */
export type ValueParserFn = (value: string) => unknown;

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
  /** Additional aliases (hidden from help). Single-char treated as short, multi-char as long. */
  readonly alias?: readonly string[];
  /** Visible aliases shown in help output. Registered as working aliases at parse time. */
  readonly visibleAlias?: readonly string[];
  /** Default value when the argument is not provided. */
  readonly default?: string | number | boolean | readonly string[];
  /** Value to use when the flag is present but no value given (e.g., --port vs --port=8080). */
  readonly defaultMissingValue?: string | number | boolean;
  /**
   * Conditional default: [otherArgName, otherArgValue, defaultValue].
   * If the other arg equals the given value, this default is applied.
   */
  readonly defaultValueIf?: readonly [string, string, string | number | boolean];
  /** Whether this argument is required. */
  readonly required?: boolean;
  /**
   * Required unless the named arg(s) are present.
   * Overrides `required: true` when the specified arg(s) are set.
   */
  readonly requiredUnlessPresent?: string | readonly string[];
  /**
   * Required if another arg equals a specific value: [argName, argValue].
   * Makes this arg required when the condition is met.
   */
  readonly requiredIfEq?: readonly [string, string];
  /** Cannot be used with ANY other argument. */
  readonly exclusive?: boolean;
  /** Global arg -- inherited by all subcommands. */
  readonly global?: boolean;
  /** Environment variable fallback (checked if arg not provided on CLI). */
  readonly env?: string;
  /** Display name for the value in help (e.g., "PATH", "PORT"). */
  readonly valueName?: string;
  /**
   * Value validation/parsing. Either:
   * - A string array of allowed values (enum-like restriction), or
   * - A function that parses/validates the raw string value (throw to reject).
   */
  readonly valueParser?: readonly string[] | ValueParserFn;
  /** Character to split values on (e.g., ',' for --tags=a,b,c). */
  readonly valueDelimiter?: string;
  /** Min/max number of values this arg accepts. */
  readonly numArgs?: NumArgs;
  /** Names of args that conflict with this one (mutually exclusive). */
  readonly conflictsWith?: readonly string[];
  /** Names of args that must also be present when this one is used. */
  readonly requires?: readonly string[];
  /** How values are collected: set (replace), append (collect into array), count. */
  readonly action?: ArgAction;
  /** Hide this argument from all help output. */
  readonly hidden?: boolean;
  /** Hide this argument from short help (-h) only. */
  readonly hideShortHelp?: boolean;
  /** Hide this argument from long help (--help) only. */
  readonly hideLongHelp?: boolean;
  /** Hide possible values list from help (when valueParser is string[]). */
  readonly hidePossibleValues?: boolean;
  /** Description for the --no-X variant of boolean flags. */
  readonly negativeDescription?: string;
  /** Accept values that start with a hyphen (e.g., --grep -pattern). */
  readonly allowHyphenValues?: boolean;
  /** Accept negative numbers as values (e.g., --offset -10). */
  readonly allowNegativeNumbers?: boolean;
  /** Mark as trailing var arg -- last positional consumes all remaining args. */
  readonly trailingVarArg?: boolean;
  /** Positional that requires -- before it (like clap's last()). */
  readonly last?: boolean;
  /** Custom section heading in help output (groups args under this heading). */
  readonly helpHeading?: string;
}

/** Record of argument name to definition. */
export type ArgsDef = Record<string, ArgDef>;

// ---- Style Customization ----

/** Style function that applies formatting to a string. */
export type StyleFn = (s: string) => string;

/** Customizable style definitions for help and error output. */
export interface StylesDef {
  /** Bold text (used for error prefix). */
  readonly bold: StyleFn;
  /** Yellow text. */
  readonly yellow: StyleFn;
  /** Green text. */
  readonly green: StyleFn;
  /** Cyan text. */
  readonly cyan: StyleFn;
  /** Section headings (e.g., "Usage:", "Options:"). */
  readonly heading: StyleFn;
  /** Flag names (e.g., --verbose, -v). */
  readonly flag: StyleFn;
  /** Value placeholders (e.g., <PORT>, <ENV>). */
  readonly value: StyleFn;
  /** Command/subcommand names. */
  readonly command: StyleFn;
}

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
  /** Text prepended before the help output. */
  readonly beforeHelp?: string;
  /** Text appended after the help output. */
  readonly afterHelp?: string;
  /** Hide this command from parent's help subcommand list. */
  readonly hidden?: boolean;
  /** Visible aliases shown next to the command name in help. */
  readonly aliases?: readonly string[];
  /** Require a subcommand to be provided. */
  readonly subcommandRequired?: boolean;
  /** Accept partial subcommand names (e.g., 'ser' matches 'serve'). */
  readonly inferSubcommands?: boolean;
  /** Accept partial long arg names (e.g., '--verb' matches '--verbose'). */
  readonly inferLongArgs?: boolean;
  /** Parent args and subcommands are mutually exclusive. */
  readonly argsConflictsWithSubcommands?: boolean;
  /** Accept subcommands not defined in subCommands. Passed to parent run handler. */
  readonly allowExternalSubcommands?: boolean;
  /** When a subcommand is present, parent's required args are waived. */
  readonly subcommandNegatesReqs?: boolean;
  /** Show help if no arguments are provided (instead of running). */
  readonly argRequiredElseHelp?: boolean;
  /**
   * Custom help template with placeholders:
   * {name}, {version}, {about}, {usage}, {all-args}, {arguments},
   * {options}, {commands}, {before-help}, {after-help}
   */
  readonly helpTemplate?: string;
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
  /** Custom styles for help and error output. */
  readonly styles?: Partial<StylesDef>;
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
  /** Whether -h (short) was used vs --help (long). */
  readonly helpIsShort: boolean;
  /** Whether --version / -V was requested. */
  readonly versionRequested: boolean;
  /** Unknown flags that were passed. */
  readonly unknown: readonly string[];
  /** Set of arg keys that were explicitly provided (not defaults or env). */
  readonly explicitlySet: ReadonlySet<string>;
}
