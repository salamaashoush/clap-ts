/**
 * Verify the artifact npm would publish.
 *
 * Packs the tarball, installs it into a scratch directory as a real dependency,
 * then imports every entry in the exports map and runs a command through the
 * installed copy. Catches what a repo-local test cannot: a missing file in
 * `files`, an exports path pointing at something that was never built, or a
 * subpath that resolves for TypeScript but not at runtime.
 *
 * Run through `bun run check:package`.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const subpaths = Object.keys(pkg.exports).map((p) => (p === '.' ? '' : p.slice(1)));

const scratch = mkdtempSync(join(tmpdir(), 'clap-ts-package-'));
const failures = [];

function run(command, args, cwd) {
  try {
    return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    // A raw execFileSync stack says nothing useful about a packaging problem.
    const detail = [error.stdout, error.stderr].filter(Boolean).join('').trim();
    throw new Error(`${command} ${args.join(' ')} failed:\n${detail || error.message}`);
  }
}

try {
  const tarball = join(scratch, run('npm', ['pack', '--silent', `--pack-destination=${scratch}`], ROOT).trim());
  if (!existsSync(tarball)) {
    throw new Error(`npm pack did not produce ${tarball}`);
  }

  // Every exports target must actually be inside the tarball.
  const packed = new Set(
    run('tar', ['tzf', tarball], ROOT)
      .split('\n')
      .map((line) => line.replace(/^package\//, '').trim()),
  );
  for (const [name, entry] of Object.entries(pkg.exports)) {
    for (const [kind, path] of Object.entries(entry)) {
      if (!packed.has(path.replace(/^\.\//, ''))) {
        failures.push(`exports["${name}"].${kind} -> ${path} is not in the tarball`);
      }
    }
  }

  const consumer = join(scratch, 'consumer');
  run('mkdir', ['-p', consumer], scratch);
  writeFileSync(
    join(consumer, 'package.json'),
    JSON.stringify({ name: 'consumer', type: 'module', private: true }, null, 2),
  );
  run('npm', ['install', '--silent', '--no-audit', '--no-fund', tarball], consumer);

  writeFileSync(
    join(consumer, 'smoke.mjs'),
    `const subpaths = ${JSON.stringify(subpaths)};
const problems = [];
for (const p of subpaths) {
  const specifier = 'clap-ts' + p;
  try {
    const mod = await import(specifier);
    if (Object.keys(mod).length === 0) problems.push(specifier + ' exports nothing');
  } catch (error) {
    problems.push(specifier + ': ' + String(error.message).split('\\n')[0]);
  }
}

// And the installed copy has to actually parse and run something.
const { defineCommand } = await import('clap-ts');
const { runCli } = await import('clap-ts/testing');
const command = defineCommand({
  meta: { name: 'demo', version: '1.0.0' },
  args: { port: { type: 'number', default: 3000 } },
  run(ctx) { ctx.stdout.write('port=' + ctx.args.port + '\\n'); },
});
const result = await runCli(command, ['--port', '8080']);
if (result.stdout !== 'port=8080\\n') problems.push('running the installed package gave ' + JSON.stringify(result.stdout));
if (result.exitCode !== 0) problems.push('exit code ' + result.exitCode);

const help = await runCli(command, ['--help']);
if (!help.plainStdout.includes('Usage: demo')) problems.push('help output looks wrong');

console.log(JSON.stringify(problems));
`,
  );

  const reported = JSON.parse(run('node', ['smoke.mjs'], consumer).trim());
  failures.push(...reported);
  console.log(`packed ${packed.size} files, checked ${subpaths.length} entry points`);
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error('\npackage check failed:');
  for (const failure of failures) {
    console.error(`  ${failure}`);
  }
  process.exit(1);
}
console.log('the published artifact imports and runs');
