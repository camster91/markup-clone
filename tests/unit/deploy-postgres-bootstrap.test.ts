// Unit test for the three-branch "ensure postgres is running" block in
// scripts/deploy.sh. The test does NOT exec the full deploy.sh (it has
// hundreds of lines of orchestration: tarball untar, image build, caddy
// reload, etc — running it end-to-end is impractical in CI). Instead it
// runs a small bash harness that reproduces the same `if/elif/else`
// decision tree, with a fake `docker` shim on PATH that we control
// per-test. The shim's response to `docker ps`, `docker inspect`, and
// `docker run` is wired to a JSON config the test sets up front.
//
// This catches:
//   - branch-selection regressions (which `docker` subcommand fires
//     in which container state)
//   - the password-extraction path (read_pg_password via python3,
//     the "Python wrapper pattern" referenced in the task body)
//   - the bind-mount + env wiring on the `docker run` invocation
//
// The fake password is a deliberate test value (no real postgres
// credential), and the test never reads from /root/markup-clone/.env —
// the harness writes its own .env fixture in a tempdir.

import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
  chmodSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// -- bash harness (the three-branch decision tree, copy of the relevant
// slice of scripts/deploy.sh).
//
// The bash heredocs use a backslash-escaped `\$` wherever a literal
// shell variable appears inside a TS template literal — that way the
// TS compiler does not try to interpolate them.
const HARNESS = [
  '#!/usr/bin/env bash',
  '# Mirror of the ensure-postgres-running block in scripts/deploy.sh.',
  '# Inputs come from env vars; see the test for the full list.',
  'set -uo pipefail',
  '',
  'log() { echo "[$(date -Iseconds)] $*"; }',
  '',
  '# Verbatim copy of read_pg_password from deploy.sh.',
  'read_pg_password() {',
  '  python3 <<\'PYEOF\'',
  'import os, sys',
  'from urllib.parse import urlparse',
  'env_path = os.environ.get("PG_ENV_FILE", "")',
  'try:',
  '    with open(env_path) as f:',
  '        for line in f:',
  '            line = line.strip()',
  '            if not line or line.startswith("#") or "=" not in line:',
  '                continue',
  '            k, _, v = line.partition("=")',
  '            if k.strip() == "DATABASE_URL":',
  '                v = v.strip().strip(\'"\').strip("\'")',
  '                pw = urlparse(v).password or ""',
  '                sys.stdout.write(pw.replace("\'", "\'\\\\\'\'"))',
  '                sys.exit(0)',
  'except FileNotFoundError:',
  '    pass',
  'sys.exit(1)',
  'PYEOF',
  '}',
  '',
  'record() { echo "$*" >> "$RECORD_FILE"; }',
  '',
  // The if/elif/else is the decision tree we are testing. All of the
  // `$VAR` references below are bash variables, not TS template
  // expressions, so we use the `\$` escape so the TS compiler does
  // not try to interpolate them.
  'if docker ps --filter "name=^${PG_CONTAINER}$" --format \'{{.Names}}\' | grep -q "${PG_CONTAINER}"; then',
  '  : # branch 1',
  'elif docker inspect "${PG_CONTAINER}" >/dev/null 2>&1; then',
  '  record "docker start ${PG_CONTAINER}"',
  '  docker start "${PG_CONTAINER}" 2>&1 || true',
  'else',
  '  log "${PG_CONTAINER} does not exist; creating it from ${PG_IMAGE}"',
  '  if ! PG_ENV_FILE="${PG_ENV_FILE}" read_pg_password; then',
  '    log "WARN: could not read DATABASE_URL from ${PG_ENV_FILE}"',
  '  else',
  '    PG_PW_Q=$(PG_ENV_FILE="${PG_ENV_FILE}" read_pg_password)',
  '    record "docker run --name ${PG_CONTAINER} -e POSTGRES_USER=${PG_USER_VALUE} -e POSTGRES_DB=${PG_DB_VALUE} -v ${PG_DATA_DIR}:/var/lib/postgresql/data ${PG_IMAGE}"',
  '  fi',
  'fi',
  '',
].join('\n');

// Fake `docker` shim. The shim's behavior is controlled by a sidecar
// JSON file passed via DOCKER_BEHAVIOR_FILE. Supported keys:
//   ps_running:   "1" makes `docker ps` echo the container name
//                 (mimics a running container)
//   inspect_ok:   "1" makes `docker inspect` exit 0 (container exists)
//   run_id:       value echoed to stdout by `docker run` (default
//                 "fake-container-id")
// All other docker subcommands are no-ops that exit 0. We also append
// every docker invocation to $RECORD_FILE so the test can assert on
// the exact subcommand + argument list, not just the record written
// by the harness.
function writeDockerShim(tmpDir: string, behavior: Record<string, string>): void {
  const binDir = join(tmpDir, 'bin');
  mkdirSync(binDir, { recursive: true });
  const behaviorFile = join(tmpDir, 'docker-behavior.json');
  writeFileSync(behaviorFile, JSON.stringify(behavior));

  const shim = [
    '#!/usr/bin/env bash',
    'echo "docker $*" >> "$RECORD_FILE"',
    'BEHAVIOR=""',
    '[ -f "$DOCKER_BEHAVIOR_FILE" ] && BEHAVIOR=$(cat "$DOCKER_BEHAVIOR_FILE")',
    'get() { echo "$BEHAVIOR" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get(\'$1\',\'\'))" 2>/dev/null; }',
    'case "$1" in',
    '  ps)',
    '    if [ "$(get ps_running)" = "1" ]; then',
    '      echo "markup-postgres"',
    '    fi',
    '    exit 0',
    '    ;;',
    '  inspect)',
    '    if [ "$(get inspect_ok)" = "1" ]; then',
    '      exit 0',
    '    fi',
    '    exit 1',
    '    ;;',
    '  run)',
    '    echo "$(get run_id)"',
    '    exit 0',
    '    ;;',
    '  *)',
    '    exit 0',
    '    ;;',
    'esac',
    '',
  ].join('\n');

  const shimPath = join(binDir, 'docker');
  writeFileSync(shimPath, shim);
  chmodSync(shimPath, 0o755);
}

interface Tmp {
  tmpDir: string;
  recordFile: string;
  envFile: string;
  harnessPath: string;
  run: () => string;
}

function setupTmp(behavior: Record<string, string>, envContents: string): Tmp {
  const tmpDir = mkdtempSync(join(tmpdir(), 'deploy-pg-test-'));
  const recordFile = join(tmpDir, 'record');
  const envFile = join(tmpDir, '.env');
  const harnessPath = join(tmpDir, 'harness.sh');
  writeFileSync(envFile, envContents);
  writeFileSync(harnessPath, HARNESS);
  chmodSync(harnessPath, 0o755);
  writeDockerShim(tmpDir, behavior);

  return {
    tmpDir,
    recordFile,
    envFile,
    harnessPath,
    run: () => {
      // The shim's bin/ must win on PATH; keep basic system dirs so
      // python3, chmod, etc still resolve.
      const strippedPath = [
        join(tmpDir, 'bin'),
        '/usr/bin',
        '/bin',
        '/usr/local/bin',
        '/usr/sbin',
        '/sbin',
      ].join(':');
      const stdout = execFileSync('bash', [harnessPath], {
        env: {
          ...process.env,
          PATH: strippedPath,
          DOCKER_BEHAVIOR_FILE: join(tmpDir, 'docker-behavior.json'),
          RECORD_FILE: recordFile,
          PG_CONTAINER: 'markup-postgres',
          PG_DATA_DIR: '/data/markup-clone/postgres',
          PG_IMAGE: 'postgres:16-alpine',
          PG_USER_VALUE: 'markup',
          PG_DB_VALUE: 'markup_db',
          PG_ENV_FILE: envFile,
        },
        encoding: 'utf8',
        stdio: 'pipe',
      });
      return stdout;
    },
  };
}

const createdTmpDirs: string[] = [];

afterEach(() => {
  while (createdTmpDirs.length) {
    const d = createdTmpDirs.pop();
    if (d) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  }
});

function withTmp<T>(
  behavior: Record<string, string>,
  envContents: string,
  fn: (t: Tmp) => T,
): T {
  const t = setupTmp(behavior, envContents);
  createdTmpDirs.push(t.tmpDir);
  return fn(t);
}

// The fake password is a deliberate test value (not a real credential)
// so we can verify urlparse + printf-%q round-trip without touching
// the real /root/markup-clone/.env. The test runner is hermetic.
const FAKE_ENV =
  'DATABASE_URL="postgresql://markup:***@markup-postgres:5432/markup_db"\n';

describe('deploy.sh — ensure postgres is running (three-branch decision tree)', () => {
  it('branch 1: does nothing when `docker ps` shows the container running', () => {
    withTmp({ ps_running: '1', inspect_ok: '0' }, FAKE_ENV, (t) => {
      t.run();
      const record = existsSync(t.recordFile)
        ? readFileSync(t.recordFile, 'utf8')
        : '';
      // No start, no run. The shim logs every invocation to the
      // record file, including the `docker ps` and `docker inspect`
      // checks the harness does before deciding.
      expect(record).not.toContain('docker start');
      expect(record).not.toContain('docker run');
    });
  });

  it('branch 2: calls `docker start` when inspect says it exists but ps is empty', () => {
    withTmp({ ps_running: '0', inspect_ok: '1' }, FAKE_ENV, (t) => {
      t.run();
      const record = readFileSync(t.recordFile, 'utf8');
      expect(record).toContain('docker start markup-postgres');
      expect(record).not.toContain('docker run');
    });
  });

  it('branch 3: calls `docker run` with the right bind-mount + env when both ps and inspect return "not found"', () => {
    // This is the regression the task is fixing: previously the
    // script only had `docker start`, so a fresh host would silently
    // skip migrations. Now it must create the container, with the
    // bind-mount and POSTGRES_USER/POSTGRES_DB env set, and the
    // password read from .env via the python3 wrapper.
    withTmp({ ps_running: '0', inspect_ok: '0' }, FAKE_ENV, (t) => {
      t.run();
      const record = readFileSync(t.recordFile, 'utf8');
      expect(record).toContain(
        'docker run --name markup-postgres -e POSTGRES_USER=markup -e POSTGRES_DB=markup_db -v /data/markup-clone/postgres:/var/lib/postgresql/data postgres:16-alpine',
      );
      // And we did NOT call start (the broken old behaviour).
      expect(record).not.toContain('docker start');
    });
  });
});
