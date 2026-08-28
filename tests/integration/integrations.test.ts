// Integration tests for the Slack / Discord / webhook
// integrations surface — both the API CRUD routes and the
// adapter modules themselves.
//
// What this catches that a unit test can't:
//   - POST creates a row in the Integration table with the
//     expected kind + configJson
//   - GET lists every row for a project
//   - DELETE removes a single row, scoped to the project
//   - Slack adapter POSTs the right URL with the right blocks
//   - Discord adapter POSTs the right embed
//   - Webhook adapter POSTs JSON with operator-supplied headers
//   - A new pin triggers the dispatch (the integration is
//     called and the integration row's lastSuccessAt is updated)
//   - The /test route updates lastSuccessAt on success and
//     lastError on failure
//
// Prisma is mocked at the module level; global `fetch` is mocked
// per-test so the adapter never makes a real HTTP roundtrip.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

// ===== prisma mock (hoisted) =====
const mocks = vi.hoisted(() => ({
  project: { findUnique: vi.fn() },
  // page.upsert is called by the pin route before the
  // transaction runs (it makes sure a Page row exists for
  // the (projectId, path) pair). The default mock returns
  // a fake page; the pin tests override as needed.
  page: { upsert: vi.fn().mockResolvedValue({ id: 'page-1', projectId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', path: '/' }) },
  // The pin route fires a fire-and-forget subscriber lookup
  // after the tx commits. The default mock returns an empty
  // list so the email path is a no-op unless a test
  // explicitly drives it.
  subscriber: { findMany: vi.fn().mockResolvedValue([]) },
  // The pin route's $transaction callback reads
  // tx.screenshot.create + tx.pin.create, not the top-level
  // mocks. The transaction mock itself is replaced per test
  // by `setupPinMocks` (so the test can drive the callback
  // shape). We keep a default no-op implementation here so
  // tests that don't go through the pin route don't blow up.
  $transaction: vi.fn().mockImplementation(async () => undefined),
  integration: {
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
  },
  txIntegrationFindMany: vi.fn().mockResolvedValue([]),
  txIntegrationEventCreate: vi.fn().mockResolvedValue({}),
  integrationDelivery: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
  audit: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: mocks,
}));

vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return {
    ...actual,
    requireDashboardAuth: vi.fn(async (req: Request) => actual.requireDashboardOrigin(req)),
    requireAuth: vi.fn(async () => ({
      id: 'operator-1',
      email: 'operator@example.com',
      role: 'operator',
    })),
  };
});

vi.mock('@/lib/audit', () => ({
  audit: mocks.audit,
}));

// ===== fs/promises mock (so the pin route doesn't write files) =====
const fsMocks = vi.hoisted(() => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('fs/promises', () => fsMocks);

// ===== rate-limit + email + events mocks (pin route dependencies) =====
vi.mock('@/lib/rate-limit', () => ({
  consume: vi.fn().mockReturnValue({ ok: true, remaining: 29 }),
}));
vi.mock('@/lib/email', () => ({
  sendSubscriberEmails: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/events', () => ({
  emit: vi.fn(),
}));

// Adapter tests must not depend on live DNS. The production URL guard has its
// own focused coverage; here we supply the already-validated public URLs so the
// tests exercise only request construction and dispatch behavior.
vi.mock('@/lib/safe-url', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/safe-url')>();
  return {
    ...actual,
    assertSafeOutboundUrl: vi.fn(async (url: string) => ({ ok: true, value: url })),
  };
});

// ===== fetch mock (hoisted, captured per test) =====
const fetchMock = vi.hoisted(() => vi.fn());
// Replace global fetch with our mock. We use `vi.stubGlobal` per-test
// inside `beforeEach` so each test gets a clean mock. The hoisted
// `fetchMock` is what the adapters call.

// ===== CSRF token (test-only) =====
const CSRF_TOKEN = '***';

function req(
  url: string,
  init: { method?: string; body?: unknown; origin?: string } = {}
): NextRequest {
  const { method = 'GET', body, origin = 'https://markup.ashbi.ca' } = init;
  const headers: Record<string, string> = {
    Origin: origin,
    'X-CSRF-Token': CSRF_TOKEN,
    cookie: `markup.csrf=${CSRF_TOKEN}`,
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return new NextRequest(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// Helpers to import routes AFTER mocks. Using dynamic import so
// the test ordering matches the project's other integration tests
// (which import routes at the top of the file after `vi.mock`).
import { POST as IntegrationsPOST, GET as IntegrationsGET } from '../../src/app/api/projects/[id]/integrations/route';
import { DELETE as IntegrationDELETE } from '../../src/app/api/projects/[id]/integrations/[integrationId]/route';
import { POST as IntegrationTestPOST } from '../../src/app/api/projects/[id]/integrations/test/route';
import { GET as DeliveryLogGET } from '../../src/app/api/projects/[id]/integrations/deliveries/route';
import { POST as DeliveryRetryPOST } from '../../src/app/api/projects/[id]/integrations/deliveries/[deliveryId]/retry/route';
import { POST as PinsPOST } from '../../src/app/api/pins/route';

import { post as slackPost } from '../../src/lib/integrations/slack';
import { post as discordPost } from '../../src/lib/integrations/discord';
import { post as webhookPost } from '../../src/lib/integrations/webhook';
import { buildSlackBody } from '../../src/lib/integrations/slack';
import { buildDiscordBody } from '../../src/lib/integrations/discord';
import { buildHeaders as buildWebhookHeaders } from '../../src/lib/integrations/webhook';
import { dispatch } from '../../src/lib/integrations/dispatcher';
import { encryptIntegrationCredential } from '../../src/lib/integrations/credential-crypto';

const SAMPLE_PAYLOAD = {
  pin: {
    id: 'pin-1',
    screenshotId: 'ss-1',
    xPercent: 25.4,
    yPercent: 75.1,
    status: 'OPEN',
    authorName: 'Alice',
    createdAt: '2026-06-19T00:00:00.000Z',
  },
  project: { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', name: 'My Site', domain: 'example.com' },
  path: '/about',
  commentText: 'Please fix the menu',
};

// Minimal valid 1x1 PNG (same as tests/integration/pins.test.ts).
const PNG_1x1 = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

function makeFormData(fields: Record<string, string | File>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.txIntegrationFindMany.mockResolvedValue([]);
  mocks.txIntegrationEventCreate.mockResolvedValue({});
  // Replace global fetch with a controllable mock. vi.stubGlobal
  // is automatically cleaned up in vitest's afterEach.
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '' });
  vi.stubGlobal('fetch', fetchMock);

  // Default project mock (assertProjectAccessible + create path).
  // teamId: null = legacy / unscoped — accessible without membership.
  mocks.project.findUnique.mockResolvedValue({
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    teamId: null,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ============================================================================
// CRUD: POST /api/projects/[id]/integrations
// ============================================================================
describe('POST /api/projects/[id]/integrations', () => {
  it('returns 400 when kind is missing', async () => {
    const res = await IntegrationsPOST(
      req('https://markup.ashbi.ca/api/projects/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/integrations', {
        method: 'POST',
        body: { config: { webhookUrl: 'https://hooks.slack.com/x' } },
      }),
      { params: Promise.resolve({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }) }
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when kind is not in the closed set', async () => {
    const res = await IntegrationsPOST(
      req('https://markup.ashbi.ca/api/projects/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/integrations', {
        method: 'POST',
        body: { kind: 'telegram', config: { webhookUrl: 'https://example.com' } },
      }),
      { params: Promise.resolve({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }) }
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when slack config is missing webhookUrl', async () => {
    const res = await IntegrationsPOST(
      req('https://markup.ashbi.ca/api/projects/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/integrations', {
        method: 'POST',
        body: { kind: 'slack', config: {} },
      }),
      { params: Promise.resolve({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }) }
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when slack webhookUrl is not http(s)', async () => {
    const res = await IntegrationsPOST(
      req('https://markup.ashbi.ca/api/projects/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/integrations', {
        method: 'POST',
        body: { kind: 'slack', config: { webhookUrl: 'file:///etc/passwd' } },
      }),
      { params: Promise.resolve({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }) }
    );
    expect(res.status).toBe(400);
  });

  it('returns 404 when the project does not exist', async () => {
    mocks.project.findUnique.mockResolvedValue(null);
    const res = await IntegrationsPOST(
      req('https://markup.ashbi.ca/api/projects/cccccccc-cccc-cccc-cccc-cccccccccccc/integrations', {
        method: 'POST',
        body: { kind: 'slack', config: { webhookUrl: 'https://hooks.slack.com/x' } },
      }),
      { params: Promise.resolve({ id: 'cccccccc-cccc-cccc-cccc-cccccccccccc' }) }
    );
    expect(res.status).toBe(404);
  });

  it('creates the row and returns 201 on a valid slack config', async () => {
    mocks.integration.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'int-1',
      projectId: data.projectId,
      kind: data.kind,
      configJson: data.configJson,
      lastSuccessAt: null,
      lastError: null,
      lastErrorAt: null,
      createdAt: new Date(),
    }));

    const res = await IntegrationsPOST(
      req('https://markup.ashbi.ca/api/projects/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/integrations', {
        method: 'POST',
        body: {
          kind: 'slack',
          config: { webhookUrl: 'https://hooks.slack.com/services/X/Y/Z' },
        },
      }),
      { params: Promise.resolve({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }) }
    );
    expect(res.status).toBe(201);
    expect(mocks.integration.create).toHaveBeenCalledWith({
      data: {
        projectId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        kind: 'slack',
        // configJson is a string of the validated config.
        configJson: JSON.stringify({
          webhookUrl: 'https://hooks.slack.com/services/X/Y/Z',
        }),
      },
    });
    const body = await res.json();
    expect(body.kind).toBe('slack');
    expect(body.id).toBe('int-1');
  });

  it('creates a discord integration', async () => {
    mocks.integration.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'int-2',
      ...data,
      createdAt: new Date(),
    }));
    const res = await IntegrationsPOST(
      req('https://markup.ashbi.ca/api/projects/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/integrations', {
        method: 'POST',
        body: { kind: 'discord', config: { webhookUrl: 'https://discord.com/api/webhooks/1/2' } },
      }),
      { params: Promise.resolve({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }) }
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.kind).toBe('discord');
  });

  it('creates a generic webhook integration with headers', async () => {
    mocks.integration.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'int-3',
      ...data,
      createdAt: new Date(),
    }));
    const res = await IntegrationsPOST(
      req('https://markup.ashbi.ca/api/projects/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/integrations', {
        method: 'POST',
        body: {
          kind: 'webhook',
          config: {
            url: 'https://example.com/hook',
            headers: { 'X-Auth': 'secret' },
          },
        },
      }),
      { params: Promise.resolve({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }) }
    );
    expect(res.status).toBe(201);
    expect(mocks.integration.create).toHaveBeenCalled();
    const call = mocks.integration.create.mock.calls[0][0];
    expect(JSON.parse(call.data.configJson)).toEqual({
      url: 'https://example.com/hook',
      headers: { 'X-Auth': 'secret' },
    });
    expect(call.data.signingSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const body = await res.json();
    expect(body.signingSecret).toBe(call.data.signingSecret);
  });

  it('encrypts a GitHub credential and returns only the selected repository', async () => {
    process.env.INTEGRATION_ENCRYPTION_KEY = Buffer.alloc(32, 4).toString('base64url');
    mocks.integration.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'int-github', ...data, createdAt: new Date(),
      lastSuccessAt: null, lastError: null, lastErrorAt: null,
    }));

    const token = 'github_pat_private_integration_token';
    const res = await IntegrationsPOST(
      req('https://markup.ashbi.ca/api/projects/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/integrations', {
        method: 'POST',
        body: {
          kind: 'github',
          config: { owner: 'acme', repo: 'client-site', labels: ['feedback'], token },
        },
      }),
      { params: Promise.resolve({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }) },
    );

    expect(res.status).toBe(201);
    const call = mocks.integration.create.mock.calls[0][0].data;
    expect(JSON.parse(call.configJson)).toEqual({ owner: 'acme', repo: 'client-site', labels: ['feedback'] });
    expect(call.credentialCiphertext).toMatch(/^v1\./);
    expect(call.credentialCiphertext).not.toContain(token);
    const body = await res.json();
    expect(body.configJson).toBe(JSON.stringify({ owner: 'acme', repo: 'client-site', labels: ['feedback'] }));
    expect(body.credentialConfigured).toBe(true);
    expect(JSON.stringify(body)).not.toContain(token);
    expect(body).not.toHaveProperty('credentialCiphertext');
  });

  it('fails closed before storing GitHub credentials when encryption is unavailable', async () => {
    delete process.env.INTEGRATION_ENCRYPTION_KEY;
    const res = await IntegrationsPOST(
      req('https://markup.ashbi.ca/api/projects/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/integrations', {
        method: 'POST',
        body: {
          kind: 'github',
          config: {
            owner: 'acme', repo: 'client-site', labels: [],
            token: 'github_pat_private_integration_token',
          },
        },
      }),
      { params: Promise.resolve({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }) },
    );

    expect(res.status).toBe(503);
    expect(mocks.integration.create).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ error: 'GitHub credential encryption is not configured' });
  });

  it('rejects webhook config with non-string header values', async () => {
    const res = await IntegrationsPOST(
      req('https://markup.ashbi.ca/api/projects/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/integrations', {
        method: 'POST',
        body: {
          kind: 'webhook',
          config: { url: 'https://example.com', headers: { 'X-Auth': 42 } },
        },
      }),
      { params: Promise.resolve({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }) }
    );
    expect(res.status).toBe(400);
  });

  it('emits an audit log entry on create', async () => {
    mocks.integration.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'int-1',
      ...data,
      createdAt: new Date(),
    }));
    await IntegrationsPOST(
      req('https://markup.ashbi.ca/api/projects/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/integrations', {
        method: 'POST',
        body: { kind: 'slack', config: { webhookUrl: 'https://hooks.slack.com/x' } },
      }),
      { params: Promise.resolve({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }) }
    );
    expect(mocks.audit).toHaveBeenCalledWith({
      actor: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      action: 'integration.create',
      target: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      metadata: { kind: 'slack' },
    });
  });

  it('returns 401 from a non-dashboard origin', async () => {
    const res = await IntegrationsPOST(
      req('https://markup.ashbi.ca/api/projects/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/integrations', {
        method: 'POST',
        body: { kind: 'slack', config: { webhookUrl: 'https://hooks.slack.com/x' } },
        origin: 'https://evil.com',
      }),
      { params: Promise.resolve({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }) }
    );
    expect(res.status).toBe(401);
  });
});

// ============================================================================
// CRUD: GET /api/projects/[id]/integrations
// ============================================================================
describe('GET /api/projects/[id]/integrations', () => {
  it('lists every integration for the project', async () => {
    const rows = [
      {
        id: 'int-1',
        projectId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        kind: 'slack',
        configJson: JSON.stringify({ webhookUrl: 'https://hooks.slack.com/services/T/B/xxx' }),
        signingSecret: null,
        lastSuccessAt: null,
        lastError: null,
        lastErrorAt: null,
        createdAt: new Date('2026-08-08T04:00:00.000Z'),
      },
      {
        id: 'int-2',
        projectId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        kind: 'discord',
        configJson: JSON.stringify({ webhookUrl: 'https://discord.com/api/webhooks/1/token' }),
        signingSecret: 'must-never-leave-the-server',
        lastSuccessAt: null,
        lastError: null,
        lastErrorAt: null,
        createdAt: new Date('2026-08-08T04:00:00.000Z'),
      },
    ];
    mocks.integration.findMany.mockResolvedValue(rows);
    const res = await IntegrationsGET(req('https://markup.ashbi.ca/api/projects/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/integrations'), {
      params: Promise.resolve({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }),
    });
    expect(res.status).toBe(200);
    expect(mocks.integration.findMany).toHaveBeenCalledWith({
      where: { projectId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
      orderBy: { createdAt: 'asc' },
    });
    const body = await res.json();
    expect(body).toHaveLength(2);
    expect(JSON.parse(body[0].configJson).webhookUrl).toBe(
      'https://hooks.slack.com/••••/••••/••••/••••'
    );
    expect(body[0].configJson).not.toContain('xxx');
    expect(JSON.parse(body[1].configJson).webhookUrl).toBe(
      'https://discord.com/••••/••••/••••/••••'
    );
    expect(body[1].configJson).not.toContain('token');
    expect(body[0]).not.toHaveProperty('signingSecret');
    expect(body[1]).not.toHaveProperty('signingSecret');
    expect(JSON.stringify(body)).not.toContain('must-never-leave-the-server');
  });

  it('reports GitHub credential presence without emitting encrypted material', async () => {
    mocks.integration.findMany.mockResolvedValue([{
      id: 'int-github',
      projectId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      kind: 'github',
      configJson: JSON.stringify({ owner: 'acme', repo: 'client-site', labels: ['feedback'] }),
      signingSecret: null,
      credentialCiphertext: 'v1.private.encrypted.material',
      lastSuccessAt: null,
      lastError: null,
      lastErrorAt: null,
      createdAt: new Date('2026-08-08T04:00:00.000Z'),
    }]);

    const res = await IntegrationsGET(
      req('https://markup.ashbi.ca/api/projects/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/integrations'),
      { params: Promise.resolve({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }) },
    );
    const body = await res.json();
    expect(body[0]).toEqual(expect.objectContaining({
      kind: 'github',
      configJson: JSON.stringify({ owner: 'acme', repo: 'client-site', labels: ['feedback'] }),
      credentialConfigured: true,
    }));
    expect(JSON.stringify(body)).not.toContain('v1.private.encrypted.material');
    expect(body[0]).not.toHaveProperty('credentialCiphertext');
  });
});

describe('owner integration delivery activity', () => {
  const deliveryId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  it('lists a bounded safe projection without payloads, configs, or secrets', async () => {
    mocks.integrationDelivery.findMany.mockResolvedValue([{
      id: deliveryId,
      status: 'DEAD_LETTER',
      attemptCount: 5,
      retryCycle: 0,
      nextAttemptAt: new Date('2026-08-08T04:00:00.000Z'),
      deliveredAt: null,
      lastStatusCode: 503,
      lastError: 'Webhook returned 503',
      externalId: null,
      externalUrl: null,
      createdAt: new Date('2026-08-08T03:00:00.000Z'),
      updatedAt: new Date('2026-08-08T04:00:00.000Z'),
      integration: { id: 'int-1', kind: 'webhook' },
      event: { id: 'event-1', type: 'pin.created', occurredAt: new Date('2026-08-08T03:00:00.000Z') },
    }]);

    const response = await DeliveryLogGET(
      req('https://markup.ashbi.ca/api/projects/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/integrations/deliveries'),
      { params: Promise.resolve({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }) },
    );
    expect(response.status).toBe(200);
    expect(mocks.integrationDelivery.findMany).toHaveBeenCalledWith({
      where: { integration: { projectId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: expect.objectContaining({
        id: true, status: true, attemptCount: true, retryCycle: true,
        externalId: true, externalUrl: true,
      }),
    });
    const body = await response.json();
    expect(body).toHaveLength(1);
    expect(body[0]).toEqual(expect.objectContaining({
      id: deliveryId, status: 'DEAD_LETTER', attemptCount: 5,
      integration: { id: 'int-1', kind: 'webhook' },
      event: { id: 'event-1', type: 'pin.created', occurredAt: '2026-08-08T03:00:00.000Z' },
    }));
    expect(JSON.stringify(body)).not.toMatch(/payloadJson|configJson|signingSecret/i);
  });

  it('returns a validated successful GitHub issue reference', async () => {
    mocks.integrationDelivery.findMany.mockResolvedValue([{
      id: deliveryId,
      status: 'SUCCEEDED', attemptCount: 1, retryCycle: 0,
      nextAttemptAt: new Date('2026-08-08T04:00:00.000Z'),
      deliveredAt: new Date('2026-08-08T04:00:00.000Z'),
      lastStatusCode: 201, lastError: null,
      externalId: '42', externalUrl: 'https://github.com/acme/client-site/issues/42',
      createdAt: new Date('2026-08-08T03:00:00.000Z'),
      updatedAt: new Date('2026-08-08T04:00:00.000Z'),
      integration: { id: 'int-github', kind: 'github' },
      event: { id: 'event-1', type: 'pin.created', occurredAt: new Date('2026-08-08T03:00:00.000Z') },
    }]);

    const response = await DeliveryLogGET(
      req('https://markup.ashbi.ca/api/projects/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/integrations/deliveries'),
      { params: Promise.resolve({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }) },
    );
    const body = await response.json();
    expect(body[0]).toEqual(expect.objectContaining({
      externalId: '42', externalUrl: 'https://github.com/acme/client-site/issues/42',
    }));
  });

  it('drops a malformed external reference instead of emitting an unsafe link', async () => {
    mocks.integrationDelivery.findMany.mockResolvedValue([{
      id: deliveryId,
      status: 'SUCCEEDED', attemptCount: 1, retryCycle: 0,
      nextAttemptAt: new Date('2026-08-08T04:00:00.000Z'), deliveredAt: new Date(),
      lastStatusCode: 201, lastError: null,
      externalId: '42', externalUrl: 'javascript:alert(1)',
      createdAt: new Date(), updatedAt: new Date(),
      integration: { id: 'int-github', kind: 'github' },
      event: { id: 'event-1', type: 'pin.created', occurredAt: new Date() },
    }]);

    const response = await DeliveryLogGET(
      req('https://markup.ashbi.ca/api/projects/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/integrations/deliveries'),
      { params: Promise.resolve({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }) },
    );
    const body = await response.json();
    expect(body[0].externalId).toBeNull();
    expect(body[0].externalUrl).toBeNull();
  });

  it('starts a fresh bounded retry cycle for a project-scoped dead letter', async () => {
    mocks.integrationDelivery.updateMany.mockResolvedValue({ count: 1 });
    const response = await DeliveryRetryPOST(
      req(`https://markup.ashbi.ca/api/projects/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/integrations/deliveries/${deliveryId}/retry`, {
        method: 'POST', body: {},
      }),
      { params: Promise.resolve({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', deliveryId }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ queued: true });
    expect(mocks.integrationDelivery.updateMany).toHaveBeenCalledWith({
      where: {
        id: deliveryId,
        status: 'DEAD_LETTER',
        integration: { projectId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
      },
      data: {
        status: 'PENDING',
        attemptCount: 0,
        retryCycle: { increment: 1 },
        nextAttemptAt: expect.any(Date),
        lockedAt: null,
        lockedBy: null,
        deliveredAt: null,
        lastStatusCode: null,
        lastError: null,
        externalId: null,
        externalUrl: null,
      },
    });
  });

  it('returns 409 instead of requeueing an active or cross-project delivery', async () => {
    mocks.integrationDelivery.updateMany.mockResolvedValue({ count: 0 });
    const response = await DeliveryRetryPOST(
      req(`https://markup.ashbi.ca/api/projects/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/integrations/deliveries/${deliveryId}/retry`, {
        method: 'POST', body: {},
      }),
      { params: Promise.resolve({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', deliveryId }) },
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'Delivery is not available for retry' });
  });
});

// ============================================================================
// CRUD: DELETE /api/projects/[id]/integrations/[integrationId]
// ============================================================================
describe('DELETE /api/projects/[id]/integrations/[integrationId]', () => {
  it('removes a single integration, scoped to the project', async () => {
    mocks.integration.deleteMany.mockResolvedValue({ count: 1 });
    const res = await IntegrationDELETE(
      req('https://markup.ashbi.ca/api/projects/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/integrations/int-1', {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', integrationId: 'int-1' }) }
    );
    expect(res.status).toBe(200);
    expect(mocks.integration.deleteMany).toHaveBeenCalledWith({
      where: { id: 'int-1', projectId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
    });
    const body = await res.json();
    expect(body).toEqual({ deleted: true, count: 1 });
  });

  it('returns 200 with count: 0 on a missing id (idempotent)', async () => {
    mocks.integration.deleteMany.mockResolvedValue({ count: 0 });
    const res = await IntegrationDELETE(
      req('https://markup.ashbi.ca/api/projects/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/integrations/int-missing', {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', integrationId: 'int-missing' }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ deleted: true, count: 0 });
  });

  it('emits an audit log entry only on a real delete', async () => {
    mocks.integration.deleteMany.mockResolvedValue({ count: 1 });
    await IntegrationDELETE(
      req('https://markup.ashbi.ca/api/projects/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/integrations/int-1', {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', integrationId: 'int-1' }) }
    );
    expect(mocks.audit).toHaveBeenCalledWith({
      actor: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      action: 'integration.remove',
      target: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      metadata: { integrationId: 'int-1' },
    });
  });
});

// ============================================================================
// Adapters: Slack
// ============================================================================
describe('slack adapter', () => {
  it('POSTs to the configured webhookUrl with Slack blocks', async () => {
    await slackPost(
      { webhookUrl: 'https://hooks.slack.com/services/X/Y/Z' },
      SAMPLE_PAYLOAD
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://hooks.slack.com/services/X/Y/Z');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(init.body);
    expect(body.text).toContain('My Site');
    expect(body.blocks).toHaveLength(2);
    // First block: a section with the headline + comment
    expect(body.blocks[0].type).toBe('section');
    expect(body.blocks[0].text.text).toContain('My Site');
    expect(body.blocks[0].text.text).toContain('Please fix the menu');
    // Second block: a context row with the author + position
    expect(body.blocks[1].type).toBe('context');
    expect(body.blocks[1].elements[0]!.text).toContain('Alice');
    expect(body.blocks[1].elements[0]!.text).toContain('25%, 75%');
  });

  it('handles an empty comment by using the "no comment" placeholder', () => {
    const body = buildSlackBody({ ...SAMPLE_PAYLOAD, commentText: '' });
    expect(body.blocks[0]!.text!.text).toContain('_no comment_');
  });

  it('throws on a non-2xx response', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'boom' });
    await expect(
      slackPost({ webhookUrl: 'https://hooks.slack.com/x' }, SAMPLE_PAYLOAD)
    ).rejects.toThrow(/Slack webhook returned 500/);
  });
});

// ============================================================================
// Adapters: Discord
// ============================================================================
describe('discord adapter', () => {
  it('POSTs the right embed to the configured webhookUrl', async () => {
    await discordPost(
      { webhookUrl: 'https://discord.com/api/webhooks/1/2' },
      SAMPLE_PAYLOAD
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://discord.com/api/webhooks/1/2');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    // content is the plain-text fallback
    expect(body.content).toContain('My Site');
    // embeds[0] is the rich card
    expect(body.embeds).toHaveLength(1);
    const embed = body.embeds[0];
    expect(embed.title).toBe('My Site — /about');
    expect(embed.description).toBe('Please fix the menu');
    expect(embed.color).toBe(0x3b82f6);
    expect(embed.footer.text).toContain('Alice');
    expect(embed.footer.text).toContain('25%, 75%');
    expect(embed.timestamp).toBe('2026-06-19T00:00:00.000Z');
  });

  it('handles an empty comment', () => {
    const body = buildDiscordBody({ ...SAMPLE_PAYLOAD, commentText: '' });
    expect(body.embeds[0].description).toBe('_no comment_');
  });

  it('throws on a non-2xx response', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404, text: async () => 'gone' });
    await expect(
      discordPost({ webhookUrl: 'https://discord.com/api/webhooks/x' }, SAMPLE_PAYLOAD)
    ).rejects.toThrow(/Discord webhook returned 404/);
  });
});

// ============================================================================
// Adapters: generic webhook
// ============================================================================
describe('webhook adapter', () => {
  it('POSTs JSON to the configured url with operator-supplied headers', async () => {
    await webhookPost(
      {
        url: 'https://example.com/hook',
        headers: { 'X-Auth': 'secret', 'X-Source': 'markup' },
      },
      SAMPLE_PAYLOAD
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://example.com/hook');
    expect(init.method).toBe('POST');
    expect(init.headers['X-Auth']).toBe('secret');
    expect(init.headers['X-Source']).toBe('markup');
    // Default Content-Type is set when none is provided.
    expect(init.headers['Content-Type']).toBe('application/json');
    // Body is the full PinPayload, not a Slack/Discord wrapper.
    const body = JSON.parse(init.body);
    expect(body).toEqual(SAMPLE_PAYLOAD);
  });

  it('respects an operator-supplied Content-Type', async () => {
    await webhookPost(
      { url: 'https://example.com/hmac', headers: { 'Content-Type': 'text/plain' } },
      SAMPLE_PAYLOAD
    );
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers['Content-Type']).toBe('text/plain');
  });

  it('buildHeaders returns a fresh copy (no shared state)', () => {
    const original = { 'X-Auth': 'a' };
    const headers = buildWebhookHeaders({ url: 'https://example.com', headers: original });
    headers['X-Mutated'] = 'true';
    expect(original).not.toHaveProperty('X-Mutated');
  });

  it('throws on a non-2xx response', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 502, text: async () => 'bad gateway' });
    await expect(
      webhookPost({ url: 'https://example.com/hook' }, SAMPLE_PAYLOAD)
    ).rejects.toThrow(/Webhook returned 502/);
  });
});

// ============================================================================
// Dispatcher
// ============================================================================
describe('dispatcher', () => {
  it('routes slack to the slack adapter', async () => {
    const result = await dispatch('slack', { webhookUrl: 'https://hooks.slack.com/x' }, SAMPLE_PAYLOAD);
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('routes discord to the discord adapter', async () => {
    const result = await dispatch('discord', { webhookUrl: 'https://discord.com/api/webhooks/x' }, SAMPLE_PAYLOAD);
    expect(result.ok).toBe(true);
  });

  it('routes webhook to the webhook adapter', async () => {
    const result = await dispatch('webhook', { url: 'https://example.com/h' }, SAMPLE_PAYLOAD);
    expect(result.ok).toBe(true);
  });

  it('returns { ok: false, error } on adapter failure (no throw)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'err' });
    const result = await dispatch('slack', { webhookUrl: 'https://hooks.slack.com/x' }, SAMPLE_PAYLOAD);
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result as { ok: false; error: string }).error).toMatch(/500/);
  });
});

// ============================================================================
// POST /api/projects/[id]/integrations/test
// ============================================================================
describe('POST /api/projects/[id]/integrations/test', () => {
  it('returns 400 when integrationId is missing', async () => {
    const res = await IntegrationTestPOST(
      req('https://markup.ashbi.ca/api/projects/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/integrations/test', {
        method: 'POST',
        body: {},
      }),
      { params: Promise.resolve({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }) }
    );
    expect(res.status).toBe(400);
  });

  it('returns 404 when the integration does not exist for the project', async () => {
    mocks.integration.findFirst.mockResolvedValue(null);
    const res = await IntegrationTestPOST(
      req('https://markup.ashbi.ca/api/projects/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/integrations/test', {
        method: 'POST',
        body: { integrationId: 'int-x' },
      }),
      { params: Promise.resolve({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }) }
    );
    expect(res.status).toBe(404);
  });

  it('fires the adapter, sets lastSuccessAt, returns ok:true', async () => {
    mocks.integration.findFirst.mockResolvedValue({
      id: 'int-1',
      projectId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      kind: 'slack',
      configJson: JSON.stringify({ webhookUrl: 'https://hooks.slack.com/x' }),
      project: { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', name: 'My Site', domain: 'example.com' },
    });
    mocks.integration.update.mockResolvedValue({});
    const res = await IntegrationTestPOST(
      req('https://markup.ashbi.ca/api/projects/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/integrations/test', {
        method: 'POST',
        body: { integrationId: 'int-1' },
      }),
      { params: Promise.resolve({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }) }
    );
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.integration.update).toHaveBeenCalledWith({
      where: { id: 'int-1' },
      data: expect.objectContaining({
        lastSuccessAt: expect.any(Date),
        lastError: null,
        lastErrorAt: null,
      }),
    });
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.lastSuccessAt).toBe('string');
  });

  it('verifies GitHub repository access without creating a test issue', async () => {
    const key = Buffer.alloc(32, 5);
    process.env.INTEGRATION_ENCRYPTION_KEY = key.toString('base64url');
    const token = 'github_pat_private_test_route_token';
    mocks.integration.findFirst.mockResolvedValue({
      id: 'int-github',
      projectId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      kind: 'github',
      configJson: JSON.stringify({ owner: 'acme', repo: 'client-site', labels: ['feedback'] }),
      credentialCiphertext: encryptIntegrationCredential(token, key),
      project: { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', name: 'My Site', domain: 'example.com' },
    });
    mocks.integration.update.mockResolvedValue({});
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200, headers: new Headers(),
      json: async () => ({ full_name: 'acme/client-site', has_issues: true }),
    });

    const res = await IntegrationTestPOST(
      req('https://markup.ashbi.ca/api/projects/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/integrations/test', {
        method: 'POST', body: { integrationId: 'int-github' },
      }),
      { params: Promise.resolve({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }) },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(expect.objectContaining({ ok: true }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.github.com/repos/acme/client-site');
    expect(fetchMock.mock.calls[0][1].method).toBe('GET');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${token}`);
  });

  it('sets lastError on adapter failure and returns ok:false with status 200', async () => {
    mocks.integration.findFirst.mockResolvedValue({
      id: 'int-1',
      projectId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      kind: 'slack',
      configJson: JSON.stringify({ webhookUrl: 'https://hooks.slack.com/x' }),
      project: { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', name: 'My Site', domain: 'example.com' },
    });
    mocks.integration.update.mockResolvedValue({});
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'oops' });
    const res = await IntegrationTestPOST(
      req('https://markup.ashbi.ca/api/projects/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/integrations/test', {
        method: 'POST',
        body: { integrationId: 'int-1' },
      }),
      { params: Promise.resolve({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }) }
    );
    expect(res.status).toBe(200); // Always 200 — failure is in the body
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.lastError).toMatch(/500/);
    expect(mocks.integration.update).toHaveBeenCalledWith({
      where: { id: 'int-1' },
      data: expect.objectContaining({
        lastError: expect.stringMatching(/500/),
        lastErrorAt: expect.any(Date),
      }),
    });
  });
});

// ============================================================================
// Pin route integration with the dispatcher
// ============================================================================
describe('POST /api/pins → integration dispatch', () => {
  function setupPinMocks() {
    mocks.project.findUnique.mockResolvedValue({
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      name: 'My Site',
      domain: 'example.com',
      apiKey: 'mk_correctkey123',
    });
    // transaction mock — the route builds the pin and
    // screenshot inside a $transaction, so we just run
    // the callback against a fake tx.
    mocks.$transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        screenshot: { create: vi.fn().mockResolvedValue({
          id: 'ss-1', pageId: 'page-1', width: 1, height: 1,
          capturedAt: new Date('2026-06-19T00:00:00.000Z'),
        }) },
        pin: { create: vi.fn().mockResolvedValue({
          id: 'pin-1',
          xPercent: 50,
          yPercent: 50,
          status: 'OPEN',
          authorName: 'Alice',
          createdAt: new Date('2026-06-19T00:00:00.000Z'),
          comments: [{
            id: 'comment-1', author: 'Alice', authorRole: 'client', text: 'Great feedback',
            createdAt: new Date('2026-06-19T00:00:00.000Z'),
          }],
        }) },
        integration: { findMany: mocks.txIntegrationFindMany },
        integrationEvent: { create: mocks.txIntegrationEventCreate },
      };
      return await cb(tx);
    });
  }

  it('queues the integration event inside the pin transaction without direct network dispatch', async () => {
    setupPinMocks();
    mocks.txIntegrationFindMany.mockResolvedValue([{ id: 'int-1' }]);

    const fd = makeFormData({
      projectId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', path: '/about', xPercent: '50', yPercent: '50',
      screenshot: new File([PNG_1x1], 'shot.png', { type: 'image/png' }),
      text: 'Great feedback',
    });
    const pinReq = new NextRequest('https://markup.ashbi.ca/api/pins', {
      method: 'POST',
      headers: { 'X-Api-Key': 'mk_correctkey123' },
      body: fd,
    });
    const res = await PinsPOST(pinReq);
    expect(res.status).toBe(201);

    expect(mocks.txIntegrationFindMany).toHaveBeenCalledWith({
      where: { projectId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
      select: { id: true },
    });
    expect(mocks.txIntegrationEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        schema: 'visual-feedback.event.v1',
        type: 'pin.created',
        payloadJson: expect.stringContaining('Great feedback'),
        deliveries: { create: [{ integrationId: 'int-1' }] },
      }),
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.integration.update).not.toHaveBeenCalled();
  });

  it('does not call a failing receiver from the pin request', async () => {
    setupPinMocks();
    mocks.txIntegrationFindMany.mockResolvedValue([{ id: 'int-1' }]);
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'err' });

    const fd = makeFormData({
      projectId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', path: '/', xPercent: '50', yPercent: '50',
      screenshot: new File([PNG_1x1], 'shot.png', { type: 'image/png' }),
    });
    const pinReq = new NextRequest('https://markup.ashbi.ca/api/pins', {
      method: 'POST',
      headers: { 'X-Api-Key': 'mk_correctkey123' },
      body: fd,
    });
    const res = await PinsPOST(pinReq);
    expect(res.status).toBe(201);
    expect(mocks.txIntegrationEventCreate).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.integration.update).not.toHaveBeenCalled();
  });

  it('is a no-op when the project has no integrations configured', async () => {
    setupPinMocks();
    mocks.txIntegrationFindMany.mockResolvedValue([]);

    const fd = makeFormData({
      projectId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', path: '/', xPercent: '50', yPercent: '50',
      screenshot: new File([PNG_1x1], 'shot.png', { type: 'image/png' }),
    });
    const pinReq = new NextRequest('https://markup.ashbi.ca/api/pins', {
      method: 'POST',
      headers: { 'X-Api-Key': 'mk_correctkey123' },
      body: fd,
    });
    const res = await PinsPOST(pinReq);
    expect(res.status).toBe(201);
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.integration.update).not.toHaveBeenCalled();
    expect(mocks.txIntegrationEventCreate).not.toHaveBeenCalled();
  });

  it('queues one delivery for each configured Slack, Discord, and webhook target', async () => {
    setupPinMocks();
    mocks.txIntegrationFindMany.mockResolvedValue([
      { id: 'int-1' }, { id: 'int-2' }, { id: 'int-3' },
    ]);

    const fd = makeFormData({
      projectId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', path: '/', xPercent: '50', yPercent: '50',
      screenshot: new File([PNG_1x1], 'shot.png', { type: 'image/png' }),
    });
    const pinReq = new NextRequest('https://markup.ashbi.ca/api/pins', {
      method: 'POST',
      headers: { 'X-Api-Key': 'mk_correctkey123' },
      body: fd,
    });
    const res = await PinsPOST(pinReq);
    expect(res.status).toBe(201);
    expect(mocks.txIntegrationEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        deliveries: { create: [
          { integrationId: 'int-1' },
          { integrationId: 'int-2' },
          { integrationId: 'int-3' },
        ] },
      }),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
