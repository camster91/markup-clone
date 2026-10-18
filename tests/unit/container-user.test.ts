// The app container runs as the unprivileged `node` user. It starts as root
// only to fix ownership of the user-file volume (written by root before this
// change), then drops privileges with su-exec. The image build plus a boot
// against a real volume is the behavioural check; this pins the wiring.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

describe('non-root app container', () => {
  const dockerfile = read('Dockerfile');
  const runner = dockerfile.slice(dockerfile.indexOf('AS runner'));
  const entrypoint = read('scripts/docker-entrypoint.sh');

  it('drops to node through the entrypoint', () => {
    expect(runner).toMatch(/\n\s+su-exec \\\n/);
    expect(runner).toContain('COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh');
    expect(runner).toContain(
      'ENTRYPOINT ["/usr/bin/dumb-init", "--", "sh", "/usr/local/bin/docker-entrypoint.sh"]'
    );
    expect(entrypoint).toContain('exec su-exec node "$@"');
  });

  it('does not set USER, so docker exec jobs (backups, delivery cron) keep running as root', () => {
    expect(runner).not.toMatch(/^USER /m);
  });

  it('fixes ownership of the user-file volume but not the backups', () => {
    expect(entrypoint).toContain('"${SCREENSHOTS_DIR:-/data/screenshots}"');
    expect(entrypoint).toContain('${ATTACHMENTS_DIR:+"$ATTACHMENTS_DIR"}');
    expect(entrypoint).toContain('-exec chown node:node {} +');
    expect(entrypoint).not.toMatch(/chown[^\n]*backups/);
    expect(runner).toContain('chown node:node /data/screenshots /app/.next/cache');
  });

  it('gives restored files back to the volume owner', () => {
    const restore = read('scripts/restore-files.sh');
    expect(restore).toContain('stat -c %u "$TARGET_DIR"');
    expect(restore).toContain('-exec chown "$OWNER_UID:$OWNER_GID" {} +');
  });
});
