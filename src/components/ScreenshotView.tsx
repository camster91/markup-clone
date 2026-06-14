'use client';

import { useState } from 'react';
import PinThread from './PinThread';
import type { Pin, FeedbackComment, ScreenshotWithPins } from '@/lib/types';

export default function ScreenshotView({
  screenshot,
  pagePath,
}: {
  screenshot: ScreenshotWithPins;
  pagePath: string;
}) {
  const [activePinId, setActivePinId] = useState<string | null>(null);
  const [pins, setPins] = useState<Pin[]>(screenshot.pins);
  const [recaptureStatus, setRecaptureStatus] = useState<'idle' | 'starting' | 'running' | 'done' | 'error'>('idle');
  const [recaptureError, setRecaptureError] = useState<string | null>(null);
  const [width, setWidth] = useState(screenshot.width);
  const [height, setHeight] = useState(screenshot.height);
  const [capturedAt, setCapturedAt] = useState(screenshot.capturedAt);
  const [imageKey, setImageKey] = useState(0); // bump to force img reload
  const imgUrl = `/api/screenshots/${screenshot.id}/image?v=${imageKey}`;

  const handlePinStatusChange = async (pinId: string, status: 'OPEN' | 'RESOLVED') => {
    const res = await fetch(`/api/pins/${pinId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      setPins(prev => prev.map(p => p.id === pinId ? { ...p, status } : p));
    }
  };

  const handleCommentAdded = (pinId: string, comment: FeedbackComment) => {
    setPins(prev => prev.map(p => p.id === pinId ? { ...p, comments: [...p.comments, comment] } : p));
  };

  // Server-side recapture: fire-and-forget spawn on the host, then poll the
  // focused /api/screenshots/[id]/status endpoint for the new width/height.
  // The previous /api/projects poll pulled the entire project → page →
  // screenshot → pin → comment graph on every 1s tick, which was wasteful
  // for a single-screenshot status check. The image src has a cache-buster
  // so the new PNG renders once the file is replaced on disk.
  const handleRecapture = async () => {
    setRecaptureStatus('starting');
    setRecaptureError(null);
    try {
      const res = await fetch(`/api/screenshots/${screenshot.id}/recapture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setRecaptureStatus('running');
      // Poll for the new screenshot (width/height change in the DB).
      // Cap at 30 polls × 1s = 30s. We pass ?since=<lastCapturedAt> so the
      // endpoint can short-circuit with 304 Not Modified when nothing has
      // changed yet — saving the bandwidth of the JSON body until the
      // recapture actually lands. After a recapture capturedAt is bumped, so
      // the next poll returns 200 with the new dims.
      let updated = false;
      let lastSince = capturedAt;
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 1000));
        try {
          const r2 = await fetch(
            `/api/screenshots/${screenshot.id}/status?since=${encodeURIComponent(lastSince)}`,
            { cache: 'no-store' }
          );
          if (r2.status === 200) {
            const data = await r2.json();
            if (data.width !== width || data.height !== height) {
              setWidth(data.width);
              setHeight(data.height);
              setCapturedAt(data.capturedAt);
              lastSince = data.capturedAt;
              setImageKey(k => k + 1);
              updated = true;
              break;
            }
            // 200 but unchanged (shouldn't normally happen with since=, but
            // be defensive) — keep the latest capturedAt in hand.
            if (data.capturedAt) lastSince = data.capturedAt;
          }
          // 304: nothing has changed yet, keep polling.
        } catch {
          // keep polling
        }
      }
      setRecaptureStatus(updated ? 'done' : 'error');
      if (!updated) {
        setRecaptureError('Timed out waiting for the new screenshot');
      } else {
        // Auto-clear the "done" indicator after 3 seconds
        setTimeout(() => setRecaptureStatus('idle'), 3000);
      }
    } catch (err) {
      setRecaptureStatus('error');
      setRecaptureError(err instanceof Error ? err.message : 'Recapture failed');
    }
  };

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
      <div className="bg-gray-50 px-4 py-2 text-xs text-gray-500 flex items-center justify-between border-b border-gray-200">
        <div>
          Captured: {new Date(capturedAt).toLocaleString()} · {width}×{height}px
        </div>
        <div className="flex items-center gap-3">
          <span className="text-gray-400">
            {pins.length} pin{pins.length === 1 ? '' : 's'}
          </span>
          <span className="text-gray-400">
            {pins.filter(p => p.status === 'RESOLVED').length} resolved
          </span>
          <button
            type="button"
            onClick={handleRecapture}
            disabled={recaptureStatus === 'starting' || recaptureStatus === 'running'}
            className="text-xs px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
            title={recaptureError || 'Server-side recapture via headless Chromium'}
          >
            {recaptureStatus === 'idle' && 'Recapture'}
            {recaptureStatus === 'starting' && 'Starting…'}
            {recaptureStatus === 'running' && 'Capturing…'}
            {recaptureStatus === 'done' && '✓ Refreshed'}
            {recaptureStatus === 'error' && '✗ Failed'}
          </button>
        </div>
      </div>

      <div className="relative" style={{ maxWidth: '100%' }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- served from /api/screenshots/[id]/image with immutable Cache-Control + ETag; the dynamic recapture cache-buster query string and the disk-backed PNG stream are intentional (not a static asset the optimizer can help with). */}
        <img
          src={imgUrl}
          alt={`Screenshot of ${pagePath}`}
          className="block w-full h-auto select-none"
          draggable={false}
        />
        {pins.map((pin, idx) => {
          const isActive = activePinId === pin.id;
          const isResolved = pin.status === 'RESOLVED';
          return (
            <button
              key={pin.id}
              type="button"
              onClick={() => setActivePinId(isActive ? null : pin.id)}
              className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md flex items-center justify-center font-bold text-white text-xs transition-transform hover:scale-110 ${
                isResolved ? 'bg-green-500' : 'bg-red-500'
              } ${isActive ? 'scale-125 ring-4 ring-blue-300' : ''}`}
              style={{
                left: `${pin.xPercent}%`,
                top: `${pin.yPercent}%`,
                width: 28,
                height: 28,
                zIndex: isActive ? 10 : 5,
              }}
              title={pin.comments[0]?.text || `Pin ${idx + 1}`}
            >
              {idx + 1}
            </button>
          );
        })}

        {activePinId && (
          <div className="absolute top-2 right-2 w-80 max-w-[calc(100%-1rem)] bg-white rounded-lg shadow-2xl border border-gray-200 z-20 max-h-[80vh] overflow-y-auto">
            {(() => {
              const pin = pins.find(p => p.id === activePinId);
              if (!pin) return null;
              return (
                <PinThread
                  pin={pin}
                  onClose={() => setActivePinId(null)}
                  onStatusChange={handlePinStatusChange}
                  onCommentAdded={handleCommentAdded}
                />
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
