import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const SCRIPT = resolve('scripts/edge-proxy-preflight.sh');
const DEPLOY_SCRIPT = resolve('scripts/deploy.sh');
const INSTALL_CRON_SCRIPT = resolve('scripts/install-cron.sh');

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
  while (temporaryDirectories.length) {
    const directory = temporaryDirectories.pop();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

function fixture(options: { traefik?: boolean; listener?: boolean; tlsOk?: boolean; routeOk?: boolean } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'edge-preflight-'));
  temporaryDirectories.push(directory);
  const binDirectory = join(directory, 'bin');
  const recordPath = join(directory, 'record.txt');
  const routersPath = join(directory, 'routers.yml');
  mkdirSync(binDirectory);

  writeFileSync(routersPath, options.routeOk === false ? 'http: {}\n' : [
    'http:',
    '  routers:',
    '    markup:',
    '      rule: Host(`markup.ashbi.ca`)',
    '  services:',
    '    markup:',
    '      loadBalancer:',
    '        servers:',
    '        - url: http://127.0.0.1:3030',
    '',
  ].join('\n'));

  const shims: Record<string, string> = {
    docker: `#!/usr/bin/env bash\necho "docker $*" >> "$RECORD_FILE"\n${options.traefik ? 'exit 0' : 'exit 1'}\n`,
    ss: `#!/usr/bin/env bash\necho "ss $*" >> "$RECORD_FILE"\n${(options.listener ?? options.traefik) ? 'echo LISTEN-443-traefik' : 'echo LISTEN-443-caddy'}\n`,
    curl: [
      '#!/usr/bin/env bash',
      'echo "curl $*" >> "$RECORD_FILE"',
      'case "$*" in',
      `  *"/api/http/routers/markup@file"*) echo '${options.routeOk === false ? '{"status":"disabled"}' : '{"status":"enabled","rule":"Host(`markup.ashbi.ca`)","service":"markup","entryPoints":["websecure"],"tls":{"certResolver":"letsencrypt"}}'}' ;;`,
      `  *"/api/http/services/markup@file"*) echo '${options.routeOk === false ? '{"status":"disabled"}' : '{"status":"enabled","loadBalancer":{"servers":[{"url":"http://127.0.0.1:3030"}]}}'}' ;;`,
      `  *) ${options.tlsOk === false ? 'exit 60' : 'echo \'{"status":"ok"}\''} ;;`,
      'esac',
      '',
    ].join('\n'),
    python3: [
      '#!/usr/bin/env bash',
      'cat >/dev/null',
      'printf %s "$ROUTER_JSON" | grep -q \'"status":"enabled"\' || exit 1',
      'printf %s "$ROUTER_JSON" | grep -q \'"certResolver":"letsencrypt"\' || exit 1',
      'printf %s "$SERVICE_JSON" | grep -q \'"status":"enabled"\' || exit 1',
      'printf %s "$SERVICE_JSON" | grep -q \'http://127.0.0.1:3030\' || exit 1',
      'exit 0',
      '',
    ].join('\n'),
  };
  for (const [name, source] of Object.entries(shims)) {
    const path = join(binDirectory, name);
    writeFileSync(path, source);
    chmodSync(path, 0o755);
  }

  const run = (command: 'detect' | 'verify', extraEnv: Record<string, string> = {}) => {
    if (!bash) throw new Error('bash unavailable');
    return spawnSync(bash, [toBashPath(SCRIPT), command], {
      env: {
        ...process.env,
        PATH: `${toBashPath(binDirectory)}:/usr/bin:/bin`,
        RECORD_FILE: toBashPath(recordPath),
        CURL_BIN: toBashPath(join(binDirectory, 'curl')),
        TRAEFIK_ROUTERS_FILE: toBashPath(routersPath),
        PUBLIC_HOSTNAME: 'markup.ashbi.ca',
        HOST_PORT: '3030',
        ...extraEnv,
      },
      encoding: 'utf8',
    });
  };

  return {
    run,
    record: () => existsSync(recordPath) ? readFileSync(recordPath, 'utf8') : '',
  };
}

describe.skipIf(!bash)('edge proxy preflight', () => {
  it('detects Traefik only when its container and public listener both exist', () => {
    expect(fixture({ traefik: true }).run('detect').stdout.trim()).toBe('traefik');
    expect(fixture({ traefik: false }).run('detect').stdout.trim()).toBe('caddy');
  });

  it('fails closed instead of touching Caddy when Traefik exists without its listener', () => {
    const result = fixture({ traefik: true, listener: false }).run('detect');
    expect(result.status).not.toBe(0);
  });

  it('verifies the active Traefik route and trusted public HTTPS', () => {
    const test = fixture({ traefik: true, tlsOk: true, routeOk: true });
    const result = test.run('verify', { EDGE_PROXY: 'traefik' });

    expect(result.status, result.stderr).toBe(0);
    expect(test.record()).toContain('/api/http/routers/markup@file');
    expect(test.record()).toContain('/api/http/services/markup@file');
    expect(test.record()).toContain('--resolve markup.ashbi.ca:443:127.0.0.1');
    expect(test.record()).not.toMatch(/curl .*\s-k(?:\s|$)/);
    expect(test.record()).not.toContain('--insecure');
  });

  it('fails closed when public TLS is not trusted', () => {
    const result = fixture({ traefik: true, tlsOk: false }).run('verify', { EDGE_PROXY: 'traefik' });
    expect(result.status).not.toBe(0);
  });

  it('fails closed when the Traefik route is absent', () => {
    const result = fixture({ traefik: true, tlsOk: true, routeOk: false }).run('verify', { EDGE_PROXY: 'traefik' });
    expect(result.status).not.toBe(0);
  });
});

describe('deploy edge integration contract', () => {
  it('preflights the edge before migrations and skips Caddy mutation in Traefik mode', () => {
    const source = readFileSync(DEPLOY_SCRIPT, 'utf8');
    const preflight = source.indexOf('edge-proxy-preflight.sh" verify');
    const migrations = source.indexOf('# --- 2. Apply pending Prisma migrations');

    expect(preflight).toBeGreaterThan(-1);
    expect(migrations).toBeGreaterThan(preflight);
    expect(source).toContain('if [ "$EDGE_PROXY" = "caddy" ]; then');
  });

  it('does not dirty tracked scripts and retires the Caddy cron under Traefik', () => {
    const source = readFileSync(INSTALL_CRON_SCRIPT, 'utf8');

    expect(source).not.toContain('chmod +x "$PRUNE_SCRIPT"');
    expect(source).not.toContain('chmod +x "$GUARD_SCRIPT"');
    expect(source).toContain('bash $PRUNE_SCRIPT');
    expect(source).toContain('bash $GUARD_SCRIPT');
    expect(source).toContain('rm -f /etc/cron.d/markup-caddy-guard');
    expect(source).toContain('bash "$EDGE_HELPER" detect');
  });
});
