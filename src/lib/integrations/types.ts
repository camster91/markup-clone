// Shared types for the outbound integration adapters.
//
// Each adapter (slack / discord / webhook) takes a kind-specific
// `config` and a unified `payload` (a safe projection of the new
// pin + its project) and POSTs to an external endpoint. The
// `post()` call throws on any non-2xx response so the calling
// site can decide how to react (e.g. update lastError on the
// integration row).
//
// `config` shapes are validated at the API layer (see
// /api/projects/[id]/integrations) before they land in the
// Integration.configJson column. The adapter trusts its config
// — no further runtime validation.

/**
 * The minimal pin projection handed to the integration adapters.
 *
 * This is a SAFE projection: no apiKey, no raw screenshot bytes,
 * no oversized HTML payload. The widget and dashboard both treat
 * this as the canonical "this pin happened" event; integrations
 * should be free to render it however the channel wants.
 */
export interface PinPayload {
  pin: {
    id: string;
    screenshotId: string;
    xPercent: number;
    yPercent: number;
    status: string;
    authorName: string;
    /** ISO-8601 string. */
    createdAt: string;
  };
  project: {
    id: string;
    name: string;
    domain: string;
  };
  /** Page path the pin was placed on (e.g. "/", "/about"). */
  path: string;
  /** Comment text, if any. Empty string when the pin has no comment. */
  commentText: string;
}

/**
 * Slack incoming-webhook config. The webhook URL is everything
 * Slack needs; there's no per-message auth because Slack
 * ingests the URL itself as the credential.
 */
export interface SlackConfig {
  webhookUrl: string;
}

/** Discord incoming-webhook config. Same shape as Slack. */
export interface DiscordConfig {
  webhookUrl: string;
}

/** Generic webhook config. `headers` is optional and lets an operator attach
 * receiver-specific authentication. System signature headers are reserved. */
export interface WebhookConfig {
  url: string;
  headers?: Record<string, string>;
}

/** Secret-free GitHub repository selection persisted in configJson. */
export interface GitHubStoredConfig {
  owner: string;
  repo: string;
  labels: string[];
}

/** Runtime GitHub config after the encrypted credential is opened in memory. */
export interface GitHubConfig extends GitHubStoredConfig {
  token: string;
}

import type { PinCreatedEventV1 } from './events';

/** Exact data required to perform one durable, reproducible delivery attempt. */
export interface IntegrationDeliveryPayload {
  event: PinCreatedEventV1;
  payloadJson: string;
  deliveryId: string;
  signingSecret: string | null;
  /** Unix timestamp in whole seconds, fixed for this attempt. */
  timestamp: string;
}

/** Translate the v1 developer-focused event into the original channel card. */
export function pinPayloadFromEvent(event: PinCreatedEventV1): PinPayload {
  const issue = event.data.issue;
  const firstComment = issue.comments[0];
  return {
    pin: {
      id: issue.pin.id,
      screenshotId: issue.screenshot.id,
      xPercent: issue.pin.coordinates.xPercent,
      yPercent: issue.pin.coordinates.yPercent,
      status: issue.pin.status,
      authorName: firstComment?.author ?? 'Client',
      createdAt: issue.pin.createdAt,
    },
    project: issue.project,
    path: issue.page.path,
    commentText: firstComment?.text ?? '',
  };
}

/**
 * The shape of `Integration.configJson` for each kind. The API
 * layer narrows on `kind` and then validates against the
 * matching member of this union.
 */
export type IntegrationConfig =
  | { kind: 'slack'; config: SlackConfig }
  | { kind: 'discord'; config: DiscordConfig }
  | { kind: 'webhook'; config: WebhookConfig }
  | { kind: 'github'; config: GitHubConfig };

/** Closed set of supported kinds. Used by the API to validate
 *  the incoming `kind` field on POST. */
export const INTEGRATION_KINDS = ['slack', 'discord', 'webhook', 'github'] as const;
export type IntegrationKind = (typeof INTEGRATION_KINDS)[number];

export function isIntegrationKind(v: unknown): v is IntegrationKind {
  return (
    typeof v === 'string' &&
    (INTEGRATION_KINDS as readonly string[]).includes(v)
  );
}
