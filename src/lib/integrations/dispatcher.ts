// Dispatcher: pick the right adapter for a given Integration
// row and call it. Centralised so the pin route and the test
// route both invoke the same code path — and so adding a new
// integration kind is a one-place change (add the adapter +
// add a case here).
//
// The dispatcher does NOT catch errors — the calling site
// decides what to do. The pin route catches + records
// lastError on the integration row; the test route rethrows
// so the response can surface "ok: false" to the dashboard.

import * as slack from './slack';
import * as discord from './discord';
import * as webhook from './webhook';
import * as github from './github';
import type { GitHubConfig, IntegrationDeliveryPayload, PinPayload, IntegrationKind } from './types';
import { IntegrationHttpError } from './errors';
import { classifyDeliveryStatus } from './retry';

export type DispatchResult = { ok: true } | { ok: false; error: string };
export type DeliveryDispatchResult =
  | { ok: true; statusCode: number; externalId?: string; externalUrl?: string }
  | { ok: false; error: string; retryable: boolean; statusCode?: number; retryAfter?: string };

/**
 * Dispatch a payload to the right adapter for `kind`.
 *
 * @returns `{ ok: true }` on a 2xx response, `{ ok: false, error }`
 *          on any failure (non-2xx, network error, JSON parse).
 *          The caller should use this to update the integration
 *          row's `lastSuccessAt` / `lastError` / `lastErrorAt`.
 */
export async function dispatch(
  kind: IntegrationKind,
  config: unknown,
  payload: PinPayload
): Promise<DispatchResult> {
  try {
    switch (kind) {
      case 'slack':
        await slack.post(config as { webhookUrl: string }, payload);
        return { ok: true };
      case 'discord':
        await discord.post(config as { webhookUrl: string }, payload);
        return { ok: true };
      case 'webhook':
        await webhook.post(
          config as { url: string; headers?: Record<string, string> },
          payload
        );
        return { ok: true };
      case 'github':
        await github.verifyGithubRepository(config as GitHubConfig);
        return { ok: true };
      default: {
        // Exhaustiveness check — if a new kind is added without
        // a case here, this branch catches it at runtime.
        const _exhaustive: never = kind;
        return { ok: false, error: `Unknown integration kind: ${String(_exhaustive)}` };
      }
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Dispatch one durable event attempt and preserve retry-relevant metadata. */
export async function dispatchDelivery(
  kind: IntegrationKind,
  config: unknown,
  delivery: IntegrationDeliveryPayload,
): Promise<DeliveryDispatchResult> {
  try {
    let statusCode: number;
    let externalReference: { externalId: string; externalUrl: string } | undefined;
    switch (kind) {
      case 'slack':
        statusCode = await slack.postEvent(config as { webhookUrl: string }, delivery);
        break;
      case 'discord':
        statusCode = await discord.postEvent(config as { webhookUrl: string }, delivery);
        break;
      case 'webhook':
        if (!delivery.signingSecret) {
          return { ok: false, error: 'Webhook signing secret is missing', retryable: false };
        }
        statusCode = await webhook.postEvent(
          config as { url: string; headers?: Record<string, string> },
          delivery,
        );
        break;
      case 'github': {
        const result = await github.postEvent(config as GitHubConfig, delivery);
        statusCode = result.statusCode;
        externalReference = { externalId: result.externalId, externalUrl: result.externalUrl };
        break;
      }
      default: {
        const _exhaustive: never = kind;
        return {
          ok: false,
          error: `Unknown integration kind: ${String(_exhaustive)}`,
          retryable: false,
        };
      }
    }
    return { ok: true, statusCode, ...externalReference };
  } catch (error) {
    if (error instanceof IntegrationHttpError) {
      return {
        ok: false,
        error: error.message,
        statusCode: error.statusCode,
        retryable: Boolean(error.retryAfter) || classifyDeliveryStatus(error.statusCode) === 'retry',
        ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}),
      };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      retryable: true,
    };
  }
}
