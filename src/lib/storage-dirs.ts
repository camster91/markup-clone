// On-disk storage locations.
//
// Every deploy (scripts/deploy.sh, docker-compose.yml, the Coolify config)
// bind-mounts exactly one data volume for user files: /data/screenshots.
// Anything written outside it lives in the container's own layer and is
// lost when a deploy replaces the container.
//
// Comment attachments therefore default to a subdirectory of the
// screenshots volume. They used to default to /data/attachments, which
// nothing mounted, so every redeploy deleted them. ATTACHMENTS_DIR still
// overrides the location for setups that mount a separate volume.
//
// The prune cron only scans the top level of the screenshots directory
// (`find -maxdepth 1 -name '*.png'`), so it never touches attachments.
//
// Read at call time, not module load, so tests and scripts can set the
// env after import.

import path from 'path';

export function screenshotsDir(): string {
  return process.env.SCREENSHOTS_DIR || '/data/screenshots';
}

export function attachmentsDir(): string {
  return (
    process.env.ATTACHMENTS_DIR ||
    path.join(/* turbopackIgnore: true */ screenshotsDir(), 'attachments')
  );
}
