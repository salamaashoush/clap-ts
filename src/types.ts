/**
 * Core types for the clap-ts CLI framework.
 * Matches clap's feature set with TypeScript type safety.
 */

// ---- Argument Types ----

/** Argument value type - matches clap's value_parser types. */
export type ArgType = 'boolean' | 'string' | 'number' | 'enum' | 'positional';

/**
 * How an argument collects values.
 * - set: replace (default)
 * - append: collect into an array
 * - count: number of occurrences
 * - setTrue / setFalse: force a boolean regardless of the flag's polarity
 * - help / helpShort / helpLong / version: trigger the built-in output
 */
export type ArgAction =
  | 'set'
  | 'append'
  | 'count'
  | 'setTrue'
  | 'setFalse'
  | 'help'
  | 'helpShort'
  | 'helpLong'
  | 'version';

/** Where a parsed value came from. Mirrors clap's ValueSource. */
export type ValueSource = 'cli' | 'env' | 'default';

/** Min/max constraint for number of values an argument accepts. */
export interface NumArgs {
  readonly min: number;
  readonly max: number;
}

/** Custom value parser function. Receives raw string, returns parsed value or throws. */
export type ValueParserFn = (value: string) => unknown;

/** One allowed value for an argument, with optional help text and aliases. */
export interface PossibleValue {
  /** The canonical value as it appears in help and completions. */
  readonly name: string;
  /** Description shown next to the value in long help. */
  readonly help?: string;
  /** Additional accepted spellings, not shown in help. */
  readonly aliases?: readonly string[];
  /** Accept the value but keep it out of help and completions. */
  readonly hidden?: boolean;
}

/** Hint for shell completion behavior -- guides what kind of values to complete. */
export type ValueHint =
  | 'unknown'
  | 'other'
  | 'filePath'
  | 'dirPath'
  | 'anyPath'
  | 'executablePath'
  | 'commandName'
  | 'commandString'
  | 'commandWithArguments'
  | 'hostname'
  | 'username'
  | 'url'
  | 'emailAddress';

/** When to colourise help and error output. */
export type ColorChoice = 'auto' | 'always' | 'never';

/** Supported shells for completion script generation. */
export type Shell = 'bash' | 'zsh' | 'fish' | 'powershell' | 'elvish' | 'nushell';

/** Full argument definition - matches clap::Arg. */
export interface ArgDef {
  /** Value type for this argument. */
  readonly type: ArgType;
  /** Human-readable description shown in help. */
  readonly description?: string;
  /** Extended description shown with --help but not with -h. */
  readonly longDescription?: string;
  /** Sort key within the arg's help section; lower values come first. */
  readonly displayOrder?: number;
  /** Render the description on its own line beneath the flag. */
  readonly nextLineHelp?: boolean;
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
  /** Values to use for a multi-value arg present without values. */
  readonly defaultMissingValues?: readonly string[];
  /**
   * Conditional default: [otherArgName, otherArgValue, defaultValue].
   * If the other arg equals the given value, this default is applied.
   */
  readonly defaultValueIf?: readonly [string, string, string | number | boolean];
  /** Several conditional defaults; the first whose condition holds is applied. */
  readonly defaultValueIfs?: readonly (readonly [
    string,
    string,
    string | number | boolean,
  ])[];
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
  /** Required when ANY of these [argName, argValue] conditions holds. */
  readonly requiredIfEqAny?: readonly (readonly [string, string])[];
  /** Required when ALL of these [argName, argValue] conditions hold. */
  readonly requiredIfEqAll?: readonly (readonly [string, string])[];
  /** Required unless ALL of the named args are present. */
  readonly requiredUnlessPresentAll?: readonly string[];
  /** Cannot be used with ANY other argument. */
  readonly exclusive?: boolean;
  /** Global arg -- inherited by all subcommands. */
  readonly global?: boolean;
  /** Environment variable fallback (checked if arg not provided on CLI). */
  readonly env?: string;
  /** Display name for the value in help (e.g., "PATH", "PORT"). */
  readonly valueName?: string;
  /** Per-value display names for a multi-value arg (e.g., ['X', 'Y', 'Z']). */
  readonly valueNames?: readonly string[];
  /**
   * Value validation/parsing. Either:
   * - An array of allowed values, each a plain string or a PossibleValue, or
   * - A function that parses/validates the raw string value (throw to reject).
   */
  readonly valueParser?: readonly (string | PossibleValue)[] | ValueParserFn;
  /** Match allowed values case-insensitively. The input is kept as typed. */
  readonly ignoreCase?: boolean;
  /** Character to split values on (e.g., ',' for --tags=a,b,c). */
  readonly valueDelimiter?: string;
  /** Require `--flag=value` form; reject `--flag value`. */
  readonly requireEquals?: boolean;
  /** Token that ends value collection for a multi-value arg (e.g., ';'). */
  readonly valueTerminator?: string;
  /** Min/max number of values this arg accepts. */
  readonly numArgs?: NumArgs;
  /** Names of args that conflict with this one (mutually exclusive). */
  readonly conflictsWith?: readonly string[];
  /** Names of args that must also be present when this one is used. */
  readonly requires?: readonly string[];
  /** Names of args this one overrides. The argument given later wins. */
  readonly overridesWith?: readonly string[];
  /** Requires the named arg only when this one equals a value: [value, argName]. */
  readonly requiresIf?: readonly [string, string];
  /** Several conditional requirements, each [thisValue, requiredArgName]. */
  readonly requiresIfs?: readonly (readonly [string, string])[];
  /** Argument group name this arg belongs to. */
  readonly group?: string;
  /** Argument group names this arg belongs to. */
  readonly groups?: readonly string[];
  /** How values are collected: set (replace), append (collect into array), count. */
  readonly action?: ArgAction;
  /** Hide this argument from all help output. */
  readonly hidden?: boolean;
  /** Hide this argument from short help (-h) only. */
  readonly hideShortHelp?: boolean;
  /** Hide this argument from long help (--help) only. */
  readonly hideLongHelp?: boolean;
  /** Hide possible values list from help (when valueParser is an array). */
  readonly hidePossibleValues?: boolean;
  /** Hide the [default: ...] note from help. */
  readonly hideDefaultValue?: boolean;
  /** Hide the [env: ...] note from help. */
  readonly hideEnv?: boolean;
  /** Show [env: VAR] in help without the variable's current value. */
  readonly hideEnvValues?: boolean;
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
  /** Explicit 1-based position for a positional arg. */
  readonly index?: number;
  /** Custom section heading in help output (groups args under this heading). */
  readonly helpHeading?: string;
  /** Hint for shell completion -- guides what kind of values to suggest (files, dirs, hosts, etc.). */
  readonly valueHint?: ValueHint;
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
  /** Name shown in the usage line, when the binary differs from the command. */
  readonly binName?: string;
  /** Name shown in the help header and version output. */
  readonly displayName?: string;
  /** Version string (shown with --version). */
  readonly version?: string;
  /** Longer version text, shown with --version where -V shows `version`. */
  readonly longVersion?: string;
  /** Give subcommands this command's version, as clap's propagate_version does. */
  readonly propagateVersion?: boolean;
  /** Author line, available to help templates as {author}. */
  readonly author?: string;
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
  /** Text prepended before long help only (--help, not -h). */
  readonly beforeLongHelp?: string;
  /** Text appended after long help only (--help, not -h). */
  readonly afterLongHelp?: string;
  /** Hide this command from parent's help subcommand list. */
  readonly hidden?: boolean;
  /** Visible aliases shown next to the command name in help. */
  readonly aliases?: readonly string[];
  /** Aliases that work but stay out of help. */
  readonly hiddenAliases?: readonly string[];
  /** Invoke this subcommand with a short flag, as in `pacman -S`. */
  readonly shortFlag?: string;
  /** Invoke this subcommand with a long flag, as in `pacman --sync`. */
  readonly longFlag?: string;
  /** Extra short flag forms for this subcommand, kept out of help. */
  readonly shortFlagAliases?: readonly string[];
  /** Extra long flag forms for this subcommand, kept out of help. */
  readonly longFlagAliases?: readonly string[];
  /** Extra short flag forms shown in help. */
  readonly visibleShortFlagAliases?: readonly string[];
  /** Extra long flag forms shown in help. */
  readonly visibleLongFlagAliases?: readonly string[];
  /** Sort key among sibling subcommands in help; lower comes first. */
  readonly displayOrder?: number;
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
  /** Do not add the built-in -h/--help flag. */
  readonly disableHelpFlag?: boolean;
  /** Do not add the built-in -V/--version flag. */
  readonly disableVersionFlag?: boolean;
  /** Do not add the built-in `help` subcommand. */
  readonly disableHelpSubcommand?: boolean;
  /** Render help without colour even on a capable terminal. */
  readonly disableColoredHelp?: boolean;
  /** When to colourise output. 'never' matches disableColoredHelp. */
  readonly color?: ColorChoice;
  /** Summarise each subcommand's own args inside this command's help. */
  readonly flattenHelp?: boolean;
  /** Collect parse errors on ParseResult instead of throwing. */
  readonly ignoreErrors?: boolean;
  /** Default help heading for args that set none. */
  readonly nextHelpHeading?: string;
  /** Starting display order for args that set none. */
  readonly nextDisplayOrder?: number;
  /** Do not split values after `--` on their valueDelimiter. */
  readonly dontDelimitTrailingValues?: boolean;
  /** Reject at build time any visible arg that has no description. */
  readonly helpExpected?: boolean;
  /** Fixed width for help output, overriding the terminal width. */
  readonly termWidth?: number;
  /** Upper bound on the terminal width used for help output. */
  readonly maxTermWidth?: number;
  /** Replace the generated usage line. */
  readonly overrideUsage?: string;
  /** Replace the whole help output. */
  readonly overrideHelp?: string;
  /** Heading for the subcommand list (default "Commands"). */
  readonly subcommandHelpHeading?: string;
  /** Placeholder for the subcommand in the usage line (default "COMMAND"). */
  readonly subcommandValueName?: string;
  /** Let every arg of this command accept values starting with a hyphen. */
  readonly allowHyphenValues?: boolean;
  /** Let every arg of this command accept negative numbers as values. */
  readonly allowNegativeNumbers?: boolean;
  /** Allow the first positional to be omitted when later ones are given. */
  readonly allowMissingPositional?: boolean;
  /** Repeating a single-value arg replaces it instead of being an error. */
  readonly argsOverrideSelf?: boolean;
  /** A subcommand name ends value collection for a multi-value arg. */
  readonly subcommandPrecedenceOverArg?: boolean;
  /** Dispatch on the invoked binary name, busybox style. */
  readonly multicall?: boolean;
  /** argv holds no binary name, so nothing is stripped from the front. */
  readonly noBinaryName?: boolean;
  /**
   * Custom help template with placeholders:
   * {name}, {version}, {author}, {about}, {usage}, {all-args}, {arguments},
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
  /** Args that cannot be used when any member of this group is present. */
  readonly conflictsWith?: readonly string[];
  /** Args that must be present when any member of this group is present. */
  readonly requires?: readonly string[];
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
  /**
   * Where each argument's value came from, by arg key. Absent means the arg has
   * no value at all.
   */
  readonly valueSources: ReadonlyMap<string, ValueSource>;
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
  /**
   * Subcommands built on first use rather than at definition time, so a CLI
   * with many heavy subcommands does not pay for all of them at startup.
   * Merged with `subCommands`, which wins on a name collision.
   */
  readonly lazySubCommands?: () => Record<string, CommandDef<any>>;
  /** Parse each argument of an external subcommand before handing it on. */
  readonly externalSubcommandValueParser?: ValueParserFn;
  /** Argument groups for validation and help grouping. */
  readonly groups?: readonly ArgGroup[];
  // Method syntax, not arrow properties: it makes the parameter bivariant, so a
  // CommandDef<{port: ...}> from defineCommand can still be passed to parseArgs,
  // validate and renderHelp, which take CommandDef<ArgsDef>.
  /** Called before run. Return value is ignored; throw to abort. */
  setup?(ctx: CommandContext<T>): void | Promise<void>;
  /** Main command handler. */
  run?(ctx: CommandContext<T>): void | Promise<void>;
  /** Called after run (even on error). */
  cleanup?(ctx: CommandContext<T>): void | Promise<void>;
}

/** Options for man page generation. */
export interface ManOptions {
  /** Page name; defaults to the command's binName, displayName or name. */
  readonly name?: string;
  /** Man section number (default '1'). */
  readonly section?: string;
  /** Manual title shown in the page header. */
  readonly manual?: string;
}

/** Options for markdown documentation output. */
export interface MarkdownOptions {
  /** Command name used in headings and usage; defaults to binName or name. */
  readonly name?: string;
  /** Document title rendered above the command, as a level-1 heading. */
  readonly title?: string;
  /** Text appended after the last command section. */
  readonly footer?: string;
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
  /** Whether the matched subcommand was accepted via allowExternalSubcommands. */
  readonly subCommandIsExternal: boolean;
  /** Tokens following the matched subcommand, to be parsed against it. */
  readonly subCommandArgs: readonly string[];
  /** Whether --help / -h was requested. */
  readonly helpRequested: boolean;
  /** Whether -h (short) was used vs --help (long). */
  readonly helpIsShort: boolean;
  /** Whether --version / -V was requested. */
  readonly versionRequested: boolean;
  /** Whether -V (short) was used rather than --version. */
  readonly versionIsShort: boolean;
  /** Unknown flags that were passed. */
  readonly unknown: readonly string[];
  /** Errors collected instead of thrown, when meta.ignoreErrors is set. */
  readonly errors: readonly string[];
  /** Set of arg keys that were explicitly provided (not defaults or env). */
  readonly explicitlySet: ReadonlySet<string>;
  /** Where each parsed value came from, by arg key. */
  readonly valueSources: ReadonlyMap<string, ValueSource>;
}
