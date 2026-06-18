// In-memory pub-sub for live dashboard updates.
//
// Backs the SSE endpoint at /api/events. Routes that mutate project state
// (POST /api/pins, POST /api/pins/[id]/comments, the recapture exit handler
// in POST /api/screenshots/[id]/recapture) call `emit()` to broadcast a
// typed event. The SSE route calls `subscribe()` for each open client and
// pipes incoming events into the text/event-stream response.
//
// ─── Per-process limitation (the only one that matters) ──────────────────────
// Subscriber state lives in a module-level `Map` that is fully in-memory.
// This is FINE for the current single-container deploy (one Next.js process
// behind a single PM2 instance): every POST /api/pins, every open SSE
// connection, and every read of the subscriber list hits the same Map.
//
// Horizontal scaling (multiple Node workers, multiple containers, or a
// serverless runtime) WILL break this: an emit on worker A won't reach a
// subscriber on worker B. The migration path is to swap the Map for a
// shared pub-sub:
//
//   - Postgres LISTEN/NOTIFY (we already have a Postgres connection; just
//     open a dedicated client per worker and NOTIFY on emit, LISTEN on
//     subscribe). One column per "topic" or one channel per projectId.
//   - Redis pub/sub (lighter if Redis is already in the stack). A single
//     PUBLISH per emit, a SUBSCRIBE per projectId per worker.
//
// The signatures of `emit` / `subscribe` are the only seam that would need
// to change; route handlers and the SSE endpoint stay the same. Do not
// horizontally scale this service without first swapping the Map.

/**
 * Event types broadcast over the SSE channel. The discriminated union is
 * the contract between the emitters (mutating routes) and the subscribers
 * (the SSE client in the dashboard). New event types are additive — old
 * clients just ignore them.
 */
export type LiveEventType =
  | 'presence-update'
  | 'new-pin'
  | 'new-comment'
  | 'recapture-complete';

/**
 * Base shape shared by every event. `projectId` is always set; the SSE
 * route uses it to route the event to the right subscriber set. `type`
 * is the discriminator.
 */
export interface LiveEventBase {
  type: LiveEventType;
  projectId: string;
}

/**
 * Discriminated union over `type`. Each variant carries the minimal payload
 * the dashboard needs to update its view without refetching. Sensitive
 * fields (project apiKey, full project config, full pin row from
 * prisma.findUnique) are intentionally NOT included — the emitter picks
 * a safe projection.
 */
export type LiveEvent =
  | (LiveEventBase & { type: 'presence-update'; payload: { presences: Array<{ id: string; userId: string; screenshotId: string | null; cursorX: number | null; cursorY: number | null; lastSeenAt: string }> } })
  | (LiveEventBase & { type: 'new-pin'; payload: { pin: { id: string; screenshotId: string; xPercent: number; yPercent: number; status: string; authorName: string; createdAt: string } } })
  | (LiveEventBase & { type: 'new-comment'; payload: { pinId: string; comment: { id: string; text: string; author: string; authorRole: string; createdAt: string; attachments: Array<{ id: string; kind: 'image' | 'voice' | 'video'; mimeType: string; size: number; url: string }> } } })
  | (LiveEventBase & { type: 'recapture-complete'; payload: { screenshotId: string; width: number; height: number; capturedAt: string } });

/**
 * Subscriber callback. Receives the typed event; the SSE route wraps this
 * in a `controller.enqueue(...)` call to push the event down the wire.
 */
export type EventCallback = (event: LiveEvent) => void;

// Per-projectId set of callbacks. The Map key is the projectId string;
// the value is a Set so add/remove are O(1) and so we don't double-fire
// if a caller subscribes twice (the second subscribe replaces the first
// via the same identity).
const subscribers = new Map<string, Set<EventCallback>>();

/**
 * Emit a typed event. The event is delivered synchronously to every
 * callback subscribed to its projectId. Synchronous delivery keeps the
 * emit() call's semantics simple ("after the emit, every subscriber has
 * been called") and avoids the "what if the next-tick never runs" hazard
// of an async fan-out.
 *
 * Subscribers that throw are caught and logged — one buggy client
 * connection can't take down the others. The same try/catch wraps the
 * fan-out so a single misbehaving subscriber can't cause the rest to
 * miss the event (we still call them all, just in a try/catch).
 */
export function emit(event: LiveEvent): void {
  const set = subscribers.get(event.projectId);
  if (!set || set.size === 0) return;
  // Snapshot the callbacks so a subscriber that unsubscribes itself in
  // its own handler doesn't mutate the set mid-iteration (which would
  // throw). The set is small (one entry per open dashboard tab), so the
  // copy is cheap.
  const list = Array.from(set);
  for (const cb of list) {
    try {
      cb(event);
    } catch (err) {
      // Don't let one subscriber's throw take down the rest of the
      // fan-out. console.error so the operator can see it in container
      // logs; we don't have a per-subscriber metric channel.
      console.error('[events] subscriber threw on emit:', err);
    }
  }
}

/**
 * Subscribe to events for a given projectId. The callback fires for
 * every event whose `projectId` matches; `type` and `payload` filtering
 * are the caller's responsibility.
 *
 * Returns an unsubscribe function. Callers MUST call it on cleanup (e.g.
 * the SSE route's stream `cancel` handler); without the unsubscribe the
 * closed connection's callback would still fire, and the Set would grow
 * forever.
 */
export function subscribe(projectId: string, callback: EventCallback): () => void {
  let set = subscribers.get(projectId);
  if (!set) {
    set = new Set();
    subscribers.set(projectId, set);
  }
  set.add(callback);
  return () => {
    const s = subscribers.get(projectId);
    if (!s) return;
    s.delete(callback);
    // Drop the projectId key when the last subscriber leaves so the
    // Map doesn't accumulate empty Sets for one-off projectIds.
    if (s.size === 0) {
      subscribers.delete(projectId);
    }
  };
}

/**
 * Number of currently-subscribed callbacks. Exposed for tests; also a
 * useful sanity check ("why is my test holding on to callbacks?") from
 * the Node REPL.
 */
export function _subscriberCount(): number {
  let n = 0;
  subscribers.forEach((set) => {
    n += set.size;
  });
  return n;
}

/**
 * Drop every subscriber. Test-only escape hatch. Production code should
 * never need this — unsubscribes are paired with the connection lifecycle.
 */
export function _resetSubscribers(): void {
  subscribers.clear();
}
