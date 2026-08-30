/**
 * Markdown documentation, shaped like the clap-markdown crate's output: one
 * heading per command, its usage line, then Commands, Arguments and Options
 * lists, with nested commands appended as deeper headings.
 *
 * Suitable for committing next to a README or feeding a docs site.
 */

import type { ArgDef, CommandDef, MarkdownOptions } from './types.js';
import { hasSubCommands, possibleValues, subCommandsOf } from './parser.js';

/** Escape the markdown that could break a list item or table cell. */
function esc(text: string): string {
  return text.replaceAll(/([\\`*_[\]<>|])/g, '\\$1');
}

function isVisible(def: ArgDef): boolean {
  return !def.hidden && !def.hideLongHelp;
}

function valuePlaceholder(key: string, def: ArgDef): string {
  if (def.valueNames && def.valueNames.length > 0) {
    return def.valueNames.map((n) => `<${n}>`).join(' ');
  }
  return `<${def.valueName ?? (def.long ?? key).toUpperCase()}>`;
}

function usageLine(path: readonly string[], command: CommandDef): string {
  const argsDef: Record<string, ArgDef> = command.args ?? {};
  const parts = [...path];

  if (Object.values(argsDef).some((def) => def.type !== 'positional' && isVisible(def))) {
    parts.push('[OPTIONS]');
  }
  for (const [key, def] of Object.entries(argsDef)) {
    if (def.type !== 'positional' || !isVisible(def)) {
      continue;
    }
    const name = `<${def.valueName ?? key.toUpperCase()}>`;
    parts.push(def.required ? name : `[${name}]`);
  }
  if (hasSubCommands(command)) {
    parts.push(`[${command.meta.subcommandValueName ?? 'COMMAND'}]`);
  }

  return parts.join(' ');
}

/** Trailing notes for one argument: default, env, possible values, required. */
function notes(def: ArgDef): string[] {
  const out: string[] = [];

  const values = def.hidePossibleValues ? [] : possibleValues(def).filter((v) => !v.hidden);
  if (values.length > 0) {
    if (values.some((v) => v.help)) {
      out.push('Possible values:');
      for (const value of values) {
        out.push(`  - \`${value.name}\`${value.help ? `: ${esc(value.help)}` : ''}`);
      }
    } else {
      out.push(`Possible values: ${values.map((v) => `\`${v.name}\``).join(', ')}`);
    }
  }
  if (def.default !== undefined && !def.hideDefaultValue) {
    const shown = Array.isArray(def.default) ? def.default.join(', ') : String(def.default);
    out.push(`Default value: \`${shown}\``);
  }
  if (def.env && !def.hideEnv) {
    out.push(`Environment: \`${def.env}\``);
  }
  if (def.required) {
    out.push('Required.');
  }
  return out;
}

function renderArgList(
  entries: (readonly [string, ArgDef])[],
  label: (key: string, def: ArgDef) => string,
  lines: string[],
): void {
  for (const [key, def] of entries) {
    const description = def.longDescription ?? def.description ?? '';
    lines.push(`* ${label(key, def)}${description ? ` - ${esc(description)}` : ''}`);
    for (const note of notes(def)) {
      lines.push(`  ${note}`);
    }
  }
  lines.push('');
}

function renderCommand(
  command: CommandDef,
  path: readonly string[],
  depth: number,
  lines: string[],
): void {
  const { meta } = command;
  const argsDef: Record<string, ArgDef> = command.args ?? {};
  const heading = '#'.repeat(Math.min(depth, 6));

  lines.push(`${heading} \`${path.join(' ')}\``);
  lines.push('');

  const about = meta.longAbout ?? meta.about ?? meta.description;
  if (about) {
    lines.push(esc(about));
    lines.push('');
  }

  lines.push(`**Usage:** \`${usageLine(path, command)}\``);
  lines.push('');

  const subs = Object.entries(subCommandsOf(command)).filter(([, def]) => !def.meta.hidden);
  if (subs.length > 0) {
    lines.push(`${heading}# Commands`);
    lines.push('');
    for (const [name, def] of subs) {
      const aliases = def.meta.aliases ?? [];
      const alias = aliases.length > 0 ? ` (${aliases.map((a) => `\`${a}\``).join(', ')})` : '';
      const description = def.meta.description ?? def.meta.about ?? '';
      lines.push(`* \`${name}\`${alias}${description ? ` - ${esc(description)}` : ''}`);
    }
    lines.push('');
  }

  const positionals = Object.entries(argsDef).filter(
    ([, def]) => def.type === 'positional' && isVisible(def),
  );
  if (positionals.length > 0) {
    lines.push(`${heading}# Arguments`);
    lines.push('');
    renderArgList(positionals, (key, def) => `\`<${def.valueName ?? key.toUpperCase()}>\``, lines);
  }

  const options = Object.entries(argsDef).filter(
    ([, def]) => def.type !== 'positional' && isVisible(def),
  );
  const hasHelp = meta.disableHelpFlag !== true;
  const hasVersion = meta.version !== undefined && meta.disableVersionFlag !== true;

  if (options.length > 0 || hasHelp || hasVersion) {
    lines.push(`${heading}# Options`);
    lines.push('');
    renderArgList(
      options,
      (key, def) => {
        // The long form and its placeholder share one code span, as
        // clap-markdown renders them: `--config <CONFIG>`.
        const value =
          def.type !== 'boolean' && def.action !== 'count'
            ? ` ${valuePlaceholder(key, def)}`
            : '';
        const long = `\`--${def.long ?? key}${value}\``;
        return def.short ? `\`-${def.short}\`, ${long}` : long;
      },
      lines,
    );
    const builtins: string[] = [];
    if (hasHelp) {
      builtins.push('* `-h`, `--help` - Print help');
    }
    if (hasVersion) {
      builtins.push('* `-V`, `--version` - Print version');
    }
    if (builtins.length > 0) {
      // The list above already ended with a blank line, so reopen it.
      lines.splice(lines.length - 1, 0, ...builtins);
    }
  }

  const after = meta.afterLongHelp ?? meta.afterHelp;
  if (after) {
    lines.push(esc(after));
    lines.push('');
  }

  for (const [name, sub] of subs) {
    renderCommand(sub, [...path, name], depth + 1, lines);
  }
}

/**
 * Render the whole command tree as one markdown document.
 *
 * ```ts
 * writeFileSync('docs/cli.md', renderMarkdownHelp(command));
 * ```
 */
export function renderMarkdownHelp(command: CommandDef, opts?: MarkdownOptions): string {
  const name = opts?.name ?? command.meta.binName ?? command.meta.name;
  const lines: string[] = [];

  if (opts?.title !== undefined) {
    lines.push(`# ${opts.title}`);
    lines.push('');
  }

  renderCommand(command, [name], opts?.title === undefined ? 1 : 2, lines);

  if (opts?.footer !== undefined) {
    lines.push(opts.footer);
    lines.push('');
  }

  // Collapse the runs of blank lines the section joins leave behind.
  return `${lines.join('\n').replaceAll(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}
