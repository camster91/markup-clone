'use client';

// LiveEventsProvider
//
// Collapses the triple EventSource problem on /projects/[id]:
// previously ProjectDetail, ScreenshotView, and PinThread each called
// useLiveEvents → three SSE connections per project detail page.
//
// Pattern:
//   - LiveEventsProvider opens ONE useLiveEvents subscription.
//   - Children call useProjectLiveEvents(handler) which registers a
//     callback in a Set; the provider fans out every event to every
//     registered handler.
//   - Outside a provider (e.g. /share/[token] read-only view) the
//     hook is a no-op — share doesn't need live updates, and the
//     SSE endpoint requires a dashboard session anyway.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import { useLiveEvents, type LiveEvent } from '@/lib/hooks/useLiveEvents';

type LiveEventHandler = (event: LiveEvent) => void;

type LiveEventsContextValue = {
  subscribe: (handler: LiveEventHandler) => () => void;
};

const LiveEventsContext = createContext<LiveEventsContextValue | null>(null);

export function LiveEventsProvider({
  projectId,
  children,
}: {
  projectId: string;
  children: ReactNode;
}) {
  const handlersRef = useRef(new Set<LiveEventHandler>());

  useLiveEvents({
    projectId,
    onEvent: (event) => {
      for (const handler of handlersRef.current) {
        handler(event);
      }
    },
  });

  const subscribe = useCallback((handler: LiveEventHandler) => {
    handlersRef.current.add(handler);
    return () => {
      handlersRef.current.delete(handler);
    };
  }, []);

  return (
    <LiveEventsContext.Provider value={{ subscribe }}>
      {children}
    </LiveEventsContext.Provider>
  );
}

/**
 * Register a live-event handler against the nearest LiveEventsProvider.
 * No-op when rendered outside a provider (share view, isolated tests).
 */
export function useProjectLiveEvents(handler: LiveEventHandler): void {
  const ctx = useContext(LiveEventsContext);
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!ctx) return;
    return ctx.subscribe((event) => {
      handlerRef.current(event);
    });
  }, [ctx]);
}
