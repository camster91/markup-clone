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

import type {
  DiscordConfig,
  GitHubConfig,
  GitHubStoredConfig,
  IntegrationKind,
  SlackConfig,
  WebhookConfig,
} from './types';
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
  // object of string→string. Operators may set receiver-specific
  // authentication headers; the adapter always overrides protected
  // delivery/signature headers with system-generated values.
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

function validateGithubRepository(raw: unknown): ValidationResult<GitHubStoredConfig> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'github config must be an object' };
  }
  const value = raw as Record<string, unknown>;
  const segment = (input: unknown, field: 'owner' | 'repo'): ValidationResult<string> => {
    if (typeof input !== 'string') return { ok: false, error: `github ${field} must be a string` };
    const normalized = input.trim();
    if (
      normalized.length < 1 || normalized.length > 100 ||
      normalized === '.' || normalized === '..' ||
      !/^[A-Za-z0-9_.-]+$/.test(normalized)
    ) {
      return { ok: false, error: `github ${field} is invalid` };
    }
    return { ok: true, value: normalized };
  };
  const owner = segment(value.owner, 'owner');
  if (!owner.ok) return owner;
  const repo = segment(value.repo, 'repo');
  if (!repo.ok) return repo;

  if (value.labels !== undefined && (!Array.isArray(value.labels) || value.labels.length > 10)) {
    return { ok: false, error: 'github labels must contain at most 10 values' };
  }
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const rawLabel of (value.labels ?? []) as unknown[]) {
    if (typeof rawLabel !== 'string') return { ok: false, error: 'github labels must be strings' };
    const label = rawLabel.trim();
    if (label.length < 1 || label.length > 50 || /[\u0000-\u001f\u007f]/.test(label)) {
      return { ok: false, error: 'github labels must be between 1 and 50 characters' };
    }
    const key = label.toLocaleLowerCase('en-US');
    if (!seen.has(key)) {
      seen.add(key);
      labels.push(label);
    }
  }
  return { ok: true, value: { owner: owner.value, repo: repo.value, labels } };
}

function validateGithubConfig(raw: unknown): ValidationResult<GitHubConfig> {
  const repository = validateGithubRepository(raw);
  if (!repository.ok) return repository;
  const token = (raw as Record<string, unknown>).token;
  if (
    typeof token !== 'string' || token.length < 20 || token.length > 500 ||
    !/^[\x21-\x7e]+$/.test(token)
  ) {
    return { ok: false, error: 'github token must be between 20 and 500 non-whitespace characters' };
  }
  return { ok: true, value: { ...repository.value, token } };
}

/**
 * Validate a `config` payload against the shape required by `kind`.
 * On success, returns the parsed config (ready to be JSON-stringified
 * and stored on the Integration row).
 */
export function validateConfig(
  kind: IntegrationKind,
  config: unknown
): ValidationResult<SlackConfig | DiscordConfig | WebhookConfig | GitHubConfig> {
  switch (kind) {
    case 'slack':
      return validateSlackConfig(config);
    case 'discord':
      return validateDiscordConfig(config);
    case 'webhook':
      return validateWebhookConfig(config);
    case 'github':
      return validateGithubConfig(config);
  }
}

/** Validate the secret-free representation loaded from Integration.configJson. */
export function validateStoredConfig(
  kind: IntegrationKind,
  config: unknown,
): ValidationResult<SlackConfig | DiscordConfig | WebhookConfig | GitHubStoredConfig> {
  if (kind === 'github') {
    if (
      config && typeof config === 'object' &&
      Object.prototype.hasOwnProperty.call(config, 'token')
    ) {
      return { ok: false, error: 'github stored config must not contain a token' };
    }
    return validateGithubRepository(config);
  }
  return validateConfig(kind, config);
}
