'use client';

import { useState, useCallback, useMemo } from 'react';
import PinThread from './PinThread';
import type { Pin, FeedbackComment, ScreenshotWithPins } from '@/lib/types';
import { useRecaptureStatus } from '@/lib/hooks/useRecaptureStatus';

export default function ScreenshotView({
  screenshot,
  pagePath,
}: {
  screenshot: ScreenshotWithPins;
  pagePath: string;
}) {
  const [activePinId, setActivePinId] = useState<string | null>(null);
  const [pins, setPins] = useState<Pin[]>(screenshot.pins);
  const [width, setWidth] = useState(screenshot.width);
  const [height, setHeight] = useState(screenshot.height);
  const [capturedAt, setCapturedAt] = useState(screenshot.capturedAt);
  const [imageKey, setImageKey] = useState(0); // bump to force img reload
  const imgUrl = `/api/screenshots/${screenshot.id}/image?v=${imageKey}`;

  // Stable initial-dims reference so the hook doesn't re-fire on every
  // parent re-render. capturedAt is a string from the server, so an
  // object identity comparison is enough.
  const initialDims = useMemo(
    () => ({ width: screenshot.width, height: screenshot.height, capturedAt: screenshot.capturedAt }),
    [screenshot.width, screenshot.height, screenshot.capturedAt]
  );

  // onUpdate is recreated every render; the hook depends on it via
  // useCallback closure. Wrap in useCallback so the hook's internal
  // start() reference is stable across renders that don't change the
  // dims.
  const handleRecaptureUpdate = useCallback((dims: { width: number; height: number; capturedAt: string }) => {
    setWidth(dims.width);
    setHeight(dims.height);
    setCapturedAt(dims.capturedAt);
    setImageKey((k) => k + 1);
  }, []);

  const { status: recaptureStatus, error: recaptureError, isStale, start } = useRecaptureStatus(
    screenshot.id,
    { onUpdate: handleRecaptureUpdate, initial: initialDims }
  );

  const handleRecapture = useCallback(() => {
    void start();
  }, [start]);

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
            {recaptureStatus === 'running' && (isStale ? 'Still rendering…' : 'Capturing…')}
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
