// Comment attachments must default to a directory inside the screenshots
// volume, the only data volume deploy.sh, docker-compose.yml and the
// Coolify config mount. The old default (/data/attachments) was never
// mounted, so every redeploy deleted every attachment.

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { attachmentsDir, screenshotsDir } from '../../src/lib/storage-dirs';

const saved = {
  SCREENSHOTS_DIR: process.env.SCREENSHOTS_DIR,
  ATTACHMENTS_DIR: process.env.ATTACHMENTS_DIR,
};

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('storage dirs', () => {
  it('defaults attachments to a subdirectory of the screenshots volume', () => {
    delete process.env.SCREENSHOTS_DIR;
    delete process.env.ATTACHMENTS_DIR;
    expect(screenshotsDir()).toBe('/data/screenshots');
    expect(attachmentsDir()).toBe('/data/screenshots/attachments');
  });

  it('follows SCREENSHOTS_DIR when it is set', () => {
    process.env.SCREENSHOTS_DIR = '/srv/shots';
    delete process.env.ATTACHMENTS_DIR;
    expect(attachmentsDir()).toBe('/srv/shots/attachments');
  });

  it('lets ATTACHMENTS_DIR override the location', () => {
    process.env.SCREENSHOTS_DIR = '/srv/shots';
    process.env.ATTACHMENTS_DIR = '/mnt/attachments';
    expect(attachmentsDir()).toBe('/mnt/attachments');
  });

  it('keeps the default inside the volume every deploy mounts', () => {
    const root = resolve(__dirname, '../..');
    const deploy = readFileSync(resolve(root, 'scripts/deploy.sh'), 'utf8');
    const compose = readFileSync(resolve(root, 'docker-compose.yml'), 'utf8');
    expect(deploy).toContain(':/data/screenshots"');
    expect(compose).toMatch(/:\/data\/screenshots\b/);
    // Nothing mounts the old default, so nothing may write there.
    expect(deploy).not.toContain('/data/attachments');
    expect(compose).not.toContain('/data/attachments');
  });
});
