'use client';

// PresenceList
//
// Small sidebar showing "who else is reviewing this project right now".
// Rendered inside <DashboardProjects> as a compact dot-list. The hook
// does the actual heartbeat + poll; this component is purely presentational.
//
// Contract:
//   - One row per OTHER reviewer (self is rendered separately as "You")
//   - Each row shows a colored dot (colorForUserId) + a 6-char label
//   - The list is bounded by the 60s server-side TTL, so even with
//     many reviewers it stays short
//
// Why "You" is shown separately: avoids the "did my own dot just blink
// off the list?" false alarm when the heartbeat hiccups. The "You"
// row is stable and never changes.

import { colorForUserId, shortLabelForUserId, type PresenceRow } from '@/lib/hooks/usePresence';

export interface PresenceListProps {
  /** Stable userId of the current reviewer. Empty string means the
   *  hook hasn't read localStorage yet (SSR / first paint). */
  myUserId: string;
  /** Other reviewers currently online. */
  others: PresenceRow[];
}

export default function PresenceList({ myUserId, others }: PresenceListProps) {
  // If the list is empty, render a single-line "You're alone" hint so
  // the sidebar has consistent height and the user knows the feature
  // is alive (no extra clicks needed to discover it).
  const total = others.length + (myUserId ? 1 : 0);

  return (
    <div className="px-6 py-3 bg-gray-50 border-b border-gray-200">
      <div className="flex items-center gap-3 text-xs">
        <span className="text-gray-500 font-medium">
          Online now
          <span className="ml-1 text-gray-400">({total})</span>
        </span>
        {myUserId && (
          <div
            className="flex items-center gap-1.5"
            title="You"
            aria-label="You"
          >
            <span
              className={`inline-block w-2.5 h-2.5 rounded-full ${colorForUserId(myUserId)}`}
              aria-hidden="true"
            />
            <span className="text-gray-700 font-medium">You</span>
          </div>
        )}
        {others.map((p) => (
          <div
            key={p.id}
            className="flex items-center gap-1.5"
            title={`Reviewer ${shortLabelForUserId(p.userId)}`}
            aria-label={`Reviewer ${shortLabelForUserId(p.userId)}`}
          >
            <span
              className={`inline-block w-2.5 h-2.5 rounded-full ${colorForUserId(p.userId)}`}
              aria-hidden="true"
            />
            <span className="text-gray-700 font-mono">
              {shortLabelForUserId(p.userId)}
            </span>
          </div>
        ))}
        {total === 0 && (
          <span className="text-gray-400 italic">Just you — others will appear here when they open this project.</span>
        )}
      </div>
    </div>
  );
}
