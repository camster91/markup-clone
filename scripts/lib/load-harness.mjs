const DEFAULT_BASE_URL = 'http://127.0.0.1:3030';
const DEFAULT_REQUESTS = 24;
const DEFAULT_CONCURRENCY = 6;
const DEFAULT_MAX_P95_MS = 1500;
const MAX_BURST_REQUESTS = 30;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

export function assertDisposableComposeEnvironment(databaseUrl, dashboardHost) {
  try {
    const database = new URL(databaseUrl);
    const dashboard = new URL(dashboardHost);
    if (
      database.protocol !== 'postgresql:'
      || database.hostname !== 'postgres'
      || database.port !== '5432'
      || database.pathname !== '/markup_db'
      || database.username !== 'markup'
      || dashboard.protocol !== 'http:'
      || dashboard.hostname !== 'localhost'
      || dashboard.port !== '3030'
    ) {
      throw new Error('mismatch');
    }
  } catch {
    throw new Error('Refusing to modify anything except the disposable local Compose environment');
  }
}

export function buildPinForm(projectId, requestIndex) {
  const form = new FormData();
  form.set('projectId', projectId);
  form.set('path', `/__load-rehearsal__/request-${requestIndex}`);
  form.set('xPercent', '50');
  form.set('yPercent', '50');
  form.set('authorName', 'Local load rehearsal');
  form.set('text', `Load rehearsal request ${requestIndex}`);
  form.set('screenshot', new File([PNG_1X1], `load-${requestIndex}.png`, { type: 'image/png' }));
  return form;
}

function positiveInteger(value, fallback, label) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

export function normalizeLoadConfig(input = {}) {
  let target;
  try {
    target = new URL(input.baseUrl ?? DEFAULT_BASE_URL);
  } catch {
    throw new Error('Load target must be a valid loopback URL');
  }
  if (!LOOPBACK_HOSTS.has(target.hostname)) {
    throw new Error('Load target must use a loopback hostname');
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new Error('Load target must use HTTP on a loopback hostname');
  }

  const requests = positiveInteger(input.requests, DEFAULT_REQUESTS, 'requests');
  if (requests > MAX_BURST_REQUESTS) {
    throw new Error(`requests must not exceed the endpoint burst budget of ${MAX_BURST_REQUESTS}`);
  }
  const concurrency = positiveInteger(input.concurrency, DEFAULT_CONCURRENCY, 'concurrency');
  if (concurrency > requests) {
    throw new Error('concurrency must not exceed requests');
  }
  const maxP95Ms = positiveInteger(input.maxP95Ms, DEFAULT_MAX_P95_MS, 'maxP95Ms');

  target.pathname = target.pathname.replace(/\/+$/, '') || '/';
  return {
    baseUrl: target.toString().replace(/\/$/, ''),
    requests,
    concurrency,
    maxP95Ms,
  };
}

export function percentile(samples, percent) {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((left, right) => left - right);
  const rank = Math.max(1, Math.ceil((percent / 100) * sorted.length));
  return sorted[Math.min(rank - 1, sorted.length - 1)];
}

export async function mapWithConcurrency(items, concurrency, worker) {
  const output = new Array(items.length);
  let nextIndex = 0;

  async function consume() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      output[index] = await worker(items[index], index);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => consume()));
  return output;
}

export function summarizeLoad(results, elapsedMs) {
  const durations = results.map((result) => result.durationMs);
  const statusCounts = {};
  let successCount = 0;
  for (const result of results) {
    const key = String(result.status);
    statusCounts[key] = (statusCounts[key] ?? 0) + 1;
    if (result.status === 201) successCount += 1;
  }
  const requestCount = results.length;
  return {
    requestCount,
    successCount,
    successRate: requestCount === 0 ? 0 : successCount / requestCount,
    statusCounts,
    p50Ms: percentile(durations, 50),
    p95Ms: percentile(durations, 95),
    p99Ms: percentile(durations, 99),
    elapsedMs,
    throughputRps: elapsedMs === 0 ? 0 : requestCount / (elapsedMs / 1000),
  };
}

export async function runPinLoad(configInput, {
  projectId,
  apiKey,
  fetchImpl = fetch,
}) {
  const config = normalizeLoadConfig(configInput);
  const startedAt = performance.now();
  const results = await mapWithConcurrency(
    Array.from({ length: config.requests }, (_, index) => index),
    config.concurrency,
    async (requestIndex) => {
      const requestStartedAt = performance.now();
      try {
        const response = await fetchImpl(`${config.baseUrl}/api/pins`, {
          method: 'POST',
          headers: {
            'X-Api-Key': apiKey,
            'User-Agent': 'visual-feedback-local-load-rehearsal/1',
          },
          body: buildPinForm(projectId, requestIndex),
        });
        const durationMs = Math.round(performance.now() - requestStartedAt);
        const error = response.status === 201 ? undefined : (await response.text()).slice(0, 300);
        return { status: response.status, durationMs, error };
      } catch (error) {
        return {
          status: 'NETWORK_ERROR',
          durationMs: Math.round(performance.now() - requestStartedAt),
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );
  const summary = summarizeLoad(results, Math.round(performance.now() - startedAt));
  return {
    config,
    results,
    summary,
    failures: evaluateLoadSummary(summary, { maxP95Ms: config.maxP95Ms }),
  };
}

export function evaluateLoadSummary(summary, { maxP95Ms }) {
  const failures = [];
  if (summary.successCount !== summary.requestCount) {
    failures.push(`Expected every request to return 201; received ${JSON.stringify(summary.statusCounts)}`);
  }
  if (summary.p95Ms > maxP95Ms) {
    failures.push(`p95 latency ${summary.p95Ms}ms exceeded ${maxP95Ms}ms`);
  }
  return failures;
}
