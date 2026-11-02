// Screen state and the address bar.
//
// `currentView` plus `selectedEventId` are the address; the history entry is pushed when
// either changes, and Back/Forward drive them back. The mapping itself is pure and lives
// in `utils/appRoute.js`; this hook only owns the React state and the listeners.

import { useEffect, useState } from 'react';
import { INITIAL_EVENTS } from '../constants/mockData.js';
import { USE_MOCK } from '../services/api.js';
import { pathFor, readInitialRoute, routeFromPath } from '../utils/appRoute.js';

// BASE_URL always ends with a slash; the router wants it without one ('' in dev).
const BASE = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');

// Read once at module load, like any initial address: a later pushState must not change
// which incident a Slack link points at.
const INITIAL_ROUTE = typeof window === 'undefined'
  ? { view: 'live', eventId: null }
  : readInitialRoute(window.location.pathname, BASE);

/** The incident a Slack link asked for, if the app was opened on one. */
const LINKED_INCIDENT_ID = INITIAL_ROUTE.eventId;

export function useRouting() {
  const [currentView, setCurrentView] = useState(INITIAL_ROUTE.view);
  // In mock mode the default incident is the newest one in the demo data, not a fixed id.
  const [selectedEventId, setSelectedEventId] = useState(
    LINKED_INCIDENT_ID || (USE_MOCK ? INITIAL_EVENTS[0]?.event_id ?? null : null)
  );

  // Screen -> address, one history entry per screen or incident.
  useEffect(() => {
    const path = pathFor(currentView, selectedEventId, BASE);
    if (window.location.pathname !== path) window.history.pushState(null, '', path);
  }, [currentView, selectedEventId]);

  // Back/Forward -> screen. A URL without an incident id keeps the selection, so leaving
  // the detail view and going back lands on the incident the operator last opened.
  useEffect(() => {
    const onPopState = () => {
      const route = routeFromPath(window.location.pathname, BASE);
      if (route.eventId) setSelectedEventId(route.eventId);
      setCurrentView(route.view);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  return {
    currentView,
    setCurrentView,
    selectedEventId,
    setSelectedEventId,
    linkedIncidentId: LINKED_INCIDENT_ID,
  };
}
