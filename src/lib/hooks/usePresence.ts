'use client';

// usePresence
//
// Client-side presence heartbeat + "who's online" poll loop for the
// collaboration feature (collab card). Both ends share the same 5s
// cadence that the rest of the dashboard uses (see DashboardProjects
// for the projects poll, useRecaptureStatus for the recapture poll) so
// all three are rate-limited by the same browser tab-visibility logic.
//
// Two responsibilities, two intervals:
//
// 1) HEARTBEAT (POST /api/presence every 5s)
//    The hook keeps a stable `userId` in localStorage so the same
//    reviewer gets the same presence row across page reloads and
//    tabs. The userId is a v4 UUID, generated once on first load and
//    read on every subsequent mount. F10 will replace this with the
//    real session's user id (and add a server-issued JWT to auth the
//    userId). For now, anyone with the dashboard origin can pose as
//    anyone — the dashboard origin is trusted (same allow-list as
//    the rest of the API) and the presence rows are advisory dots.
//
//    The hook also forwards the live cursor as a (cursorX, cursorY)
//    percentage of the screenshot. The caller passes the current
//    screenshot id + cursor ref via opts; the hook reads it on
//    each tick. The POST is debounced by the 5s tick itself — the
//    route accepts a 60s TTL, so a few missed heartbeats don't drop
//    the user from the list.
//
// 2) POLL (GET /api/presence?projectId=X every 5s)
//    Returns the full TTL list of "online" reviewers for the project.
//    We intentionally do NOT pass ?since= — presence rows age out via
//    a 60s TTL, and a delta-only poll would leave stale users on the
//    client after they drop off the server list. Always replacing with
//    the full TTL window is the simplest correct merge.
//
// Why polling and not SSE: F2 will swap the GET poll for an SSE
// stream. The hook's `presences` + `myUserId` shape is designed to
// survive that swap — the component consumes the state, not the
// transport. F2 just needs to call `setPresences(...)` when a delta
// arrives from the SSE channel.

import { useEffect, useRef, useState } from 'react';
import { dashboardHeaders } from '@/lib/client-origin';

// 5s heartbeat / poll — matches the rest of the dashboard's cadence.
// The presence TTL on the server is 60s, so 5s = up to ~12 missed
// heartbeats before a user drops off the list.
const HEARTBEAT_INTERVAL_MS = 5_000;

// localStorage key for the client-generated userId. Versioned so we
// can change the shape (or reset the value) without colliding with
// older deployments' stored UUIDs.
const USER_ID_KEY = 'markup.presence.userId.v1';

export interface PresenceRow {
  id: string;
  userId: string;
  projectId: string;
  screenshotId: string | null;
  lastSeenAt: string;
  cursorX: number | null;
  cursorY: number | null;
}

export interface UsePresenceOptions {
  /** Project we're "in" right now. The heartbeat targets this project,
   *  and the poll filters to this project. */
  projectId: string;
  /** The screenshot the reviewer is currently viewing (if any). null/undefined
   *  means "no screenshot" (e.g. project is open but no specific image). */
  screenshotId?: string | null;
  /** Latest cursor position (0-100 percent of the screenshot bounds). null
   *  means the cursor is off the image. The hook reads `.current` on every
   *  tick. */
  cursorRef?: React.MutableRefObject<{ x: number | null; y: number | null } | null>;
}

export interface UsePresenceResult {
  /** The stable userId for this browser. Read this on first render so
   *  the dashboard can mark "you" in the list. */
  myUserId: string;
  /** All other reviewers currently online in this project (does NOT
   *  include `myUserId` — the dashboard wants to render "you"
   *  separately). */
  others: PresenceRow[];
}

/** Generate a v4 UUID. Uses crypto.randomUUID where available; falls
 *  back to a math-random implementation for older browsers (Node /
 *  jsdom test envs). */
function generateUuid(): string {
  // crypto.randomUUID is available in modern browsers and Node 19+.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // RFC 4122 v4 fallback. Not used in the browser, only in test envs
  // and ancient runtimes.
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  // Per spec, set the version (4) and variant (10) bits.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
  return (
    hex.slice(0, 4).join('') + '-' +
    hex.slice(4, 6).join('') + '-' +
    hex.slice(6, 8).join('') + '-' +
    hex.slice(8, 10).join('') + '-' +
    hex.slice(10, 16).join('')
  );
}

/** Read or generate the stable per-browser userId. Reads from
 *  localStorage; if missing or malformed, generates + persists a new
 *  one. Returns null on the server / when localStorage is unavailable
 *  (e.g. SSR), so the caller can defer the first heartbeat to the
 *  client effect. */
function readOrCreateUserId(): string | null {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return null;
  }
  try {
    const existing = localStorage.getItem(USER_ID_KEY);
    if (existing && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(existing)) {
      return existing;
    }
    const fresh = generateUuid();
    localStorage.setItem(USER_ID_KEY, fresh);
    return fresh;
  } catch {
    // localStorage may be disabled (private mode, quota, etc.). Fall
    // back to an ephemeral id; the user will be "new" on every
    // reload, but heartbeats still work for the current session.
    return generateUuid();
  }
}

export function usePresence(opts: UsePresenceOptions): UsePresenceResult {
  const { projectId, screenshotId = null, cursorRef } = opts;

  // myUserId: read from localStorage on first mount. null on the
  // server / SSR pass. We use state (not just a ref) so the first
  // heartbeat has the value synchronously after mount.
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [presences, setPresences] = useState<PresenceRow[]>([]);

  // mountedRef: bail out of the heartbeat/poll if the component
  // unmounts during a 5s sleep. Without this, setState would fire
  // on an unmounted component (React warning + memory leak).
  const mountedRef = useRef<boolean>(true);

  // Read the userId from session OR localStorage on mount. Defer
  // the first heartbeat to AFTER we've resolved it (avoids the
  // "POST with null userId" race on first render).
  //
  // Order of precedence:
  //   1. /api/auth/me — a real session gives a real User.id
  //      (F10). This is the preferred path; the dashboard's
  //      LoginForm is the entry point, so most open tabs have
  //      a valid session by the time usePresence mounts.
  //   2. localStorage — the legacy F1 client-generated UUID.
  //      Kept for the (rare) case where the dashboard renders
  //      before login completes, or for callers that hit
  //      /api/presence from a non-dashboard origin (the
  //      presence route is dashboard-gated, so this should
  //      never happen in practice — but the fallback is here
  //      as defense in depth).
  //   3. A fresh UUID — last resort, so the heartbeat can
  //      still go out on a tab that never logs in. Treated
  //      as anonymous (no auth → no real identity).
  useEffect(() => {
    mountedRef.current = true;
    let resolved: string | null = null;
    (async () => {
      try {
        const res = await fetch('/api/auth/me', {
          credentials: 'same-origin',
          cache: 'no-store',
        });
        if (mountedRef.current && res.ok) {
          const data = await res.json();
          if (data?.user?.id) {
            resolved = data.user.id as string;
          }
        }
      } catch {
        // Network blip → fall through to localStorage.
      }
      if (!resolved) {
        resolved = readOrCreateUserId();
      }
      if (resolved && mountedRef.current) setMyUserId(resolved);
    })();
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // POST heartbeat. Fires immediately on (myUserId || projectId)
  // change, then on the 5s tick. The route is idempotent — it
  // upserts on (userId, projectId) — so re-firing on a project
  // switch is correct (and the old projectId's row simply stops
  // being bumped and ages out after 60s).
  useEffect(() => {
    if (!myUserId || !projectId) return;
    let cancelled = false;

    const sendHeartbeat = async () => {
      if (cancelled || !mountedRef.current) return;
      const cursor = cursorRef?.current ?? null;
      try {
        await fetch('/api/presence', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...dashboardHeaders() },
          body: JSON.stringify({
            projectId,
            userId: myUserId,
            screenshotId: screenshotId ?? null,
            // Send null (not the number) when the cursor is off the
            // image so the server stores an explicit "no cursor".
            cursorX: cursor?.x ?? null,
            cursorY: cursor?.y ?? null,
          }),
        });
      } catch {
        // Network blip — the next 5s tick will retry. The presence
        // row's lastSeenAt stays at the previous bump; if we lose
        // ~12 ticks in a row the row will age out and we'll
        // re-create it on the next successful heartbeat.
      }
    };

    // Fire immediately on mount / on projectId change. The first
    // heartbeat MUST go out as soon as we have a userId so the
    // reviewer shows up in the "online" list within 5s of opening
    // the dashboard.
    sendHeartbeat();
    const id = setInterval(() => {
      if (!document.hidden) sendHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [myUserId, projectId, screenshotId, cursorRef]);

  // GET poll for the "online" list. F2 will swap this for SSE; the
  // setPresences() call survives the swap.
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;

    const fetchList = async () => {
      if (cancelled || !mountedRef.current) return;
      try {
        // Always fetch the full TTL list — no ?since=. Presence
        // rows expire server-side; a delta poll would leave stale
        // users in client state after they drop off.
        const url = `/api/presence?projectId=${encodeURIComponent(projectId)}`;
        const res = await fetch(url, {
          cache: 'no-store',
          headers: dashboardHeaders(),
        });
        if (!res.ok) return;
        const data = (await res.json()) as { presences?: PresenceRow[] };
        // Defensive: the route always returns { presences: [...] },
        // but a misrouted fetch (e.g. test mocks) or a stale service
        // worker could land on a different shape. Treat a missing
        // array as an empty list rather than a TypeError.
        if (mountedRef.current && !cancelled) {
          const list = Array.isArray(data.presences) ? data.presences : [];
          setPresences(list);
        }
      } catch {
        // silent retry - keep showing old data
      }
    };

    fetchList();
    const id = setInterval(() => {
      if (!document.hidden) fetchList();
    }, HEARTBEAT_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [projectId]);

  // Exclude self from `others` so the dashboard can render "you"
  // separately. We compute this on every render — the list is
  // bounded by the 60s TTL × heartbeat rate, so in practice it's
  // <20 rows.
  const others = myUserId
    ? presences.filter((p) => p.userId !== myUserId)
    : presences;

  // myUserId is typed as string in the public interface; coerce the
  // null (SSR / localStorage unavailable) case to a stable empty
  // string so consumers don't have to handle null. The hook never
  // sends a heartbeat without a real id, so this is safe.
  return { myUserId: myUserId ?? '', others };
}

/** Stable color picker for a userId. Hashes the id to one of 8
 *  distinct Tailwind colors so two reviewers with the same id get
 *  the same color across renders, and different ids get visually
 *  distinct colors. Exported so the PresenceList component and any
 *  cursor-dot rendering can share the same mapping. */
export function colorForUserId(userId: string): string {
  const colors = [
    'bg-blue-500',
    'bg-green-500',
    'bg-yellow-500',
    'bg-pink-500',
    'bg-purple-500',
    'bg-indigo-500',
    'bg-red-500',
    'bg-orange-500',
  ];
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return colors[hash % colors.length];
}

/** Short display label for a userId — first 6 hex chars, uppercased.
 *  Used in the cursor-dot tooltip and the "online" sidebar. F10
 *  will replace this with the real reviewer name. */
export function shortLabelForUserId(userId: string): string {
  return userId.replace(/-/g, '').slice(0, 6).toUpperCase();
}
