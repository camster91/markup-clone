// Discord adapter: post a pin notification to a Discord webhook.
//
// Discord incoming webhooks accept a JSON body with optional
// `content` (plain text) and `embeds` (rich cards). We send
// ONE embed that summarises the pin: title is the project +
// page, description is the comment text (or a "no comment"
// fallback), and the footer carries the pin id + author +
// timestamp.
//
// Body shape (per https://discord.com/developers/docs/resources/webhook#execute-webhook):
//   {
//     "content": "optional plain text (supports @mentions)",
//     "embeds": [
//       {
//         "title": "...",
//         "description": "...",
//         "color": 0xRRGGBB,
//         "footer": { "text": "..." },
//         "timestamp": "ISO-8601 string"
//       }
//     ]
//   }
//
// We do NOT add an Authorization header — Discord webhooks are
// URL-authenticated. Adding one would 401.

import type { DiscordConfig, PinPayload } from './types';
import { safeOutboundFetch } from '@/lib/ssrf';

const EMBED_COLOR = 0x3b82f6; // blue-500; matches the dashboard's accent

/**
 * Build the Discord message body for a pin event.
 *
 * Exported (not just internal) so the test suite can assert
 * against the exact JSON the adapter sends.
 */
export function buildDiscordBody(payload: PinPayload) {
  const { pin, project, path, commentText } = payload;
  return {
    content: `New pin on **${project.name}** (${path})`,
    embeds: [
      {
        title: `${project.name} — ${path}`,
        description: commentText || '_no comment_',
        // Discord colour is a 24-bit integer; 0x3b82f6 = blue-500
        color: EMBED_COLOR,
        footer: {
          text: `pin ${pin.id} • ${pin.authorName} • ${pin.xPercent.toFixed(0)}%, ${pin.yPercent.toFixed(0)}%`,
        },
        timestamp: pin.createdAt,
      },
    ],
  };
}

/**
 * POST the pin payload to the Discord incoming webhook URL.
 *
 * Throws on a non-2xx response (the route layer catches and
 * records lastError).
 */
export async function post(config: DiscordConfig, payload: PinPayload): Promise<void> {
  const res = await safeOutboundFetch(config.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildDiscordBody(payload)),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Discord webhook returned ${res.status}: ${text.slice(0, 200)}`);
  }
}
