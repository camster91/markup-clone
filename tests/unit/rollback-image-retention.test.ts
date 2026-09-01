import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve('scripts/retain-rollback-image.sh');
const SHA = 'e3f9c4d12986da641b01f758316c84e43013b3d8';
const IMAGE_ID = `sha256:${'a'.repeat(64)}`;

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
  runningImageId?: string;
  resolvedImageId?: string;
  imageExists?: boolean;
  existingRetainer?: boolean;
  existingOwned?: boolean;
  existingTemporary?: boolean;
} = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'rollback-image-retention-'));
  temporaryDirectories.push(directory);
  const binDirectory = join(directory, 'bin');
  const stateDirectory = join(directory, 'state');
  const recordFile = join(directory, 'docker-record');
  mkdirSync(binDirectory);
  mkdirSync(stateDirectory);

  if (options.existingRetainer) {
    writeFileSync(join(stateDirectory, 'stable'), 'present');
  }
  if (options.existingTemporary) {
    writeFileSync(join(stateDirectory, 'temporary'), 'present');
  }

  const dockerShim = `#!/usr/bin/env bash
set -eu
record() { printf '%s\\n' "$*" >> "$DOCKER_RECORD"; }
stable="$DOCKER_STATE/stable"
temporary="$DOCKER_STATE/temporary"

if [ "$1" = "inspect" ] && [ "\${2:-}" = "--format" ]; then
  format="$3"
  name="$4"
  case "$name:$format" in
    markup-clone:*Config.Image*) printf '%s\\n' "$DOCKER_CONFIGURED_IMAGE" ;;
    markup-clone:*Image*) printf '%s\\n' "$DOCKER_RUNNING_IMAGE_ID" ;;
    *rollback-retainer.next.*:*Image*) test -f "$temporary" && printf '%s\\n' "$DOCKER_RUNNING_IMAGE_ID" ;;
    markup-clone-rollback-retainer:*Labels*)
      test -f "$stable" || exit 1
      [ "$DOCKER_EXISTING_OWNED" = "true" ] && printf 'true\\n' || printf '<no value>\\n'
      ;;
    markup-clone-rollback-retainer:*Image*) test -f "$stable" && printf '%s\\n' "$DOCKER_RUNNING_IMAGE_ID" ;;
    *) exit 2 ;;
  esac
elif [ "$1" = "inspect" ]; then
  [ "$2" = "markup-clone-rollback-retainer" ] && test -f "$stable"
elif [ "$1" = "image" ] && [ "$2" = "inspect" ]; then
  [ "$DOCKER_IMAGE_EXISTS" = "true" ] || exit 1
  printf '%s\\n' "$DOCKER_RESOLVED_IMAGE_ID"
elif [ "$1" = "create" ]; then
  record "$*"
  test ! -f "$temporary"
  touch "$temporary"
  printf 'temporary-id\\n'
elif [ "$1" = "rm" ]; then
  record "$*"
  target="\${@: -1}"
  if [ "$target" = "markup-clone-rollback-retainer" ]; then
    rm -f "$stable"
  else
    rm -f "$temporary"
  fi
elif [ "$1" = "rename" ]; then
  record "$*"
  test -f "$temporary"
  rm -f "$temporary"
  touch "$stable"
else
  exit 2
fi
`;
  const dockerPath = join(binDirectory, 'docker');
  writeFileSync(dockerPath, dockerShim);
  chmodSync(dockerPath, 0o755);

  const run = () => {
    if (!bash) throw new Error('bash unavailable');
    return spawnSync(bash, [toBashPath(SCRIPT)], {
      env: {
        ...process.env,
        APP_NAME: 'markup-clone',
        APP_CONTAINER: 'markup-clone',
        DOCKER_CONFIGURED_IMAGE: options.configuredImage ?? `markup-clone:${SHA}`,
        DOCKER_RUNNING_IMAGE_ID: options.runningImageId ?? IMAGE_ID,
        DOCKER_RESOLVED_IMAGE_ID: options.resolvedImageId ?? IMAGE_ID,
        DOCKER_IMAGE_EXISTS: String(options.imageExists ?? true),
        DOCKER_EXISTING_OWNED: String(options.existingOwned ?? true),
        DOCKER_RECORD: toBashPath(recordFile),
        DOCKER_STATE: toBashPath(stateDirectory),
        PATH: `${toBashPath(binDirectory)}:/usr/bin:/bin`,
      },
      encoding: 'utf8',
    });
  };

  const record = () => existsSync(recordFile) ? readFileSync(recordFile, 'utf8') : '';
  return { record, run, stateDirectory };
}

describe.skipIf(!bash)('rollback image retention', () => {
  it('creates a network-disabled stopped retainer for the running exact image', () => {
    const test = fixture();
    const result = test.run();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`retained markup-clone:${SHA}`);
    expect(test.record()).toContain('--label ashbi.rollback-retainer=true');
    expect(test.record()).toContain('--network none --restart no --entrypoint /bin/true');
    expect(test.record()).toContain(`markup-clone:${SHA}`);
    expect(test.record()).not.toMatch(/(?:^|\s)(?:-p|--publish|-v|--volume|--mount)(?:\s|=)/);
    expect(existsSync(join(test.stateDirectory, 'stable'))).toBe(true);
  });

  it('creates and verifies the replacement before removing an owned prior retainer', () => {
    const test = fixture({ existingRetainer: true, existingOwned: true });
    const result = test.run();
    const record = test.record().trim().split('\n');

    expect(result.status).toBe(0);
    const create = record.findIndex((line) => line.startsWith('create '));
    const remove = record.indexOf('rm -f markup-clone-rollback-retainer');
    const rename = record.findIndex((line) => line.startsWith('rename '));
    expect(create).toBeGreaterThan(-1);
    expect(remove).toBeGreaterThan(create);
    expect(rename).toBeGreaterThan(remove);
  });

  it('refuses to replace a container without the ownership label', () => {
    const test = fixture({ existingRetainer: true, existingOwned: false });
    const result = test.run();

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('refusing to replace unowned container');
    expect(test.record().trim().split('\n')).not.toContain('rm -f markup-clone-rollback-retainer');
    expect(existsSync(join(test.stateDirectory, 'stable'))).toBe(true);
  });

  it('fails closed without deleting a colliding temporary container', () => {
    const test = fixture({ existingTemporary: true });
    const result = test.run();

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('cannot create temporary rollback retainer');
    expect(test.record().trim().split('\n').some((line) => line.startsWith('rm '))).toBe(false);
    expect(existsSync(join(test.stateDirectory, 'temporary'))).toBe(true);
  });

  it('rejects a mutable current image tag', () => {
    const result = fixture({ configuredImage: 'markup-clone:latest' }).run();

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('40-character source SHA');
  });

  it('rejects a current image that Docker can no longer inspect', () => {
    const result = fixture({ imageExists: false }).run();

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('not available locally');
  });

  it('rejects an image tag that does not resolve to the running image ID', () => {
    const result = fixture({ resolvedImageId: `sha256:${'b'.repeat(64)}` }).run();

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('does not match the running container image');
  });
});
