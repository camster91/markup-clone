// Runs the real scripts/recapture.sh with fake `psql` and `chromium` on
// PATH and checks the URL it hands to Chromium.
//
// psql prints `domain|path`. The script used to `read -r DOMAIN PATH_`
// with the default IFS, so DOMAIN held the whole line and every capture
// URL was `https://example.com|/pricing`.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(__dirname, '../../scripts/recapture.sh');
const SCREENSHOT_ID = '55555555-5555-4555-8555-555555555555';

let dir: string;

function tool(name: string, body: string) {
  const p = join(dir, 'bin', name);
  writeFileSync(p, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(p, 0o755);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'recapture-test-'));
  mkdirSync(join(dir, 'bin'));
  mkdirSync(join(dir, 'shots'));
  // SELECT returns one `domain|path` row; the UPDATE is ignored.
  tool('psql', 'for a in "$@"; do case "$a" in SELECT*) echo "example.com|/pricing";; esac; done');
  // Record the URL (last arg) and write no PNG, so the script stops
  // right after the capture attempt.
  tool('chromium', `echo "\${@: -1}" > "${join(dir, 'url.txt')}"`);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('recapture.sh capture URL', () => {
  it('splits the psql row on | into domain and path', () => {
    const res = spawnSync('bash', [SCRIPT, SCREENSHOT_ID], {
      input: '',
      encoding: 'utf8',
      timeout: 20_000,
      env: {
        ...process.env,
        PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
        DATABASE_URL: 'postgresql://markup:secret@db:5432/markup_db',
        SCREENSHOTS_DIR: join(dir, 'shots'),
      },
    });
    expect(res.stdout).toContain('Re-capturing https://example.com/pricing ');
    expect(readFileSync(join(dir, 'url.txt'), 'utf8').trim()).toBe('https://example.com/pricing');
    // No PNG was written, so the script reports a failed capture.
    expect(res.status).toBe(4);
  });
});
