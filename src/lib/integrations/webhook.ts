// Generic webhook adapter: POST the pin payload as JSON to an
// operator-supplied URL. The simplest of the three adapters —
// the operator owns the receiving endpoint, so we just hand
// them the same `PinPayload` shape the other adapters consume.
//
// We do NOT try to be clever with the body shape; downstream
// services can re-parse it. We do NOT add a default Content-Type
// (the route has already set application/json) or any
// auth header (the operator adds one via `config.headers`).
//
// Re-throws on any non-2xx response so the route can record
// the failure on the integration row.

import type { PinPayload, WebhookConfig } from './types';
import { safeOutboundFetch } from '@/lib/ssrf';

/**
 * Build the request headers for a generic-webhook dispatch.
 *
 * The shape of `headers` is operator-defined (e.g. a signing
 * secret, an API-key, an X-Provider-Token). We do NOT add a
 * default Content-Type — the caller is expected to have set
 * `application/json` in the headers object, or to not care
 * about it (some HMAC-signed receivers use a different
 * Content-Type like text/plain).
 *
 * Returned separately from `post()` so the test suite can
 * assert against the exact header set.
 */
export function buildHeaders(config: WebhookConfig): Record<string, string> {
  // Clone so the caller's `config.headers` reference isn't
  // shared with the adapter's internal state — defensive,
  // but cheap, and keeps the test assertions deterministic.
  return { ...(config.headers ?? {}) };
}

/**
 * POST the pin payload to the operator-supplied URL.
 *
 * Throws on a non-2xx response (the route layer catches and
 * records lastError).
 */
export async function post(config: WebhookConfig, payload: PinPayload): Promise<void> {
  const headers = buildHeaders(config);
  // Default Content-Type to application/json if the operator
  // didn't set one. Most JSON receivers expect it; we only
  // override if the operator explicitly chose something else
  // (e.g. text/plain for HMAC body signing).
  if (!Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await safeOutboundFetch(config.url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Webhook returned ${res.status}: ${text.slice(0, 200)}`);
  }
}
