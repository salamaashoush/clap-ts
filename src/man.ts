/**
 * Man page generation, matching the roff clap_mangen produces.
 *
 * A page carries the sections `man` expects in order: NAME, SYNOPSIS,
 * DESCRIPTION, OPTIONS, SUBCOMMANDS, then the extra text, VERSION and AUTHORS.
 * Subcommands get their own pages, named `parent-child.1` the way clap does.
 */

import type { ArgDef, CommandDef, ManOptions } from './types.js';
import { hasSubCommands, possibleValues, subCommandsOf } from './parser.js';

// ---- Escaping ----

/**
 * Escape text for roff. A leading dot would start a request, a backslash starts
 * an escape, a hyphen renders as a soft hyphen unless escaped, and an
 * apostrophe goes through the \*(Aq string defined in the preamble.
 */
function esc(text: string): string {
  return text
    .replaceAll('\\', '\\e')
    .replaceAll("'", '\\*(Aq')
    .replaceAll('-', '\\-')
    .replaceAll(/^\./gm, '\\&.');
}

function bold(text: string): string {
  return `\\fB${esc(text)}\\fR`;
}

function italic(text: string): string {
  return `\\fI${esc(text)}\\fR`;
}

// ---- Arg helpers ----

function valuePlaceholder(key: string, def: ArgDef): string {
  if (def.valueNames && def.valueNames.length > 0) {
    return def.valueNames.map((n) => italic(n)).join(' ');
  }
  return italic(def.valueName ?? (def.long ?? key).toUpperCase());
}

/** The bracket pair around an option in the synopsis: required or optional. */
function markers(def: ArgDef): [string, string] {
  return def.required ? ['', ''] : ['[', ']'];
}

/** `\fB-c\fR|\fB--config\fR` for one option, with its value if it takes one. */
function optionForms(key: string, def: ArgDef): string {
  const forms: string[] = [];
  if (def.short) {
    forms.push(bold(`-${def.short}`));
  }
  forms.push(bold(`--${def.long ?? key}`));
  let rendered = forms.join('|');
  if (def.type !== 'boolean' && def.action !== 'count') {
    rendered += `=${valuePlaceholder(key, def)}`;
  }
  return rendered;
}

function isVisible(def: ArgDef): boolean {
  return !def.hidden && !def.hideLongHelp;
}

// ---- Sections ----

function renderSynopsis(name: string, command: CommandDef): string {
  const argsDef: Record<string, ArgDef> = command.args ?? {};
  const parts: string[] = [bold(name)];

  for (const [key, def] of Object.entries(argsDef)) {
    if (def.type === 'positional' || !isVisible(def)) {
      continue;
    }
    const [open, close] = markers(def);
    const repeat = def.action === 'append' || def.action === 'count' ? '...' : '';
    parts.push(`${open}${optionForms(key, def)}${close}${repeat}`);
  }

  if (command.meta.disableHelpFlag !== true) {
    parts.push(`[${bold('-h')}|${bold('--help')}]`);
  }
  if (command.meta.version && command.meta.disableVersionFlag !== true) {
    parts.push(`[${bold('-V')}|${bold('--version')}]`);
  }

  for (const [key, def] of Object.entries(argsDef)) {
    if (def.type !== 'positional' || !isVisible(def)) {
      continue;
    }
    const name_ = italic(def.valueName ?? key);
    const repeat = def.trailingVarArg ? '...' : '';
    parts.push(def.required ? `${name_}${repeat}` : `[${name_}]${repeat}`);
  }

  if (hasSubCommands(command)) {
    parts.push(`[${italic('subcommands')}]`);
  }

  return parts.join(' ');
}

/** A `.TP` entry: the term, its description, then any trailing notes. */
function renderEntry(term: string, def: ArgDef, key: string, lines: string[]): void {
  lines.push('.TP');
  lines.push(term);

  const description = def.longDescription ?? def.description ?? '';
  lines.push(description ? esc(description) : '');

  const notes: string[] = [];
  if (def.default !== undefined && !def.hideDefaultValue) {
    const shown = Array.isArray(def.default) ? def.default.join(', ') : String(def.default);
    notes.push(`${italic('Default value:')} ${esc(shown)}`);
  }
  if (def.env && !def.hideEnv) {
    notes.push(`${italic('Environment:')} ${esc(def.env)}`);
  }
  for (const note of notes) {
    lines.push('.br');
    lines.push(note);
  }

  const values = def.hidePossibleValues ? [] : possibleValues(def).filter((v) => !v.hidden);
  if (values.length > 0) {
    lines.push('.br');
    lines.push(`${italic('Possible values:')}`);
    lines.push('.RS 14');
    for (const value of values) {
      lines.push('.IP \\(bu 2');
      lines.push(value.help ? `${esc(value.name)}: ${esc(value.help)}` : esc(value.name));
    }
    lines.push('.RE');
  }

  void key;
}

function renderOptions(command: CommandDef, lines: string[]): boolean {
  const argsDef: Record<string, ArgDef> = command.args ?? {};
  const options = Object.entries(argsDef).filter(
    ([, def]) => def.type !== 'positional' && isVisible(def),
  );
  const positionals = Object.entries(argsDef).filter(
    ([, def]) => def.type === 'positional' && isVisible(def),
  );

  const hasHelp = command.meta.disableHelpFlag !== true;
  const hasVersion = command.meta.version !== undefined && command.meta.disableVersionFlag !== true;

  if (options.length === 0 && positionals.length === 0 && !hasHelp && !hasVersion) {
    return false;
  }

  lines.push('.SH OPTIONS');
  for (const [key, def] of options) {
    const forms: string[] = [];
    if (def.short) {
      forms.push(bold(`-${def.short}`));
    }
    forms.push(bold(`--${def.long ?? key}`));
    let term = forms.join(', ');
    if (def.type !== 'boolean' && def.action !== 'count') {
      term += `=${valuePlaceholder(key, def)}`;
    }
    renderEntry(term, def, key, lines);
  }

  if (hasHelp) {
    lines.push('.TP', `${bold('-h')}, ${bold('--help')}`, 'Print help');
  }
  if (hasVersion) {
    lines.push('.TP', `${bold('-V')}, ${bold('--version')}`, 'Print version');
  }

  for (const [key, def] of positionals) {
    const name = italic(def.valueName ?? key);
    renderEntry(def.required ? name : `[${name}]`, def, key, lines);
  }

  return true;
}

function renderSubcommands(name: string, command: CommandDef, lines: string[]): void {
  const subs = Object.entries(subCommandsOf(command)).filter(([, def]) => !def.meta.hidden);
  if (subs.length === 0) {
    return;
  }

  lines.push('.SH SUBCOMMANDS');
  for (const [subName, def] of subs) {
    lines.push('.TP');
    lines.push(esc(`${name}-${subName}(1)`));
    lines.push(esc(def.meta.description ?? def.meta.about ?? ''));
  }
}

// ---- Public API ----

/**
 * Render a man page for one command as roff source.
 *
 * ```ts
 * writeFileSync('my-tool.1', renderManPage(command));
 * ```
 */
export function renderManPage(command: CommandDef, opts?: ManOptions): string {
  const { meta } = command;
  const name = opts?.name ?? meta.binName ?? meta.displayName ?? meta.name;
  const section = opts?.section ?? '1';
  const manual = opts?.manual ?? '';
  const title = meta.version ? `${name} ${meta.version}` : name;

  const lines: string[] = [
    '.ie \\n(.g .ds Aq \\(aq',
    ".el .ds Aq '",
    `.TH ${esc(name)} ${esc(section)} "${esc(manual)}" "${esc(title)}"`,
  ];

  lines.push('.SH NAME');
  const summary = meta.description ?? meta.about ?? '';
  lines.push(summary ? `${esc(name)} \\- ${esc(summary)}` : esc(name));

  lines.push('.SH SYNOPSIS');
  lines.push(renderSynopsis(name, command));

  lines.push('.SH DESCRIPTION');
  const description = meta.longAbout ?? meta.about ?? meta.description ?? '';
  if (description) {
    lines.push(esc(description));
  }

  renderOptions(command, lines);
  renderSubcommands(name, command, lines);

  const extra = meta.afterLongHelp ?? meta.afterHelp;
  if (extra) {
    lines.push('.SH EXTRA');
    lines.push(esc(extra));
  }

  if (meta.version) {
    lines.push('.SH VERSION');
    lines.push(`v${esc(meta.longVersion ?? meta.version)}`);
  }

  if (meta.author) {
    lines.push('.SH AUTHORS');
    lines.push(esc(meta.author));
  }

  return `${lines.join('\n')}\n`;
}

/**
 * Render a man page for the command and every subcommand beneath it, keyed by
 * file name. Nested pages are named `parent-child.1`, as clap_mangen does.
 *
 * ```ts
 * for (const [file, roff] of generateManPages(command)) {
 *   writeFileSync(path.join(outDir, file), roff);
 * }
 * ```
 */
export function generateManPages(
  command: CommandDef,
  opts?: ManOptions,
): Map<string, string> {
  const pages = new Map<string, string>();
  const section = opts?.section ?? '1';

  const walk = (node: CommandDef, name: string): void => {
    pages.set(`${name}.${section}`, renderManPage(node, { ...opts, name }));
    for (const [subName, sub] of Object.entries(subCommandsOf(node))) {
      if (sub.meta.hidden) {
        continue;
      }
      walk(sub, `${name}-${subName}`);
    }
  };

  const rootName = opts?.name ?? command.meta.binName ?? command.meta.name;
  walk(command, rootName);
  return pages;
}
