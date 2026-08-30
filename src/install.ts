/**
 * Put generated completions and man pages where the system will find them.
 *
 * ```ts
 * import { withInstallers } from 'clap-ts/install';
 *
 * runMain(withInstallers(main));
 * // my-tool completions install zsh
 * // my-tool man install
 * ```
 *
 * Everything respects `XDG_DATA_HOME`, and nothing is written until the target
 * directory is created, so a dry run can report the path without touching disk.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { CommandDef, Shell } from './types.js';
import { generateCompletions } from './completions.js';
import { generateManPages } from './man.js';

const XDG_DATA = process.env['XDG_DATA_HOME'] ?? join(homedir(), '.local', 'share');
const XDG_CONFIG = process.env['XDG_CONFIG_HOME'] ?? join(homedir(), '.config');

/** Where a shell looks for user completions, and what the file must be called. */
export interface CompletionTarget {
  readonly dir: string;
  readonly file: string;
  /** A line the user must add themselves, when sourcing is not automatic. */
  readonly manualStep?: string;
}

/**
 * The per-user completion path for a shell.
 *
 * bash, zsh and fish load these directories on their own. powershell, elvish
 * and nushell have no drop-in directory, so those report a line to add to the
 * profile instead.
 */
export function completionTarget(shell: Shell, binaryName: string): CompletionTarget {
  switch (shell) {
    case 'bash':
      return { dir: join(XDG_DATA, 'bash-completion', 'completions'), file: binaryName };
    case 'zsh':
      return {
        dir: join(XDG_DATA, 'zsh', 'site-functions'),
        file: `_${binaryName}`,
        manualStep: `add ${join(XDG_DATA, 'zsh', 'site-functions')} to $fpath before compinit`,
      };
    case 'fish':
      return { dir: join(XDG_CONFIG, 'fish', 'completions'), file: `${binaryName}.fish` };
    case 'powershell':
      return {
        dir: join(XDG_CONFIG, 'powershell', 'completions'),
        file: `${binaryName}.ps1`,
        manualStep: `add \`. ${join(XDG_CONFIG, 'powershell', 'completions', `${binaryName}.ps1`)}\` to $PROFILE`,
      };
    case 'elvish':
      return {
        dir: join(XDG_CONFIG, 'elvish', 'lib'),
        file: `${binaryName}.elv`,
        manualStep: `add \`use ${binaryName}\` to ~/.config/elvish/rc.elv`,
      };
    case 'nushell':
      return {
        dir: join(XDG_CONFIG, 'nushell', 'completions'),
        file: `${binaryName}.nu`,
        manualStep: `add \`source ${join(XDG_CONFIG, 'nushell', 'completions', `${binaryName}.nu`)}\` to your config`,
      };
  }
}

/** What an install did, or would have done. */
export interface InstallResult {
  readonly paths: readonly string[];
  readonly manualStep?: string;
  readonly dryRun: boolean;
}

export interface InstallOptions {
  /** Report the paths without writing anything. */
  readonly dryRun?: boolean;
  /** Write here instead of the per-user location. */
  readonly dir?: string;
  /** Binary name; defaults to the command's binName or name. */
  readonly binaryName?: string;
}

function write(dir: string, file: string, contents: string, dryRun: boolean): string {
  const path = join(dir, file);
  if (!dryRun) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, contents);
  }
  return path;
}

/** Write the completion script for one shell to its per-user location. */
export function installCompletions(
  command: CommandDef,
  shell: Shell,
  opts?: InstallOptions,
): InstallResult {
  const binaryName = opts?.binaryName ?? command.meta.binName ?? command.meta.name;
  const target = completionTarget(shell, binaryName);
  const dir = opts?.dir ?? target.dir;
  const dryRun = opts?.dryRun === true;

  const path = write(dir, target.file, generateCompletions(command, shell, binaryName), dryRun);
  return {
    paths: [path],
    ...(target.manualStep === undefined ? {} : { manualStep: target.manualStep }),
    dryRun,
  };
}

/** Write a man page per command into the per-user man directory. */
export function installManPages(command: CommandDef, opts?: InstallOptions): InstallResult {
  const binaryName = opts?.binaryName ?? command.meta.binName ?? command.meta.name;
  const dryRun = opts?.dryRun === true;
  const pages = generateManPages(command, { name: binaryName });
  const dir = opts?.dir ?? join(XDG_DATA, 'man', 'man1');

  const paths: string[] = [];
  for (const [file, roff] of pages) {
    paths.push(write(dir, file, roff, dryRun));
  }
  return {
    paths,
    manualStep: `add ${join(XDG_DATA, 'man')} to $MANPATH if your system does not read it already`,
    dryRun,
  };
}

const SHELLS: readonly Shell[] = ['bash', 'zsh', 'fish', 'powershell', 'elvish', 'nushell'];

/**
 * Add `completions` and `man` subcommands that both print and install.
 *
 * `tool completions bash` writes the script to stdout as before;
 * `tool completions install bash` puts it where the shell will find it.
 */
export function withInstallers(rootCommand: CommandDef<any>): CommandDef<any> {
  const completions: CommandDef = {
    meta: {
      name: 'completions',
      description: 'Print or install a shell completion script',
      aliases: ['completion'],
      // `completions install zsh` names the shell on the subcommand, so the
      // shell positional here is only required when printing.
      subcommandNegatesReqs: true,
    },
    args: {
      shell: {
        type: 'positional',
        valueName: 'SHELL',
        required: true,
        valueParser: [...SHELLS],
        description: `Target shell: ${SHELLS.join(', ')}`,
      },
    },
    subCommands: {
      install: {
        meta: { name: 'install', description: 'Write the script where the shell will find it' },
        args: {
          shell: {
            type: 'positional',
            valueName: 'SHELL',
            required: true,
            valueParser: [...SHELLS],
            description: 'Shell to install for',
          },
          dryRun: { type: 'boolean', description: 'Report the path without writing' },
        },
        run({ args, stdout }) {
          const result = installCompletions(rootCommand, args['shell'] as Shell, {
            dryRun: args['dryRun'] === true,
          });
          const verb = result.dryRun ? 'would write' : 'wrote';
          stdout.write(`${verb} ${result.paths[0]!}\n`);
          if (result.manualStep !== undefined) {
            stdout.write(`note: ${result.manualStep}\n`);
          }
        },
      },
    },
    run({ args, stdout }) {
      stdout.write(generateCompletions(rootCommand, args['shell'] as Shell));
    },
  };

  const man: CommandDef = {
    meta: { name: 'man', description: 'Print or install man pages' },
    args: {
      dryRun: { type: 'boolean', description: 'Report the paths without writing' },
    },
    subCommands: {
      install: {
        meta: { name: 'install', description: 'Write man pages where man will find them' },
        args: { dryRun: { type: 'boolean', description: 'Report the paths without writing' } },
        run({ args, stdout }) {
          const result = installManPages(rootCommand, { dryRun: args['dryRun'] === true });
          const verb = result.dryRun ? 'would write' : 'wrote';
          for (const path of result.paths) {
            stdout.write(`${verb} ${path}\n`);
          }
          if (result.manualStep !== undefined) {
            stdout.write(`note: ${result.manualStep}\n`);
          }
        },
      },
    },
    run({ stdout }) {
      for (const roff of generateManPages(rootCommand).values()) {
        stdout.write(roff);
      }
    },
  };

  return {
    ...rootCommand,
    subCommands: { ...rootCommand.subCommands, completions, man },
    lazySubCommands: rootCommand.lazySubCommands,
  };
}
