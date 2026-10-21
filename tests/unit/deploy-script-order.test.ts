// scripts/deploy.sh runs on the production VPS, so these checks pin two
// properties the 2026-10-21 stand-in dry-runs proved:
//   - the image is built before any migration touches the live database, so a
//     failed build leaves the running app and its schema untouched;
//   - the subnet trust rule is only a fallback when password auth fails, and
//     pg_hba changes are applied with a reload, not a postgres restart.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const deploy = readFileSync(resolve(__dirname, '../../scripts/deploy.sh'), 'utf8');

describe('deploy.sh', () => {
  it('builds the image before applying migrations and fails loudly on a bad build', () => {
    const build = deploy.indexOf('docker build -t "$APP_NAME:$NEW_TAG"');
    const firstMigration = deploy.indexOf('CREATE TABLE IF NOT EXISTS "_prisma_migrations"');
    const applyMigration = deploy.indexOf('apply-migration.sh"');
    expect(build).toBeGreaterThan(0);
    expect(build).toBeLessThan(firstMigration);
    expect(build).toBeLessThan(applyMigration);
    expect(deploy).toContain('fail "image build failed; database and running container left unchanged"');
  });

  it('probes password auth before falling back to the subnet trust rule', () => {
    const probe = deploy.indexOf('psql "$DATABASE_URL" -tAc "SELECT 1"');
    const trust = deploy.indexOf('trust the app container on this subnet');
    expect(probe).toBeGreaterThan(0);
    expect(probe).toBeLessThan(trust);
    // The probe gets DATABASE_URL from the env file, never from argv.
    expect(deploy).toMatch(/docker run --rm --network "\$PG_NET" --env-file "\$APP_DIR\/\.env"/);
  });

  it('reloads pg_hba.conf instead of restarting postgres', () => {
    expect(deploy).not.toMatch(/pg_ctl -D[^\n]*restart/);
    expect(deploy).toContain('kill -HUP');
  });
});
