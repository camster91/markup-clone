'use client';

// HistoryPanel — shows the last 50 ScreenshotVersion rows for a
// screenshot as a grid of thumbnails. Each thumbnail is the
// version's PNG served from /api/screenshots/[id]/image with a
// ?storageKey=<key> query. Clicking a thumbnail opens a full-size
// modal with the version's PNG and its metadata (capturedAt,
// dims, recapture author).
//
// Wired into ScreenshotView as a "History" tab in the header bar.
// Tabs are local UI state — only the active tab is rendered, so
// flipping back and forth between "Latest" and "History" doesn't
// re-fetch the history list.
//
// Fetch lifecycle:
//   - On mount (when the tab first opens), the panel GETs
//     /api/screenshots/[id]/history and caches the result in
//     component state.
//   - The ScreenshotView's recapture handler bumps `imageKey` on a
//     successful recapture. We watch `imageKey` as a refresh signal:
//     on every bump, we re-fetch the history so the new version
//     shows up at the top of the grid (the previous fetch may have
//     raced with the route's ScreenshotVersion insert — the re-fetch
//     on the next imageKey bump is the "definitely caught up" point).
//
// 50-row cap comes from the server: the history endpoint always
// returns at most 50 rows ordered by capturedAt desc. Older
// versions beyond the cap are not addressable from this UI; the
// task's explicit limit.

import { useEffect, useState, useCallback, useRef } from 'react';

export type ScreenshotVersionRow = {
  id: string;
  capturedAt: string;
  width: number;
  height: number;
  storageKey: string;
  createdBy: string;
};

export default function HistoryPanel({
  screenshotId,
  /** Bumped by the parent ScreenshotView after a successful recapture;
   *  we re-fetch the history on every bump so the new version shows
   *  up at the top of the grid. */
  refreshKey,
  /** Optional share token appended to thumbnail / full image URLs
   *  so share viewers (if ever shown History) can authorize image
   *  GETs. Dashboard callers omit this. */
  shareToken = null,
}: {
  screenshotId: string;
  refreshKey: number;
  shareToken?: string | null;
}) {
  const [versions, setVersions] = useState<ScreenshotVersionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ScreenshotVersionRow | null>(null);
  // Track the last refreshKey we acted on so a back-to-back bump
  // doesn't trigger two fetches (React strict mode + double-bump
  // from the recapture hook's imageKey update).
  const lastFetchedKey = useRef<number>(-1);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch(`/api/screenshots/${screenshotId}/history`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        setError(`Failed to load history (${res.status})`);
        return;
      }
      const body = (await res.json()) as { versions: ScreenshotVersionRow[] };
      setVersions(body.versions);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    }
  }, [screenshotId]);

  useEffect(() => {
    if (lastFetchedKey.current === refreshKey) return;
    lastFetchedKey.current = refreshKey;
    void fetchHistory();
  }, [refreshKey, fetchHistory]);

  if (error) {
    return (
      <div className="p-4 text-sm text-red-600" role="alert">
        {error}
      </div>
    );
  }

  if (versions === null) {
    return (
      <div className="p-4 text-sm text-gray-500" data-testid="history-loading">
        Loading history…
      </div>
    );
  }

  if (versions.length === 0) {
    return (
      <div
        className="p-4 text-sm text-gray-500"
        data-testid="history-empty"
      >
        No recaptures yet — the current screenshot is the only version.
      </div>
    );
  }

  return (
    <div className="p-4" data-testid="history-panel">
      <p className="text-xs text-gray-500 mb-3">
        {versions.length} version{versions.length === 1 ? '' : 's'}, newest first.
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {versions.map((v) => {
          // The /image endpoint accepts ?storageKey=<key> for
          // arbitrary versions (security: it 404s if the key
          // doesn't belong to this screenshot). We pass the
          // version's storageKey so the right PNG is served —
          // older captures still exist on disk and the file is
          // immutable (immutable Cache-Control makes the browser
          // cache it for a year).
          const shareQ = shareToken ? `&share=${encodeURIComponent(shareToken)}` : '';
          const thumbUrl = `/api/screenshots/${screenshotId}/image?storageKey=${encodeURIComponent(v.storageKey)}${shareQ}`;
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => setSelected(v)}
              data-testid={`history-thumb-${v.id}`}
              className="text-left border border-gray-200 rounded-md overflow-hidden bg-white hover:border-blue-400 hover:shadow-md transition focus:outline-none focus:ring-2 focus:ring-blue-300"
              title={`Captured ${new Date(v.capturedAt).toLocaleString()} · ${v.width}×${v.height}px`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- served from /api/screenshots/[id]/image with immutable Cache-Control + ETag, same contract as the main ScreenshotView's <img>. */}
              <img
                src={thumbUrl}
                alt={`Version from ${new Date(v.capturedAt).toLocaleString()}`}
                className="block w-full h-auto"
                loading="lazy"
                draggable={false}
              />
              <div className="px-2 py-1 text-[10px] text-gray-500 flex items-center justify-between">
                <span>{new Date(v.capturedAt).toLocaleString()}</span>
                <span className="text-gray-400">
                  {v.width}×{v.height}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {selected && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Version full size"
          onClick={() => setSelected(null)}
        >
          <div
            className="bg-white rounded-lg max-w-[95vw] max-h-[95vh] overflow-auto shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 text-xs text-gray-600">
              <span>
                {new Date(selected.capturedAt).toLocaleString()} ·{' '}
                {selected.width}×{selected.height}px
                {selected.createdBy !== 'system' && ` · by ${selected.createdBy}`}
              </span>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="px-2 py-1 rounded border border-gray-300 hover:bg-gray-100"
              >
                Close
              </button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element -- see comment above. */}
            <img
              src={`/api/screenshots/${screenshotId}/image?storageKey=${encodeURIComponent(selected.storageKey)}${shareToken ? `&share=${encodeURIComponent(shareToken)}` : ''}`}
              alt={`Version from ${new Date(selected.capturedAt).toLocaleString()}`}
              className="block max-w-full h-auto"
            />
          </div>
        </div>
      )}
    </div>
  );
}
