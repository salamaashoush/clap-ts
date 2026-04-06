/**
 * Help renderer - generates clap-style help output.
 * Respects NO_COLOR, TERM=dumb, CI for color output.
 * Wraps text to terminal width.
 */

import { styleText } from 'node:util';
import type { ArgDef, CommandDef, CommandMeta } from './types.js';

// ---- Color Support ----

/** Get terminal width, defaulting to 80 if not available. */
function getTerminalWidth(): number {
  if (typeof process.stdout?.columns === 'number' && process.stdout.columns > 0) {
    return process.stdout.columns;
  }
  return 80;
}

type StyleFn = (s: string) => string;

interface Styles {
  bold: StyleFn;
  yellow: StyleFn;
  green: StyleFn;
  cyan: StyleFn;
  heading: StyleFn;
  flag: StyleFn;
  value: StyleFn;
  command: StyleFn;
}

/** Create style functions using node:util styleText (auto-respects NO_COLOR and non-TTY). */
function createStyles(): Styles {
  return {
    bold: (s) => styleText('bold', s),
    yellow: (s) => styleText('yellow', s),
    green: (s) => styleText('green', s),
    cyan: (s) => styleText('cyan', s),
    heading: (s) => styleText(['bold', 'yellow'], s),
    flag: (s) => styleText('green', s),
    value: (s) => styleText('cyan', s),
    command: (s) => styleText('bold', s),
  };
}

// ---- Help Text Helpers ----

/** Wrap text to fit within a given width, preserving leading indent. */
function wrapText(text: string, maxWidth: number, indent: number): string {
  if (text.length + indent <= maxWidth) {
    return text;
  }

  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';
  const padding = ' '.repeat(indent);

  for (const word of words) {
    if (currentLine.length === 0) {
      currentLine = word;
    } else if (currentLine.length + 1 + word.length + indent <= maxWidth) {
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

/** Format a flag string for display: "-s, --long <VALUE>" */
function formatArgFlag(key: string, def: ArgDef, styles: Styles): { flag: string; rawLen: number } {
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

  // Value placeholder
  if (def.type !== 'boolean' || def.valueName) {
    const valueName = def.valueName ?? def.type.toUpperCase();
    // Optional value indicator
    if (def.numArgs && def.numArgs.min === 0) {
      parts.push(` ${styles.value(`[${valueName}]`)}`);
      rawParts.push(` [${valueName}]`);
    } else {
      parts.push(` ${styles.value(`<${valueName}>`)}`);
      rawParts.push(` <${valueName}>`);
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

  if (def.default !== undefined && def.type !== 'boolean') {
    const defaultStr = Array.isArray(def.default) ? def.default.join(', ') : String(def.default);
    suffixes.push(`[default: ${defaultStr}]`);
  }

  if (def.env) {
    suffixes.push(`[env: ${def.env}]`);
  }

  if (def.valueParser && def.valueParser.length > 0) {
    suffixes.push(`[possible values: ${def.valueParser.join(', ')}]`);
  }

  if (def.required) {
    suffixes.push('[required]');
  }

  return suffixes.length > 0 ? ` ${suffixes.join(' ')}` : '';
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
    usageParts.push('[COMMAND]');
  }
}

// ---- Main Renderer ----

/**
 * Render the full help text for a command.
 * Matches clap's help format.
 */
export function renderHelp(command: CommandDef, parentNames?: string[]): string {
  const { meta } = command;
  const styles = createStyles();
  const termWidth = getTerminalWidth();
  const lines: string[] = [];

  // Header: "Description (name vX.Y.Z)"
  const nameVersion = meta.version ? `${meta.name} v${meta.version}` : meta.name;
  const headerDesc = meta.about ?? meta.description ?? '';
  if (headerDesc) {
    lines.push(`${headerDesc} (${nameVersion})`);
  } else {
    lines.push(nameVersion);
  }

  // Long about (if any)
  if (meta.longAbout) {
    lines.push('');
    lines.push(meta.longAbout);
  }

  lines.push('');

  // Usage line
  const fullName = parentNames ? [...parentNames, meta.name].join(' ') : meta.name;
  const usageParts = [styles.heading('Usage:'), styles.command(fullName)];
  appendUsageParts(usageParts, command);
  lines.push(usageParts.join(' '));

  // Positional arguments
  const argsDef = command.args ?? {};
  const positionals = Object.entries(argsDef).filter(([_, d]) => d.type === 'positional');

  if (positionals.length > 0) {
    lines.push('');
    lines.push(styles.heading('Arguments:'));

    const entries: { label: string; rawLen: number; desc: string }[] = [];
    for (const [key, def] of positionals) {
      if (def.hidden) {
        continue;
      }
      const name = def.valueName ?? key.toUpperCase();
      const label = `  ${styles.value(`<${name}>`)}`;
      const rawLen = name.length + 4; // "  <" + name + ">"
      const desc = (def.description ?? '') + formatArgSuffix(def);
      entries.push({ label, rawLen, desc });
    }

    const maxLen = Math.max(...entries.map((e) => e.rawLen));
    const descIndent = maxLen + 4; // padding between flag and description

    for (const entry of entries) {
      const padding = ' '.repeat(Math.max(2, descIndent - entry.rawLen));
      const wrappedDesc = wrapText(entry.desc, termWidth, descIndent + 2);
      lines.push(`${entry.label}${padding}${wrappedDesc}`);
    }
  }

  // Options (non-positional, non-hidden)
  const options = Object.entries(argsDef).filter(([_, d]) => d.type !== 'positional' && !d.hidden);

  if (options.length > 0) {
    lines.push('');
    lines.push(styles.heading('Options:'));

    const entries: { label: string; rawLen: number; desc: string }[] = [];

    for (const [key, def] of options) {
      const { flag, rawLen } = formatArgFlag(key, def, styles);
      const desc = (def.description ?? '') + formatArgSuffix(def);
      entries.push({ label: `  ${flag}`, rawLen: rawLen + 2, desc });

      // Boolean negation: --no-flag
      if (def.type === 'boolean' && def.negativeDescription) {
        const longName = def.long ?? key;
        const negFlag = `    ${styles.flag(`--no-${longName}`)}`;
        const negRawLen = longName.length + 10; // "    --no-" + name
        entries.push({
          label: `  ${negFlag}`,
          rawLen: negRawLen + 2,
          desc: def.negativeDescription,
        });
      }
    }

    // Add built-in --help and --version
    const helpFlag = `  ${styles.flag('-h')}, ${styles.flag('--help')}`;
    entries.push({ label: helpFlag, rawLen: 14, desc: 'Print help' });

    if (meta.version) {
      const versionFlag = `  ${styles.flag('-V')}, ${styles.flag('--version')}`;
      entries.push({ label: versionFlag, rawLen: 17, desc: 'Print version' });
    }

    const maxLen = Math.max(...entries.map((e) => e.rawLen));
    const descIndent = maxLen + 4;

    for (const entry of entries) {
      const padding = ' '.repeat(Math.max(2, descIndent - entry.rawLen));
      const wrappedDesc = wrapText(entry.desc, termWidth, descIndent + 2);
      lines.push(`${entry.label}${padding}${wrappedDesc}`);
    }
  }

  // Subcommands
  const hasSubcommands = command.subCommands && Object.keys(command.subCommands).length > 0;
  if (hasSubcommands) {
    renderSubcommandSection(lines, command, styles, termWidth, fullName);
  }

  // After help
  if (meta.afterHelp) {
    lines.push('');
    lines.push(meta.afterHelp);
  }

  lines.push('');
  return lines.join('\n');
}

/** Render the subcommands section of help output. */
function renderSubcommandSection(
  lines: string[],
  command: CommandDef,
  styles: Styles,
  termWidth: number,
  fullName: string,
): void {
  lines.push('');
  lines.push(styles.heading('Commands:'));

  const subEntries: { label: string; rawLen: number; desc: string }[] = [];
  // Track which commands we've already rendered (to deduplicate aliases registered as separate keys)
  const rendered = new Set<string>();

  for (const [name, def] of Object.entries(command.subCommands!)) {
    if (def.meta.hidden) {
      continue;
    }
    if (rendered.has(name)) {
      continue;
    }
    rendered.add(name);

    let label: string;
    let rawLen: number;

    // Show visible aliases
    const { aliases } = def.meta;
    if (aliases && aliases.length > 0) {
      const aliasStr = aliases.join(', ');
      label = `  ${styles.command(name)} (${aliasStr})`;
      rawLen = name.length + aliasStr.length + 5; // "  " + name + " (" + aliases + ")"
    } else {
      label = `  ${styles.command(name)}`;
      rawLen = name.length + 2;
    }

    const desc = def.meta.description ?? '';
    subEntries.push({ label, rawLen, desc });
  }

  if (subEntries.length > 0) {
    const maxLen = Math.max(...subEntries.map((e) => e.rawLen));
    const descIndent = maxLen + 4;

    for (const entry of subEntries) {
      const padding = ' '.repeat(Math.max(2, descIndent - entry.rawLen));
      const wrappedDesc = wrapText(entry.desc, termWidth, descIndent + 2);
      lines.push(`${entry.label}${padding}${wrappedDesc}`);
    }
  }

  lines.push('');
  lines.push(
    `Use ${styles.command(`${fullName} <command> --help`)} for more information about a command.`,
  );
}

/**
 * Render a short usage message (shown on errors).
 */
export function renderUsage(command: CommandDef, parentNames?: string[]): string {
  const { meta } = command;
  const styles = createStyles();
  const fullName = parentNames ? [...parentNames, meta.name].join(' ') : meta.name;

  const usageParts = [styles.heading('Usage:'), styles.command(fullName)];
  appendUsageParts(usageParts, command);

  return usageParts.join(' ');
}

/**
 * Print help to stdout and optionally exit.
 */
export function showHelp(command: CommandDef, parentNames?: string[]): void {
  const text = renderHelp(command, parentNames);
  process.stdout.write(text);
}

/**
 * Print version to stdout.
 */
export function showVersion(meta: CommandMeta): void {
  const version = meta.version ?? '0.0.0';
  process.stdout.write(`${meta.name} ${version}\n`);
}

/**
 * Print an error message with usage hint.
 */
export function showError(message: string, command: CommandDef, parentNames?: string[]): void {
  const styles = createStyles();
  const usage = renderUsage(command, parentNames);
  const output = `${styles.bold('error:')} ${message}\n\n${usage}\n\nFor more information, try '${styles.flag('--help')}'.\n`;
  process.stderr.write(output);
}
