/**
 * A machine-readable description of a command tree.
 *
 * ```ts
 * import { toSpec } from 'clap-ts/spec';
 *
 * writeFileSync('cli.json', JSON.stringify(toSpec(main), null, 2));
 * ```
 *
 * Useful for generating a docs site, driving editor integration, or turning a
 * CLI into tool definitions for something that calls it. The shape is plain
 * JSON: no functions survive, so a `valueParser` function is reported only as
 * the fact that one exists.
 */

import type { ArgDef, CommandDef, PossibleValue, ValueHint } from './types.js';
import { possibleValues, subCommandsOf } from './parser.js';

/** One argument, flattened to JSON. */
export interface ArgSpecJson {
  readonly name: string;
  readonly type: ArgDef['type'];
  readonly description?: string;
  readonly longDescription?: string;
  readonly short?: string;
  readonly long?: string;
  readonly aliases?: readonly string[];
  readonly visibleAliases?: readonly string[];
  readonly valueName?: string;
  readonly valueNames?: readonly string[];
  readonly valueHint?: ValueHint;
  readonly required: boolean;
  readonly hidden: boolean;
  readonly deprecated?: string | true;
  readonly replacedBy?: string;
  readonly global?: boolean;
  readonly env?: string;
  readonly default?: string | number | boolean | readonly string[];
  readonly action?: ArgDef['action'];
  readonly numArgs?: { readonly min: number; readonly max: number };
  readonly possibleValues?: readonly PossibleValue[];
  /** True when a function parser is attached; the function itself cannot serialise. */
  readonly hasCustomParser?: boolean;
  readonly conflictsWith?: readonly string[];
  readonly requires?: readonly string[];
  readonly groups?: readonly string[];
  readonly helpHeading?: string;
}

/** One command, flattened to JSON, with its subcommands nested. */
export interface CommandSpecJson {
  readonly name: string;
  readonly path: readonly string[];
  readonly description?: string;
  readonly about?: string;
  readonly longAbout?: string;
  readonly version?: string;
  readonly author?: string;
  readonly aliases?: readonly string[];
  readonly hidden: boolean;
  readonly deprecated?: string | true;
  readonly replacedBy?: string;
  readonly usage: string;
  readonly args: readonly ArgSpecJson[];
  readonly subcommands: readonly CommandSpecJson[];
}

export interface SpecOptions {
  /** Root name; defaults to the command's binName or name. */
  readonly name?: string;
  /** Include args and commands marked hidden (default false). */
  readonly includeHidden?: boolean;
}

function defined<T extends Record<string, unknown>>(obj: T): T {
  for (const key of Object.keys(obj)) {
    if (obj[key] === undefined) {
      delete obj[key];
    }
  }
  return obj;
}

function normalizeDeprecated(value: boolean | string | undefined): string | true | undefined {
  if (value === undefined || value === false) {
    return undefined;
  }
  return value === true ? true : value;
}

function argToJson(key: string, def: ArgDef): ArgSpecJson {
  const values = possibleValues(def);
  const groups = def.group === undefined ? def.groups : [def.group, ...(def.groups ?? [])];

  return defined({
    name: key,
    type: def.type,
    description: def.description,
    longDescription: def.longDescription,
    short: def.short,
    long: def.long ?? (def.type === 'positional' ? undefined : key),
    aliases: def.alias,
    visibleAliases: def.visibleAlias,
    valueName: def.valueName,
    valueNames: def.valueNames,
    valueHint: def.valueHint,
    required: def.required === true,
    hidden: def.hidden === true,
    deprecated: normalizeDeprecated(def.deprecated),
    replacedBy: def.replacedBy,
    global: def.global,
    env: def.env,
    default: def.default,
    action: def.action,
    numArgs: def.numArgs,
    possibleValues: values.length > 0 ? values : undefined,
    hasCustomParser: typeof def.valueParser === 'function' ? true : undefined,
    conflictsWith: def.conflictsWith,
    requires: def.requires,
    groups,
    helpHeading: def.helpHeading,
  }) as ArgSpecJson;
}

function usageOf(path: readonly string[], command: CommandDef, args: readonly ArgSpecJson[]): string {
  const parts = [...path];
  if (args.some((a) => a.type !== 'positional')) {
    parts.push('[OPTIONS]');
  }
  for (const arg of args) {
    if (arg.type !== 'positional') {
      continue;
    }
    const name = `<${arg.valueName ?? arg.name.toUpperCase()}>`;
    parts.push(arg.required ? name : `[${name}]`);
  }
  if (Object.keys(subCommandsOf(command)).length > 0) {
    parts.push(`[${command.meta.subcommandValueName ?? 'COMMAND'}]`);
  }
  return parts.join(' ');
}

function commandToJson(
  command: CommandDef,
  path: readonly string[],
  includeHidden: boolean,
): CommandSpecJson {
  const argsDef: Record<string, ArgDef> = command.args ?? {};
  const args = Object.entries(argsDef)
    .filter(([, def]) => includeHidden || def.hidden !== true)
    .map(([key, def]) => argToJson(key, def));

  const subcommands = Object.entries(subCommandsOf(command))
    .filter(([, sub]) => includeHidden || sub.meta.hidden !== true)
    .map(([name, sub]) => commandToJson(sub, [...path, name], includeHidden));

  const { meta } = command;
  return defined({
    name: meta.name,
    path,
    description: meta.description,
    about: meta.about,
    longAbout: meta.longAbout,
    version: meta.version,
    author: meta.author,
    aliases: meta.aliases,
    hidden: meta.hidden === true,
    deprecated: normalizeDeprecated(meta.deprecated),
    replacedBy: meta.replacedBy,
    usage: usageOf(path, command, args),
    args,
    subcommands,
  }) as CommandSpecJson;
}

/**
 * Describe a command tree as plain JSON-safe data.
 *
 * Forces any `lazySubCommands` thunk, since the whole tree has to be walked.
 */
export function toSpec(command: CommandDef, opts?: SpecOptions): CommandSpecJson {
  const name = opts?.name ?? command.meta.binName ?? command.meta.name;
  return commandToJson(command, [name], opts?.includeHidden === true);
}

/** Describe a command tree as a JSON string. */
export function toSpecJson(command: CommandDef, opts?: SpecOptions & { space?: number }): string {
  return JSON.stringify(toSpec(command, opts), null, opts?.space ?? 2);
}

/** Walk every command in a spec, root first. */
export function* walkSpec(spec: CommandSpecJson): Generator<CommandSpecJson> {
  yield spec;
  for (const sub of spec.subcommands) {
    yield* walkSpec(sub);
  }
}
