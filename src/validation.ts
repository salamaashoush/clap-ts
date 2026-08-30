/**
 * Argument validation - enforces constraints after parsing.
 * Matches clap's validation: required, exclusive, conflicts, requires,
 * valueParser, numArgs, requiredUnlessPresent, requiredIfEq, groups.
 * Includes typo suggestion via Levenshtein distance.
 */

import type { ArgDef, ArgsDef, CommandDef, ParseResult } from './types.js';
import { CliParseError } from './parser.js';

// ---- Compiled Validation Spec ----

/**
 * Most commands use only a few of the constraint kinds, so the subsets are
 * computed once per command rather than walking every arg nine times per run.
 */
interface ValidationSpec {
  readonly entries: readonly (readonly [string, ArgDef])[];
  readonly exclusive: readonly (readonly [string, ArgDef])[];
  readonly required: readonly (readonly [string, ArgDef])[];
  readonly requiredIfEq: readonly (readonly [string, ArgDef])[];
  readonly valueParser: readonly (readonly [string, ArgDef])[];
  readonly conflicts: readonly (readonly [string, ArgDef])[];
  readonly requires: readonly (readonly [string, ArgDef])[];
  readonly numArgs: readonly (readonly [string, ArgDef])[];
}

const specCache = new WeakMap<CommandDef, ValidationSpec>();

function buildValidationSpec(command: CommandDef): ValidationSpec {
  const entries: (readonly [string, ArgDef])[] = [];
  const exclusive: (readonly [string, ArgDef])[] = [];
  const required: (readonly [string, ArgDef])[] = [];
  const requiredIfEq: (readonly [string, ArgDef])[] = [];
  const valueParser: (readonly [string, ArgDef])[] = [];
  const conflicts: (readonly [string, ArgDef])[] = [];
  const requires: (readonly [string, ArgDef])[] = [];
  const numArgs: (readonly [string, ArgDef])[] = [];

  const argsDef = command.args ?? {};
  for (const key of Object.keys(argsDef)) {
    const def = argsDef[key]!;
    const entry = [key, def] as const;
    entries.push(entry);

    if (def.exclusive) {
      exclusive.push(entry);
    }
    if (def.required && def.default === undefined) {
      required.push(entry);
    }
    if (def.requiredIfEq) {
      requiredIfEq.push(entry);
    }
    if (def.valueParser) {
      valueParser.push(entry);
    }
    if (def.conflictsWith && def.conflictsWith.length > 0) {
      conflicts.push(entry);
    }
    if (def.requires && def.requires.length > 0) {
      requires.push(entry);
    }
    // The parser enforces numArgs per occurrence while consuming tokens, the
    // way clap does. Only positionals and delimiter-split values reach here
    // without having been counted.
    if (def.numArgs && (def.type === 'positional' || def.valueDelimiter !== undefined)) {
      numArgs.push(entry);
    }
  }

  return { entries, exclusive, required, requiredIfEq, valueParser, conflicts, requires, numArgs };
}

function getValidationSpec(command: CommandDef): ValidationSpec {
  let spec = specCache.get(command);
  if (spec === undefined) {
    spec = buildValidationSpec(command);
    specCache.set(command, spec);
  }
  return spec;
}

// ---- Levenshtein Distance ----

/**
 * Calculate Levenshtein distance between two strings.
 * Used for "did you mean?" typo suggestions (like clap).
 */
function levenshteinDistance(a: string, b: string): number {
  const aLen = a.length;
  const bLen = b.length;

  if (aLen === 0) {
    return bLen;
  }
  if (bLen === 0) {
    return aLen;
  }

  // Use single-row DP for memory efficiency
  const row: number[] = Array.from({ length: bLen + 1 });
  for (let j = 0; j <= bLen; j++) {
    row[j] = j;
  }

  for (let i = 1; i <= aLen; i++) {
    let prev = i - 1;
    row[0] = i;
    for (let j = 1; j <= bLen; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const current = row[j]!;
      const val = Math.min(
        current + 1, // deletion
        row[j - 1]! + 1, // insertion
        prev + cost, // substitution
      );
      prev = current;
      row[j] = val;
    }
  }

  return row[bLen]!;
}

/**
 * Find the closest match for a string from candidates.
 * Returns undefined if no candidate is within maxDistance.
 */
function findClosestMatch(
  target: string,
  candidates: readonly string[],
  maxDistance = 3,
): string | undefined {
  let bestMatch: string | undefined;
  let bestDist = maxDistance + 1;

  for (const candidate of candidates) {
    const dist = levenshteinDistance(target, candidate);
    if (dist < bestDist) {
      bestDist = dist;
      bestMatch = candidate;
    }
  }

  return bestMatch;
}

// ---- Build Known Flags ----

/**
 * Collect all known long flag names for a command (for typo suggestions).
 */
function collectKnownFlags(argsDef: ArgsDef): string[] {
  const flags: string[] = [];
  for (const [key, def] of Object.entries(argsDef)) {
    const longName = def.long ?? key;
    flags.push(longName);
    if (def.type === 'boolean') {
      flags.push(`no-${longName}`);
    }
    if (def.alias) {
      for (const alias of def.alias) {
        if (alias.length > 1) {
          flags.push(alias);
        }
      }
    }
    if (def.visibleAlias) {
      for (const alias of def.visibleAlias) {
        if (alias.length > 1) {
          flags.push(alias);
        }
      }
    }
  }
  // Always include built-in flags
  flags.push('help', 'version');
  return flags;
}

/**
 * Collect all known subcommand names (including aliases) for typo suggestions.
 */
function collectKnownSubcommands(command: CommandDef): string[] {
  const names: string[] = [];
  if (!command.subCommands) {
    return names;
  }
  for (const [name, def] of Object.entries(command.subCommands)) {
    names.push(name);
    if (def.meta.aliases) {
      for (const alias of def.meta.aliases) {
        names.push(alias);
      }
    }
  }
  return names;
}

/** Check if an arg value is "set" (not undefined, and not false for booleans). */
function isArgSet(value: unknown, typeName: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }
  if (typeName === 'boolean' && value === false) {
    return false;
  }
  return true;
}

// ---- Validation ----

/** Validate unknown flags and suggest corrections. */
function validateUnknownFlags(
  unknown: readonly string[],
  argsDef: ArgsDef,
  command: CommandDef,
): void {
  if (unknown.length === 0) {
    return;
  }

  const knownFlags = collectKnownFlags(argsDef);
  const knownSubcommands = collectKnownSubcommands(command);
  const allKnown = [...knownFlags, ...knownSubcommands];

  for (const flag of unknown) {
    const stripped = flag.replace(/^-+/, '');
    const suggestion = findClosestMatch(stripped, allKnown);
    let msg = `unexpected argument '${flag}' found`;
    if (suggestion) {
      const prefix = suggestion.length === 1 ? '-' : '--';
      msg += `\n\n  tip: a similar argument exists: '${prefix}${suggestion}'`;
    }
    throw new CliParseError(msg);
  }
}

/** Validate exclusive args -- cannot be used with any other arg. */
function validateExclusive(
  spec: ValidationSpec,
  argsDef: ArgsDef,
  explicitlySet: ReadonlySet<string>,
): void {
  for (const [key, def] of spec.exclusive) {
    if (!explicitlySet.has(key)) {
      continue;
    }

    // Check if any other arg was explicitly set
    for (const otherKey of explicitlySet) {
      if (otherKey === key) {
        continue;
      }
      const otherDef = argsDef[otherKey];
      if (!otherDef) {
        continue;
      }
      const flagName = formatFlagForError(key, def);
      const otherFlagName = formatFlagForError(otherKey, otherDef);
      throw new CliParseError(
        `the argument ${flagName} cannot be used with ${otherFlagName}`,
      );
    }
  }
}

/**
 * Validate that all required args are present.
 * Respects requiredUnlessPresent and subcommandNegatesReqs.
 */
function validateRequired(
  spec: ValidationSpec,
  argsDef: ArgsDef,
  args: Record<string, string | number | boolean | string[]>,
  skipRequired: boolean,
): void {
  if (skipRequired) {
    return;
  }

  const missing: string[] = [];

  for (const [key, def] of spec.required) {
    // requiredUnlessPresent: skip if the named arg(s) are present
    if (def.requiredUnlessPresent) {
      const unlessArgs = Array.isArray(def.requiredUnlessPresent)
        ? def.requiredUnlessPresent
        : [def.requiredUnlessPresent];
      if (unlessArgs.some((name) => isArgSet(args[name], argsDef[name]?.type))) {
        continue;
      }
    }

    const value = args[key];
    if (value === undefined) {
      const displayName =
        def.type === 'positional' ? `<${def.valueName ?? key}>` : `--${def.long ?? key}`;
      missing.push(displayName);
    }
  }

  if (missing.length > 0) {
    const lines = missing.map((f) => `  ${f}`).join('\n');
    throw new CliParseError(`the following required arguments were not provided:\n${lines}`);
  }
}

/** Validate requiredIfEq -- arg required when another arg equals a specific value. */
function validateRequiredIfEq(
  spec: ValidationSpec,
  args: Record<string, string | number | boolean | string[]>,
): void {
  for (const [key, def] of spec.requiredIfEq) {
    const [otherKey, otherValue] = def.requiredIfEq!;
    const otherArgValue = args[otherKey];

    // Check if the other arg's value matches the condition
    if (otherArgValue !== undefined && String(otherArgValue) === otherValue) {
      if (!isArgSet(args[key], def.type)) {
        const displayName =
          def.type === 'positional' ? `<${def.valueName ?? key}>` : `--${def.long ?? key}`;
        throw new CliParseError(
          `the following required arguments were not provided:\n  ${displayName}`,
        );
      }
    }
  }
}

/** Validate valueParser (enum-like restricted values). */
function validateValueParser(
  spec: ValidationSpec,
  args: Record<string, string | number | boolean | string[]>,
): void {
  for (const [key, def] of spec.valueParser) {
    const value = args[key];
    if (value === undefined) {
      continue;
    }

    const longName = def.long ?? key;

    // Function-based value parser: already applied in parser, skip enum check
    if (typeof def.valueParser === 'function') {
      continue;
    }

    // Enum-style value parser: validate against allowed values
    const possible = def.valueParser as readonly string[];
    if (possible.length === 0) {
      continue;
    }

    const valueName = def.valueName ?? longName.toUpperCase();
    const values = Array.isArray(value) ? value : [String(value)];
    for (const v of values) {
      if (!possible.includes(v)) {
        const possibleStr = possible.join(', ');
        throw new CliParseError(
          `invalid value '${v}' for '--${longName} <${valueName}>'\n  [possible values: ${possibleStr}]`,
        );
      }
    }
  }
}

/** Format a flag name for error display, including value name for non-booleans. */
function formatFlagForError(key: string, def: ArgDef): string {
  const longName = def.long ?? key;
  if (def.type !== 'boolean') {
    const valueName = def.valueName ?? longName.toUpperCase();
    return `'--${longName} <${valueName}>'`;
  }
  return `'--${longName}'`;
}

/** Validate conflictsWith constraints. */
function validateConflicts(
  spec: ValidationSpec,
  argsDef: ArgsDef,
  args: Record<string, string | number | boolean | string[]>,
): void {
  for (const [key, def] of spec.conflicts) {
    if (!isArgSet(args[key], def.type)) {
      continue;
    }

    for (const conflictKey of def.conflictsWith!) {
      const conflictDef = argsDef[conflictKey];
      if (!isArgSet(args[conflictKey], conflictDef?.type)) {
        continue;
      }

      const flagA = formatFlagForError(key, def);
      const flagB = conflictDef
        ? formatFlagForError(conflictKey, conflictDef)
        : `'--${conflictKey}'`;
      throw new CliParseError(`the argument ${flagA} cannot be used with ${flagB}`);
    }
  }
}

/** Validate requires constraints. */
function validateRequires(
  spec: ValidationSpec,
  argsDef: ArgsDef,
  args: Record<string, string | number | boolean | string[]>,
): void {
  for (const [key, def] of spec.requires) {
    if (!isArgSet(args[key], def.type)) {
      continue;
    }

    const missing: string[] = [];
    for (const requiredKey of def.requires!) {
      const requiredDef = argsDef[requiredKey];
      if (!isArgSet(args[requiredKey], requiredDef?.type)) {
        missing.push(`--${requiredDef?.long ?? requiredKey}`);
      }
    }
    if (missing.length > 0) {
      const lines = missing.map((f) => `  ${f}`).join('\n');
      throw new CliParseError(`the following required arguments were not provided:\n${lines}`);
    }
  }
}

/** Validate numArgs constraints. */
function validateNumArgs(
  spec: ValidationSpec,
  args: Record<string, string | number | boolean | string[]>,
): void {
  for (const [key, def] of spec.numArgs) {
    const value = args[key];
    if (value === undefined) {
      continue;
    }

    const count = Array.isArray(value) ? value.length : 1;
    if (count < def.numArgs!.min) {
      throw new CliParseError(
        `the argument '--${def.long ?? key}' requires at least ${String(def.numArgs!.min)} values but ${String(count)} were provided`,
      );
    }
    if (count > def.numArgs!.max) {
      throw new CliParseError(
        `the argument '--${def.long ?? key}' accepts at most ${String(def.numArgs!.max)} values but ${String(count)} were provided`,
      );
    }
  }
}

/** Validate argument groups. */
function validateGroups(
  command: CommandDef,
  argsDef: ArgsDef,
  args: Record<string, string | number | boolean | string[]>,
): void {
  if (!command.groups) {
    return;
  }

  for (const group of command.groups) {
    const setArgs = group.args.filter((argName) => isArgSet(args[argName], argsDef[argName]?.type));

    if (group.required && setArgs.length === 0) {
      const argList = group.args.map((a) => `'--${argsDef[a]?.long ?? a}'`).join(', ');
      throw new CliParseError(`one of the following arguments must be provided: ${argList}`);
    }

    if (!group.multiple && setArgs.length > 1) {
      const argList = setArgs.map((a) => `'--${argsDef[a]?.long ?? a}'`).join(', ');
      throw new CliParseError(`the following arguments cannot be used together: ${argList}`);
    }
  }
}

/**
 * Validate parsed results against the command definition.
 * Throws CliParseError with clap-style error messages.
 */
export function validate(parseResult: ParseResult, command: CommandDef): void {
  const argsDef = command.args ?? {};
  const { args, unknown, explicitlySet } = parseResult;

  // Determine if required validation should be skipped (subcommandNegatesReqs)
  const skipRequired =
    command.meta.subcommandNegatesReqs === true && parseResult.subCommand !== undefined;

  const spec = getValidationSpec(command);

  if (unknown.length > 0) {
    validateUnknownFlags(unknown, argsDef, command);
  }
  validateExclusive(spec, argsDef, explicitlySet);
  validateRequired(spec, argsDef, args, skipRequired);
  if (!skipRequired) {
    validateRequiredIfEq(spec, args);
  }
  validateValueParser(spec, args);
  validateConflicts(spec, argsDef, args);
  validateRequires(spec, argsDef, args);
  validateNumArgs(spec, args);
  validateGroups(command, argsDef, args);
}
