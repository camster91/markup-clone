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

import type { IntegrationDeliveryPayload, PinPayload, WebhookConfig } from './types';
import { assertSafeOutboundUrl } from '@/lib/safe-url';
import { IntegrationHttpError } from './errors';
import { buildSignedWebhookHeaders } from './signing';

const OUTBOUND_TIMEOUT_MS = 10_000;

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
  const safe = await assertSafeOutboundUrl(config.url);
  if (!safe.ok) {
    throw new Error(`Webhook URL rejected: ${safe.error}`);
  }
  const headers = buildHeaders(config);
  // Default Content-Type to application/json if the operator
  // didn't set one. Most JSON receivers expect it; we only
  // override if the operator explicitly chose something else
  // (e.g. text/plain for HMAC body signing).
  if (!Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(safe.value, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    redirect: 'error',
    signal: AbortSignal.timeout(OUTBOUND_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new IntegrationHttpError('Webhook', res.status, res.headers?.get?.('retry-after') ?? null);
  }
}

export async function postEvent(
  config: WebhookConfig,
  delivery: IntegrationDeliveryPayload,
): Promise<number> {
  if (!delivery.signingSecret) throw new Error('Webhook signing secret is missing');
  const safe = await assertSafeOutboundUrl(config.url);
  if (!safe.ok) throw new Error(`Webhook URL rejected: ${safe.error}`);
  const headers = buildSignedWebhookHeaders({
    operatorHeaders: config.headers,
    secret: delivery.signingSecret,
    timestamp: delivery.timestamp,
    payloadJson: delivery.payloadJson,
    eventId: delivery.event.id,
    eventType: delivery.event.type,
    deliveryId: delivery.deliveryId,
  });
  const res = await fetch(safe.value, {
    method: 'POST',
    headers,
    body: delivery.payloadJson,
    redirect: 'error',
    signal: AbortSignal.timeout(OUTBOUND_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new IntegrationHttpError('Webhook', res.status, res.headers?.get?.('retry-after') ?? null);
  }
  return res.status;
}
