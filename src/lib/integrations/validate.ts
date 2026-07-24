// Validation helpers for the integration routes.
//
// The API layer narrows the incoming `kind` first, then
// validates the per-kind `config` shape. We centralise the
// shape check here so both the POST and the test routes go
// through the same validator — a typo in one route's check
// would otherwise silently let bad configs through to the
// adapter (which would then 4xx at the receiver).

import { assertSafeOutboundUrl } from '@/lib/ssrf';
import type { DiscordConfig, IntegrationKind, SlackConfig, WebhookConfig } from './types';

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function validateSlackConfig(raw: unknown): ValidationResult<SlackConfig> {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'config must be an object' };
  }
  const r = raw as Record<string, unknown>;
  if (!isNonEmptyString(r.webhookUrl)) {
    return { ok: false, error: 'slack config requires a non-empty webhookUrl' };
  }
  // http(s) only — block file://, data:, javascript: etc. The
  // adapter uses node:fetch which would happily try most
  // schemes, but we'd rather reject at the boundary than
  // launch a 30s fetch to a URL that can't possibly work.
  if (!/^https?:\/\//i.test(r.webhookUrl)) {
    return { ok: false, error: 'slack webhookUrl must be http(s)' };
  }
  const ssrf = assertSafeOutboundUrl(r.webhookUrl);
  if (!ssrf.ok) return { ok: false, error: ssrf.error };
  return { ok: true, value: { webhookUrl: r.webhookUrl } };
}

function validateDiscordConfig(raw: unknown): ValidationResult<DiscordConfig> {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'config must be an object' };
  }
  const r = raw as Record<string, unknown>;
  if (!isNonEmptyString(r.webhookUrl)) {
    return { ok: false, error: 'discord config requires a non-empty webhookUrl' };
  }
  if (!/^https?:\/\//i.test(r.webhookUrl)) {
    return { ok: false, error: 'discord webhookUrl must be http(s)' };
  }
  const ssrf = assertSafeOutboundUrl(r.webhookUrl);
  if (!ssrf.ok) return { ok: false, error: ssrf.error };
  return { ok: true, value: { webhookUrl: r.webhookUrl } };
}

function validateWebhookConfig(raw: unknown): ValidationResult<WebhookConfig> {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'config must be an object' };
  }
  const r = raw as Record<string, unknown>;
  if (!isNonEmptyString(r.url)) {
    return { ok: false, error: 'webhook config requires a non-empty url' };
  }
  if (!/^https?:\/\//i.test(r.url)) {
    return { ok: false, error: 'webhook url must be http(s)' };
  }
  const ssrf = assertSafeOutboundUrl(r.url);
  if (!ssrf.ok) return { ok: false, error: ssrf.error };
  // `headers` is optional. If present, it must be a flat
  // object of string→string. We do NOT restrict which
  // headers — operators may need to set signature / auth
  // headers per their receiver.
  if (r.headers !== undefined) {
    if (!r.headers || typeof r.headers !== 'object' || Array.isArray(r.headers)) {
      return { ok: false, error: 'webhook headers must be a string→string object' };
    }
    for (const [k, v] of Object.entries(r.headers as Record<string, unknown>)) {
      if (typeof k !== 'string' || typeof v !== 'string') {
        return { ok: false, error: 'webhook headers must be string→string' };
      }
    }
  }
  return {
    ok: true,
    value: {
      url: r.url,
      headers: r.headers ? (r.headers as Record<string, string>) : undefined,
    },
  };
}

/**
 * Validate a `config` payload against the shape required by `kind`.
 * On success, returns the parsed config (ready to be JSON-stringified
 * and stored on the Integration row).
 */
export function validateConfig(
  kind: IntegrationKind,
  config: unknown
): ValidationResult<SlackConfig | DiscordConfig | WebhookConfig> {
  switch (kind) {
    case 'slack':
      return validateSlackConfig(config);
    case 'discord':
      return validateDiscordConfig(config);
    case 'webhook':
      return validateWebhookConfig(config);
  }
}
