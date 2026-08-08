import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve('scripts/rollback-image-preflight.sh');
const DEPLOY_SCRIPT = resolve('scripts/deploy.sh');
const SHA = 'd47ada5bfa0d66be70d4751ce63ddfee07c63da3';
const IMAGE_ID = `sha256:${'c'.repeat(64)}`;

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

function fixture(options: {
  configuredImage?: string;
  containerImageId?: string;
  inspectedImageId?: string;
  imageExists?: boolean;
} = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'rollback-image-preflight-'));
  temporaryDirectories.push(directory);
  const binDirectory = join(directory, 'bin');
  const outputFile = join(directory, 'state', 'rollback-image.env');
  mkdirSync(binDirectory);

  const behavior = {
    configuredImage: options.configuredImage ?? `markup-clone:${SHA}`,
    containerImageId: options.containerImageId ?? IMAGE_ID,
    inspectedImageId: options.inspectedImageId ?? IMAGE_ID,
    imageExists: options.imageExists ?? true,
  };
  const dockerShim = [
    '#!/usr/bin/env bash',
    'set -eu',
    'if [ "$1" = "inspect" ] && [ "$2" = "--format" ]; then',
    '  case "$3" in',
    "    '{{.Config.Image}}') echo \"$DOCKER_CONFIGURED_IMAGE\" ;;",
    "    '{{.Image}}') echo \"$DOCKER_CONTAINER_IMAGE_ID\" ;;",
    '    *) exit 2 ;;',
    '  esac',
    'elif [ "$1" = "image" ] && [ "$2" = "inspect" ]; then',
    '  if [ "$DOCKER_IMAGE_EXISTS" != "true" ]; then exit 1; fi',
    '  if [ "${3:-}" = "--format" ]; then echo "$DOCKER_INSPECTED_IMAGE_ID"; fi',
    'else',
    '  exit 2',
    'fi',
    '',
  ].join('\n');
  const dockerPath = join(binDirectory, 'docker');
  writeFileSync(dockerPath, dockerShim);
  chmodSync(dockerPath, 0o755);

  const run = () => {
    if (!bash) throw new Error('bash unavailable');
    return spawnSync(bash, [toBashPath(SCRIPT), toBashPath(outputFile)], {
      env: {
        ...process.env,
        APP_NAME: 'markup-clone',
        APP_CONTAINER: 'markup-clone',
        DOCKER_CONFIGURED_IMAGE: behavior.configuredImage,
        DOCKER_CONTAINER_IMAGE_ID: behavior.containerImageId,
        DOCKER_INSPECTED_IMAGE_ID: behavior.inspectedImageId,
        DOCKER_IMAGE_EXISTS: String(behavior.imageExists),
        PATH: `${toBashPath(binDirectory)}:/usr/bin:/bin`,
      },
      encoding: 'utf8',
    });
  };

  return { outputFile, run };
}

describe.skipIf(!bash)('rollback image preflight', () => {
  it('records an exact immutable image only when the tag still resolves to the running image', () => {
    const test = fixture();
    const result = test.run();

    expect(result.status).toBe(0);
    expect(readFileSync(test.outputFile, 'utf8')).toContain(`ROLLBACK_IMAGE=markup-clone:${SHA}`);
    expect(readFileSync(test.outputFile, 'utf8')).toContain(`ROLLBACK_IMAGE_ID=${IMAGE_ID}`);
    if (process.platform !== 'win32') {
      expect(statSync(test.outputFile).mode & 0o777).toBe(0o600);
    }
  });

  it('rejects a mutable image tag', () => {
    const result = fixture({ configuredImage: 'markup-clone:latest' }).run();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('40-character source SHA');
  });

  it('rejects an image that Docker can no longer inspect', () => {
    const result = fixture({ imageExists: false }).run();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('not available locally');
  });

  it('rejects a tag that no longer resolves to the running container image', () => {
    const result = fixture({ inspectedImageId: `sha256:${'d'.repeat(64)}` }).run();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('does not match the running container image');
  });
});

describe('deploy rollback integration contract', () => {
  it('runs the rollback preflight before migrations and image replacement', () => {
    const source = readFileSync(DEPLOY_SCRIPT, 'utf8');
    const preflight = source.indexOf('rollback-image-preflight.sh');
    const migrations = source.indexOf('# --- 2. Apply pending Prisma migrations ---');
    const replacement = source.indexOf('docker rm -f "$APP_CONTAINER"');

    expect(preflight).toBeGreaterThan(-1);
    expect(preflight).toBeLessThan(migrations);
    expect(preflight).toBeLessThan(replacement);
  });

  it('refuses a dirty Git source tree before assigning the release image tag', () => {
    const source = readFileSync(DEPLOY_SCRIPT, 'utf8');
    const dirtyCheck = source.indexOf('git status --porcelain --untracked-files=all');
    const dirtyFailure = source.indexOf('release source tree is dirty');
    const tagAssignment = source.indexOf('NEW_TAG=$(git rev-parse HEAD)');

    expect(dirtyCheck).toBeGreaterThan(-1);
    expect(dirtyFailure).toBeGreaterThan(dirtyCheck);
    expect(dirtyFailure).toBeLessThan(tagAssignment);
  });
});
