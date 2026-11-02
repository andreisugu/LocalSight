// Incidents: the list every screen reads, the Live filter, and the operator actions.
//
// The list is shared by design: Live, Incidents, the KPI tiles, the shift report and the
// audit log all derive from it. Actions are optimistic and the row is replaced by the API
// answer; a failed call rolls the row back, except for a 409, where the API's version wins
// because the incident changed elsewhere (another operator, Slack, the escalation timer).
//
// One distinction sits above the list: `events` (what every screen shows) holds the rows
// the operator is entitled to see right now, while the store keeps the full list in state.
// Demo fixtures are hidden unless `showDemoData` is on, but a deep link to a fixture must
// still open, so the detail lookup reads the full list.
//
// All behaviour that can be expressed without React lives in `utils/incidentState.js`,
// `utils/eventFeed.js`, `utils/engineEventFeed.js` and `utils/eventVisibility.js`.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { INITIAL_EVENTS } from '../constants/mockData.js';
import { STATUS_TOKENS } from '../constants/theme.js';
import { canDo } from '../constants/eventActions.js';
import { templateReport } from '../engine/report.js';
import { localSightApi, USE_MOCK } from '../services/api.js';
import { filterFeedEvents } from '../utils/eventFeed.js';
import { visibleEvents } from '../utils/eventVisibility.js';
import { mergeEngineEvents } from '../utils/engineEventFeed.js';
import { useEvidencePersistence } from './useEvidencePersistence.js';
import {
  acknowledgeLocally,
  applyEscalations,
  findEvent,
  hasEvent,
  isConflictError,
  markFalsePositiveLocally,
  mergeEvent,
  reopenLocally,
  revertEvent,
} from '../utils/incidentState.js';

const MOCK_ESCALATION_TICK_MS = 1000;

export function useIncidentStore({
  showToast,
  operatorName,
  cameras,
  zones,
  selectedEventId,
  linkedIncidentId,
  showDemoData = false,
}) {
  const [events, setEvents] = useState(USE_MOCK ? INITIAL_EVENTS : []);
  const [filterMode, setFilterMode] = useState('open');
  const [searchQuery, setSearchQuery] = useState('');
  // Ids whose confirmation request is already in flight: a second click is a no-op.
  const pendingAcks = useRef(new Set());

  // Incidents, acks and snapshots survive a reload in IndexedDB. Hydration runs once and
  // merges into the state above; the writes below are fire-and-forget, so a browser that
  // refuses storage still shows the incident (see `services/evidencePersistence.js`).
  const {
    supported: evidenceSupported,
    hydrated: evidenceHydrated,
    stats: evidenceStats,
    retention: evidenceRetention,
    persistEvent,
    persistStatus,
    clearStore,
    refreshStats: refreshEvidenceStats,
    isBlocked,
  } = useEvidencePersistence({ setEvents });

  // The rows the screens may show. Fixtures leave every surface together — feed, list,
  // reports, KPI counts and the audit log all read this list — while the engine and the
  // simulator stay. The full list stays in state for actions, persistence and deep links.
  const visible = useMemo(() => visibleEvents(events, { showDemoData }), [events, showDemoData]);

  const filteredEvents = useMemo(
    () => filterFeedEvents(visible, { filterMode, searchQuery }),
    [visible, filterMode, searchQuery]
  );

  const selectedEvent = useMemo(() => {
    // A requested id that is not loaded yet shows nothing rather than another incident.
    // The lookup deliberately reads the full list: a deep link to a hidden fixture must
    // still render, with its `date demo` chip, even though no screen lists it.
    if (selectedEventId) return findEvent(events, selectedEventId) || null;
    return visible[0] || null;
  }, [events, visible, selectedEventId]);

  // A Slack link can point at an incident older than the loaded list: fetch it by id.
  // The dependency is "the list is non-empty", as before: it must not refetch on every
  // incoming event.
  const hasEvents = events.length > 0;
  useEffect(() => {
    if (USE_MOCK || !linkedIncidentId || !hasEvents) return undefined;
    if (hasEvent(events, linkedIncidentId)) return undefined;
    let cancelled = false;
    localSightApi
      .getEventById(linkedIncidentId)
      .then((event) => {
        if (!cancelled && event) {
          setEvents((prev) => (hasEvent(prev, event.event_id) ? prev : [event, ...prev]));
        }
      })
      .catch(() => {
        if (!cancelled) showToast('Incidentul din link nu a fost găsit.');
      });
    return () => { cancelled = true; };
  }, [hasEvents]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mock mode has no backend timer: escalate an open incident once its own timer elapsed.
  useEffect(() => {
    if (!USE_MOCK) return undefined;
    const timer = setInterval(() => {
      setEvents((prev) => applyEscalations(prev));
    }, MOCK_ESCALATION_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  // A failed action: a 409 means the incident changed meanwhile, so show it as it is now;
  // anything else puts the old state back.
  const recoverFromFailedAction = async (eventId, previous, error, failedMessage) => {
    if (!USE_MOCK && isConflictError(error)) {
      try {
        const current = await localSightApi.getEventById(eventId);
        setEvents((prev) => prev.map((event) => (
          event.event_id === eventId ? current : event
        )));
        showToast(
          `Incidentul fusese deja modificat; acum e „${STATUS_TOKENS[current.status]?.label || current.status}”.`
        );
        return;
      } catch {
        // Fall through to the plain revert.
      }
    }
    if (previous) setEvents((prev) => revertEvent(prev, previous));
    showToast(`${failedMessage}: ${error.message}`);
  };

  const acknowledgeEvent = async (eventId, clickEvent) => {
    if (clickEvent) clickEvent.stopPropagation();
    const previous = findEvent(events, eventId);
    // Confirmation is idempotent: an incident that is already confirmed (or cannot be
    // confirmed: false positive, resolved, missing) never reaches the API and shows no
    // toast. A second click before React re-renders lands here and is ignored too.
    if (!canDo('ack', previous?.status)) return;
    if (pendingAcks.current.has(eventId)) return;
    pendingAcks.current.add(eventId);
    // One timestamp for the screen and for the stored override: a reload must show the
    // same confirmation time the operator saw.
    const at = new Date();
    setEvents((prev) => acknowledgeLocally(prev, eventId, operatorName, at));
    try {
      const updated = await localSightApi.acknowledgeEvent(eventId, operatorName);
      setEvents((prev) => mergeEvent(prev, eventId, updated));
      persistStatus({
        ...previous,
        status: 'acknowledged',
        acked_at: at.toISOString(),
        acked_by: operatorName,
        ...updated,
      });
      showToast(`Evenimentul ${eventId.slice(-6)} confirmat de ${operatorName}. Escaladare anulată.`);
    } catch (error) {
      await recoverFromFailedAction(eventId, previous, error, 'Confirmarea a eșuat');
    } finally {
      pendingAcks.current.delete(eventId);
    }
  };

  const markFalsePositive = async (eventId, note = '') => {
    const previous = findEvent(events, eventId);
    setEvents((prev) => markFalsePositiveLocally(prev, eventId, operatorName, note));
    try {
      const updated = await localSightApi.markFalsePositive(eventId, operatorName, note);
      setEvents((prev) => mergeEvent(prev, eventId, updated));
      persistStatus({
        ...previous,
        status: 'false_positive',
        false_positive_by: operatorName,
        false_positive_note: note,
        ...updated,
      });
      showToast('Marcat ca Fals Pozitiv. Feedback înregistrat pentru modelul AI.');
    } catch (error) {
      await recoverFromFailedAction(eventId, previous, error, 'Marcarea ca fals pozitiv a eșuat');
    }
  };

  const reopenEvent = async (eventId) => {
    const previous = findEvent(events, eventId);
    setEvents((prev) => reopenLocally(prev, eventId));
    try {
      const updated = await localSightApi.reopenEvent(eventId, operatorName);
      setEvents((prev) => mergeEvent(prev, eventId, updated));
      persistStatus({
        ...previous,
        status: 'open',
        escalated_at: null,
        acked_at: null,
        acked_by: null,
        ...updated,
      });
      showToast('Eveniment redeschis. Timerul de escaladare a repornit.');
    } catch (error) {
      await recoverFromFailedAction(eventId, previous, error, 'Redeschiderea a eșuat');
    }
  };

  const regenerateReport = async (eventId) => {
    showToast('Regenerare raport LLM în curs...');
    try {
      const updated = await localSightApi.regenerateReport(eventId);
      setEvents((prev) => mergeEvent(prev, eventId, updated));
      showToast('Raportul de incident a fost actualizat.');
    } catch (error) {
      showToast(`Regenerarea raportului a eșuat: ${error.message}`);
    }
  };

  // Incidents produced by the in-browser engine join the same list as edge events. They are
  // local by construction (`snapshot_url: blob:pending`, no backend model), so they are
  // marked `local` and keep `status: 'open'`. Dedupe by `event_id` makes the call safe to
  // repeat on every engine render, and the list limit matches the WebSocket feed.
  //
  // The feed replays its whole recent list on every engine render, so the store dedupes by
  // id too (`persistEvent`): one incident is written once, no matter how often it renders.
  const addEngineEvents = useCallback((incoming) => {
    const accepted = (Array.isArray(incoming) ? incoming : [])
      .filter((event) => event && !isBlocked(event.event_id));
    setEvents((prev) => mergeEngineEvents(prev, accepted, {
      cameras,
      zones,
      buildReport: templateReport,
    }));
    // Persist the decorated row the list shows (local, report, escalation threshold), not
    // the raw worker payload; its `blob:` URL is still alive here, which is what lets the
    // snapshot be fetched and stored.
    const decorated = mergeEngineEvents([], accepted, {
      cameras,
      zones,
      buildReport: templateReport,
    });
    for (const event of decorated) persistEvent(event);
  }, [cameras, zones, persistEvent, isBlocked]);

  // "Delete local data" from Settings: the durable store goes, and so do the incidents
  // that only exist because of it. Demo fixtures are not local data: they stay, and in
  // mock mode they return to their seeded values, overrides included.
  const clearLocalData = useCallback(async () => {
    const cleared = await clearStore();
    if (!cleared) return false;
    setEvents((prev) => (
      USE_MOCK ? INITIAL_EVENTS.slice() : prev.filter((event) => event.local !== true)
    ));
    return true;
  }, [clearStore, setEvents]);

  return {
    // What the screens show: fixtures only while the demo preference is on.
    events: visible,
    setEvents,
    filteredEvents,
    selectedEvent,
    filterMode,
    setFilterMode,
    searchQuery,
    setSearchQuery,
    acknowledgeEvent,
    markFalsePositive,
    reopenEvent,
    regenerateReport,
    addEngineEvents,
    // The Settings panel reads this: no other screen does, and the keys above stay frozen.
    localEvidence: {
      supported: evidenceSupported,
      hydrated: evidenceHydrated,
      stats: evidenceStats,
      retention: evidenceRetention,
      refreshStats: refreshEvidenceStats,
      clearLocalData,
    },
  };
}
