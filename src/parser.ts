/**
 * Argument parser.
 *
 * Tokenizes argv directly against the command's own arg definitions. This
 * replaced node:util parseArgs, which re-validates its entire `options` object
 * on every call (~170ns per option, regardless of argv length) and cannot
 * express multi-value options, value terminators, or subcommand boundaries.
 *
 * Handled here: long/short/clustered flags, attached and `=` values, boolean
 * negation, count and append actions, multi-token numArgs, optional values via
 * defaultMissingValue, value delimiters, hyphen and negative-number values,
 * positional assignment, trailing var args, `--` escape, subcommand
 * boundaries, env fallback, conditional and static defaults, and
 * kebab-to-camel key mapping.
 *
 * Constraint checks that need the whole picture (conflicts, requires, groups,
 * possible values) live in validation.ts.
 */

import type {
  ArgDef,
  ArgsDef,
  ParseResult,
  CommandDef,
  PossibleValue,
  ValueSource,
} from './types.js';

// ---- Error ----

export class CliParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliParseError';
  }
}

// ---- Helpers ----

const HYPHEN = 45;
const NEGATIVE_NUMBER = /^-\d/;

/** Convert kebab-case to camelCase: --config-path -> configPath */
export function kebabToCamel(s: string): string {
  return s.replaceAll(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/**
 * Get the raw argv slice (after the binary/script path). With `noBinaryName`
 * the source is taken as-is, matching clap's Command::no_binary_name.
 */
export function getRawArgs(argv?: readonly string[], noBinaryName = false): string[] {
  if (argv) {
    return [...argv];
  }
  // Bun.argv includes [bun, script, ...args], same as process.argv
  const source =
    globalThis.Bun === undefined ? process.argv : (globalThis.Bun as { argv: string[] }).argv;
  return noBinaryName ? [...source] : source.slice(2);
}

function readEnv(name: string): string | undefined {
  return globalThis.Bun === undefined
    ? process.env[name]
    : (globalThis.Bun as { env: Record<string, string | undefined> }).env[name];
}

// ---- Subcommands ----

const resolvedSubCommands = new WeakMap<object, Record<string, CommandDef<any>>>();

/**
 * The command's subcommands, building any lazy ones on first use and caching
 * the result so the thunk runs at most once per command.
 */
export function subCommandsOf(command: CommandDef<any>): Record<string, CommandDef<any>> {
  if (command.lazySubCommands === undefined) {
    return command.subCommands ?? {};
  }
  let resolved = resolvedSubCommands.get(command);
  if (resolved === undefined) {
    resolved = { ...command.lazySubCommands(), ...command.subCommands };
    resolvedSubCommands.set(command, resolved);
  }
  return resolved;
}

/** Whether the command has any subcommand, without building the lazy ones. */
export function hasSubCommands(command: CommandDef<any>): boolean {
  if (command.lazySubCommands !== undefined) {
    return true;
  }
  const subs = command.subCommands;
  if (subs === undefined) {
    return false;
  }
  for (const _key in subs) {
    return true;
  }
  return false;
}

// ---- Possible Values ----

const possibleValueCache = new WeakMap<object, readonly PossibleValue[]>();

/**
 * Normalize an arg's allowed values to PossibleValue records. Plain strings and
 * PossibleValue objects can be mixed in the same list.
 */
export function possibleValues(def: ArgDef): readonly PossibleValue[] {
  const parser = def.valueParser;
  if (parser === undefined || typeof parser === 'function') {
    return [];
  }
  const cached = possibleValueCache.get(parser);
  if (cached !== undefined) {
    return cached;
  }
  const normalized = parser.map((v) => (typeof v === 'string' ? { name: v } : v));
  possibleValueCache.set(parser, normalized);
  return normalized;
}

/** Whether a raw value matches this possible value, by name or alias. */
export function matchesPossibleValue(
  candidate: PossibleValue,
  value: string,
  ignoreCase: boolean,
): boolean {
  if (ignoreCase) {
    const lowered = value.toLowerCase();
    if (candidate.name.toLowerCase() === lowered) {
      return true;
    }
    return candidate.aliases?.some((a) => a.toLowerCase() === lowered) ?? false;
  }
  return candidate.name === value || (candidate.aliases?.includes(value) ?? false);
}

// ---- Compiled Spec ----

/**
 * An arg definition flattened into the shape the tokenizer needs, so the hot
 * loop never re-derives `long ?? key`, value counts, or action booleans.
 */
interface ArgSpec {
  readonly key: string;
  readonly def: ArgDef;
  readonly long: string;
  readonly isBool: boolean;
  readonly isCount: boolean;
  readonly isAppend: boolean;
  /** Minimum values this arg consumes per occurrence. */
  readonly min: number;
  /** Maximum values this arg consumes per occurrence. */
  readonly max: number;
  /** camelCase form of `key`, precomputed so parsing never re-runs the regex. */
  readonly camel: string;
  /** Whether a second occurrence of this arg should be rejected. */
  readonly repeatIsError: boolean;
  /** Fixed boolean this flag forces, for the setTrue and setFalse actions. */
  readonly forced?: boolean;
  /** Built-in output this arg triggers, for the help and version actions. */
  readonly triggers?: 'help' | 'helpShort' | 'helpLong' | 'version';
  /** Built-in flag this spec stands for, if any. */
  readonly builtin?: 'help' | 'version';
}

interface LongEntry {
  readonly spec: ArgSpec;
  readonly negated: boolean;
}

interface CommandSpec {
  readonly longs: Map<string, LongEntry>;
  readonly shorts: Map<string, ArgSpec>;
  readonly positionals: readonly ArgSpec[];
  /** Count of positionals fed from argv rather than from after `--`. */
  readonly indexedPositionals: number;
  /** Every declared arg, in declaration order, for the fallback and key passes. */
  readonly all: readonly ArgSpec[];
  /**
   * The command itself, so the subcommand maps can be built on demand. A CLI
   * that only ever sees flags never pays for a lazySubCommands thunk.
   */
  readonly command: CommandDef<any>;
  readonly anySubcommands: boolean;
  /** Subcommand name or alias -> canonical name. Built on first lookup. */
  subcommands?: Map<string, string>;
  /** Long or short flag -> canonical subcommand name, for `pacman -S` style. */
  subcommandFlags?: Map<string, string>;
  readonly inferSubcommands: boolean;
  readonly allowExternal: boolean;
  readonly subcommandPrecedence: boolean;
  readonly allowMissingPositional: boolean;
  readonly argsOverrideSelf: boolean;
  readonly ignoreErrors: boolean;
  readonly dontDelimitTrailingValues: boolean;
  /** Whether any arg declares overridesWith, so occurrence order must be kept. */
  readonly hasOverrides: boolean;
  readonly cmdAllowHyphen: boolean;
  /** Any arg accepts negative numbers, so `-5` may be a value rather than a flag. */
  readonly allowsNegative: boolean;
  readonly inferLong: boolean;
}

const specCache = new WeakMap<CommandDef, CommandSpec>();

/** Actions that stand alone: the flag carries no value of its own. */
const VALUELESS_ACTIONS = new Set<string>([
  'count',
  'setTrue',
  'setFalse',
  'help',
  'helpShort',
  'helpLong',
  'version',
]);

function valueCounts(def: ArgDef): { min: number; max: number } {
  if (def.numArgs) {
    return { min: def.numArgs.min, max: def.numArgs.max };
  }
  if (def.type === 'boolean' || (def.action !== undefined && VALUELESS_ACTIONS.has(def.action))) {
    return { min: 0, max: 0 };
  }
  return { min: 1, max: 1 };
}

function makeSpec(key: string, def: ArgDef, argsOverrideSelf: boolean): ArgSpec {
  const { min, max } = valueCounts(def);
  const isAppend = def.action === 'append';
  const forced =
    def.action === 'setTrue' ? true : def.action === 'setFalse' ? false : undefined;
  const triggers =
    def.action === 'help' || def.action === 'helpShort' || def.action === 'helpLong'
      ? def.action
      : def.action === 'version'
        ? ('version' as const)
        : undefined;
  return {
    forced,
    triggers,
    key,
    def,
    long: def.long ?? key,
    camel: kebabToCamel(key),
    repeatIsError: !isAppend && !argsOverrideSelf && def.overridesWith === undefined,
    isBool: def.type === 'boolean' && !VALUELESS_ACTIONS.has(def.action ?? ''),
    isCount: def.action === 'count',
    isAppend,
    min,
    max,
  };
}

function registerAliases(
  aliases: readonly string[] | undefined,
  spec: ArgSpec,
  longs: Map<string, LongEntry>,
  shorts: Map<string, ArgSpec>,
): void {
  if (!aliases) {
    return;
  }
  for (const alias of aliases) {
    if (alias.length === 1) {
      shorts.set(alias, spec);
    } else {
      longs.set(alias, { spec, negated: false });
    }
  }
}

function buildSpec(command: CommandDef): CommandSpec {
  const argsDef: ArgsDef = command.args ?? {};
  const longs = new Map<string, LongEntry>();
  const shorts = new Map<string, ArgSpec>();
  const positionals: ArgSpec[] = [];
  const all: ArgSpec[] = [];
  let allowsNegative = false;

  const cmdAllowHyphen = command.meta.allowHyphenValues === true;
  const argsOverrideSelf = command.meta.argsOverrideSelf === true;
  let hasOverrides = false;
  if (command.meta.allowNegativeNumbers) {
    allowsNegative = true;
  }

  for (const key of Object.keys(argsDef)) {
    const def = argsDef[key]!;

    if (def.allowNegativeNumbers) {
      allowsNegative = true;
    }
    if (def.overridesWith !== undefined) {
      hasOverrides = true;
    }

    const spec = makeSpec(key, def, argsOverrideSelf);
    all.push(spec);

    if (def.type === 'positional') {
      positionals.push(spec);
      continue;
    }

    longs.set(spec.long, { spec, negated: false });
    if (spec.isBool) {
      longs.set(`no-${spec.long}`, { spec, negated: true });
    }
    if (def.short && def.short.length === 1) {
      shorts.set(def.short, spec);
    }
    registerAliases(def.alias, spec, longs, shorts);
    registerAliases(def.visibleAlias, spec, longs, shorts);
  }

  // Built-in flags never displace a user-defined arg of the same name.
  const helpSpec: ArgSpec = {
    key: 'help', def: { type: 'boolean' }, long: 'help', camel: 'help',
    repeatIsError: false,
    isBool: true, isCount: false, isAppend: false, min: 0, max: 0, builtin: 'help',
  };
  const versionSpec: ArgSpec = {
    key: 'version', def: { type: 'boolean' }, long: 'version', camel: 'version',
    repeatIsError: false,
    isBool: true, isCount: false, isAppend: false, min: 0, max: 0, builtin: 'version',
  };
  if (command.meta.disableHelpFlag !== true) {
    if (!longs.has('help')) {
      longs.set('help', { spec: helpSpec, negated: false });
    }
    if (!shorts.has('h')) {
      shorts.set('h', helpSpec);
    }
  }
  // clap only offers --version where a version exists, either on this command
  // or propagated down from an ancestor.
  if (command.meta.disableVersionFlag !== true && command.meta.version !== undefined) {
    if (!longs.has('version')) {
      longs.set('version', { spec: versionSpec, negated: false });
    }
    if (!shorts.has('V')) {
      shorts.set('V', versionSpec);
    }
  }

  if (command.meta.helpExpected) {
    const undocumented = all
      .filter((spec) => !spec.def.hidden && !spec.def.description && !spec.def.longDescription)
      .map((spec) => spec.key);
    if (undocumented.length > 0) {
      throw new CliParseError(
        `helpExpected is set but these arguments have no description: ${undocumented.join(', ')}`,
      );
    }
  }

  // An explicit index overrides declaration order; unindexed positionals keep
  // their relative order after the indexed ones are placed.
  if (positionals.some((spec) => spec.def.index !== undefined)) {
    positionals.sort((a, b) => (a.def.index ?? Number.MAX_SAFE_INTEGER) - (b.def.index ?? Number.MAX_SAFE_INTEGER));
  }

  return {
    longs,
    shorts,
    positionals,
    indexedPositionals: positionals.reduce((n, spec) => (spec.def.last ? n : n + 1), 0),
    all,
    command,
    anySubcommands: hasSubCommands(command),
    inferSubcommands: command.meta.inferSubcommands === true,
    allowExternal: command.meta.allowExternalSubcommands === true,
    subcommandPrecedence: command.meta.subcommandPrecedenceOverArg === true,
    allowMissingPositional: command.meta.allowMissingPositional === true,
    argsOverrideSelf,
    ignoreErrors: command.meta.ignoreErrors === true,
    dontDelimitTrailingValues: command.meta.dontDelimitTrailingValues === true,
    hasOverrides,
    cmdAllowHyphen,
    allowsNegative,
    inferLong: command.meta.inferLongArgs === true,
  };
}

function getSpec(command: CommandDef): CommandSpec {
  let spec = specCache.get(command);
  if (spec === undefined) {
    spec = buildSpec(command);
    specCache.set(command, spec);
  }
  return spec;
}

// ---- Value Coercion ----

function coerceValue(value: string, def: ArgDef, argName: string): string | number | boolean {
  if (typeof def.valueParser === 'function') {
    try {
      const parsed = def.valueParser(value);
      if (
        typeof parsed === 'string' ||
        typeof parsed === 'number' ||
        typeof parsed === 'boolean'
      ) {
        return parsed;
      }
      return String(parsed);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new CliParseError(`invalid value '${value}' for '${argName}': ${msg}`);
    }
  }

  switch (def.type) {
    case 'boolean': {
      const lower = value.toLowerCase();
      return lower === 'true' || lower === '1' || lower === 'yes';
    }
    case 'number': {
      const num = value.includes('.') ? Number.parseFloat(value) : Number.parseInt(value, 10);
      if (Number.isNaN(num) || !Number.isFinite(num)) {
        throw new CliParseError(
          `invalid value '${value}' for '${argName}': expected a finite number`,
        );
      }
      return num;
    }
    case 'enum':
    case 'string':
    case 'positional': {
      return value;
    }
  }
}

/** Human-readable name for this arg in error messages. */
function displayName(spec: ArgSpec): string {
  return spec.def.type === 'positional' ? `<${spec.def.valueName ?? spec.key}>` : `--${spec.long}`;
}

// ---- Tokenizer State ----

interface ParseState {
  readonly result: Record<string, string | number | boolean | string[]>;
  readonly explicitlySet: Set<string>;
  readonly valueSources: Map<string, ValueSource>;
  readonly errors: string[];
  /** Keys whose value came from tokens after `--`. */
  readonly fromRest: Set<string>;
  /**
   * Arg key -> sequence number of its last explicit occurrence. Only built when
   * some arg declares overridesWith, so the common parse allocates no Map.
   */
  order: Map<string, number> | undefined;
  seq: number;
  readonly unknown: string[];
  readonly positionals: string[];
  readonly rest: string[];
  helpRequested: boolean;
  helpIsShort: boolean;
  versionRequested: boolean;
  versionIsShort: boolean;
  subCommand?: string;
  subCommandIsExternal: boolean;
  subCommandArgs: readonly string[];
}

/** Record that an arg was explicitly given, keeping the occurrence order. */
function markSet(state: ParseState, key: string): void {
  state.explicitlySet.add(key);
  state.valueSources.set(key, 'cli');
  state.order?.set(key, state.seq++);
}

/** Whether a token can serve as a value for this arg rather than starting a new flag. */
function isValueToken(token: string, spec: ArgSpec, cmdSpec: CommandSpec): boolean {
  if (token.length === 0 || token.charCodeAt(0) !== HYPHEN) {
    return true;
  }
  if (token === '-') {
    return true;
  }
  if (token === '--') {
    return false;
  }
  if (spec.def.allowHyphenValues || cmdSpec.cmdAllowHyphen) {
    return true;
  }
  return (
    (spec.def.allowNegativeNumbers || cmdSpec.allowsNegative) && NEGATIVE_NUMBER.test(token)
  );
}

/** Record a flag occurrence that carries no value: booleans and counts. */
function applyFlagOnly(spec: ArgSpec, negated: boolean, state: ParseState): void {
  if (spec.builtin === 'help' || spec.triggers === 'help' || spec.triggers === 'helpLong') {
    state.helpRequested = true;
    return;
  }
  if (spec.triggers === 'helpShort') {
    state.helpRequested = true;
    state.helpIsShort = true;
    return;
  }
  if (spec.builtin === 'version' || spec.triggers === 'version') {
    state.versionRequested = true;
    return;
  }
  if (spec.forced !== undefined) {
    state.result[spec.key] = negated ? !spec.forced : spec.forced;
    markSet(state, spec.key);
    return;
  }
  if (spec.isCount) {
    const previous = state.result[spec.key];
    state.result[spec.key] = (typeof previous === 'number' ? previous : 0) + 1;
  } else {
    state.result[spec.key] = !negated;
  }
  markSet(state, spec.key);
}

/** Store one or more parsed values for an arg, honouring the append action. */
function applyValues(spec: ArgSpec, values: string[], state: ParseState): void {
  const name = displayName(spec);

  // A second occurrence of a single-value arg is an error in clap unless the
  // command opted into argsOverrideSelf. Reading result is cheaper than the
  // Set, and defaults have not been applied yet, so a value here means a
  // previous occurrence.
  if (spec.repeatIsError && state.result[spec.key] !== undefined) {
    throw new CliParseError(`the argument '${name}' cannot be used multiple times`);
  }

  if (spec.isAppend) {
    const previous = state.result[spec.key];
    const list = Array.isArray(previous) ? previous : [];
    for (const value of values) {
      list.push(String(coerceValue(value, spec.def, name)));
    }
    state.result[spec.key] = list;
  } else if (values.length > 1) {
    state.result[spec.key] = values.map((v) => String(coerceValue(v, spec.def, name)));
  } else {
    state.result[spec.key] = coerceValue(values[0]!, spec.def, name);
  }

  markSet(state, spec.key);
}

/** Apply defaultMissingValue for a flag whose value was omitted (numArgs.min === 0). */
function applyMissingValue(spec: ArgSpec, state: ParseState): void {
  if (spec.def.defaultMissingValues !== undefined) {
    state.result[spec.key] = [...spec.def.defaultMissingValues];
    markSet(state, spec.key);
    return;
  }
  const fallback = spec.def.defaultMissingValue ?? true;
  if (spec.isAppend) {
    const previous = state.result[spec.key];
    const list = Array.isArray(previous) ? previous : [];
    list.push(String(fallback));
    state.result[spec.key] = list;
  } else {
    state.result[spec.key] = fallback;
  }
  markSet(state, spec.key);
}

/**
 * Consume up to `spec.max` values for a flag starting at argv[from].
 * Returns the index of the last token consumed.
 */
function consumeValues(
  spec: ArgSpec,
  argv: readonly string[],
  from: number,
  cmdSpec: CommandSpec,
  state: ParseState,
): number {
  const values: string[] = [];
  let i = from;

  while (values.length < spec.max && i < argv.length) {
    const token = argv[i]!;
    if (spec.def.valueTerminator !== undefined && token === spec.def.valueTerminator) {
      i++;
      break;
    }
    if (!isValueToken(token, spec, cmdSpec)) {
      break;
    }
    if (
      cmdSpec.subcommandPrecedence &&
      values.length >= spec.min &&
      resolveSubcommand(cmdSpec, token) !== undefined
    ) {
      break;
    }
    values.push(token);
    i++;
  }

  if (values.length < spec.min) {
    if (values.length === 0 && spec.min === 0) {
      applyMissingValue(spec, state);
      return i - 1;
    }
    throw new CliParseError(
      spec.min === 1
        ? `a value is required for '${displayName(spec)}' but none was supplied`
        : `the argument '${displayName(spec)}' requires at least ${String(spec.min)} values but ${String(values.length)} were provided`,
    );
  }

  if (values.length === 0) {
    applyMissingValue(spec, state);
  } else {
    applyValues(spec, values, state);
  }
  return i - 1;
}

/**
 * Resolve an unknown long flag by unique prefix match (inferLongArgs).
 * Negated (`--no-x`) entries are excluded so `--n` cannot silently negate.
 */
function inferLongEntry(cmdSpec: CommandSpec, name: string): LongEntry | undefined {
  let match: LongEntry | undefined;
  for (const [candidate, entry] of cmdSpec.longs) {
    if (entry.negated || !candidate.startsWith(name)) {
      continue;
    }
    if (match !== undefined) {
      return undefined;
    }
    match = entry;
  }
  return match;
}

/** Build the name and flag lookup maps, once, on the first token that needs them. */
function buildSubcommandMaps(cmdSpec: CommandSpec): void {
  const names = new Map<string, string>();
  const flags = new Map<string, string>();

  const subs = subCommandsOf(cmdSpec.command);
  for (const name of Object.keys(subs)) {
    names.set(name, name);
    const subMeta = subs[name]!.meta;
    for (const alias of [...(subMeta.aliases ?? []), ...(subMeta.hiddenAliases ?? [])]) {
      names.set(alias, name);
    }
    for (const form of [
      ...(subMeta.shortFlag === undefined ? [] : [subMeta.shortFlag]),
      ...(subMeta.shortFlagAliases ?? []),
      ...(subMeta.visibleShortFlagAliases ?? []),
    ]) {
      flags.set(`-${form}`, name);
    }
    for (const form of [
      ...(subMeta.longFlag === undefined ? [] : [subMeta.longFlag]),
      ...(subMeta.longFlagAliases ?? []),
      ...(subMeta.visibleLongFlagAliases ?? []),
    ]) {
      flags.set(`--${form}`, name);
    }
  }

  cmdSpec.subcommands = names;
  cmdSpec.subcommandFlags = flags;
}

/** The subcommand named by a flag form like `-S`, or undefined. */
function subcommandForFlag(cmdSpec: CommandSpec, token: string): string | undefined {
  if (!cmdSpec.anySubcommands) {
    return undefined;
  }
  if (cmdSpec.subcommandFlags === undefined) {
    buildSubcommandMaps(cmdSpec);
  }
  return cmdSpec.subcommandFlags!.get(token);
}

/**
 * Resolve a bare token to a canonical subcommand name, by exact match on the
 * name or an alias, then by unique prefix when inferSubcommands is on.
 */
function resolveSubcommand(cmdSpec: CommandSpec, token: string): string | undefined {
  if (!cmdSpec.anySubcommands) {
    return undefined;
  }
  if (cmdSpec.subcommands === undefined) {
    buildSubcommandMaps(cmdSpec);
  }
  const map = cmdSpec.subcommands!;
  const exact = map.get(token);
  if (exact !== undefined) {
    return exact;
  }
  if (!cmdSpec.inferSubcommands) {
    return undefined;
  }
  let match: string | undefined;
  for (const [candidate, canonical] of map) {
    if (!candidate.startsWith(token)) {
      continue;
    }
    if (match !== undefined && match !== canonical) {
      return undefined;
    }
    match = canonical;
  }
  return match;
}

/** Handle a `--long`, `--long=value` or `--no-long` token. Returns the last index consumed. */
function handleLong(
  token: string,
  argv: readonly string[],
  i: number,
  cmdSpec: CommandSpec,
  state: ParseState,
): number {
  const eq = token.indexOf('=');
  const name = eq === -1 ? token.slice(2) : token.slice(2, eq);

  let entry = cmdSpec.longs.get(name);
  if (entry === undefined && cmdSpec.inferLong) {
    entry = inferLongEntry(cmdSpec, name);
  }
  if (entry === undefined) {
    // Only now is it worth building the subcommand maps: an unrecognised flag
    // may still be a flag-invoked subcommand like `pacman --sync`.
    const flagSub = subcommandForFlag(cmdSpec, token);
    if (flagSub !== undefined) {
      state.subCommand = flagSub;
      state.subCommandArgs = argv.slice(i + 1);
      return i;
    }
    state.unknown.push(`--${name}`);
    return i;
  }

  const { spec, negated } = entry;

  if (eq !== -1) {
    const inline = token.slice(eq + 1);
    if (spec.builtin !== undefined || spec.isCount) {
      applyFlagOnly(spec, negated, state);
      return i;
    }
    if (spec.isBool && negated) {
      // `--no-verbose=true` means "negate", so invert whatever was supplied.
      state.result[spec.key] = coerceValue(inline, spec.def, `--${name}`) === false;
      markSet(state, spec.key);
      return i;
    }
    applyValues(spec, [inline], state);
    return i;
  }

  if (spec.max === 0) {
    applyFlagOnly(spec, negated, state);
    return i;
  }
  if (spec.def.requireEquals) {
    if (spec.min === 0) {
      applyMissingValue(spec, state);
      return i;
    }
    throw new CliParseError(
      `equal sign is needed when assigning values to '${displayName(spec)}'`,
    );
  }
  return consumeValues(spec, argv, i + 1, cmdSpec, state);
}

/** Handle a `-abc`, `-p80`, `-p=80` or `-p 80` token. Returns the last index consumed. */
function handleShort(
  token: string,
  argv: readonly string[],
  i: number,
  cmdSpec: CommandSpec,
  state: ParseState,
): number {
  for (let c = 1; c < token.length; c++) {
    const flag = token[c]!;
    const spec = cmdSpec.shorts.get(flag);

    if (spec === undefined) {
      const flagSub = subcommandForFlag(cmdSpec, token);
      if (flagSub !== undefined) {
        state.subCommand = flagSub;
        state.subCommandArgs = argv.slice(i + 1);
        return i;
      }
      state.unknown.push(`-${flag}`);
      return i;
    }

    if (spec.builtin === 'help') {
      state.helpRequested = true;
      state.helpIsShort = true;
      continue;
    }
    if (spec.builtin === 'version') {
      state.versionRequested = true;
      state.versionIsShort = true;
      continue;
    }
    if (spec.max === 0) {
      applyFlagOnly(spec, false, state);
      continue;
    }

    // A value-taking short flag takes the rest of the cluster, or the next token.
    if (c + 1 < token.length) {
      // clap strips a single leading '=' so `-o=v` and `-ov` agree.
      const attached = token.charCodeAt(c + 1) === 61 ? token.slice(c + 2) : token.slice(c + 1);
      applyValues(spec, [attached], state);
      return i;
    }
    if (spec.def.requireEquals) {
      if (spec.min === 0) {
        applyMissingValue(spec, state);
        return i;
      }
      throw new CliParseError(
        `equal sign is needed when assigning values to '${displayName(spec)}'`,
      );
    }
    return consumeValues(spec, argv, i + 1, cmdSpec, state);
  }

  return i;
}

/**
 * Consume one token: a flag-invoked subcommand, a long or short flag, a
 * subcommand boundary, or a positional. Returns the last index consumed.
 */
function handleToken(
  token: string,
  rawArgs: readonly string[],
  i: number,
  cmdSpec: CommandSpec,
  state: ParseState,
): number {
  if (token.length > 1 && token.charCodeAt(0) === HYPHEN) {
    if (token.charCodeAt(1) === HYPHEN) {
      return handleLong(token, rawArgs, i, cmdSpec, state);
    }
    // A negative number is a value, not a flag cluster, when nothing claims the
    // leading digit as a short flag.
    const isNegativeValue =
      cmdSpec.allowsNegative && NEGATIVE_NUMBER.test(token) && !cmdSpec.shorts.has(token[1]!);
    if (!isNegativeValue) {
      return handleShort(token, rawArgs, i, cmdSpec, state);
    }
  }

  if (state.positionals.length === 0) {
    const canonical = resolveSubcommand(cmdSpec, token);
    if (canonical !== undefined) {
      state.subCommand = canonical;
      state.subCommandArgs = rawArgs.slice(i + 1);
      return i;
    }
    if (cmdSpec.allowExternal) {
      state.subCommand = token;
      state.subCommandIsExternal = true;
      state.subCommandArgs = rawArgs.slice(i + 1);
      return i;
    }
  }

  state.positionals.push(token);
  return i;
}

// ---- Positional Assignment ----

function assignPositionals(cmdSpec: CommandSpec, state: ParseState): void {
  let index = 0;
  // Definitions still waiting for a value, so a leading optional one can be
  // skipped when there are not enough values to go round.
  let remainingDefs = cmdSpec.indexedPositionals;

  for (const spec of cmdSpec.positionals) {
    if (!spec.def.last) {
      remainingDefs--;
      if (
        cmdSpec.allowMissingPositional &&
        !spec.def.required &&
        state.positionals.length - index <= remainingDefs
      ) {
        continue;
      }
    }

    if (spec.def.last) {
      // `last` positionals are only fed from tokens after `--`.
      if (state.rest.length > 0) {
        state.result[spec.key] = state.rest[0]!;
        state.fromRest.add(spec.key);
        markSet(state, spec.key);
      }
      continue;
    }

    if (spec.def.trailingVarArg) {
      if (index < state.positionals.length) {
        state.result[spec.key] = state.positionals.slice(index);
        markSet(state, spec.key);
        index = state.positionals.length;
      }
      return;
    }

    if (index >= state.positionals.length) {
      continue;
    }

    if (spec.max > 1) {
      const take = Math.min(spec.max, state.positionals.length - index);
      const values = state.positionals.slice(index, index + take);
      state.result[spec.key] = values.map((v) => String(coerceValue(v, spec.def, spec.key)));
      markSet(state, spec.key);
      index += take;
      continue;
    }

    state.result[spec.key] = coerceValue(state.positionals[index]!, spec.def, spec.key);
    markSet(state, spec.key);
    index++;
  }
}

// ---- Overrides ----

/**
 * Drop args displaced by a later `overridesWith`. Only command-line
 * occurrences take part, so an env or default value is never overridden.
 */
function applyOverrides(cmdSpec: CommandSpec, state: ParseState): void {
  const order = state.order;
  if (order === undefined) {
    return;
  }
  for (const spec of cmdSpec.all) {
    const targets = spec.def.overridesWith;
    if (targets === undefined || !state.explicitlySet.has(spec.key)) {
      continue;
    }
    const mine = order.get(spec.key);
    if (mine === undefined) {
      continue;
    }
    for (const target of targets) {
      if (target === spec.key) {
        continue;
      }
      const theirs = order.get(target);
      if (theirs === undefined || theirs > mine) {
        continue;
      }
      delete state.result[target];
      state.explicitlySet.delete(target);
      order.delete(target);
    }
  }
}

// ---- Defaults, Env, Delimiters ----

function splitByDelimiter(value: string | string[], delimiter: string): string[] {
  if (Array.isArray(value)) {
    const out: string[] = [];
    for (const v of value) {
      out.push(...v.split(delimiter));
    }
    return out;
  }
  return value.split(delimiter);
}

function applyFallbacks(cmdSpec: CommandSpec, state: ParseState): void {
  const { result, explicitlySet } = state;

  for (const spec of cmdSpec.all) {
    const { key, def } = spec;
    if (explicitlySet.has(key)) {
      if (
        def.valueDelimiter &&
        !(cmdSpec.dontDelimitTrailingValues && state.fromRest.has(key))
      ) {
        const value = result[key];
        if (value !== undefined && (typeof value === 'string' || Array.isArray(value))) {
          result[key] = splitByDelimiter(value, def.valueDelimiter);
        }
      }
      continue;
    }

    if (def.env) {
      const envValue = readEnv(def.env);
      if (envValue !== undefined && envValue !== '') {
        result[key] = def.valueDelimiter
          ? envValue.split(def.valueDelimiter)
          : coerceValue(envValue, def, `env:${def.env}`);
        explicitlySet.add(key);
        state.valueSources.set(key, 'env');
        continue;
      }
    }

    if (def.defaultValueIf) {
      const [otherKey, otherValue, conditionalDefault] = def.defaultValueIf;
      if (String(result[otherKey]) === String(otherValue)) {
        result[key] = conditionalDefault;
        state.valueSources.set(key, 'default');
        continue;
      }
    }

    if (def.defaultValueIfs) {
      let matched = false;
      for (const [otherKey, otherValue, conditionalDefault] of def.defaultValueIfs) {
        if (String(result[otherKey]) === String(otherValue)) {
          result[key] = conditionalDefault;
          state.valueSources.set(key, 'default');
          matched = true;
          break;
        }
      }
      if (matched) {
        continue;
      }
    }

    if (def.default !== undefined) {
      result[key] = Array.isArray(def.default)
        ? [...def.default]
        : (def.default as string | number | boolean);
      state.valueSources.set(key, 'default');
    }
  }
}

// ---- Main Parser ----

/**
 * Parse raw argument tokens against a command definition.
 *
 * Stops at the first bare token matching a subcommand name or alias; the
 * remaining tokens are returned as `subCommandArgs` for the caller to parse
 * against that subcommand.
 */
export function parseArgs(rawArgs: readonly string[], command: CommandDef): ParseResult {
  const cmdSpec = getSpec(command);

  const state: ParseState = {
    result: {},
    explicitlySet: new Set<string>(),
    valueSources: new Map<string, ValueSource>(),
    errors: [],
    fromRest: new Set<string>(),
    order: cmdSpec.hasOverrides ? new Map<string, number>() : undefined,
    seq: 0,
    unknown: [],
    positionals: [],
    rest: [],
    helpRequested: false,
    helpIsShort: false,
    versionRequested: false,
    versionIsShort: false,
    subCommandIsExternal: false,
    subCommandArgs: [],
  };

  let i = 0;
  for (; i < rawArgs.length; i++) {
    const token = rawArgs[i]!;

    if (token === '--') {
      for (let r = i + 1; r < rawArgs.length; r++) {
        state.rest.push(rawArgs[r]!);
      }
      break;
    }

    // ignoreErrors keeps going after a bad token, collecting the message, the
    // way clap's Command::ignore_errors does.
    if (cmdSpec.ignoreErrors) {
      try {
        i = handleToken(token, rawArgs, i, cmdSpec, state);
      } catch (error) {
        state.errors.push(error instanceof Error ? error.message : String(error));
      }
    } else {
      i = handleToken(token, rawArgs, i, cmdSpec, state);
    }

    if (state.subCommand !== undefined) {
      break;
    }
  }

  assignPositionals(cmdSpec, state);
  applyOverrides(cmdSpec, state);
  applyFallbacks(cmdSpec, state);

  // Expose both the declared key and its camelCase form.
  const args: Record<string, string | number | boolean | string[]> = {};
  for (const spec of cmdSpec.all) {
    const value = state.result[spec.key];
    if (value === undefined) {
      continue;
    }
    args[spec.camel] = value;
    if (spec.key !== spec.camel) {
      args[spec.key] = value;
    }
  }

  return {
    args,
    positionals: state.positionals,
    rest: state.rest,
    subCommand: state.subCommand,
    subCommandIsExternal: state.subCommandIsExternal,
    subCommandArgs: state.subCommandArgs,
    helpRequested: state.helpRequested,
    helpIsShort: state.helpIsShort,
    versionRequested: state.versionRequested,
    versionIsShort: state.versionIsShort,
    unknown: state.unknown,
    errors: state.errors,
    explicitlySet: state.explicitlySet,
    valueSources: state.valueSources,
  };
}

// ---- Global Args ----

/**
 * Collect global args from a command.
 * Returns a merged ArgsDef of all global args.
 */
export function collectGlobalArgs(command: CommandDef): ArgsDef {
  const globals: Record<string, ArgDef> = {};
  const args = command.args ?? {};
  for (const [key, def] of Object.entries(args)) {
    if (def.global) {
      globals[key] = def;
    }
  }
  return globals;
}

/**
 * Merge global args into a subcommand's args.
 * Global args from the parent are added to the child unless the child
 * already defines an arg with the same name.
 */
export function mergeGlobalArgs(parentGlobals: ArgsDef, childArgs: ArgsDef): ArgsDef {
  const merged: Record<string, ArgDef> = { ...childArgs };
  for (const [key, def] of Object.entries(parentGlobals)) {
    if (!(key in merged)) {
      merged[key] = def;
    }
  }
  return merged;
}
