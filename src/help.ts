/**
 * Help renderer - generates clap-style help output.
 * Respects NO_COLOR, TERM=dumb, CI for color output.
 * Wraps text to terminal width.
 * Supports helpHeading grouping, helpTemplate, beforeHelp,
 * hideShortHelp/hideLongHelp, visibleAlias, hidePossibleValues,
 * and custom styles.
 */

import { styleText } from 'node:util';
import type { ArgDef, CommandDef, CommandMeta, StylesDef } from './types.js';
import { possibleValues } from './parser.js';

// ---- Color Support ----

/** Get terminal width, honouring termWidth and maxTermWidth, defaulting to 80. */
function getTerminalWidth(meta: CommandMeta): number {
  if (meta.termWidth !== undefined && meta.termWidth > 0) {
    return meta.termWidth;
  }
  let width = 80;
  if (typeof process.stdout?.columns === 'number' && process.stdout.columns > 0) {
    width = process.stdout.columns;
  }
  if (meta.maxTermWidth !== undefined && meta.maxTermWidth > 0) {
    width = Math.min(width, meta.maxTermWidth);
  }
  return width;
}

/** Create style functions, merging optional user overrides. */
const NO_STYLE: StylesDef = {
  bold: (s) => s,
  yellow: (s) => s,
  green: (s) => s,
  cyan: (s) => s,
  heading: (s) => s,
  flag: (s) => s,
  value: (s) => s,
  command: (s) => s,
};

function createStyles(overrides?: Partial<StylesDef>, disabled = false): StylesDef {
  if (disabled) {
    return overrides ? { ...NO_STYLE, ...overrides } : NO_STYLE;
  }
  const defaults: StylesDef = {
    bold: (s) => styleText('bold', s),
    yellow: (s) => styleText('yellow', s),
    green: (s) => styleText('green', s),
    cyan: (s) => styleText('cyan', s),
    heading: (s) => styleText(['bold', 'yellow'], s),
    flag: (s) => styleText('green', s),
    value: (s) => styleText('cyan', s),
    command: (s) => styleText('bold', s),
  };
  if (!overrides) {
    return defaults;
  }
  return { ...defaults, ...overrides };
}

// ---- Help Text Helpers ----

/** Wrap text to fit within a given width, preserving leading indent. */
function wrapText(text: string, maxWidth: number, indent: number): string {
  const available = Math.max(MIN_DESC_WIDTH, maxWidth - indent);
  if (text.length <= available) {
    return text;
  }

  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';
  const padding = ' '.repeat(indent);

  for (const word of words) {
    if (currentLine.length === 0) {
      currentLine = word;
    } else if (currentLine.length + 1 + word.length <= available) {
      currentLine += ` ${word}`;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  return lines.join(`\n${padding}`);
}

/** Format a flag string for display: "-s, --long, --visible-alias <VALUE>" */
function formatArgFlag(key: string, def: ArgDef, styles: StylesDef): { flag: string; rawLen: number } {
  const parts: string[] = [];
  const rawParts: string[] = [];

  // Short flag
  if (def.short) {
    parts.push(styles.flag(`-${def.short}`));
    rawParts.push(`-${def.short}`);
  }

  // Long flag
  const longName = def.long ?? key;
  if (def.short) {
    parts.push(`, ${styles.flag(`--${longName}`)}`);
    rawParts.push(`, --${longName}`);
  } else {
    // Pad to align with flags that have short
    parts.push(`    ${styles.flag(`--${longName}`)}`);
    rawParts.push(`    --${longName}`);
  }

  // Visible aliases (shown in help, unlike hidden aliases)
  if (def.visibleAlias) {
    for (const alias of def.visibleAlias) {
      if (alias.length === 1) {
        parts.push(`, ${styles.flag(`-${alias}`)}`);
        rawParts.push(`, -${alias}`);
      } else {
        parts.push(`, ${styles.flag(`--${alias}`)}`);
        rawParts.push(`, --${alias}`);
      }
    }
  }

  // Value placeholder
  if (def.type !== 'boolean' || def.valueName || def.valueNames) {
    const optional = def.numArgs !== undefined && def.numArgs.min === 0;
    const open = optional ? '[' : '<';
    const close = optional ? ']' : '>';
    const names = def.valueNames ?? [def.valueName ?? def.type.toUpperCase()];
    for (const name of names) {
      parts.push(` ${styles.value(`${open}${name}${close}`)}`);
      rawParts.push(` ${open}${name}${close}`);
    }
  }

  return {
    flag: parts.join(''),
    rawLen: rawParts.join('').length,
  };
}

/** Build the description suffix: [default: x] [env: VAR] [possible values: a, b] */
function formatArgSuffix(def: ArgDef): string {
  const suffixes: string[] = [];

  if (def.default !== undefined && def.type !== 'boolean' && !def.hideDefaultValue) {
    const defaultStr = Array.isArray(def.default) ? def.default.join(', ') : String(def.default);
    suffixes.push(`[default: ${defaultStr}]`);
  }

  if (def.env && !def.hideEnv) {
    const current = def.hideEnvValues ? undefined : process.env[def.env];
    suffixes.push(current ? `[env: ${def.env}=${current}]` : `[env: ${def.env}]`);
  }

  if (!def.hidePossibleValues) {
    const visible = possibleValues(def).filter((v) => !v.hidden);
    if (visible.length > 0) {
      suffixes.push(`[possible values: ${visible.map((v) => v.name).join(', ')}]`);
    }
  }

  if (def.required) {
    suffixes.push('[required]');
  }

  return suffixes.length > 0 ? ` ${suffixes.join(' ')}` : '';
}

/** Description for an arg, preferring the long form in long help. */
function argDescription(def: ArgDef, isShortHelp: boolean): string {
  const base = (!isShortHelp && def.longDescription) || def.description || '';
  return base + formatArgSuffix(def);
}

/** Sort help entries by displayOrder, keeping declaration order as the tiebreak. */
function byDisplayOrder(entries: (readonly [string, ArgDef])[]): (readonly [string, ArgDef])[] {
  if (!entries.some(([, def]) => def.displayOrder !== undefined)) {
    return entries;
  }
  return [...entries].sort(
    (a, b) =>
      (a[1].displayOrder ?? Number.MAX_SAFE_INTEGER) -
      (b[1].displayOrder ?? Number.MAX_SAFE_INTEGER),
  );
}

/** Append usage parts for options, positionals, and subcommands. */
function appendUsageParts(usageParts: string[], command: CommandDef): void {
  const argsDef = command.args ?? {};
  const hasOptions = Object.values(argsDef).some((d) => d.type !== 'positional' && !d.hidden);
  const positionals = Object.entries(argsDef).filter(([_, d]) => d.type === 'positional');
  const hasSubcommands = command.subCommands && Object.keys(command.subCommands).length > 0;

  if (hasOptions) {
    usageParts.push('[OPTIONS]');
  }
  for (const [key, def] of positionals) {
    const name = def.valueName ?? key.toUpperCase();
    if (def.required) {
      usageParts.push(`<${name}>`);
    } else {
      usageParts.push(`[${name}]`);
    }
  }
  if (hasSubcommands) {
    usageParts.push(`[${command.meta.subcommandValueName ?? 'COMMAND'}]`);
  }
}

/** Check if an arg should be hidden based on help mode. */
function isArgHiddenForMode(def: ArgDef, isShortHelp: boolean): boolean {
  if (def.hidden) {
    return true;
  }
  if (isShortHelp && def.hideShortHelp) {
    return true;
  }
  if (!isShortHelp && def.hideLongHelp) {
    return true;
  }
  return false;
}

/** Below this many columns beside a flag, help drops to next-line layout. */
const MIN_DESC_WIDTH = 20;

// ---- Entry type for aligned rendering ----

interface HelpEntry {
  label: string;
  rawLen: number;
  desc: string;
  /** Put the description on its own line beneath the label. */
  nextLine?: boolean;
  /** Extra indented lines rendered after the description. */
  detail?: readonly string[];
}

/** Render aligned entries (flag + description with padding). */
function renderAlignedEntries(
  entries: HelpEntry[],
  termWidth: number,
  lines: string[],
): void {
  if (entries.length === 0) {
    return;
  }
  const inline = entries.filter((e) => !e.nextLine);
  const maxLen = inline.length > 0 ? Math.max(...inline.map((e) => e.rawLen)) : 0;
  const descIndent = maxLen + 4;

  // A narrow terminal leaves too little room beside the flag to wrap into, so
  // the whole section drops to next-line help rather than overflowing.
  const forceNextLine = termWidth - (descIndent + 2) < MIN_DESC_WIDTH;

  for (const entry of entries) {
    if (entry.nextLine || forceNextLine) {
      lines.push(entry.label);
      if (entry.desc) {
        lines.push(`      ${wrapText(entry.desc, termWidth, 6)}`);
      }
    } else if (entry.desc) {
      const padding = ' '.repeat(Math.max(2, descIndent - entry.rawLen));
      lines.push(`${entry.label}${padding}${wrapText(entry.desc, termWidth, descIndent)}`);
    } else {
      lines.push(entry.label);
    }
    if (entry.detail) {
      for (const line of entry.detail) {
        lines.push(line);
      }
    }
  }
}

/**
 * Per-value help block, as clap renders under an option in long help:
 *
 *   Possible values:
 *   - fast: skip the slow checks
 */
function possibleValueDetail(def: ArgDef, styles: StylesDef, isShortHelp: boolean): string[] | undefined {
  if (isShortHelp || def.hidePossibleValues) {
    return undefined;
  }
  const visible = possibleValues(def).filter((v) => !v.hidden);
  if (!visible.some((v) => v.help)) {
    return undefined;
  }
  const detail = ['', `      ${styles.heading('Possible values:')}`];
  for (const value of visible) {
    detail.push(`      - ${styles.value(value.name)}${value.help ? `: ${value.help}` : ''}`);
  }
  detail.push('');
  return detail;
}

// ---- Template Rendering ----

/**
 * Render help using a custom template with placeholders.
 * Placeholders: {name}, {version}, {about}, {usage}, {all-args},
 * {arguments}, {options}, {commands}, {before-help}, {after-help}
 */
function renderHelpTemplate(
  template: string,
  command: CommandDef,
  styles: StylesDef,
  termWidth: number,
  fullName: string,
  isShortHelp: boolean,
): string {
  const { meta } = command;
  const argsDef = command.args ?? {};

  // Build each section as a string
  const usageParts = [styles.heading('Usage:'), styles.command(fullName)];
  appendUsageParts(usageParts, command);
  const usageStr = usageParts.join(' ');

  const argsLines: string[] = [];
  renderPositionalSection(argsLines, argsDef, styles, termWidth, isShortHelp);
  const argumentsStr = argsLines.join('\n');

  const optLines: string[] = [];
  renderOptionsSection(optLines, argsDef, meta, styles, termWidth, isShortHelp);
  const optionsStr = optLines.join('\n');

  const cmdLines: string[] = [];
  if (command.subCommands && Object.keys(command.subCommands).length > 0) {
    renderSubcommandSection(cmdLines, command, styles, termWidth, fullName);
  }
  const commandsStr = cmdLines.join('\n');

  return template
    .replaceAll('{name}', meta.name)
    .replaceAll('{version}', meta.version ?? '')
    .replaceAll('{author}', meta.author ?? '')
    .replaceAll('{about}', meta.about ?? meta.description ?? '')
    .replaceAll('{usage}', usageStr)
    .replaceAll('{all-args}', [argumentsStr, optionsStr].filter(Boolean).join('\n'))
    .replaceAll('{arguments}', argumentsStr)
    .replaceAll('{options}', optionsStr)
    .replaceAll('{commands}', commandsStr)
    .replaceAll('{before-help}', meta.beforeHelp ?? '')
    .replaceAll('{after-help}', meta.afterHelp ?? '');
}

// ---- Section Renderers (extracted for reuse) ----

/** Render positional arguments section. */
function renderPositionalSection(
  lines: string[],
  argsDef: Record<string, ArgDef>,
  styles: StylesDef,
  termWidth: number,
  isShortHelp: boolean,
): void {
  const positionals = Object.entries(argsDef).filter(([_, d]) => d.type === 'positional');
  const visiblePositionals = positionals.filter(([_, d]) => !isArgHiddenForMode(d, isShortHelp));

  if (visiblePositionals.length === 0) {
    return;
  }

  lines.push(styles.heading('Arguments:'));

  const entries: HelpEntry[] = [];
  for (const [key, def] of byDisplayOrder(visiblePositionals)) {
    const name = def.valueName ?? key.toUpperCase();
    const label = `  ${styles.value(`<${name}>`)}`;
    const rawLen = name.length + 4;
    entries.push({
      label,
      rawLen,
      desc: argDescription(def, isShortHelp),
      nextLine: def.nextLineHelp,
      detail: possibleValueDetail(def, styles, isShortHelp),
    });
  }

  renderAlignedEntries(entries, termWidth, lines);
}

/** Render options section, grouped by helpHeading. */
function renderOptionsSection(
  lines: string[],
  argsDef: Record<string, ArgDef>,
  meta: CommandMeta,
  styles: StylesDef,
  termWidth: number,
  isShortHelp: boolean,
): void {
  const options = Object.entries(argsDef).filter(
    ([_, d]) => d.type !== 'positional' && !isArgHiddenForMode(d, isShortHelp),
  );

  if (options.length === 0) {
    return;
  }

  // Group options by helpHeading
  const groups = new Map<string, [string, ArgDef][]>();
  const defaultHeading = 'Options';

  for (const entry of options) {
    const heading = entry[1].helpHeading ?? defaultHeading;
    let group = groups.get(heading);
    if (!group) {
      group = [];
      groups.set(heading, group);
    }
    group.push(entry);
  }

  for (const [heading, groupOptions] of groups) {
    lines.push('');
    lines.push(styles.heading(`${heading}:`));

    const entries: HelpEntry[] = [];

    for (const [key, def] of byDisplayOrder(groupOptions)) {
      const { flag, rawLen } = formatArgFlag(key, def, styles);
      entries.push({
        label: `  ${flag}`,
        rawLen: rawLen + 2,
        desc: argDescription(def, isShortHelp),
        nextLine: def.nextLineHelp,
        detail: possibleValueDetail(def, styles, isShortHelp),
      });

      // Boolean negation: --no-flag
      if (def.type === 'boolean' && def.negativeDescription) {
        const longName = def.long ?? key;
        const negFlag = `    ${styles.flag(`--no-${longName}`)}`;
        const negRawLen = longName.length + 10;
        entries.push({
          label: `  ${negFlag}`,
          rawLen: negRawLen + 2,
          desc: def.negativeDescription,
        });
      }
    }

    // Add built-in --help and --version to the default "Options" group
    if (heading === defaultHeading) {
      if (!meta.disableHelpFlag) {
        const helpFlag = `  ${styles.flag('-h')}, ${styles.flag('--help')}`;
        entries.push({ label: helpFlag, rawLen: '  -h, --help'.length, desc: 'Print help' });
      }

      if (meta.version && !meta.disableVersionFlag) {
        const versionFlag = `  ${styles.flag('-V')}, ${styles.flag('--version')}`;
        entries.push({
          label: versionFlag,
          rawLen: '  -V, --version'.length,
          desc: 'Print version',
        });
      }
    }

    renderAlignedEntries(entries, termWidth, lines);
  }
}

// ---- Main Renderer ----

/**
 * Render the full help text for a command.
 * Matches clap's help format. Supports helpTemplate override,
 * helpHeading grouping, beforeHelp, and help mode filtering.
 */
export function renderHelp(
  command: CommandDef,
  parentNames?: string[],
  isShortHelp = false,
  styleOverrides?: Partial<StylesDef>,
): string {
  const { meta } = command;

  if (meta.overrideHelp !== undefined) {
    return meta.overrideHelp.endsWith('\n') ? meta.overrideHelp : `${meta.overrideHelp}\n`;
  }

  const styles = createStyles(styleOverrides, meta.disableColoredHelp === true);
  const termWidth = getTerminalWidth(meta);
  const fullName = parentNames ? [...parentNames, meta.name].join(' ') : meta.name;

  // Custom template override
  if (meta.helpTemplate) {
    return renderHelpTemplate(meta.helpTemplate, command, styles, termWidth, fullName, isShortHelp);
  }

  const lines: string[] = [];

  // Before help text
  const beforeHelp = (!isShortHelp && meta.beforeLongHelp) || meta.beforeHelp;
  if (beforeHelp) {
    lines.push(beforeHelp);
    lines.push('');
  }

  // Header: "Description (name vX.Y.Z)"
  const nameVersion = meta.version ? `${meta.name} v${meta.version}` : meta.name;
  const headerDesc = meta.about ?? meta.description ?? '';
  if (headerDesc) {
    lines.push(`${headerDesc} (${nameVersion})`);
  } else {
    lines.push(nameVersion);
  }

  // Long about (if any, only in long help mode)
  if (meta.longAbout && !isShortHelp) {
    lines.push('');
    lines.push(meta.longAbout);
  }

  lines.push('');

  // Usage line
  if (meta.overrideUsage !== undefined) {
    lines.push(`${styles.heading('Usage:')} ${meta.overrideUsage}`);
  } else {
    const usageParts = [styles.heading('Usage:'), styles.command(fullName)];
    appendUsageParts(usageParts, command);
    lines.push(usageParts.join(' '));
  }

  // Positional arguments
  const argsDef = command.args ?? {};
  const posLines: string[] = [];
  renderPositionalSection(posLines, argsDef, styles, termWidth, isShortHelp);
  if (posLines.length > 0) {
    lines.push('');
    lines.push(...posLines);
  }

  // Options (grouped by helpHeading)
  const optLines: string[] = [];
  renderOptionsSection(optLines, argsDef, meta, styles, termWidth, isShortHelp);
  lines.push(...optLines);

  // Subcommands
  const hasSubcommands = command.subCommands && Object.keys(command.subCommands).length > 0;
  if (hasSubcommands) {
    renderSubcommandSection(lines, command, styles, termWidth, fullName);
  }

  // After help
  const afterHelp = (!isShortHelp && meta.afterLongHelp) || meta.afterHelp;
  if (afterHelp) {
    lines.push('');
    lines.push(afterHelp);
  }

  lines.push('');
  return lines.join('\n');
}

/** Render the subcommands section of help output. */
function renderSubcommandSection(
  lines: string[],
  command: CommandDef,
  styles: StylesDef,
  termWidth: number,
  fullName: string,
): void {
  lines.push('');
  lines.push(styles.heading(`${command.meta.subcommandHelpHeading ?? 'Commands'}:`));

  const subEntries: HelpEntry[] = [];
  const rendered = new Set<string>();

  const subs = Object.entries(command.subCommands!);
  if (subs.some(([, def]) => def.meta.displayOrder !== undefined)) {
    subs.sort(
      (a, b) =>
        (a[1].meta.displayOrder ?? Number.MAX_SAFE_INTEGER) -
        (b[1].meta.displayOrder ?? Number.MAX_SAFE_INTEGER),
    );
  }

  for (const [name, def] of subs) {
    if (def.meta.hidden) {
      continue;
    }
    if (rendered.has(name)) {
      continue;
    }
    rendered.add(name);

    // Visible aliases and any flag form share the parenthesised suffix.
    const extras: string[] = [...(def.meta.aliases ?? [])];
    if (def.meta.shortFlag !== undefined) {
      extras.push(`-${def.meta.shortFlag}`);
    }
    if (def.meta.longFlag !== undefined) {
      extras.push(`--${def.meta.longFlag}`);
    }

    let label: string;
    let rawLen: number;
    if (extras.length > 0) {
      const aliasStr = extras.join(', ');
      label = `  ${styles.command(name)} (${aliasStr})`;
      rawLen = name.length + aliasStr.length + 5;
    } else {
      label = `  ${styles.command(name)}`;
      rawLen = name.length + 2;
    }

    subEntries.push({ label, rawLen, desc: def.meta.description ?? '' });
  }

  if (!command.meta.disableHelpSubcommand) {
    subEntries.push({
      label: `  ${styles.command('help')}`,
      rawLen: 6,
      desc: 'Print this message or the help of the given subcommand(s)',
    });
  }

  renderAlignedEntries(subEntries, termWidth, lines);

  lines.push('');
  lines.push(
    `Use ${styles.command(`${fullName} <command> --help`)} for more information about a command.`,
  );
}

/**
 * Render a short usage message (shown on errors).
 */
export function renderUsage(
  command: CommandDef,
  parentNames?: string[],
  styleOverrides?: Partial<StylesDef>,
): string {
  const { meta } = command;
  const styles = createStyles(styleOverrides, meta.disableColoredHelp === true);

  if (meta.overrideUsage !== undefined) {
    return `${styles.heading('Usage:')} ${meta.overrideUsage}`;
  }

  const fullName = parentNames ? [...parentNames, meta.name].join(' ') : meta.name;
  const usageParts = [styles.heading('Usage:'), styles.command(fullName)];
  appendUsageParts(usageParts, command);

  return usageParts.join(' ');
}

/**
 * Print help to stdout.
 */
export function showHelp(
  command: CommandDef,
  parentNames?: string[],
  isShortHelp = false,
  styleOverrides?: Partial<StylesDef>,
): void {
  const text = renderHelp(command, parentNames, isShortHelp, styleOverrides);
  process.stdout.write(text);
}

/**
 * Print version to stdout.
 */
export function showVersion(meta: CommandMeta, isShort = false): void {
  const version = (!isShort && meta.longVersion) || meta.version || '0.0.0';
  process.stdout.write(`${meta.name} ${version}\n`);
}

/**
 * Print an error message with usage hint.
 */
export function showError(
  message: string,
  command: CommandDef,
  parentNames?: string[],
  styleOverrides?: Partial<StylesDef>,
): void {
  const styles = createStyles(styleOverrides);
  const usage = renderUsage(command, parentNames, styleOverrides);
  const output = `${styles.bold('error:')} ${message}\n\n${usage}\n\nFor more information, try '${styles.flag('--help')}'.\n`;
  process.stderr.write(output);
}
