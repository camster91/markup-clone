'use client';

// LiveEventsProvider
//
// Owns a single project-scoped EventSource via useLiveEvents and fans
// events out to any number of subscribers (ProjectDetail refresh,
// PinThread optimistic append, …). Without this, ProjectDetail and
// every open PinThread each opened their own SSE connection.
//
// Share views and isolated unit mounts have no provider; those callers
// must no-op rather than open an authenticated EventSource.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { useLiveEvents, type LiveEvent } from '@/lib/hooks/useLiveEvents';

type LiveEventHandler = (event: LiveEvent) => void;

interface LiveEventsContextValue {
  subscribe: (handler: LiveEventHandler) => () => void;
}

const LiveEventsContext = createContext<LiveEventsContextValue | null>(null);

export function LiveEventsProvider({
  projectId,
  children,
}: {
  projectId: string;
  children: ReactNode;
}) {
  const handlersRef = useRef(new Set<LiveEventHandler>());

  const subscribe = useCallback((handler: LiveEventHandler) => {
    handlersRef.current.add(handler);
    return () => {
      handlersRef.current.delete(handler);
    };
  }, []);

  useLiveEvents({
    projectId,
    onEvent: (event) => {
      for (const handler of handlersRef.current) {
        handler(event);
      }
    },
  });

  const value = useMemo(() => ({ subscribe }), [subscribe]);

  return (
    <LiveEventsContext.Provider value={value}>
      {children}
    </LiveEventsContext.Provider>
  );
}

/**
 * Register a handler on the project LiveEventsProvider fan-out.
 *
 * Outside a provider (public share / isolated mounts) this no-ops —
 * share is read-only and must not open an authenticated EventSource.
 */
export function useProjectLiveEvents(handler: LiveEventHandler): void {
  const ctx = useContext(LiveEventsContext);
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!ctx) {
      // No provider: share views stay read-only without a second SSE.
      return;
    }
    return ctx.subscribe((event) => {
      handlerRef.current(event);
    });
  }, [ctx]);
}
