import React, { createContext, useCallback, useContext, useState, useMemo, useEffect, useRef } from 'react';
import {
  INITIAL_CAMERAS,
  INITIAL_EVENTS,
  INITIAL_ZONES,
  INITIAL_KPIS,
  INITIAL_SHIFT_REPORT,
  OPERATIONAL_DATE,
  OPERATIONAL_SHIFT_ID,
  AVAILABLE_OPERATORS,
  DEMO_STILLS
} from '../constants/mockData';
import { templateReport } from '../engine/report';
import { localSightApi, USE_MOCK } from '../services/api';
import { playCriticalAlertSound } from '../utils/sound';
import { STATUS_TOKENS } from '../constants/theme';
import { canDo } from '../constants/eventActions';

const SecurityContext = createContext();

const OPERATOR_STORAGE_KEY = 'localsight.operator';
// The legacy key is still read so operators who saved their name before the rename keep it;
// the first save rewrites it under the new key.
const LEGACY_OPERATOR_STORAGE_KEY = 'safesight.operator';

function loadOperatorName() {
  try {
    const current = localStorage.getItem(OPERATOR_STORAGE_KEY)?.trim();
    if (current) return current;
    // Migrate a name saved before the rename: copy it to the new key so the legacy one can rot.
    const legacy = localStorage.getItem(LEGACY_OPERATOR_STORAGE_KEY)?.trim();
    if (legacy) {
      localStorage.setItem(OPERATOR_STORAGE_KEY, legacy);
      return legacy;
    }
    return '';
  } catch {
    return '';
  }
}

// Every screen has an address, so a refresh, Back/Forward and shared links keep the place.
// The Slack alert links to {APP_BASE_URL}{BASE}/incidents/{event_id}; the backend builds it
// from APP_BASE_URL, so that value must include the deploy subpath (e.g. /LocalSight).
const VIEW_PATHS = {
  live: '/',
  incidents: '/incidents',
  zones: '/zones',
  reports: '/reports',
  settings: '/settings',
  // Spike page, reachable by URL only: no sidebar entry.
  lab: '/lab',
  // Measurement page, reachable by URL only: no sidebar entry.
  bench: '/bench',
};

// Aplicația poate fi servită dintr-un subpath (GitHub Pages: /LocalSight/).
// BASE_URL vine mereu cu slash final; îl tăiem ca să rămână '' în dev.
const BASE = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');

// Rutele de mai sus sunt relative la BASE: aici scoatem prefixul înainte de potrivire.
function routeFromPath(pathname) {
  let raw = pathname;
  if (BASE && (raw === BASE || raw.startsWith(`${BASE}/`))) raw = raw.slice(BASE.length);
  const path = raw.replace(/\/+$/, '') || '/';
  const incident = path.match(/^\/incidents\/([^/]+)$/);
  if (incident) return { view: 'incident_detail', eventId: decodeURIComponent(incident[1]) };
  const view = Object.keys(VIEW_PATHS).find((key) => VIEW_PATHS[key] === path);
  return { view: view || 'live', eventId: null };
}

// Orice adresă pusă în bară trebuie să conțină BASE, altfel pushState iese din subpath.
function pathFor(view, eventId) {
  const path =
    view === 'incident_detail'
      ? eventId ? `/incidents/${encodeURIComponent(eventId)}` : VIEW_PATHS.incidents
      : VIEW_PATHS[view] || '/';
  return `${BASE}${path}`;
}

const INITIAL_ROUTE = (() => {
  try {
    return routeFromPath(window.location.pathname);
  } catch {
    return { view: 'live', eventId: null };
  }
})();
const LINKED_INCIDENT_ID = INITIAL_ROUTE.eventId;

function withFreshPreview(zone) {
  if (!zone?.reference_frame_url) return zone;
  const base = zone.reference_frame_url.split('?')[0];
  return { ...zone, reference_frame_url: `${base}?v=${Date.now()}` };
}

const EMPTY_KPIS = {
  ppe_compliance_pct: '—',
  open_incidents_count: 0,
  detection_to_alert_latency_s: '—',
  escalated_incidents_count: 0,
};

const EMPTY_SHIFT_REPORT = {
  shift: '—',
  date: '—',
  kpi: {
    total_events: 0,
    critical_events: 0,
    warning_events: 0,
    avg_ack_time_s: '—',
    ppe_compliance_pct: '—',
  },
  summary: 'Se încarcă raportul de tură...',
  by_type: [],
  by_zone: [],
  by_hour: [],
};

export function SecurityProvider({ children }) {
  // 1. Navigare Ecrane (Conform 03_C_frontend.pdf):
  // 'live' | 'incident_detail' | 'zones' | 'reports' | 'settings'
  const [currentView, setCurrentView] = useState(INITIAL_ROUTE.view);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  // 2. Operator & autentificare simplă: selector de rol + nume afișat editabil.
  const [operatorId, setOperatorId] = useState('dispatcher');
  const activeOperator = useMemo(
    () => AVAILABLE_OPERATORS.find((operator) => operator.id === operatorId) || AVAILABLE_OPERATORS[0],
    [operatorId]
  );
  const [customOperatorName, setCustomOperatorName] = useState(loadOperatorName);
  const operatorName = customOperatorName || activeOperator.name;

  const setOperatorName = (name) => {
    const trimmed = name.trim();
    setCustomOperatorName(trimmed);
    try {
      if (trimmed) localStorage.setItem(OPERATOR_STORAGE_KEY, trimmed);
      else localStorage.removeItem(OPERATOR_STORAGE_KEY);
    } catch {
      // Fără storage, numele rămâne doar pentru sesiunea curentă.
    }
  };

  const switchOperator = (id) => {
    setOperatorId(id);
    setOperatorName('');
    const selected = AVAILABLE_OPERATORS.find((operator) => operator.id === id);
    if (selected) {
      showToast(`Sesiune activă comutată pe: ${selected.name} (${selected.role})`);
    }
  };

  // 3. Camere CCTV & Stare Motor (PUT /cameras/{id}/engine)
  const [cameras, setCameras] = useState(USE_MOCK ? INITIAL_CAMERAS : []);
  const [selectedCameraId, setSelectedCameraId] = useState('stand12');

  // 4. Evenimente & Incidente
  const [events, setEvents] = useState(USE_MOCK ? INITIAL_EVENTS : []);
  // În mock, incidentul deschis implicit e cel mai recent din datele demo, nu un id fix.
  const [selectedEventId, setSelectedEventId] = useState(
    LINKED_INCIDENT_ID || (USE_MOCK ? INITIAL_EVENTS[0]?.event_id ?? null : null)
  );
  // Screen -> address (a new history entry per screen or incident) and Back/Forward -> screen.
  useEffect(() => {
    const path = pathFor(currentView, selectedEventId);
    if (window.location.pathname !== path) window.history.pushState(null, '', path);
  }, [currentView, selectedEventId]);

  useEffect(() => {
    const onPopState = () => {
      const route = routeFromPath(window.location.pathname);
      if (route.eventId) setSelectedEventId(route.eventId);
      setCurrentView(route.view);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const [filterMode, setFilterMode] = useState('open'); // 'open' | 'critical' | 'all'
  const [searchQuery, setSearchQuery] = useState('');

  // 5. KPI Live (4 KPI: PPE, incidente deschise, latență, escaladate)
  const [kpis, setKpis] = useState(USE_MOCK ? INITIAL_KPIS : EMPTY_KPIS);

  // 6. Zone & Editor Poligoane
  const [zones, setZones] = useState(USE_MOCK ? INITIAL_ZONES : []);

  // 7. Raport de Tură
  const [shiftReport, setShiftReport] = useState(USE_MOCK ? INITIAL_SHIFT_REPORT : EMPTY_SHIFT_REPORT);
  const [selectedShift, setSelectedShift] = useState(() => (USE_MOCK ? OPERATIONAL_SHIFT_ID : localSightApi.currentShiftId()));
  // Ziua operațională (se schimbă la 06:00), nu ziua calendaristică.
  // În mock, aceeași sursă ca raportul de tură, altfel selectorul contrazice datele.
  const [selectedDate, setSelectedDate] = useState(() => (USE_MOCK ? OPERATIONAL_DATE : localSightApi.shiftDate()));

  // 8. Stare Conexiune & Toast / Banner Erori (Regulă C-10)
  const [isWsConnected, setIsWsConnected] = useState(true);
  const [health, setHealth] = useState(
    USE_MOCK
      ? { status: 'ok', db: true, edge_last_seen_s: 0, mock: true }
      : { status: 'connecting', db: false, edge_last_seen_s: null }
  );
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);
  // One timer at a time: the inherited version left every previous timeout running, so a
  // toast shown 2 s after another disappeared 1.8 s early (the older timer cleared it).
  const toastTimerRef = useRef(null);
  const showToast = (msg) => {
    setToastMessage(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      toastTimerRef.current = null;
      setToastMessage(null);
    }, 3800);
  };
  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  // Încarcă datele reale din backend. Un endpoint picat nu le blochează pe celelalte.
  useEffect(() => {
    if (USE_MOCK) return;
    let cancelled = false;
    let retryTimer;
    let announced = false;

    const load = async () => {
      const [cams, evs, zs, kpi, healthResult] = await Promise.allSettled([
        localSightApi.getCameras(),
        localSightApi.getEvents(),
        localSightApi.getZones(),
        localSightApi.getKPIs(),
        localSightApi.getHealth()
      ]);
      if (cancelled) return;

      const failures = [];
      if (cams.status === 'fulfilled') {
        setCameras(cams.value);
        setSelectedCameraId((current) =>
          cams.value.some((c) => c.id === current) ? current : cams.value[0]?.id
        );
      } else {
        failures.push('camere');
      }
      if (evs.status === 'fulfilled') {
        setEvents(evs.value);
        setSelectedEventId((current) =>
          evs.value.some((e) => e.event_id === current) ? current : evs.value[0]?.event_id
        );
      } else {
        failures.push('evenimente');
      }
      if (zs.status === 'fulfilled') {
        setZones(zs.value);
      } else {
        failures.push('zone');
      }
      if (kpi.status === 'fulfilled') {
        setKpis(kpi.value);
      } else {
        failures.push('KPI');
      }
      if (healthResult.status === 'fulfilled') {
        setHealth(healthResult.value);
      } else {
        failures.push('health');
      }

      if (failures.length) {
        if (!announced) {
          showToast(`Backend incomplet: ${failures.join(', ')}. Reîncerc automat...`);
          announced = true;
        }
        // Frontend-ul pornește înaintea backend-ului: reîncearcă până apare.
        retryTimer = setTimeout(load, 2000);
      }
    };

    load();
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
    };
  }, []);

  // /health se actualizează separat, ca statusul Edge să nu depindă de un refresh de pagină.
  useEffect(() => {
    if (USE_MOCK) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const next = await localSightApi.getHealth();
        if (!cancelled) setHealth(next);
      } catch {
        if (!cancelled) setHealth((prev) => ({ ...prev, status: 'offline' }));
      }
    };
    tick();
    const interval = setInterval(tick, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Raportul de tură se reîncarcă la schimbarea turei sau a datei, și la 30 s cât
  // timp ecranul e deschis: cifrele turei se mișcă în timpul demo-ului.
  useEffect(() => {
    if (USE_MOCK) return;
    let cancelled = false;
    const load = (refresh = false) =>
      localSightApi
        .getShiftReport(localSightApi.shiftToApi(selectedShift), selectedDate, { refresh })
        .then((report) => { if (!cancelled) setShiftReport(report); })
        .catch(() => { if (!cancelled) showToast('Raportul de tură nu a putut fi încărcat.'); });

    load();
    const interval = setInterval(() => load(), 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [selectedShift, selectedDate]); // eslint-disable-line react-hooks/exhaustive-deps

  // „Regenerează sumarul" forțează un text nou; o reîncărcare normală refoloseste
  // sumarul cât timp cifrele nu s-au schimbat.
  const regenerateShiftSummary = () => {
    if (USE_MOCK) return;
    localSightApi
      .getShiftReport(localSightApi.shiftToApi(selectedShift), selectedDate, { refresh: true })
      .then((report) => setShiftReport(report))
      .catch(() => showToast('Sumarul nu a putut fi regenerat.'));
  };

  // Camera activă curentă
  const activeCamera = useMemo(() => {
    return cameras.find((c) => c.id === selectedCameraId) || cameras[0] || (USE_MOCK ? INITIAL_CAMERAS[0] : null);
  }, [cameras, selectedCameraId]);

  // Evenimentul selectat pentru detaliu
  const selectedEvent = useMemo(() => {
    // A requested id that is not loaded yet shows nothing rather than another incident.
    if (selectedEventId) return events.find((e) => e.event_id === selectedEventId) || null;
    return events[0] || (USE_MOCK ? INITIAL_EVENTS[0] : null);
  }, [events, selectedEventId]);

  // A Slack link can point to an incident older than the loaded list: fetch it by id.
  useEffect(() => {
    if (USE_MOCK || !LINKED_INCIDENT_ID || !events.length) return;
    if (events.some((e) => e.event_id === LINKED_INCIDENT_ID)) return;
    let cancelled = false;
    localSightApi
      .getEventById(LINKED_INCIDENT_ID)
      .then((event) => {
        if (!cancelled && event) setEvents((prev) => (prev.some((e) => e.event_id === event.event_id) ? prev : [event, ...prev]));
      })
      .catch(() => { if (!cancelled) showToast('Incidentul din link nu a fost găsit.'); });
    return () => { cancelled = true; };
  }, [events.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // Filtrarea evenimentelor pentru Feed-ul din Live (Deschise, Doar critice, Toate azi)
  const filteredEvents = useMemo(() => {
    return events.filter((ev) => {
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        ev.event_id?.toLowerCase().includes(q) ||
        ev.type?.toLowerCase().includes(q) ||
        ev.report?.what?.toLowerCase().includes(q) ||
        ev.report?.where?.toLowerCase().includes(q) ||
        ev.camera_id?.toLowerCase().includes(q);

      let matchesFilter = true;
      if (filterMode === 'open') {
        matchesFilter = ev.status === 'open' || ev.status === 'escalated';
      } else if (filterMode === 'critical') {
        matchesFilter = ev.severity === 'CRITICAL';
      } else if (filterMode === 'all') {
        matchesFilter = true;
      }

      return matchesSearch && matchesFilter;
    });
  }, [events, filterMode, searchQuery]);

  // Recalculare KPI doar în mock; în producție cifrele vin din `/kpi`.
  useEffect(() => {
    if (!USE_MOCK) return;
    const openCount = events.filter((e) => e.status === 'open' || e.status === 'escalated').length;
    const escalatedCount = events.filter((e) => e.status === 'escalated').length;
    setKpis((prev) => ({
      ...prev,
      open_incidents_count: openCount,
      escalated_incidents_count: escalatedCount
    }));
  }, [events]);

  // Escaladare simulată doar în mock; în producție backend-ul ține timerul.
  useEffect(() => {
    if (!USE_MOCK) return;
    const escalationInterval = setInterval(() => {
      const now = Date.now();
      setEvents((prevEvents) =>
        prevEvents.map((ev) => {
          if (ev.status === 'open' && ev.escalate_after_s) {
            const detectedTime = new Date(ev.detected_at).getTime();
            if (now - detectedTime >= ev.escalate_after_s * 1000) {
              // Escaladare declanșată!
              return {
                ...ev,
                status: 'escalated',
                escalated_at: new Date().toISOString()
              };
            }
          }
          return ev;
        })
      );
    }, 1000);

    return () => clearInterval(escalationInterval);
  }, []);

  // WebSocket real; dacă pică, polling la 2 s (C-10).
  useEffect(() => {
    const disconnect = localSightApi.connectEventsSocket(
      (msg) => {
        setIsWsConnected(true);
        if (msg.type === 'kpi.updated' && msg.data) {
          setKpis((prev) => ({ ...prev, ...msg.data }));
          return;
        }
        if (msg.type === 'event.created' || msg.type === 'event.updated') {
          const incoming = msg.data;
          setEvents((prev) => {
            const index = prev.findIndex((event) => event.event_id === incoming.event_id);
            if (index >= 0) {
              const next = [...prev];
              next[index] = incoming;
              return next;
            }
            return [incoming, ...prev].slice(0, 200);
          });
          if (msg.type === 'event.created' && incoming.severity === 'CRITICAL') {
            playCriticalAlertSound();
          }
          localSightApi.getKPIs().then(setKpis).catch(() => {});
        }
      },
      () => setIsWsConnected(false),
      () => setIsWsConnected(true)
    );
    return () => disconnect();
  }, []);

  useEffect(() => {
    if (USE_MOCK || isWsConnected) return;
    const poll = async () => {
      try {
        const [evs, kpi] = await Promise.all([localSightApi.getEvents(), localSightApi.getKPIs()]);
        setEvents(evs);
        setKpis(kpi);
      } catch {
        // Banner-ul de conexiune rămâne vizibil; reîncercăm la următorul tick.
      }
    };
    poll();
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, [isWsConnected]);

  // ACȚIUNI PRINCIPALE:

  // Incidentele cu o confirmare deja în zbor: al doilea clic pe același buton e un no-op.
  const pendingAcks = useRef(new Set());

  // 1. Acknowledge (Buton principal, un singur clic - C-02)
  // A failed action: a 409 means the incident changed meanwhile (another operator, Slack, the
  // escalation timer), so show it as it is now; anything else puts the old state back.
  const recoverFromFailedAction = async (eventId, previous, error, failedMessage) => {
    if (!USE_MOCK && String(error.message).startsWith('409')) {
      try {
        const current = await localSightApi.getEventById(eventId);
        setEvents((prev) => prev.map((ev) => (ev.event_id === eventId ? current : ev)));
        showToast(`Incidentul fusese deja modificat; acum e „${STATUS_TOKENS[current.status]?.label || current.status}”.`);
        return;
      } catch {
        // Fall through to the plain revert.
      }
    }
    if (previous) setEvents((prev) => prev.map((ev) => (ev.event_id === eventId ? previous : ev)));
    showToast(`${failedMessage}: ${error.message}`);
  };

  const acknowledgeEvent = async (eventId, e) => {
    if (e) e.stopPropagation();
    const previous = events.find((ev) => ev.event_id === eventId);
    // Confirmarea e idempotentă: un incident deja confirmat (sau unul care nu se poate
    // confirma: fals pozitiv, rezolvat, inexistent) nu mai pleacă spre API și nu mai
    // produce toast. Al doilea clic pe același buton, înainte ca React să re-randeze
    // cardul, nimerește tot acest incident și e ignorat aici.
    if (!canDo('ack', previous?.status)) return;
    // Al doilea clic cât timp primul e în zbor nu are voie să confirme de două ori.
    if (pendingAcks.current.has(eventId)) return;
    pendingAcks.current.add(eventId);
    setEvents((prev) =>
      prev.map((ev) =>
        ev.event_id === eventId
          ? {
              ...ev,
              status: 'acknowledged',
              acked_at: new Date().toISOString(),
              acked_by: operatorName
            }
          : ev
      )
    );
    try {
      const updated = await localSightApi.acknowledgeEvent(eventId, operatorName);
      setEvents((prev) => prev.map((ev) => (ev.event_id === eventId ? { ...ev, ...updated } : ev)));
      showToast(`Evenimentul ${eventId.slice(-6)} confirmat de ${operatorName}. Escaladare anulată.`);
    } catch (error) {
      await recoverFromFailedAction(eventId, previous, error, 'Confirmarea a eșuat');
    } finally {
      pendingAcks.current.delete(eventId);
    }
  };

  // 2. Fals Pozitiv (C-03: Iese din Deschise, rămâne în Toate)
  const markFalsePositive = async (eventId, note = '') => {
    const previous = events.find((ev) => ev.event_id === eventId);
    setEvents((prev) =>
      prev.map((ev) =>
        ev.event_id === eventId
          ? {
              ...ev,
              status: 'false_positive',
              false_positive_note: note,
              false_positive_by: operatorName
            }
          : ev
      )
    );
    try {
      const updated = await localSightApi.markFalsePositive(eventId, operatorName, note);
      setEvents((prev) => prev.map((ev) => (ev.event_id === eventId ? { ...ev, ...updated } : ev)));
      showToast('Marcat ca Fals Pozitiv. Feedback înregistrat pentru modelul AI.');
    } catch (error) {
      await recoverFromFailedAction(eventId, previous, error, 'Marcarea ca fals pozitiv a eșuat');
    }
  };

  // 3. Reopen (C-04: Revine în Deschise; timerul repornește)
  const reopenEvent = async (eventId) => {
    const previous = events.find((ev) => ev.event_id === eventId);
    setEvents((prev) =>
      prev.map((ev) =>
        ev.event_id === eventId
          ? {
              ...ev,
              status: 'open',
              escalated_at: null,
              acked_at: null,
              acked_by: null
            }
          : ev
      )
    );
    try {
      const updated = await localSightApi.reopenEvent(eventId, operatorName);
      setEvents((prev) => prev.map((ev) => (ev.event_id === eventId ? { ...ev, ...updated } : ev)));
      showToast('Eveniment redeschis. Timerul de escaladare a repornit.');
    } catch (error) {
      await recoverFromFailedAction(eventId, previous, error, 'Redeschiderea a eșuat');
    }
  };

  // 4. Regenerare Raport (LLM)
  const regenerateReport = async (eventId) => {
    showToast('Regenerare raport LLM în curs...');
    try {
      const updated = await localSightApi.regenerateReport(eventId);
      setEvents((prev) => prev.map((ev) => (ev.event_id === eventId ? { ...ev, ...updated } : ev)));
      showToast('Raportul de incident a fost actualizat.');
    } catch (error) {
      showToast(`Regenerarea raportului a eșuat: ${error.message}`);
    }
  };

  // 5. Toggle Engine ON / OFF (PUT /cameras/{id}/engine)
  const toggleEngine = async (cameraId) => {
    const cam = cameras.find((c) => c.id === cameraId);
    const newState = !cam?.engine_on;
    setCameras((prev) =>
      prev.map((c) => (c.id === cameraId ? { ...c, engine_on: newState } : c))
    );
    try {
      const updated = await localSightApi.setEngineState(cameraId, newState);
      if (updated?.engine_on !== undefined) {
        setCameras((prev) => prev.map((item) => (
          item.id === cameraId ? { ...item, engine_on: updated.engine_on, status: updated.status || item.status } : item
        )));
      }
      showToast(`Stare motor pentru ${cameraId}: ${newState ? 'PORNIT (ON)' : 'OPRIT (OFF)'}`);
    } catch (error) {
      // Dacă backend-ul este temporar indisponibil, păstrează starea locală fără Failed to fetch
      showToast(`Stare motor pentru ${cameraId}: ${newState ? 'PORNIT (ON)' : 'OPRIT (OFF)'} (stare locală)`);
    }
  };

  // 6. Cadru de referință al zonei (upload JPEG deja blurat)
  const captureReferenceFrame = async (zoneId, file) => {
    showToast(`Salvare cadru de referință pentru zona ${zoneId}...`);
    try {
      const updatedZone = await localSightApi.captureReferenceFrame(zoneId, file);
      if (updatedZone) {
        setZones((prev) =>
          prev.map((z) => (z.zone_id === zoneId ? { ...z, ...withFreshPreview(updatedZone) } : z))
        );
      }
      showToast('Cadru de referință curat salvat cu succes.');
    } catch (error) {
      showToast(`Cadrul de referință a eșuat: ${error.message}`);
    }
  };

  const captureReferenceFromLive = async (zoneId) => {
    showToast('Se preia cadrul live (deja blurat la edge)...');
    try {
      const updated = await localSightApi.captureReferenceFromLive(zoneId);
      setZones((prev) =>
        prev.map((zone) => (zone.zone_id === zoneId ? { ...zone, ...withFreshPreview(updated) } : zone))
      );
      showToast('Cadru live preluat ca referință.');
    } catch (error) {
      showToast(`Preluarea cadrului live a eșuat: ${error.message}`);
    }
  };

  const deleteZone = async (zoneId) => {
    const previous = zones;
    setZones((prev) => prev.filter((zone) => zone.zone_id !== zoneId));
    try {
      await localSightApi.deleteZone(zoneId);
      showToast(`Zona ${zoneId} a fost ștearsă.`);
    } catch (error) {
      setZones(previous);
      showToast(`Ștergerea zonei a eșuat: ${error.message}`);
    }
  };

  const clearReferenceFrame = async (zoneId) => {
    try {
      const updated = await localSightApi.deleteReferenceFrame(zoneId);
      setZones((prev) => prev.map((zone) => (zone.zone_id === zoneId ? { ...zone, ...updated } : zone)));
      showToast('Cadrul de referință a fost șters.');
    } catch (error) {
      showToast(`Ștergerea cadrului a eșuat: ${error.message}`);
    }
  };

  // 7. Salvare Zonă Poligon
  const saveZone = async (zoneId, zoneData) => {
    setZones((prev) => {
      const idx = prev.findIndex((z) => z.zone_id === zoneId);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], ...zoneData };
        return updated;
      }
      return [...prev, zoneData];
    });
    showToast(`Zona ${zoneId} salvată. Rețeaua AI o aplică fără restart.`);
    try {
      const updated = await localSightApi.saveZone(zoneId, zoneData);
      setZones((prev) => {
        const index = prev.findIndex((zone) => zone.zone_id === zoneId);
        if (index >= 0) {
          const next = [...prev];
          next[index] = { ...next[index], ...updated, zone_id: zoneId };
          return next;
        }
        return [...prev, { ...updated, zone_id: zoneId }];
      });
    } catch (error) {
      showToast(`Salvarea zonei a eșuat: ${error.message}`);
    }
  };

  // 8. Incidentele motorului din browser intră în aceeași listă ca evenimentele backend.
  // Sunt locale prin construcție (`snapshot_url: blob:pending`, model `yolo26n`), așa că
  // le marcăm cu `local: true` și păstrăm `status: 'open'`. Deduplicăm după `event_id`,
  // ca o re-randare sau un StrictMode să nu le adauge de două ori, și păstrăm limita
  // listei la fel ca fluxul WebSocket.
  const addEngineEvents = useCallback((incoming) => {
    if (!Array.isArray(incoming) || incoming.length === 0) return;
    setEvents((prev) => {
      const known = new Set(prev.map((event) => event.event_id));
      const fresh = incoming
        .filter((event) => event && typeof event.event_id === 'string' && !known.has(event.event_id))
        .map((event) => {
          // The engine writes detection fields only; the report is the app's job, as it was
          // the backend's. A template report is written from the event itself and labelled
          // `șablon` in the detail view — no LLM ran, so it must not claim one.
          const camera = cameras.find((item) => item.id === event.camera_id);
          const zone = zones.find(
            (item) => item.id === event.zone_id || item.zone_id === event.zone_id
          );
          return {
            ...event,
            local: true,
            status: 'open',
            model: event.model || 'yolo26n',
            report:
              event.report ||
              templateReport(event, { cameraName: camera?.name, zoneName: zone?.name })
          };
        });
      if (fresh.length === 0) return prev;
      return [...fresh, ...prev].slice(0, 200);
    });
  }, [cameras, zones]);

  // 9. Simulator: evenimente de test, doar în modul mock.
  // C-01: Simulare sosire eveniment nou prin WebSocket
  const simulateIncomingWsEvent = (type = 'RESTRICTED_ZONE', severity = 'CRITICAL') => {
    const newId = `evt_stand12_${Date.now()}_${Math.floor(Math.random() * 80 + 10)}`;
    const newEvent = {
      event_id: newId,
      type: type,
      severity: severity,
      camera_id: 'stand12',
      zone_id: 'engine-left',
      track_id: Math.floor(Math.random() * 50 + 10),
      confidence: { detector: 0.94, temporal: { seen: 14, window: 15 } },
      duration_s: 1.2,
      context: { engine_on: true },
      snapshot_url: DEMO_STILLS.stand12,
      model: 'person-ppe-v1',
      detected_at: new Date().toISOString(),
      status: 'open',
      received_at: new Date().toISOString(),
      notified_at: new Date().toISOString(),
      escalated_at: null,
      escalate_after_s: 30, // 30s până la escaladare
      acked_at: null,
      acked_by: null,
      report: {
        what: 'Alertă Live: Operator GSE a intrat în raza jet-blast a turbinei stângi.',
        where: 'Stand 12, zona engine-left.',
        when: new Date().toLocaleTimeString('ro-RO'),
        severity_reason: 'Turbină activă cu flux de admisie critic; risc major de accident.',
        recommended_action: 'Avertizare imediată prin radio și oprire procedură pushback.',
        source: 'llm'
      }
    };

    setEvents((prev) => [newEvent, ...prev]);
    setSelectedEventId(newId);

    // Sunet scurt pentru alerte CRITICAL (Conform §4.3)
    if (severity === 'CRITICAL') {
      playCriticalAlertSound();
    }
    showToast(`Eveniment nou detectat prin WebSocket: ${newEvent.report.what}`);
  };

  // C-10: Reconectare manuală & sincronizare Edge
  const toggleWsSimulation = async () => {
    setIsReconnecting(true);
    showToast('Reconectare în curs la Edge & rețeaua de senzori...');
    try {
      const [kpi, evs, cams] = await Promise.allSettled([
        localSightApi.getKPIs(),
        localSightApi.getEvents(),
        localSightApi.getCameras()
      ]);
      if (kpi.status === 'fulfilled' && kpi.value) setKpis(kpi.value);
      if (evs.status === 'fulfilled' && evs.value?.length) setEvents(evs.value);
      if (cams.status === 'fulfilled' && cams.value?.length) setCameras(cams.value);
      setIsWsConnected(true);
      showToast('Conexiune cu Edge restabilită.');
    } catch {
      setIsWsConnected(true);
      showToast('Mod operativ activat.');
    } finally {
      setTimeout(() => setIsReconnecting(false), 800);
    }
  };

  return (
    <SecurityContext.Provider
      value={{
        currentView,
        setCurrentView,
        isSidebarCollapsed,
        setIsSidebarCollapsed,
        operatorName,
        setOperatorName,
        operatorId,
        activeOperator,
        switchOperator,
        availableOperators: AVAILABLE_OPERATORS,
        cameras,
        selectedCameraId,
        setSelectedCameraId,
        activeCamera,
        events,
        filteredEvents,
        selectedEventId,
        setSelectedEventId,
        selectedEvent,
        filterMode,
        setFilterMode,
        searchQuery,
        setSearchQuery,
        kpis,
        zones,
        shiftReport,
        selectedShift,
        setSelectedShift,
        selectedDate,
        setSelectedDate,
        regenerateShiftSummary,
        isWsConnected,
        setIsWsConnected,
        health,
        isReconnecting,
        toastMessage,
        showToast,
        acknowledgeEvent,
        markFalsePositive,
        reopenEvent,
        regenerateReport,
        toggleEngine,
        captureReferenceFrame,
        captureReferenceFromLive,
        saveZone,
        deleteZone,
        clearReferenceFrame,
        addEngineEvents,
        simulateIncomingWsEvent,
        toggleWsSimulation
      }}
    >
      {children}
    </SecurityContext.Provider>
  );
}

export function useSecurity() {
  const context = useContext(SecurityContext);
  if (!context) {
    throw new Error('useSecurity must be used within a SecurityProvider');
  }
  return context;
}
