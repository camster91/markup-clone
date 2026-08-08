// Slack adapter: post a pin notification to a Slack incoming webhook.
//
// Slack's incoming webhooks accept a JSON body with a `text`
// field and an optional `blocks` array. The endpoint is
// authenticated by the URL itself (no per-message auth) so we
// do NOT add any Authorization header — Slack rejects the
// request if a header it doesn't recognize is present.
//
// Body shape (per https://api.slack.com/messaging/webhooks):
//   {
//     "text": "fallback string for notifications that don't
//               render blocks",
//     "blocks": [
//       { "type": "section", "text": { "type": "mrkdwn", ... } },
//       { "type": "context", "elements": [ ... ] }
//     ]
//   }
//
// We use blocks (not attachments) because the attachments
// shape is deprecated for new apps. The block layout puts the
// project / page / comment in a section and the position +
// timestamp in a context row.

import type { IntegrationDeliveryPayload, PinPayload, SlackConfig } from './types';
import { pinPayloadFromEvent } from './types';
import { assertSafeOutboundUrl } from '@/lib/safe-url';
import { IntegrationHttpError } from './errors';

const OUTBOUND_TIMEOUT_MS = 10_000;

/**
 * Build the Slack message body for a pin event.
 *
 * Exported (not just internal) so the test suite can assert
 * against the exact JSON the adapter sends without going
 * through the fetch mock.
 */
export function buildSlackBody(payload: PinPayload) {
  const { pin, project, path, commentText } = payload;
  // Slack mrkdwn supports `*bold*` but NOT `**bold**` (which
  // renders literally). We use a single asterisk for the bold
  // project / page / author line. The link to the dashboard is
  // a Slack-style <url|label> so the label text is underlined
  // in the Slack client.
  const headline = `*${project.name}* — new feedback on \`${path}\``;
  const detail = commentText
    ? `>${commentText.replace(/\n/g, '\n>')}`
    : '_no comment_';
  return {
    text: `New pin on ${project.name} (${path})`, // fallback for clients that don't render blocks
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${headline}\n${detail}`,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text:
              `*Author:* ${pin.authorName}  ` +
              `*Position:* ${pin.xPercent.toFixed(0)}%, ${pin.yPercent.toFixed(0)}%  ` +
              `*Pin ID:* \`${pin.id}\``,
          },
        ],
      },
    ],
  };
}

/**
 * POST the pin payload to the Slack incoming webhook URL.
 *
 * Throws on a non-2xx response (the route layer catches and
 * records lastError). Uses global `fetch` (Node 18+) — the
 * project does not depend on node-fetch.
 */
export async function post(config: SlackConfig, payload: PinPayload): Promise<void> {
  const safe = await assertSafeOutboundUrl(config.webhookUrl);
  if (!safe.ok) {
    throw new Error(`Slack webhook URL rejected: ${safe.error}`);
  }
  const res = await fetch(safe.value, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildSlackBody(payload)),
    redirect: 'error',
    signal: AbortSignal.timeout(OUTBOUND_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new IntegrationHttpError('Slack webhook', res.status, res.headers?.get?.('retry-after') ?? null);
  }
}

export async function postEvent(
  config: SlackConfig,
  delivery: IntegrationDeliveryPayload,
): Promise<number> {
  const safe = await assertSafeOutboundUrl(config.webhookUrl);
  if (!safe.ok) throw new Error(`Slack webhook URL rejected: ${safe.error}`);
  const res = await fetch(safe.value, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildSlackBody(pinPayloadFromEvent(delivery.event))),
    redirect: 'error',
    signal: AbortSignal.timeout(OUTBOUND_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new IntegrationHttpError('Slack webhook', res.status, res.headers?.get?.('retry-after') ?? null);
  }
  return res.status;
}
