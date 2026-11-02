// Boot-time evidence hydration, and the fire-and-forget writes behind operator actions.
//
// The store itself (`services/evidencePersistence.js`) knows IndexedDB and nothing about
// React. This hook is the bridge: it hydrates once on mount, remembers which incidents it
// already wrote (so a re-render or StrictMode cannot duplicate them) and refreshes the
// stats the Settings panel shows.
//
// Every write is fire-and-forget on purpose: an incident must appear in the list even when
// the browser refuses to store it (private mode, quota, a blocked database). A failure is
// logged and the UI carries on; `supported` and `stats` tell the operator the truth.

import { useCallback, useEffect, useRef, useState } from 'react';
import { USE_MOCK } from '../services/config.js';
import {
  applyAckOverrides,
  createEvidenceStore,
  mergeHydratedEvents,
} from '../services/evidencePersistence.js';
import { EVENT_LIMIT } from '../utils/incidentState.js';

const emptyStats = (store) => ({
  supported: store.supported,
  count: 0,
  evidenceCount: 0,
  ackCount: 0,
  bytes: 0,
  maxEvents: store.retention.maxEvents,
  maxAgeDays: store.retention.maxAgeDays,
});

const logWriteError = (error) => {
  console.warn('[evidence] could not persist:', error?.message ?? error);
};

/**
 * @param {{ setEvents: (updater: (events: Array<object>) => Array<object>) => void }} options
 * @returns {{
 *   supported: boolean,
 *   hydrated: boolean,
 *   stats: object,
 *   retention: { maxEvents: number, maxAgeDays: number },
 *   persistEvent: (event: object) => void,
 *   persistStatus: (event: object) => void,
 *   clearStore: () => Promise<boolean>,
 *   refreshStats: () => Promise<object>,
 *   isBlocked: (eventId: string) => boolean,
 * }}
 */
export function useEvidencePersistence({ setEvents }) {
  const storeRef = useRef(null);
  if (storeRef.current === null) storeRef.current = createEvidenceStore();
  const store = storeRef.current;

  // Ids this tab already wrote or restored. Hydration fills it before engine events can be
  // persisted, so a reload never writes a second copy of an incident it just restored.
  const knownIds = useRef(new Set());
  // Ids the operator cleared on purpose: the engine feed may still replay them, and they
  // must neither return to the list nor be written again in this session.
  const blockedIds = useRef(new Set());
  // One hydration per provider, shared by StrictMode's two effect runs.
  const bootRef = useRef(null);

  const [state, setState] = useState(() => ({
    supported: store.supported,
    hydrated: false,
    stats: emptyStats(store),
  }));

  const refreshStats = useCallback(async () => {
    const stats = await store.stats();
    setState((previous) => ({ ...previous, supported: stats.supported, stats }));
    return stats;
  }, [store]);

  useEffect(() => {
    let cancelled = false;
    // StrictMode mounts the provider twice: both effects await the same hydrate, so the
    // second cannot revoke the object URLs the first one just handed to the list.
    if (bootRef.current === null) bootRef.current = store.hydrate();
    bootRef.current
      .then(async ({ events, acks }) => {
        if (cancelled) return;
        // A clear that happened while the read was in flight wins over the read.
        const restored = events.filter((event) => !blockedIds.current.has(event.event_id));
        for (const event of restored) knownIds.current.add(event.event_id);
        if (restored.length > 0 || acks.length > 0) {
          setEvents((previous) => applyAckOverrides(
            mergeHydratedEvents(previous, restored, { limit: EVENT_LIMIT }),
            acks
          ));
        }
        const stats = await store.stats();
        if (cancelled) return;
        setState({ supported: stats.supported, hydrated: true, stats });
      })
      .catch((error) => {
        // Boot must survive a store that cannot even be read.
        logWriteError(error);
        if (!cancelled) setState((previous) => ({ ...previous, hydrated: true }));
      });
    return () => {
      cancelled = true;
    };
  }, [store, setEvents]);

  /** Persist one engine incident and its snapshot; safe to call repeatedly. */
  const persistEvent = useCallback((event) => {
    const eventId = event?.event_id;
    if (typeof eventId !== 'string' || eventId === '') return;
    if (blockedIds.current.has(eventId) || knownIds.current.has(eventId)) return;
    // Mark before the await: a second render of the same feed must not fetch the blob twice.
    knownIds.current.add(eventId);
    store
      .recordEvent(event)
      .then((saved) => (saved ? store.prune() : null))
      .then(() => refreshStats())
      .catch(logWriteError);
  }, [store, refreshStats]);

  /**
   * Persist the fields an operator action owns. Fixtures are not written as incidents, only
   * their override, so the demo data file stays the source of truth for their values.
   */
  const persistStatus = useCallback((event) => {
    if (!event || typeof event.event_id !== 'string') return;
    // The real backend already owns status; only a browser-engine incident is local-only.
    if (!USE_MOCK && event.local !== true) return;
    store.putAck(event).then(() => refreshStats()).catch(logWriteError);
  }, [store, refreshStats]);

  const clearStore = useCallback(async () => {
    for (const eventId of knownIds.current) blockedIds.current.add(eventId);
    knownIds.current.clear();
    const cleared = await store.clear();
    await refreshStats();
    return cleared;
  }, [store, refreshStats]);

  const isBlocked = useCallback((eventId) => blockedIds.current.has(eventId), []);

  return {
    supported: state.supported,
    hydrated: state.hydrated,
    stats: state.stats,
    retention: store.retention,
    persistEvent,
    persistStatus,
    clearStore,
    refreshStats,
    isBlocked,
  };
}
