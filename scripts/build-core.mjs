import { rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptsDir, '..');
const packageDir = path.join(repoRoot, 'packages', 'markup-core');
const outputDir = path.join(packageDir, 'dist');
const tscEntrypoint = path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');

// Keep package output deterministic without depending on rm, bash, or a
// platform-specific node_modules/.bin launcher.
rmSync(outputDir, { recursive: true, force: true });

const result = spawnSync(
  process.execPath,
  [tscEntrypoint, '-p', path.join(packageDir, 'tsconfig.json')],
  { cwd: repoRoot, stdio: 'inherit' }
);

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

console.log(`@markup/core built -> ${outputDir}`);
