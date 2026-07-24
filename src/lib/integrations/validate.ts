// Validation helpers for the integration routes.
//
// The API layer narrows the incoming `kind` first, then
// validates the per-kind `config` shape. We centralise the
// shape check here so both the POST and the test routes go
// through the same validator — a typo in one route's check
// would otherwise silently let bad configs through to the
// adapter (which would then 4xx at the receiver).
//
// Outbound URLs go through `validateOutboundUrlShape` (https
// only, no credentials, no IP literals / internal hosts). The
// fetch adapters additionally call `assertSafeOutboundUrl`
// (DNS + private-IP reject) immediately before fetch.

import type { DiscordConfig, IntegrationKind, SlackConfig, WebhookConfig } from './types';
import { validateOutboundUrlShape } from '@/lib/safe-url';

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

function validateSlackConfig(raw: unknown): ValidationResult<SlackConfig> {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'config must be an object' };
  }
  const r = raw as Record<string, unknown>;
  const urlRes = validateOutboundUrlShape(r.webhookUrl);
  if (!urlRes.ok) {
    return { ok: false, error: `slack webhookUrl: ${urlRes.error}` };
  }
  return { ok: true, value: { webhookUrl: urlRes.value } };
}

function validateDiscordConfig(raw: unknown): ValidationResult<DiscordConfig> {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'config must be an object' };
  }
  const r = raw as Record<string, unknown>;
  const urlRes = validateOutboundUrlShape(r.webhookUrl);
  if (!urlRes.ok) {
    return { ok: false, error: `discord webhookUrl: ${urlRes.error}` };
  }
  return { ok: true, value: { webhookUrl: urlRes.value } };
}

function validateWebhookConfig(raw: unknown): ValidationResult<WebhookConfig> {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'config must be an object' };
  }
  const r = raw as Record<string, unknown>;
  const urlRes = validateOutboundUrlShape(r.url);
  if (!urlRes.ok) {
    return { ok: false, error: `webhook url: ${urlRes.error}` };
  }
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
      url: urlRes.value,
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
