#!/usr/bin/env node

'use strict';

const { createHash } = require('node:crypto');
const { readFile } = require('node:fs/promises');
const { resolve } = require('node:path');

const REQUIRED_HEADERS = new Map([
  ['x-content-type-options', 'nosniff'],
  ['x-frame-options', 'DENY'],
  ['referrer-policy', 'strict-origin-when-cross-origin'],
  [
    'permissions-policy',
    'camera=(), microphone=(), geolocation=(), browsing-topics=()',
  ],
]);

const REQUIRED_CSP_DIRECTIVES = [
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
];

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizeOrigin(value) {
  invariant(typeof value === 'string' && value.length > 0, '--origin is required');

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('--origin must be an absolute URL');
  }

  invariant(!url.username && !url.password, '--origin must not contain credentials');
  invariant(
    url.pathname === '/' && !url.search && !url.hash,
    '--origin must not contain a path, query, or fragment',
  );

  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  invariant(
    url.protocol === 'https:' || (url.protocol === 'http:' && loopback),
    '--origin must use trusted HTTPS; plain HTTP is allowed only for loopback tests',
  );

  return url.origin;
}

function assertSecurityHeaders(response, label, requireHsts) {
  for (const [name, expected] of REQUIRED_HEADERS) {
    invariant(
      response.headers.get(name) === expected,
      `${label} has an invalid or missing ${name} header`,
    );
  }

  const csp = response.headers.get('content-security-policy') || '';
  for (const directive of REQUIRED_CSP_DIRECTIVES) {
    invariant(csp.includes(directive), `${label} CSP is missing ${directive}`);
  }
  if (requireHsts) {
    invariant(
      response.headers.get('strict-transport-security') ===
        'max-age=63072000; includeSubDomains; preload',
      `${label} has an invalid or missing strict-transport-security header`,
    );
    invariant(
      csp.includes('upgrade-insecure-requests'),
      `${label} CSP is missing upgrade-insecure-requests`,
    );
  }

  invariant(!response.headers.has('x-powered-by'), `${label} exposes x-powered-by`);
}

async function request(fetchImpl, url, timeoutMs, accept) {
  return fetchImpl(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      accept,
      'user-agent': 'ashbi-public-release-verifier/1',
    },
  });
}

async function readBounded(response, label, maxBytes) {
  const contentLength = response.headers.get('content-length');
  const declaredLength = Number(contentLength);
  if (contentLength !== null && Number.isFinite(declaredLength)) {
    invariant(declaredLength <= maxBytes, `${label} exceeds ${maxBytes} bytes`);
  }
  const body = Buffer.from(await response.arrayBuffer());
  invariant(body.length <= maxBytes, `${label} exceeds ${maxBytes} bytes`);
  return body;
}

async function verifyPublicRelease({
  origin,
  expectedWidgetPath = resolve(process.cwd(), 'public/widget.js'),
  fetchImpl = fetch,
  timeoutMs = 10_000,
} = {}) {
  const normalizedOrigin = normalizeOrigin(origin);
  invariant(
    Number.isInteger(timeoutMs) && timeoutMs >= 1_000 && timeoutMs <= 60_000,
    'timeoutMs must be an integer from 1000 through 60000',
  );
  const requireHsts = normalizedOrigin.startsWith('https://');

  const healthResponse = await request(
    fetchImpl,
    `${normalizedOrigin}/api/health`,
    timeoutMs,
    'application/json',
  );
  invariant(healthResponse.status === 200, `health returned HTTP ${healthResponse.status}`);
  assertSecurityHeaders(healthResponse, 'health', requireHsts);
  invariant(
    (healthResponse.headers.get('content-type') || '').includes('application/json'),
    'health did not return JSON',
  );
  const healthBody = await readBounded(healthResponse, 'health body', 64 * 1024);
  let health;
  try {
    health = JSON.parse(healthBody.toString('utf8'));
  } catch {
    throw new Error('health returned invalid JSON');
  }
  invariant(health?.status === 'ok', 'health status is not ok');

  const rootResponse = await request(fetchImpl, `${normalizedOrigin}/`, timeoutMs, 'text/html');
  invariant(rootResponse.status === 200, `root returned HTTP ${rootResponse.status}`);
  assertSecurityHeaders(rootResponse, 'root', requireHsts);
  invariant(
    (rootResponse.headers.get('content-type') || '').includes('text/html'),
    'root did not return HTML',
  );
  invariant(
    (rootResponse.headers.get('cache-control') || '').includes('no-store'),
    'root is not marked no-store',
  );
  await readBounded(rootResponse, 'root body', 2 * 1024 * 1024);

  const workspaceResponse = await request(
    fetchImpl,
    `${normalizedOrigin}/workspaces`,
    timeoutMs,
    'text/html',
  );
  assertSecurityHeaders(workspaceResponse, 'anonymous /workspaces', requireHsts);
  let workspaceBoundary;
  let redirectLocation;
  if ([302, 303, 307, 308].includes(workspaceResponse.status)) {
    workspaceBoundary = 'http-redirect';
    redirectLocation = workspaceResponse.headers.get('location');
    await workspaceResponse.body?.cancel();
  } else if (workspaceResponse.status === 200) {
    workspaceBoundary = 'next-streamed-redirect';
    const body = (
      await readBounded(workspaceResponse, 'anonymous /workspaces body', 512 * 1024)
    ).toString('utf8');
    const redirectMatch = body.match(/NEXT_REDIRECT;(?:replace|push);([^;]+);30(?:2|3|7|8);/);
    invariant(
      redirectMatch,
      'anonymous /workspaces returned HTTP 200 without a Next.js redirect boundary',
    );
    redirectLocation = redirectMatch[1];
  } else {
    throw new Error(
      `anonymous /workspaces returned HTTP ${workspaceResponse.status} instead of redirecting`,
    );
  }

  invariant(redirectLocation, 'anonymous /workspaces redirect has no location');
  const redirectUrl = new URL(redirectLocation, normalizedOrigin);
  invariant(
    redirectUrl.origin === normalizedOrigin && redirectUrl.pathname === '/',
    'anonymous /workspaces did not redirect to the public root',
  );
  if (redirectUrl.search || redirectUrl.hash) {
    invariant(
      redirectUrl.searchParams.get('next') === '/workspaces' &&
        redirectUrl.hash === '#sign-in',
      'anonymous /workspaces used an unexpected redirect query or fragment',
    );
  }

  const workspaceApiResponse = await request(
    fetchImpl,
    `${normalizedOrigin}/api/workspaces`,
    timeoutMs,
    'application/json',
  );
  invariant(
    workspaceApiResponse.status === 401,
    `anonymous /api/workspaces returned HTTP ${workspaceApiResponse.status} instead of 401`,
  );
  assertSecurityHeaders(workspaceApiResponse, 'anonymous /api/workspaces', requireHsts);
  invariant(
    (workspaceApiResponse.headers.get('content-type') || '').includes('application/json'),
    'anonymous /api/workspaces did not return JSON',
  );
  const workspaceApiBody = await readBounded(
    workspaceApiResponse,
    'anonymous /api/workspaces body',
    64 * 1024,
  );
  let workspaceApi;
  try {
    workspaceApi = JSON.parse(workspaceApiBody.toString('utf8'));
  } catch {
    throw new Error('anonymous /api/workspaces returned invalid JSON');
  }
  invariant(workspaceApi?.error === 'Unauthorized', 'anonymous API denial is not explicit');

  const widgetResponse = await request(
    fetchImpl,
    `${normalizedOrigin}/widget.js`,
    timeoutMs,
    'application/javascript',
  );
  invariant(widgetResponse.status === 200, `widget returned HTTP ${widgetResponse.status}`);
  assertSecurityHeaders(widgetResponse, 'widget', requireHsts);
  invariant(
    (widgetResponse.headers.get('content-type') || '').includes('javascript'),
    'widget did not return JavaScript',
  );
  const deployedWidget = await readBounded(widgetResponse, 'widget', 2 * 1024 * 1024);
  const expectedWidget = await readFile(expectedWidgetPath);
  const deployedHash = createHash('sha256').update(deployedWidget).digest('hex');
  const expectedHash = createHash('sha256').update(expectedWidget).digest('hex');
  invariant(
    deployedHash === expectedHash,
    `widget provenance mismatch: deployed ${deployedHash}, expected ${expectedHash}`,
  );

  return {
    schema: 'ashbi.public-release.v1',
    verifiedAt: new Date().toISOString(),
    origin: normalizedOrigin,
    health: { status: health.status, timestamp: health.timestamp || null },
    routes: {
      root: rootResponse.status,
      health: healthResponse.status,
      anonymousWorkspaces: {
        pageStatus: workspaceResponse.status,
        apiStatus: workspaceApiResponse.status,
        boundary: workspaceBoundary,
      },
      widget: widgetResponse.status,
    },
    security: {
      trustedHttps: requireHsts,
      hsts: requireHsts,
      csp: true,
      noSniff: true,
      frameDenied: true,
      referrerPolicy: true,
      permissionsPolicy: true,
      poweredByHidden: true,
    },
    widget: {
      sha256: deployedHash,
      bytes: deployedWidget.length,
      expectedPath: resolve(expectedWidgetPath),
    },
  };
}

function parseArgs(argv) {
  let origin = '';
  let expectedWidgetPath = resolve(process.cwd(), 'public/widget.js');

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--origin') {
      origin = argv[++index] || '';
    } else if (argument === '--widget') {
      expectedWidgetPath = resolve(argv[++index] || '');
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }

  return { origin, expectedWidgetPath };
}

async function main() {
  try {
    const result = await verifyPublicRelease(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`public release verification failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { normalizeOrigin, parseArgs, verifyPublicRelease };

if (require.main === module) void main();
