// Runs the real backup-files.sh, restore-files.sh and nightly-backup.sh
// against temp directories. Until these existed, nothing backed up
// screenshots, uploads, PDF pages or comment attachments, and nothing
// scheduled the database dump either.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  chmodSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPTS = resolve(__dirname, '../../scripts');

let dir: string;
let shots: string;
let backups: string;
let bin: string;

function run(script: string, args: string[] = [], env: Record<string, string> = {}) {
  return spawnSync('bash', [join(SCRIPTS, script), ...args], {
    encoding: 'utf8',
    timeout: 20_000,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      SCREENSHOTS_DIR: shots,
      ATTACHMENTS_DIR: '',
      BACKUP_DIR: backups,
      ...env,
    },
  });
}

function write(rel: string, body: string) {
  const p = join(shots, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, body);
}

function shim(name: string, body: string) {
  const p = join(bin, name);
  writeFileSync(p, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(p, 0o755);
}

function archives(kind = 'files'): string[] {
  return readdirSync(backups)
    .filter((f) => f.startsWith(`markup-${kind}-`) && f.endsWith('.tar'))
    .sort();
}

function members(archive: string): string[] {
  const res = spawnSync('tar', ['-tf', archive], { encoding: 'utf8' });
  return res.stdout.trim().split('\n').sort();
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'file-backup-'));
  shots = join(dir, 'screenshots');
  backups = join(dir, 'backups');
  bin = join(dir, 'bin');
  mkdirSync(shots);
  mkdirSync(bin);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('backup-files.sh', () => {
  it('archives screenshots and attachments, skipping in-flight writes', () => {
    write('shot.png', 'png');
    write('attachments/note.webm', 'webm');
    write('abc.tmp.1234', 'partial capture');
    write('.pdf-asset/page-1.png', 'rendering');

    const res = run('backup-files.sh');
    expect(res.status, res.stderr).toBe(0);
    const [archive] = archives();
    expect(res.stdout.trim()).toBe(join(backups, archive));
    expect(members(join(backups, archive))).toEqual(['./attachments/note.webm', './shot.png']);

    const check = spawnSync('sha256sum', ['-c', `${archive}.sha256`], { cwd: backups });
    expect(check.status).toBe(0);
  });

  it('archives a separately mounted ATTACHMENTS_DIR on its own', () => {
    const attachments = join(dir, 'attachments');
    mkdirSync(attachments);
    writeFileSync(join(attachments, 'voice.webm'), 'webm');
    write('shot.png', 'png');

    const res = run('backup-files.sh', [], { ATTACHMENTS_DIR: attachments });
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout.trim().split('\n')).toHaveLength(2);
    expect(members(join(backups, archives('files')[0]))).toEqual(['./shot.png']);
    expect(members(join(backups, archives('attachments')[0]))).toEqual(['./voice.webm']);
  });

  it('makes one archive when ATTACHMENTS_DIR is inside the screenshots directory', () => {
    write('shot.png', 'png');
    write('attachments/voice.webm', 'webm');
    const res = run('backup-files.sh', [], { ATTACHMENTS_DIR: join(shots, 'attachments') });
    expect(res.status, res.stderr).toBe(0);
    expect(archives('attachments')).toEqual([]);
    expect(members(join(backups, archives('files')[0]))).toEqual(['./attachments/voice.webm', './shot.png']);
  });

  it('refuses a backup directory inside the screenshots directory', () => {
    write('shot.png', 'png');
    const res = run('backup-files.sh', [], { BACKUP_DIR: join(shots, 'backups') });
    expect(res.status).toBe(2);
    expect(existsSync(join(shots, 'backups'))).toBe(false);
  });

  it('skips the archive when there are no files', () => {
    const res = run('backup-files.sh');
    expect(res.status).toBe(0);
    expect(res.stdout).toBe('');
    expect(archives()).toEqual([]);
  });

  it('refuses to run when the disk is too full', () => {
    write('shot.png', 'x'.repeat(64 * 1024));
    shim('df', `printf 'Filesystem 1024-blocks Used Available Capacity Mounted\\nfake 100 99 1 99%% /\\n'`);
    const res = run('backup-files.sh');
    expect(res.status).toBe(5);
    expect(res.stderr).toContain('Not enough free space');
    expect(readdirSync(backups)).toEqual([]);
  });
});

describe('restore-files.sh', () => {
  function backupNow(): string {
    const res = run('backup-files.sh');
    expect(res.status, res.stderr).toBe(0);
    return res.stdout.trim();
  }

  it('requires the target directory to be confirmed', () => {
    write('shot.png', 'png');
    const archive = backupNow();
    expect(run('restore-files.sh', [archive]).status).not.toBe(0);
    expect(run('restore-files.sh', [archive], { RESTORE_CONFIRM_DIR: '/data/elsewhere' }).status).toBe(3);
  });

  it('adds back missing files and never overwrites existing ones', () => {
    write('lost.png', 'original lost');
    write('kept.png', 'original kept');
    write('attachments/voice.webm', 'voice');
    const archive = backupNow();

    rmSync(join(shots, 'lost.png'));
    rmSync(join(shots, 'attachments'), { recursive: true });
    writeFileSync(join(shots, 'kept.png'), 'newer content');

    const res = run('restore-files.sh', [archive], { RESTORE_CONFIRM_DIR: shots });
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toContain('Restored 2 missing files');
    expect(readFileSync(join(shots, 'lost.png'), 'utf8')).toBe('original lost');
    expect(readFileSync(join(shots, 'attachments/voice.webm'), 'utf8')).toBe('voice');
    expect(readFileSync(join(shots, 'kept.png'), 'utf8')).toBe('newer content');
    // The staging directory is cleaned up.
    expect(readdirSync(shots).sort()).toEqual(['attachments', 'kept.png', 'lost.png']);
  });

  it('restores an attachments archive into ATTACHMENTS_DIR', () => {
    const attachments = join(dir, 'attachments');
    mkdirSync(attachments);
    writeFileSync(join(attachments, 'voice.webm'), 'webm');
    const res = run('backup-files.sh', [], { ATTACHMENTS_DIR: attachments });
    expect(res.status, res.stderr).toBe(0);
    const archive = join(backups, archives('attachments')[0]);
    rmSync(join(attachments, 'voice.webm'));

    // Confirming the screenshots directory is not enough for this archive.
    expect(
      run('restore-files.sh', [archive], { ATTACHMENTS_DIR: attachments, RESTORE_CONFIRM_DIR: shots }).status
    ).toBe(3);
    const ok = run('restore-files.sh', [archive], { ATTACHMENTS_DIR: attachments, RESTORE_CONFIRM_DIR: attachments });
    expect(ok.status, ok.stderr).toBe(0);
    expect(readFileSync(join(attachments, 'voice.webm'), 'utf8')).toBe('webm');
    expect(existsSync(join(shots, 'voice.webm'))).toBe(false);
  });

  it('refuses an archive whose checksum does not match', () => {
    write('shot.png', 'png');
    const archive = backupNow();
    writeFileSync(`${archive}.sha256`, `${'0'.repeat(64)}  ${archive.split('/').pop()}\n`);
    const res = run('restore-files.sh', [archive], { RESTORE_CONFIRM_DIR: shots });
    expect(res.status).not.toBe(0);
  });

  it('refuses an archive with absolute paths', () => {
    const outside = join(dir, 'outside.png');
    writeFileSync(outside, 'escape');
    mkdirSync(backups);
    const archive = join(backups, 'markup-files-evil.tar');
    expect(spawnSync('tar', ['-cPf', archive, outside]).status).toBe(0);
    spawnSync('bash', ['-c', `sha256sum markup-files-evil.tar > markup-files-evil.tar.sha256`], { cwd: backups });
    rmSync(outside);

    const res = run('restore-files.sh', [archive], { RESTORE_CONFIRM_DIR: shots });
    expect(res.status).toBe(4);
    expect(existsSync(outside)).toBe(false);
  });
});

describe('nightly-backup.sh', () => {
  const DB_ENV = { DATABASE_URL: 'postgresql://markup:secret@db:5432/markup_db' };

  beforeEach(() => {
    // pg_dump writes a placeholder to --file=; pg_restore --list succeeds.
    shim(
      'pg_dump',
      `for a in "$@"; do case "$a" in --file=*) echo dump > "\${a#--file=}" ;; esac; done
[ "\${PG_DUMP_FAIL:-}" = 1 ] && exit 1
exit 0`
    );
    shim('pg_restore', 'exit 0');
    write('shot.png', 'png');
  });

  function seedOld(name: string) {
    mkdirSync(backups, { recursive: true });
    writeFileSync(join(backups, name), 'old');
    writeFileSync(join(backups, `${name}.sha256`), 'old');
  }

  it('writes both backups and keeps only the newest of each', () => {
    seedOld('markup-20250101T000000Z.dump');
    seedOld('markup-20250102T000000Z.dump');
    seedOld('markup-files-20250101T000000Z.tar');
    seedOld('markup-files-20250102T000000Z.tar');
    seedOld('markup-attachments-20250101T000000Z.tar');
    seedOld('markup-attachments-20250102T000000Z.tar');
    const attachments = join(dir, 'attachments');
    mkdirSync(attachments);
    writeFileSync(join(attachments, 'voice.webm'), 'webm');

    const res = run('nightly-backup.sh', [], {
      ...DB_ENV,
      ATTACHMENTS_DIR: attachments,
      BACKUP_KEEP_DB: '2',
      BACKUP_KEEP_FILES: '2',
    });
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toContain('database backup:');
    expect(res.stdout).toContain('file backup:');

    const left = readdirSync(backups).sort();
    expect(left.filter((f) => /^markup-\d.*\.dump$/.test(f))).toHaveLength(2);
    expect(left.filter((f) => /^markup-files-.*\.tar$/.test(f))).toHaveLength(2);
    expect(left).not.toContain('markup-20250101T000000Z.dump');
    expect(left).not.toContain('markup-20250101T000000Z.dump.sha256');
    expect(left).not.toContain('markup-files-20250101T000000Z.tar');
    expect(left).toContain('markup-20250102T000000Z.dump');
    expect(left).toContain('markup-files-20250102T000000Z.tar');
    expect(archives('attachments')).toHaveLength(2);
    expect(left).not.toContain('markup-attachments-20250101T000000Z.tar');
  });

  it('deletes nothing when a backup fails', () => {
    seedOld('markup-20250101T000000Z.dump');
    seedOld('markup-files-20250101T000000Z.tar');
    const res = run('nightly-backup.sh', [], { ...DB_ENV, PG_DUMP_FAIL: '1', BACKUP_KEEP_DB: '1', BACKUP_KEEP_FILES: '1' });
    expect(res.status).not.toBe(0);
    expect(readdirSync(backups)).toEqual(
      expect.arrayContaining(['markup-20250101T000000Z.dump', 'markup-files-20250101T000000Z.tar'])
    );
    expect(archives()).toEqual(['markup-files-20250101T000000Z.tar']);
  });

  it('rejects a zero or non-numeric retention count', () => {
    expect(run('nightly-backup.sh', [], { ...DB_ENV, BACKUP_KEEP_DB: '0' }).status).toBe(2);
    expect(run('nightly-backup.sh', [], { ...DB_ENV, BACKUP_KEEP_FILES: 'all' }).status).toBe(2);
  });

  it('is scheduled nightly before the prune by install-cron.sh', () => {
    const cron = readFileSync(join(SCRIPTS, 'install-cron.sh'), 'utf8');
    expect(cron).toContain('cat > /etc/cron.d/markup-backup');
    expect(cron).toContain(
      '15 2 * * * root docker exec markup-clone bash /opt/app-scripts/nightly-backup.sh'
    );
  });
});
