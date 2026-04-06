/**
 * Argument parser - delegates core tokenizing to node:util parseArgs,
 * then layers on: env fallback, type coercion, count/append actions,
 * numArgs with defaultMissingValue, global args, kebab-to-camel mapping,
 * subcommand detection, and default values.
 *
 * node:util parseArgs handles:
 *   --flag, --flag=value, --flag value, -f, -fvalue, -abc (combined booleans),
 *   -- separator, positionals
 *
 * We handle on top:
 *   conflictsWith / requires (in validation.ts),
 *   env variable fallback, action: 'append' (via multiple:true), action: 'count',
 *   numArgs with defaultMissingValue, global args merge, valueParser enum validation
 *   (in validation.ts), number type coercion, kebab-to-camel mapping,
 *   required arg validation (in validation.ts), typo suggestions (in validation.ts).
 */

import { parseArgs as nodeParseArgs } from 'node:util';
import type { ArgDef, ArgsDef, ParseResult, CommandDef } from './types.js';

// ---- Helpers ----

/** Convert kebab-case to camelCase: --config-path -> configPath */
function kebabToCamel(s: string): string {
  return s.replaceAll(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** Get the raw argv slice (after the binary/script path). */
export function getRawArgs(argv?: readonly string[]): string[] {
  if (argv) {
    return [...argv];
  }
  // Bun.argv includes [bun, script, ...args], same as process.argv
  const source =
    globalThis.Bun === undefined ? process.argv : (globalThis.Bun as { argv: string[] }).argv;
  return source.slice(2);
}

// ---- Error ----

export class CliParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliParseError';
  }
}

// ---- Internal Types ----

interface FlagEntry {
  key: string;
  def: ArgDef;
  negated: boolean;
}

// ---- Flag Lookup Maps ----

/**
 * Build lookup maps from all possible flag forms to the canonical arg name.
 * Used for post-processing parseArgs output back to our ArgDef keys.
 */
function buildFlagMaps(argsDef: ArgsDef): {
  longMap: Map<string, FlagEntry>;
  shortMap: Map<string, { key: string; def: ArgDef }>;
} {
  const longMap = new Map<string, FlagEntry>();
  const shortMap = new Map<string, { key: string; def: ArgDef }>();

  for (const [key, def] of Object.entries(argsDef)) {
    const longName = def.long ?? key;
    longMap.set(longName, { key, def, negated: false });

    if (def.type === 'boolean') {
      longMap.set(`no-${longName}`, { key, def, negated: true });
    }

    if (def.alias) {
      for (const alias of def.alias) {
        if (alias.length === 1) {
          shortMap.set(alias, { key, def });
        } else {
          longMap.set(alias, { key, def, negated: false });
        }
      }
    }

    if (def.short && def.short.length === 1) {
      shortMap.set(def.short, { key, def });
    }
  }

  return { longMap, shortMap };
}

// ---- Build parseArgs options config ----

/**
 * Build the `options` config that node:util parseArgs expects from our ArgDef definitions.
 *
 * Mapping:
 * - boolean type -> parseArgs type: 'boolean'
 * - string/number/enum type -> parseArgs type: 'string'
 * - action: 'count' -> type: 'boolean', multiple: true (count array length)
 * - action: 'append' -> type: 'string', multiple: true
 * - boolean --no-<flag> -> separate boolean entry
 */
function buildParseArgsOptions(argsDef: ArgsDef): {
  options: Record<string, { type: 'string' | 'boolean'; short?: string; multiple?: boolean }>;
  /** Set of long option names that have optional values (numArgs.min === 0) */
  optionalValueFlags: Set<string>;
} {
  const options: Record<
    string,
    { type: 'string' | 'boolean'; short?: string; multiple?: boolean }
  > = {};
  const optionalValueFlags = new Set<string>();

  for (const [key, def] of Object.entries(argsDef)) {
    if (def.type === 'positional') {
      continue;
    }

    const longName = def.long ?? key;

    if (def.action === 'count') {
      options[longName] = { type: 'boolean', multiple: true };
    } else if (def.type === 'boolean') {
      options[longName] = { type: 'boolean' };
      // --no-<flag> negation
      options[`no-${longName}`] = { type: 'boolean' };
    } else if (def.action === 'append') {
      options[longName] = { type: 'string', multiple: true };
    } else {
      options[longName] = { type: 'string' };
    }

    // Track optional-value flags (numArgs.min === 0 on non-boolean args).
    // These need special pre-processing since parseArgs can't handle
    // --flag without a value when the option type is 'string'.
    if (def.numArgs && def.numArgs.min === 0 && def.type !== 'boolean') {
      optionalValueFlags.add(longName);
    }

    // Short flag
    if (def.short && def.short.length === 1) {
      options[longName].short = def.short;
    }

    // Aliases: register multi-char as separate long entries, single-char as short
    if (def.alias) {
      const opt = options[longName];
      for (const alias of def.alias) {
        if (alias.length > 1 || opt.short) {
          // Long alias or short slot already taken: register as separate option
          options[alias] = { type: opt.type, multiple: opt.multiple };
        } else {
          // Use this single-char alias as the short flag
          opt.short = alias;
        }
      }
    }
  }

  // Built-in flags
  options['help'] = { type: 'boolean', short: 'h' };
  options['version'] = { type: 'boolean', short: 'V' };

  return { options, optionalValueFlags };
}

// ---- Pre-scan for Optional-Value Args ----

/** Check if the next token looks like a flag (not a value). */
function isNextTokenAFlag(nextToken: string | undefined): boolean {
  return (
    nextToken === undefined ||
    (nextToken.startsWith('-') && nextToken !== '-' && nextToken !== '--')
  );
}

/** Try to match a long flag token as an optional-value flag without a value. */
function tryStripOptionalLong(
  token: string,
  nextToken: string | undefined,
  optionalValueFlags: Set<string>,
  longMap: Map<string, FlagEntry>,
): { key: string; defaultVal: string | number | boolean } | undefined {
  if (!token.startsWith('--') || token.length <= 2 || token.includes('=')) {
    return undefined;
  }
  const flagName = token.slice(2);
  if (!optionalValueFlags.has(flagName) || !isNextTokenAFlag(nextToken)) {
    return undefined;
  }
  const entry = longMap.get(flagName);
  if (!entry) {
    return undefined;
  }
  return { key: entry.key, defaultVal: entry.def.defaultMissingValue ?? true };
}

/** Try to match a short flag token as an optional-value flag without a value. */
function tryStripOptionalShort(
  token: string,
  nextToken: string | undefined,
  optionalValueFlags: Set<string>,
  shortMap: Map<string, { key: string; def: ArgDef }>,
): { key: string; defaultVal: string | number | boolean } | undefined {
  if (!token.startsWith('-') || token.length !== 2 || token[1] === '-') {
    return undefined;
  }
  const c = token[1]!;
  const entry = shortMap.get(c);
  if (!entry) {
    return undefined;
  }
  const entryLong = entry.def.long ?? entry.key;
  if (!optionalValueFlags.has(entryLong) || !isNextTokenAFlag(nextToken)) {
    return undefined;
  }
  return { key: entry.key, defaultVal: entry.def.defaultMissingValue ?? true };
}

/**
 * parseArgs cannot handle --flag that optionally takes a value (type: 'string'
 * without a value would consume the next positional or throw). We pre-scan the
 * raw args and, for optional-value flags that appear without a value, we strip
 * them out and record their default. The rest goes through parseArgs normally.
 */
function extractOptionalValueFlags(
  rawArgs: readonly string[],
  optionalValueFlags: Set<string>,
  longMap: Map<string, FlagEntry>,
  shortMap: Map<string, { key: string; def: ArgDef }>,
): { processedArgs: string[]; optionalDefaults: Map<string, string | number | boolean> } {
  if (optionalValueFlags.size === 0) {
    return { processedArgs: [...rawArgs], optionalDefaults: new Map() };
  }

  const optionalDefaults = new Map<string, string | number | boolean>();
  const processedArgs: string[] = [];
  let stopParsing = false;

  for (let i = 0; i < rawArgs.length; i++) {
    const token = rawArgs[i]!;

    if (stopParsing || token === '--') {
      if (token === '--') {
        stopParsing = true;
      }
      processedArgs.push(token);
      continue;
    }

    // Long flag without =value
    const stripped = tryStripOptionalLong(token, rawArgs[i + 1], optionalValueFlags, longMap);
    if (stripped) {
      optionalDefaults.set(stripped.key, stripped.defaultVal);
      continue; // strip this token
    }

    // Short flag (single char) for optional-value arg
    const strippedShort = tryStripOptionalShort(
      token,
      rawArgs[i + 1],
      optionalValueFlags,
      shortMap,
    );
    if (strippedShort) {
      optionalDefaults.set(strippedShort.key, strippedShort.defaultVal);
      continue; // strip
    }

    processedArgs.push(token);
  }

  return { processedArgs, optionalDefaults };
}

// ---- Coerce Value ----

function coerceValue(value: string, def: ArgDef, argName: string): string | number | boolean {
  switch (def.type) {
    case 'boolean': {
      const lower = value.toLowerCase();
      return lower === 'true' || lower === '1' || lower === 'yes';
    }
    case 'number': {
      const num = value.includes('.') ? Number.parseFloat(value) : Number.parseInt(value, 10);
      if (Number.isNaN(num) || !Number.isFinite(num)) {
        throw new CliParseError(`invalid value '${value}' for '${argName}': expected a finite number`);
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

// ---- Subcommand Detection ----

/**
 * Scan positionals for a subcommand name or alias.
 * Returns the canonical name and the index in the positionals array.
 */
function detectSubcommand(
  positionals: readonly string[],
  command: CommandDef,
): { name: string; index: number } | undefined {
  if (!command.subCommands) {
    return undefined;
  }

  for (let i = 0; i < positionals.length; i++) {
    const token = positionals[i]!;
    if (command.subCommands[token]) {
      return { name: token, index: i };
    }
    for (const [name, def] of Object.entries(command.subCommands)) {
      if (def.meta.aliases?.includes(token)) {
        return { name, index: i };
      }
    }
  }
  return undefined;
}

// ---- Separate Rest Args ----

/**
 * parseArgs lumps everything (before and after --) into its `positionals` array.
 * We need to split them into positionals (before --) and rest (after --).
 */
function splitPositionalsAndRest(
  rawArgs: readonly string[],
  parseArgsPositionals: readonly string[],
): { positionals: string[]; rest: string[] } {
  // Find the -- separator index in rawArgs
  let dashDashIdx = -1;
  for (let i = 0; i < rawArgs.length; i++) {
    if (rawArgs[i] === '--') {
      dashDashIdx = i;
      break;
    }
  }

  if (dashDashIdx === -1) {
    return { positionals: [...parseArgsPositionals], rest: [] };
  }

  // Count tokens after -- in rawArgs to know how many trailing positionals are rest
  const restCount = rawArgs.length - dashDashIdx - 1;
  const totalPositionals = parseArgsPositionals.length;
  const beforeCount = totalPositionals - restCount;

  return {
    positionals: parseArgsPositionals.slice(0, Math.max(0, beforeCount)),
    rest: parseArgsPositionals.slice(Math.max(0, beforeCount)),
  };
}

// ---- Main Parser ----

/**
 * Parse raw argument tokens against a command definition.
 *
 * Uses node:util parseArgs for core tokenizing (--flag, --flag=value, -f, -fvalue,
 * -abc combined shorts, -- separator, positionals), then layers on:
 * - numArgs with defaultMissingValue (optional-value flags)
 * - action: 'count' (from boolean[] length)
 * - number type coercion
 * - subcommand detection
 * - env variable fallback
 * - default values
 * - kebab-case to camelCase mapping
 */
export function parseArgs(rawArgs: readonly string[], command: CommandDef): ParseResult {
  const argsDef = command.args ?? {};

  // Build parseArgs config from our ArgDef definitions
  const { options, optionalValueFlags } = buildParseArgsOptions(argsDef);

  // Build flag maps once and reuse throughout parsing
  const { longMap, shortMap } = buildFlagMaps(argsDef);

  // Pre-process: extract optional-value flags that parseArgs can't handle
  const { processedArgs, optionalDefaults } = extractOptionalValueFlags(
    rawArgs,
    optionalValueFlags,
    longMap,
    shortMap,
  );

  // Run node:util parseArgs (strict: false so unknown flags don't throw)
  let parsed: { values: Record<string, unknown>; positionals: string[] };
  try {
    parsed = nodeParseArgs({
      args: processedArgs,
      options,
      allowPositionals: true,
      strict: false,
    }) as { values: Record<string, unknown>; positionals: string[] };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new CliParseError(msg);
  }

  const { values, positionals: rawPositionals } = parsed;

  const result: Record<string, string | number | boolean | string[]> = {};
  const unknown: string[] = [];
  const explicitlySet = new Set<string>();

  // Extract help/version
  const helpRequested = values['help'] === true;
  const versionRequested = values['version'] === true;

  // Process each parsed value back through our ArgDef system
  for (const [parsedKey, rawValue] of Object.entries(values)) {
    if (parsedKey === 'help' || parsedKey === 'version') {
      continue;
    }

    // Handle --no-<flag> negation
    if (parsedKey.startsWith('no-') && rawValue === true) {
      const positiveName = parsedKey.slice(3);
      const entry = longMap.get(positiveName);
      if (entry && entry.def.type === 'boolean') {
        result[entry.key] = false;
        explicitlySet.add(entry.key);
        continue;
      }
    }

    // Look up canonical key via long map
    const entry = longMap.get(parsedKey);
    if (entry) {
      applyValue(entry.key, entry.def, rawValue, result, explicitlySet);
      continue;
    }

    // Check short map for single-char aliases registered as separate options
    const shortEntry = shortMap.get(parsedKey);
    if (shortEntry) {
      applyValue(shortEntry.key, shortEntry.def, rawValue, result, explicitlySet);
      continue;
    }

    // Check alias entries (multi-char aliases that may not be in longMap)
    let foundAlias = false;
    for (const [key, def] of Object.entries(argsDef)) {
      if (def.alias?.includes(parsedKey)) {
        applyValue(key, def, rawValue, result, explicitlySet);
        foundAlias = true;
        break;
      }
    }
    if (!foundAlias) {
      unknown.push(`--${parsedKey}`);
    }
  }

  // Apply optional-value defaults from pre-scan
  for (const [key, defaultVal] of optionalDefaults) {
    if (!explicitlySet.has(key)) {
      result[key] = defaultVal;
      explicitlySet.add(key);
    }
  }

  // Split positionals from rest (tokens after --)
  const { positionals: allPositionals, rest } = splitPositionalsAndRest(rawArgs, rawPositionals);

  // Detect subcommand in positionals
  const subCmdResult = detectSubcommand(allPositionals, command);
  const subCommand = subCmdResult?.name;

  // Remove subcommand token from positionals
  const positionals: string[] = [];
  for (let i = 0; i < allPositionals.length; i++) {
    if (subCmdResult && i === subCmdResult.index) {
      continue;
    }
    positionals.push(allPositionals[i]!);
  }

  // Assign positionals to positional arg defs
  const positionalDefs: { key: string; def: ArgDef }[] = [];
  for (const [key, def] of Object.entries(argsDef)) {
    if (def.type === 'positional') {
      positionalDefs.push({ key, def });
    }
  }
  for (let p = 0; p < positionalDefs.length && p < positionals.length; p++) {
    const { key, def } = positionalDefs[p]!;
    const value = positionals[p]!;
    result[key] = coerceValue(value, def, key);
    explicitlySet.add(key);
  }

  // Apply env var fallbacks for args not explicitly set
  for (const [key, def] of Object.entries(argsDef)) {
    if (explicitlySet.has(key)) {
      continue;
    }
    if (!def.env) {
      continue;
    }

    const envValue =
      globalThis.Bun === undefined
        ? process.env[def.env]
        : (globalThis.Bun as { env: Record<string, string | undefined> }).env[def.env];

    if (envValue !== undefined && envValue !== '') {
      result[key] = coerceValue(envValue, def, `env:${def.env}`);
      explicitlySet.add(key);
    }
  }

  // Apply defaults for args not explicitly set and not from env
  for (const [key, def] of Object.entries(argsDef)) {
    if (explicitlySet.has(key)) {
      continue;
    }
    if (def.default !== undefined) {
      if (Array.isArray(def.default)) {
        result[key] = [...def.default];
      } else if (
        typeof def.default === 'string' ||
        typeof def.default === 'number' ||
        typeof def.default === 'boolean'
      ) {
        result[key] = def.default;
      }
    }
  }

  // Convert keys to camelCase for the result
  const camelResult: Record<string, string | number | boolean | string[]> = {};
  for (const [key, value] of Object.entries(result)) {
    camelResult[kebabToCamel(key)] = value;
    if (key !== kebabToCamel(key)) {
      camelResult[key] = value;
    }
  }

  return {
    args: camelResult,
    positionals,
    rest,
    subCommand,
    helpRequested,
    versionRequested,
    unknown,
  };
}

// ---- Value Application Helper ----

/**
 * Apply a raw value from parseArgs into the result, handling count, append,
 * number coercion, and boolean conversion.
 */
function applyValue(
  key: string,
  def: ArgDef,
  rawValue: unknown,
  result: Record<string, string | number | boolean | string[]>,
  explicitlySet: Set<string>,
): void {
  if (def.action === 'count') {
    // parseArgs returns boolean[] for multiple:true boolean options
    if (Array.isArray(rawValue)) {
      result[key] = rawValue.length;
    } else {
      result[key] = rawValue === true ? 1 : 0;
    }
    explicitlySet.add(key);
    return;
  }

  if (def.type === 'boolean') {
    result[key] = rawValue === true;
    explicitlySet.add(key);
    return;
  }

  if (def.action === 'append') {
    // parseArgs returns string[] for multiple:true string options
    if (Array.isArray(rawValue)) {
      const values = (rawValue as string[]).map(String);
      result[key] = values;
    } else if (typeof rawValue === 'string') {
      result[key] = [rawValue];
    }
    explicitlySet.add(key);
    return;
  }

  // Single string/number/enum value
  if (typeof rawValue === 'string') {
    result[key] = coerceValue(rawValue, def, `--${def.long ?? key}`);
    explicitlySet.add(key);
    return;
  }

  // Boolean value for a string-typed arg (edge case from parseArgs)
  if (typeof rawValue === 'boolean' && rawValue) {
    result[key] = def.defaultMissingValue ?? true;
    explicitlySet.add(key);
  }
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
