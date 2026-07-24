// Server-Sent Events for live dashboard updates.
//
// GET /api/events?projectId=X&screenshotId=Y (screenshotId optional)
//
// Streams newline-delimited `event:` lines as they happen, using the
// standard text/event-stream content type. The browser's EventSource
// reconnects automatically on disconnect; we re-subscribe on the
// server when a new connection arrives.
//
// Auth: dashboard origin (requireDashboardSession). Same gate as the
// other /api/* routes — the SSE channel is only for the dashboard.
//
// ─── Why SSE and not WebSockets ─────────────────────────────────────────────
// The dashboard is a server-rendered Next.js app. WebSockets need a
// separate server (or the unstable upgrade dance on a Node server),
// and the existing PM2 + next start topology already serves long-lived
// connections just fine. SSE rides on plain HTTP/1.1, gets free
// auto-reconnect from EventSource, and is unidirectional — which is
// what we want (the dashboard is a consumer, not a producer of events).
//
// ─── How the stream is kept alive ───────────────────────────────────────────
// The in-memory pub-sub (src/lib/events.ts) fans events into the
// controller.enqueue() callback. Between events, we send a `: ping`
// comment line every 25 seconds — the EventSource ignores comment lines,
// but the bytes-on-the-wire keep the connection from being timed out by
// a proxy / load balancer. We close the controller when the client
// disconnects (the request's abort signal fires when EventSource is
// torn down on the browser side).
//
// ─── The pub-sub is per-process ──────────────────────────────────────────────
// Subscriber state lives in a module-level Map in src/lib/events.ts.
// This is fine for the single-container deploy. If we ever scale
// horizontally, an emit on worker A won't reach a subscriber on
// worker B — swap the Map for Postgres LISTEN/NOTIFY or Redis pubsub
// (commented on the pub-sub side; no changes needed here).

import { requireDashboardSession } from '@/lib/auth';
import { subscribe, type LiveEvent } from '@/lib/events';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuid(value: string | null, name: string): string | null {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    return `${name} must be a UUID`;
  }
  return null;
}

/** Encode a single SSE message. SSE wire format:
 *
 *   event: <name>\n
 *   data: <json>\n
 *   \n
 *
 * The blank line is the message terminator. `event:` is optional in the
 * spec; we set it so the EventSource can use
 * `addEventListener('new-pin', ...)` directly without parsing the JSON
 * to dispatch.
 *
 * `id:` would be the natural place for a cursor / last-event-id, but
 * the in-memory pub-sub doesn't have a replay buffer — there is no
 * "last id" to put here. Adding one would require a ring buffer of
 * recent events, which is out of scope for F2; the EventSource
 * reconnect just re-subscribes and starts receiving from "now".
 */
function formatSse(event: LiveEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

// 25-second ping. Long enough to keep most proxies from killing an
// idle HTTP/1.1 connection (nginx default is 60s; Cloudflare's free
// tier is 100s); short enough that a half-dead connection is detected
// within a reasonable window.
const PING_INTERVAL_MS = 25_000;

// SSE comment line. EventSource ignores lines beginning with a colon
// per the spec; we use this as a keep-alive heartbeat.
const PING_LINE = ': ping\n\n';

export async function GET(req: Request) {
  const authErr = await requireDashboardSession(req);
  if (authErr) return authErr;

  const url = new URL(req.url);
  const projectId = url.searchParams.get('projectId');
  // screenshotId is optional; the SSE client can subscribe to a
  // whole-project stream (screenshotId=null) or to a single screenshot.
  // The route doesn't use screenshotId to filter the events it
  // forwards — the client filters on its end after receiving the
  // payload. We validate it only so a malformed value 400s cleanly
  // instead of being silently treated as "all screenshots".
  const screenshotIdParam = url.searchParams.get('screenshotId');

  const projectIdErr = requireUuid(projectId, 'projectId');
  if (projectIdErr) {
    return new Response(JSON.stringify({ error: projectIdErr }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (screenshotIdParam !== null) {
    const screenshotIdErr = requireUuid(screenshotIdParam, 'screenshotId');
    if (screenshotIdErr) {
      return new Response(JSON.stringify({ error: screenshotIdErr }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // AbortSignal-driven cleanup. The stream's `cancel` callback runs
  // when the request signal aborts (client disconnects) OR when the
  // underlying stream is cancelled. We use it to clear the ping
  // interval and unsubscribe from the pub-sub so a closed connection
  // can't keep receiving events forever.
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;

      // Handshake: send a `ready` event the moment the client
      // connects so the dashboard can confirm the stream is alive
      // and know which projectId / screenshotId the server bound
      // the subscription to. The ready event uses the same wire
      // shape as the live events, so the EventSource client can
      // listen for it the same way.
      const readyPayload = {
        type: 'ready',
        projectId,
        screenshotId: screenshotIdParam,
      };
      try {
        controller.enqueue(
          encoder.encode(`event: ready\ndata: ${JSON.stringify(readyPayload)}\n\n`)
        );
      } catch {
        // controller was closed between the auth check and now
        // (rare; happens if the client navigated away instantly).
        closed = true;
        return;
      }

      // Subscribe to the pub-sub. The callback is invoked
      // synchronously by emit(); inside it we enqueue onto the
      // controller.
      const unsubscribe = subscribe(projectId as string, (event: LiveEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(formatSse(event)));
        } catch {
          // Controller is closed (client went away). Unsubscribe
          // and stop trying to write. The stream's cancel() will
          // also run, but we don't want to wait for it.
          closed = true;
          unsubscribe();
          clearInterval(pingTimer);
        }
      });

      // Keep-alive ping. Comment lines are ignored by the
      // browser's EventSource but count as bytes for the proxy's
      // idle timer.
      const pingTimer = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(PING_LINE));
        } catch {
          closed = true;
          unsubscribe();
          clearInterval(pingTimer);
        }
      }, PING_INTERVAL_MS);
      // Don't let the ping timer keep the process alive on shutdown.
      pingTimer.unref?.();

      // Client disconnected: stop the timer, unsubscribe, close
      // the controller so the response body is finalised.
      const cancel = () => {
        if (closed) return;
        closed = true;
        clearInterval(pingTimer);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      // req.signal is the request's abort signal — fires when the
      // client tears down the connection.
      req.signal.addEventListener('abort', cancel);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      // Don't buffer the response through any caching layer; SSE
      // streams must reach the browser as they're written.
      'Cache-Control': 'no-cache, no-transform',
      // Keep the connection open. nginx + Cloudflare both honour this.
      'Connection': 'keep-alive',
      // X-Accel-Buffering: no tells nginx to disable proxy buffering
      // for this response. Without it, the SSE bytes sit in the
      // proxy's buffer until the buffer fills or the response ends,
      // and the EventSource times out waiting for the first event.
      'X-Accel-Buffering': 'no',
    },
  });
}
