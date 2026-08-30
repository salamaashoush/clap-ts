"""Typecheck every TypeScript example in the README.

Each fenced ts block becomes a namespace in a throwaway source file, so tsc
sees them all. Imports are stripped and re-supplied from the real entry points,
and a name the surrounding prose introduced is declared only when the snippet
does not define it itself.

Run through `bun run check:readme`.
"""
import re, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent

def strip_imports(src: str) -> str:
    """Drop whole import statements, single or multi line."""
    out, i, lines = [], 0, src.split('\n')
    while i < len(lines):
        line = lines[i]
        if line.startswith('import '):
            # a multi-line import runs until the line closing it
            while i < len(lines) and not re.search(r"from '[^']+';?\s*$|^import '[^']+';?\s*$", lines[i]):
                i += 1
            i += 1
            continue
        out.append(line)
        i += 1
    return '\n'.join(out)

# Names the prose introduces before a snippet uses them. Only declared when the
# snippet does not define the name itself.
AMBIENT = {
    'connectToDatabase': 'declare function connectToDatabase(...a: any[]): any;',
    'Database': 'declare type Database = any;',
    'startServer': 'declare function startServer(...a: any[]): any;',
    'heavyDeployCommand': 'declare const heavyDeployCommand: any;',
    'require': 'declare function require(m: string): any;',
    'rows': 'declare const rows: any[];',
    'ctx': 'declare const ctx: any;',
    'fetchThings': 'declare function fetchThings(): Promise<void>;',
    'parseToml': 'declare function parseToml(t: string): any;',
    'main': 'declare const main: any;',
    'root': 'declare const root: any;',
    'rootCommand': 'declare const rootCommand: any;',
    'command': 'declare const command: any;',
    'expect': 'declare function expect(v: any): any;',
}

def ambient_for(block: str) -> str:
    out = []
    for name, decl in AMBIENT.items():
        if not re.search(rf'\b{name}\b', block):
            continue
        if re.search(rf'\b(?:const|let|var|function|type|interface)\s+{name}\b', block):
            continue
        out.append(decl)
    return ' '.join(out)
HEAD = """import { defineCommand, defineArgs, defineArg, runMain, runCommand, parseArgs, validate, renderHelp, CliParseError, subCommandsOf, hasSubCommands, possibleValues } from './index.js';
import { generateCompletions, withCompletions } from './completions.js';
import { renderManPage, generateManPages } from './man.js';
import { renderMarkdownHelp } from './markdown.js';
import { configOptions, loadConfig } from './config.js';
import { runCli, captureArgs } from './testing.js';
import { expandArgFiles, readPathOrStdin } from './argfile.js';
import { pluginSubCommands } from './plugins.js';
import { withInstallers } from './install.js';
import { toSpecJson } from './spec.js';
import { table, keyValue, tree } from './output.js';
import { loggerFrom } from './log.js';
import { spinner, progressBar } from './progress.js';
import { promptMissing, input, confirm, select, multiselect, password, scriptedIO } from './prompt.js';
import { writeFileSync } from 'node:fs';
"""

blocks = re.findall(r'```ts\n(.*?)```', (ROOT / 'README.md').read_text(), re.S)
parts, kept = [], 0
for i, block in enumerate(blocks):
    if not any(k in block for k in ('defineCommand({', 'defineArgs(', 'runMain(', 'import ')):
        continue
    kept += 1
    body = strip_imports(block)
    # An async wrapper so a snippet may use await, as the prose shows.
    parts.append(
        f"// ---- README block {i} ----\nnamespace B{i} {{\n{ambient_for(body)}\n"
        f"export async function example(): Promise<void> {{\n{body}\n}}\n}}\n"
    )

(ROOT / 'src/__readme_check.ts').write_text(HEAD + '\n'.join(parts))
print(f'{kept} blocks extracted')


import subprocess, sys

check = subprocess.run(
    ['npx', 'tsc', '--noEmit', '-p', 'tsconfig.test.json'],
    cwd=ROOT, capture_output=True, text=True,
)
(ROOT / 'src/__readme_check.ts').unlink(missing_ok=True)

failures = [l for l in check.stdout.splitlines() if '__readme_check' in l]
if failures:
    print('\n'.join(failures))
    sys.exit(1)
print('all README examples typecheck')
