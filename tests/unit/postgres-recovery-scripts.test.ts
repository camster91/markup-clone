import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const backup = () => readFileSync(resolve('scripts/backup-postgres.sh'), 'utf8');
const restore = () => readFileSync(resolve('scripts/restore-postgres.sh'), 'utf8');

describe('PostgreSQL recovery scripts', () => {
  it('creates a private custom-format backup and verifies it before publishing', () => {
    const source = backup();
    expect(source).toContain('umask 077');
    expect(source).toContain('pg_dump');
    expect(source).toContain('--format=custom');
    expect(source).toContain('pg_restore --list');
    expect(source).toContain('sha256sum');
    expect(source).toContain('mv -- "$TEMP_PATH" "$BACKUP_PATH"');
    expect(source).not.toMatch(/pg_dump[^\n]*\$DATABASE_URL/);
  });

  it('requires exact database confirmation, integrity verification, and explicit replacement opt-in', () => {
    const source = restore();
    expect(source).toContain('RESTORE_CONFIRM_DATABASE');
    expect(source).toContain('ALLOW_NONEMPTY_RESTORE');
    expect(source).toContain('sha256sum -c');
    expect(source).toContain('--clean');
    expect(source).toContain('--if-exists');
    expect(source).not.toMatch(/pg_restore[^\n]*\$DATABASE_URL/);
  });

  it('mounts an explicit recovery directory in local and VPS runtime definitions', () => {
    const compose = readFileSync(resolve('docker-compose.yml'), 'utf8');
    const deploy = readFileSync(resolve('scripts/deploy.sh'), 'utf8');
    const dockerfile = readFileSync(resolve('Dockerfile'), 'utf8');
    expect(compose).toContain('backups:/data/backups');
    expect(deploy).toContain('BACKUPS_DIR="/data/markup-clone/backups"');
    expect(deploy).toContain('-v "$BACKUPS_DIR:/data/backups"');
    expect(dockerfile).toContain('postgresql16-client');
    expect(dockerfile).not.toMatch(/\n\s*postgresql-client\s/);
  });

  it('documents the five operational release drills and approval boundary', () => {
    const runbook = readFileSync(resolve('docs/DEPLOY-RUNBOOK.md'), 'utf8');
    for (const heading of ['Backup drill', 'Restore drill', 'Rollback drill', 'Observability drill', 'Rate-limit drill']) {
      expect(runbook).toContain(heading);
    }
    expect(runbook).toContain('Production execution requires Cameron');
  });
});
