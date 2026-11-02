// Incidents: the list every screen reads, the Live filter, and the operator actions.
//
// The list is shared by design: Live, Incidents, the KPI tiles, the shift report and the
// audit log all derive from it. Actions are optimistic and the row is replaced by the API
// answer; a failed call rolls the row back, except for a 409, where the API's version wins
// because the incident changed elsewhere (another operator, Slack, the escalation timer).
//
// All behaviour that can be expressed without React lives in `utils/incidentState.js`,
// `utils/eventFeed.js` and `utils/engineEventFeed.js`.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { INITIAL_EVENTS } from '../constants/mockData.js';
import { STATUS_TOKENS } from '../constants/theme.js';
import { canDo } from '../constants/eventActions.js';
import { templateReport } from '../engine/report.js';
import { localSightApi, USE_MOCK } from '../services/api.js';
import { filterFeedEvents } from '../utils/eventFeed.js';
import { mergeEngineEvents } from '../utils/engineEventFeed.js';
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
}) {
  const [events, setEvents] = useState(USE_MOCK ? INITIAL_EVENTS : []);
  const [filterMode, setFilterMode] = useState('open');
  const [searchQuery, setSearchQuery] = useState('');
  // Ids whose confirmation request is already in flight: a second click is a no-op.
  const pendingAcks = useRef(new Set());

  const filteredEvents = useMemo(
    () => filterFeedEvents(events, { filterMode, searchQuery }),
    [events, filterMode, searchQuery]
  );

  const selectedEvent = useMemo(() => {
    // A requested id that is not loaded yet shows nothing rather than another incident.
    if (selectedEventId) return findEvent(events, selectedEventId) || null;
    return events[0] || (USE_MOCK ? INITIAL_EVENTS[0] : null);
  }, [events, selectedEventId]);

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
    setEvents((prev) => acknowledgeLocally(prev, eventId, operatorName));
    try {
      const updated = await localSightApi.acknowledgeEvent(eventId, operatorName);
      setEvents((prev) => mergeEvent(prev, eventId, updated));
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
  const addEngineEvents = useCallback((incoming) => {
    setEvents((prev) => mergeEngineEvents(prev, incoming, {
      cameras,
      zones,
      buildReport: templateReport,
    }));
  }, [cameras, zones]);

  return {
    events,
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
  };
}
