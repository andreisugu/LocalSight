// First load against the real backend.
//
// The frontend starts before the backend does, so a failed or partial answer is expected:
// each endpoint lands independently, a missing one is named in a single toast, and the
// whole load repeats every 2 s until everything answered. Nothing here blocks the others.

import { useEffect } from 'react';
import { localSightApi, USE_MOCK } from '../services/api.js';

const RETRY_MS = 2000;

export function useBackendBootstrap({
  showToast,
  setCameras,
  setSelectedCameraId,
  setEvents,
  setSelectedEventId,
  setZones,
  setKpis,
  setHealth,
}) {
  useEffect(() => {
    if (USE_MOCK) return undefined;
    let cancelled = false;
    let retryTimer;
    let announced = false;

    const load = async () => {
      const [cameras, events, zones, kpis, health] = await Promise.allSettled([
        localSightApi.getCameras(),
        localSightApi.getEvents(),
        localSightApi.getZones(),
        localSightApi.getKPIs(),
        localSightApi.getHealth(),
      ]);
      if (cancelled) return;

      const failures = [];
      if (cameras.status === 'fulfilled') {
        setCameras(cameras.value);
        setSelectedCameraId((current) => (
          cameras.value.some((camera) => camera.id === current) ? current : cameras.value[0]?.id
        ));
      } else {
        failures.push('camere');
      }
      if (events.status === 'fulfilled') {
        setEvents(events.value);
        setSelectedEventId((current) => (
          events.value.some((event) => event.event_id === current) ? current : events.value[0]?.event_id
        ));
      } else {
        failures.push('evenimente');
      }
      if (zones.status === 'fulfilled') setZones(zones.value);
      else failures.push('zone');
      if (kpis.status === 'fulfilled') setKpis(kpis.value);
      else failures.push('KPI');
      if (health.status === 'fulfilled') setHealth(health.value);
      else failures.push('health');

      if (failures.length) {
        if (!announced) {
          showToast(`Backend incomplet: ${failures.join(', ')}. Reîncerc automat...`);
          announced = true;
        }
        retryTimer = setTimeout(load, RETRY_MS);
      }
    };

    load();
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
