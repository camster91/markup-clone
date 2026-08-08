import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const SCRIPT = resolve('scripts/apply-migration.sh');
const DEPLOY_SCRIPT = resolve('scripts/deploy.sh');

function bashPath(): string | null {
  const candidates = process.platform === 'win32'
    ? ['C:\\Program Files\\Git\\bin\\bash.exe', 'bash']
    : ['bash'];
  return candidates.find((candidate) =>
    existsSync(candidate) || spawnSync(candidate, ['--version'], { stdio: 'ignore' }).status === 0
  ) ?? null;
}

function toBashPath(path: string): string {
  if (process.platform !== 'win32') return path;
  return `/${path[0].toLowerCase()}${path.slice(2).replaceAll('\\', '/')}`;
}

const bash = bashPath();
const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

function fixture(migrationExit = 0) {
  const directory = mkdtempSync(join(tmpdir(), 'deploy-migration-'));
  temporaryDirectories.push(directory);
  const binDirectory = join(directory, 'bin');
  const migrationPath = join(directory, 'migration.sql');
  const recordPath = join(directory, 'record.txt');
  mkdirSync(binDirectory);
  writeFileSync(migrationPath, 'CREATE TABLE "SafeMigration" ("id" TEXT PRIMARY KEY);\n');

  const dockerShim = [
    '#!/usr/bin/env bash',
    'set -u',
    'echo "docker $*" >> "$RECORD_FILE"',
    'case " $* " in',
    '  *" exec -i "*) cat >> "$RECORD_FILE"; exit "$MIGRATION_EXIT" ;;',
    '  *) exit 0 ;;',
    'esac',
    '',
  ].join('\n');
  const dockerPath = join(binDirectory, 'docker');
  writeFileSync(dockerPath, dockerShim);
  chmodSync(dockerPath, 0o755);

  const run = (migrationName = '20260808140000_safe_migration') => {
    if (!bash) throw new Error('bash unavailable');
    return spawnSync(bash, [toBashPath(SCRIPT), migrationName, toBashPath(migrationPath)], {
      env: {
        ...process.env,
        PATH: `${toBashPath(binDirectory)}:/usr/bin:/bin`,
        RECORD_FILE: toBashPath(recordPath),
        MIGRATION_EXIT: String(migrationExit),
        PG_CONTAINER: 'markup-postgres',
        PG_USER_VALUE: 'markup',
        PG_DB_VALUE: 'markup_db',
      },
      encoding: 'utf8',
    });
  };

  return {
    recordPath,
    run,
    record: () => existsSync(recordPath) ? readFileSync(recordPath, 'utf8') : '',
  };
}

describe.skipIf(!bash)('fail-fast deploy migration application', () => {
  it('uses one fail-fast transaction so rejected SQL cannot commit its marker', () => {
    const test = fixture(1);
    const result = test.run();

    expect(result.status).not.toBe(0);
    expect(test.record()).toContain('-v ON_ERROR_STOP=1');
    expect(test.record()).toContain('--single-transaction');
    expect(test.record()).toContain('INSERT INTO _prisma_migrations');
    expect(test.record().match(/^docker /gm)).toHaveLength(1);
  });

  it('commits migration SQL and its history marker in one transaction', () => {
    const test = fixture(0);
    const result = test.run();
    expect(result.status).toBe(0);
    expect(test.record().match(/^docker /gm)).toHaveLength(1);
    expect(test.record()).toContain('-v ON_ERROR_STOP=1');
    expect(test.record()).toContain('--single-transaction');
    expect(test.record()).toContain('CREATE TABLE "SafeMigration"');
    expect(test.record()).toContain('INSERT INTO _prisma_migrations');
  });

  it('rejects an invalid migration name before calling Docker', () => {
    const test = fixture(0);
    const result = test.run('unsafe;drop-table');

    expect(result.status).not.toBe(0);
    expect(test.record()).toBe('');
  });
});

describe('deploy migration integration contract', () => {
  it('bootstraps Prisma migration history before discovering applied migrations', () => {
    const source = readFileSync(DEPLOY_SCRIPT, 'utf8');
    const bootstrap = source.indexOf('CREATE TABLE IF NOT EXISTS "_prisma_migrations"');
    const discovery = source.indexOf('SELECT migration_name FROM _prisma_migrations');

    expect(bootstrap).toBeGreaterThan(-1);
    expect(discovery).toBeGreaterThan(bootstrap);
  });

  it('delegates migration execution without suppressing PostgreSQL errors', () => {
    const source = readFileSync(DEPLOY_SCRIPT, 'utf8');

    expect(source).toContain('scripts/apply-migration.sh');
    expect(source).not.toContain('errors below are OK if already applied');
    expect(source).not.toContain('grep -v "^ERROR:"');
  });

  it('does not continue with stale source after a failed Git refresh', () => {
    const source = readFileSync(DEPLOY_SCRIPT, 'utf8');

    expect(source).not.toContain('git pull (optional, will continue with current tree on failure)');
    expect(source).not.toContain('Continuing with current tree');
    expect(source).toContain('fail "git pull --ff-only failed');
  });

  it('does not label a broken Git tree from an unverifiable SHA marker', () => {
    const source = readFileSync(DEPLOY_SCRIPT, 'utf8');

    expect(source).not.toContain('falling back to .last-sha marker');
    expect(source).not.toContain('NEW_TAG="$LAST_SHA"');
    expect(source).toContain('fail "release source must resolve to a valid Git commit"');
  });

  it('does not accept an unverified source tarball', () => {
    const source = readFileSync(DEPLOY_SCRIPT, 'utf8');

    expect(source).not.toContain('TARBALL=');
    expect(source).not.toContain('tar -xzf');
    expect(source).toContain('[ -d "$APP_DIR/.git" ] || fail "release checkout is not a Git repository"');
  });
});
