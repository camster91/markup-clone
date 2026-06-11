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
  const imgUrl = `/api/screenshots/${screenshot.id}/image`;

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
          Captured: {new Date(screenshot.capturedAt).toLocaleString()} · {screenshot.width}×{screenshot.height}px
        </div>
        <div className="flex items-center gap-3">
          <span className="text-gray-400">
            {pins.length} pin{pins.length === 1 ? '' : 's'}
          </span>
          <span className="text-gray-400">
            {pins.filter(p => p.status === 'RESOLVED').length} resolved
          </span>
        </div>
      </div>

      <div className="relative" style={{ maxWidth: '100%' }}>
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
