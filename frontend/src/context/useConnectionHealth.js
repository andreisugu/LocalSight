// Connection state: edge health, the event socket and the manual reconnect.
//
// The socket is the fast path; when it is down the app polls every 2 s instead (C-10), so a
// lost signal degrades the feed instead of freezing it. `/health` is polled separately so
// the Edge badge does not need a page refresh.

import { useEffect, useState } from 'react';
import { localSightApi, USE_MOCK } from '../services/api.js';
import { playCriticalAlertSound } from '../utils/sound.js';
import { upsertEvent } from '../utils/incidentState.js';

const HEALTH_POLL_MS = 5000;
const EVENT_POLL_MS = 2000;
const RECONNECT_BANNER_MS = 800;

const INITIAL_HEALTH = USE_MOCK
  ? { status: 'ok', db: true, edge_last_seen_s: 0, mock: true }
  : { status: 'connecting', db: false, edge_last_seen_s: null };

export function useConnectionHealth({ showToast, setEvents, setKpis, setCameras }) {
  const [health, setHealth] = useState(INITIAL_HEALTH);
  const [isWsConnected, setIsWsConnected] = useState(true);
  const [isReconnecting, setIsReconnecting] = useState(false);

  // Real socket. A critical incident that just arrived plays the alert sound; the KPI tiles
  // are refreshed from the API because the message carries only the event.
  useEffect(() => {
    const disconnect = localSightApi.connectEventsSocket(
      (message) => {
        setIsWsConnected(true);
        if (message.type === 'kpi.updated' && message.data) {
          setKpis((prev) => ({ ...prev, ...message.data }));
          return;
        }
        if (message.type === 'event.created' || message.type === 'event.updated') {
          const incoming = message.data;
          setEvents((prev) => upsertEvent(prev, incoming));
          if (message.type === 'event.created' && incoming?.severity === 'CRITICAL') {
            playCriticalAlertSound();
          }
          localSightApi.getKPIs().then(setKpis).catch(() => {});
        }
      },
      () => setIsWsConnected(false),
      () => setIsWsConnected(true)
    );
    return () => disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Polling fallback while the socket is down. The failure banner stays visible; the next
  // tick retries.
  useEffect(() => {
    if (USE_MOCK || isWsConnected) return undefined;
    const poll = async () => {
      try {
        const [nextEvents, nextKpis] = await Promise.all([
          localSightApi.getEvents(),
          localSightApi.getKPIs(),
        ]);
        setEvents(nextEvents);
        setKpis(nextKpis);
      } catch {
        // Retried on the next tick.
      }
    };
    poll();
    const interval = setInterval(poll, EVENT_POLL_MS);
    return () => clearInterval(interval);
  }, [isWsConnected]); // eslint-disable-line react-hooks/exhaustive-deps

  // Edge health is independent of the event socket.
  useEffect(() => {
    if (USE_MOCK) return undefined;
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
    const interval = setInterval(tick, HEALTH_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // C-10: manual reconnect and edge resync. The banner spinner stays for a moment even when
  // the requests answer instantly, so the click has visible feedback.
  const toggleWsSimulation = async () => {
    setIsReconnecting(true);
    showToast('Reconectare în curs la Edge & rețeaua de senzori...');
    try {
      const [kpi, events, cameras] = await Promise.allSettled([
        localSightApi.getKPIs(),
        localSightApi.getEvents(),
        localSightApi.getCameras(),
      ]);
      if (kpi.status === 'fulfilled' && kpi.value) setKpis(kpi.value);
      if (events.status === 'fulfilled' && events.value?.length) setEvents(events.value);
      if (cameras.status === 'fulfilled' && cameras.value?.length) setCameras(cameras.value);
      setIsWsConnected(true);
      showToast('Conexiune cu Edge restabilită.');
    } catch {
      setIsWsConnected(true);
      showToast('Mod operativ activat.');
    } finally {
      setTimeout(() => setIsReconnecting(false), RECONNECT_BANNER_MS);
    }
  };

  return { health, setHealth, isWsConnected, setIsWsConnected, isReconnecting, toggleWsSimulation };
}
