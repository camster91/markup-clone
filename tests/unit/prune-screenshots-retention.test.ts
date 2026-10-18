// Runs the real scripts/prune-screenshots.sh with a fake `docker` shim on
// PATH. The shim records every psql call and answers the survivor query
// from a fixture, so the test pins the script's retention rules without a
// database:
//
//   - the Screenshot DELETE must never touch pinned screenshots, uploaded
//     images, or PDF review pages (Pin/Comment CASCADE from Screenshot, so
//     an unguarded DELETE erases client feedback);
//   - file deletion must fail closed when the survivor list can't be read;
//   - the survivor query must actually run (`-F''` collapsed to `-F` and
//     swallowed `-c`, so psql read stdin and returned nothing).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  chmodSync,
  utimesSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(__dirname, '../../scripts/prune-screenshots.sh');

// Fake docker: `docker exec <container> psql ARGS...`. Writes each call's
// args to $SHIM_LOG.<n>. A SELECT prints $SHIM_SURVIVORS (or fails when
// $SHIM_SELECT_FAIL=1); anything else prints "DELETE 0".
const SHIM = `#!/usr/bin/env bash
shift 3
n=$(ls "$SHIM_LOG".* 2>/dev/null | wc -l)
printf '%s\\x1f' "$@" > "$SHIM_LOG.$(printf '%03d' "$n")"
for a in "$@"; do
  if [ "$a" = "-F" ]; then echo "psql: -F swallowed the next flag" >&2; exit 2; fi
done
sql=""
while [ $# -gt 0 ]; do
  if [ "$1" = "-c" ]; then sql="$2"; break; fi
  shift
done
if [ -z "$sql" ]; then echo "psql: no -c query" >&2; exit 2; fi
case "$sql" in
  SELECT*)
    if [ "\${SHIM_SELECT_FAIL:-}" = "1" ]; then exit 1; fi
    cat "$SHIM_SURVIVORS"
    ;;
  *) echo "DELETE 0" ;;
esac
`;

let dir: string;
let shots: string;
let shimLog: string;
let survivors: string;

function oldFile(name: string) {
  const p = join(shots, name);
  writeFileSync(p, 'png');
  const t = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
  utimesSync(p, t, t);
}

function run(env: Record<string, string> = {}) {
  return spawnSync('bash', [SCRIPT], {
    input: '',
    encoding: 'utf8',
    timeout: 20_000,
    env: {
      ...process.env,
      PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
      SCREENSHOT_DIR: shots,
      LOG_FILE: join(dir, 'prune.log'),
      SHIM_LOG: shimLog,
      SHIM_SURVIVORS: survivors,
      ...env,
    },
  });
}

// One file per psql call (SQL can span lines), in call order.
function psqlCalls(): string[][] {
  return readdirSync(dir)
    .filter((name) => name.startsWith('psql.log.'))
    .sort()
    .map((name) => readFileSync(join(dir, name), 'utf8').split('\x1f').filter(Boolean));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'prune-test-'));
  shots = join(dir, 'shots');
  mkdirSync(shots);
  mkdirSync(join(dir, 'bin'));
  const shim = join(dir, 'bin', 'docker');
  writeFileSync(shim, SHIM);
  chmodSync(shim, 0o755);
  shimLog = join(dir, 'psql.log');
  survivors = join(dir, 'survivors.txt');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('prune-screenshots.sh retention', () => {
  it('only deletes unpinned website screenshots, never uploads or PDF pages', () => {
    writeFileSync(survivors, '');
    const res = run();
    expect(res.status).toBe(0);

    const deleteSql = psqlCalls()
      .map((args) => args[args.indexOf('-c') + 1])
      .find((sql) => sql?.includes('DELETE FROM "Screenshot"'));
    expect(deleteSql).toBeDefined();
    expect(deleteSql).toMatch(/NOT EXISTS \(SELECT 1 FROM "Pin"/);
    expect(deleteSql).toMatch(/"reviewAssetId" IS NULL/);
    expect(deleteSql).toMatch(/NOT LIKE '\/uploads\/%'/);
  });

  it('keeps files still referenced by the DB and deletes the rest', () => {
    oldFile('kept.png');
    oldFile('orphan.png');
    writeFileSync(survivors, 'kept.png\n');
    const res = run();
    expect(res.status).toBe(0);
    expect(readdirSync(shots)).toEqual(['kept.png']);
  });

  it('never touches comment attachments in the attachments/ subdirectory', () => {
    // Pasted-image attachments are .png files too; they live in
    // <screenshots>/attachments/ and are not Screenshot rows.
    mkdirSync(join(shots, 'attachments'));
    const att = join(shots, 'attachments', 'pasted.png');
    writeFileSync(att, 'png');
    const t = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
    utimesSync(att, t, t);
    oldFile('orphan.png');
    writeFileSync(survivors, '');
    const res = run();
    expect(res.status).toBe(0);
    expect(readdirSync(shots)).toEqual(['attachments']);
    expect(readdirSync(join(shots, 'attachments'))).toEqual(['pasted.png']);
  });

  it('deletes no files when the survivor query fails', () => {
    oldFile('pinned.png');
    oldFile('orphan.png');
    writeFileSync(survivors, '');
    const res = run({ SHIM_SELECT_FAIL: '1' });
    expect(res.status).toBe(1);
    expect(readdirSync(shots).sort()).toEqual(['orphan.png', 'pinned.png']);
  });

  it('runs the survivor query in DRY_RUN mode without deleting anything', () => {
    oldFile('kept.png');
    oldFile('orphan.png');
    writeFileSync(survivors, 'kept.png\n');
    const res = run({ DRY_RUN: '1' });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('Would delete');
    expect(res.stdout).toContain('orphan.png');
    expect(res.stdout).not.toMatch(/Would delete: .*kept\.png/);
    expect(readdirSync(shots).sort()).toEqual(['kept.png', 'orphan.png']);
    // Only the read-only survivor SELECT runs in a dry run.
    const sqls = psqlCalls().map((args) => args[args.indexOf('-c') + 1]);
    expect(sqls.every((sql) => sql.startsWith('SELECT'))).toBe(true);
  });
});
