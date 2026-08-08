import { describe, expect, it } from 'vitest';

import {
  assertDisposableComposeEnvironment,
  buildPinForm,
  evaluateLoadSummary,
  mapWithConcurrency,
  normalizeLoadConfig,
  percentile,
  runPinLoad,
  summarizeLoad,
} from '../../scripts/lib/load-harness.mjs';

describe('assertDisposableComposeEnvironment', () => {
  it('accepts only the named local Compose database and dashboard', () => {
    expect(() => assertDisposableComposeEnvironment(
      'postgresql://markup:markup_dev_pw@postgres:5432/markup_db',
      'http://localhost:3030',
    )).not.toThrow();
  });

  it.each([
    ['postgresql://markup:secret@production-db:5432/markup_db', 'http://localhost:3030'],
    ['postgresql://markup:markup_dev_pw@postgres:5432/markup_db', 'https://markup.ashbi.ca'],
    ['', 'http://localhost:3030'],
  ])('rejects a non-disposable environment', (databaseUrl, dashboardHost) => {
    expect(() => assertDisposableComposeEnvironment(databaseUrl, dashboardHost))
      .toThrow(/disposable local compose/i);
  });
});

describe('buildPinForm', () => {
  it('builds a real PNG multipart payload with a unique load-test path', async () => {
    const form = buildPinForm('project-id', 7);
    expect(form.get('projectId')).toBe('project-id');
    expect(form.get('path')).toBe('/__load-rehearsal__/request-7');
    expect(form.get('xPercent')).toBe('50');
    expect(form.get('yPercent')).toBe('50');
    expect(form.get('authorName')).toBe('Local load rehearsal');
    const screenshot = form.get('screenshot');
    expect(screenshot).toBeInstanceOf(File);
    expect((screenshot as File).type).toBe('image/png');
    const bytes = new Uint8Array(await (screenshot as File).arrayBuffer());
    expect([...bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });
});

describe('normalizeLoadConfig', () => {
  it('normalizes a loopback target and bounded numeric inputs', () => {
    expect(normalizeLoadConfig({
      baseUrl: 'http://localhost:3030/',
      requests: '24',
      concurrency: '6',
      maxP95Ms: '1500',
    })).toEqual({
      baseUrl: 'http://localhost:3030',
      requests: 24,
      concurrency: 6,
      maxP95Ms: 1500,
    });
  });

  it.each([
    'https://markup.ashbi.ca',
    'http://example.test:3030',
    'http://localhost.example.com:3030',
    'not-a-url',
  ])('rejects non-loopback target %s', (baseUrl) => {
    expect(() => normalizeLoadConfig({ baseUrl })).toThrow(/loopback/i);
  });

  it('rejects a request count above the endpoint burst budget', () => {
    expect(() => normalizeLoadConfig({ baseUrl: 'http://127.0.0.1:3030', requests: 31 }))
      .toThrow(/30/);
  });

  it('rejects concurrency above the request count', () => {
    expect(() => normalizeLoadConfig({
      baseUrl: 'http://[::1]:3030',
      requests: 4,
      concurrency: 5,
    })).toThrow(/concurrency/i);
  });
});

describe('percentile', () => {
  it('uses nearest-rank percentiles over sorted numeric samples', () => {
    expect(percentile([100, 10, 50, 20], 50)).toBe(20);
    expect(percentile([100, 10, 50, 20], 95)).toBe(100);
  });

  it('returns zero for an empty sample', () => {
    expect(percentile([], 95)).toBe(0);
  });
});

describe('mapWithConcurrency', () => {
  it('never runs more workers than the configured concurrency', async () => {
    let active = 0;
    let peak = 0;
    await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value: number) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, value % 2 ? 5 : 1));
      active -= 1;
      return value;
    });
    expect(peak).toBe(2);
  });

  it('preserves input order when workers finish out of order', async () => {
    const output = await mapWithConcurrency([3, 1, 2], 3, async (value: number) => {
      await new Promise((resolve) => setTimeout(resolve, value * 2));
      return value * 10;
    });
    expect(output).toEqual([30, 10, 20]);
  });
});

describe('summarizeLoad', () => {
  it('reports response counts, latency percentiles, and throughput', () => {
    expect(summarizeLoad([
      { status: 201, durationMs: 10 },
      { status: 201, durationMs: 20 },
      { status: 500, durationMs: 100 },
      { status: 201, durationMs: 40 },
    ], 2000)).toEqual({
      requestCount: 4,
      successCount: 3,
      successRate: 0.75,
      statusCounts: { '201': 3, '500': 1 },
      p50Ms: 20,
      p95Ms: 100,
      p99Ms: 100,
      elapsedMs: 2000,
      throughputRps: 2,
    });
  });
});

describe('runPinLoad', () => {
  it('posts one authenticated multipart request per configured item', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const result = await runPinLoad({
      baseUrl: 'http://127.0.0.1:3030',
      requests: 3,
      concurrency: 2,
      maxP95Ms: 1500,
    }, {
      projectId: 'project-id',
      apiKey: 'load-api-key',
      fetchImpl: async (input: URL | RequestInfo, init?: RequestInit) => {
        calls.push({ url: String(input), init: init ?? {} });
        return new Response(JSON.stringify({ id: calls.length }), { status: 201 });
      },
    });

    expect(calls).toHaveLength(3);
    expect(calls.every((call) => call.url === 'http://127.0.0.1:3030/api/pins')).toBe(true);
    expect(calls.every((call) => new Headers(call.init.headers).get('X-Api-Key') === 'load-api-key')).toBe(true);
    expect(calls.map((call) => (call.init.body as FormData).get('path'))).toEqual([
      '/__load-rehearsal__/request-0',
      '/__load-rehearsal__/request-1',
      '/__load-rehearsal__/request-2',
    ]);
    expect(result.summary.statusCounts).toEqual({ '201': 3 });
    expect(result.failures).toEqual([]);
  });

  it('records a network exception as a failed request instead of aborting cleanup', async () => {
    const result = await runPinLoad({
      baseUrl: 'http://localhost:3030',
      requests: 1,
      concurrency: 1,
      maxP95Ms: 1500,
    }, {
      projectId: 'project-id',
      apiKey: 'load-api-key',
      fetchImpl: async () => { throw new Error('connection reset'); },
    });

    expect(result.summary.statusCounts).toEqual({ NETWORK_ERROR: 1 });
    expect(result.failures).toEqual([expect.stringMatching(/201/)]);
    expect(result.results[0]).toMatchObject({ status: 'NETWORK_ERROR', error: 'connection reset' });
  });
});

describe('evaluateLoadSummary', () => {
  it('accepts a fully successful run below the p95 threshold', () => {
    expect(evaluateLoadSummary({
      requestCount: 24,
      successCount: 24,
      successRate: 1,
      statusCounts: { '201': 24 },
      p50Ms: 100,
      p95Ms: 400,
      p99Ms: 450,
      elapsedMs: 1000,
      throughputRps: 24,
    }, { maxP95Ms: 1500 })).toEqual([]);
  });

  it('fails when any request does not return 201', () => {
    const failures = evaluateLoadSummary({
      requestCount: 2,
      successCount: 1,
      successRate: 0.5,
      statusCounts: { '201': 1, '429': 1 },
      p50Ms: 100,
      p95Ms: 120,
      p99Ms: 120,
      elapsedMs: 200,
      throughputRps: 10,
    }, { maxP95Ms: 1500 });
    expect(failures).toEqual([expect.stringMatching(/201/)]);
  });

  it('fails when p95 exceeds the configured threshold', () => {
    const failures = evaluateLoadSummary({
      requestCount: 1,
      successCount: 1,
      successRate: 1,
      statusCounts: { '201': 1 },
      p50Ms: 1600,
      p95Ms: 1600,
      p99Ms: 1600,
      elapsedMs: 1600,
      throughputRps: 0.625,
    }, { maxP95Ms: 1500 });
    expect(failures).toEqual([expect.stringMatching(/p95/i)]);
  });
});
