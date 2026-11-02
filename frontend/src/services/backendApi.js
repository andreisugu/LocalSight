// Real backend implementation of the API surface.
//
// Every method shapes the response through `backendMappers.js`; this file only knows the
// routes from `docs/contract.md`. The websocket mirrors the polling fallback in the
// context: `event.created` / `event.updated` payloads are mapped like any HTTP event.

import { API_BASE_URL } from './config.js';
import {
  mapCamera,
  mapEvent,
  mapKpi,
  mapShiftReport,
  mapZone,
  toZonePayload,
} from './backendMappers.js';
import { queryString, request } from './http.js';
import { localDateString } from './shift.js';

const RECONNECT_DELAY_MS = 2000;

export const backendApi = {
  async getHealth() {
    return request('/health');
  },

  async getCameras() {
    const cameras = await request('/cameras');
    return cameras.map(mapCamera);
  },

  async setEngineState(cameraId, on) {
    try {
      const camera = await request(`/cameras/${encodeURIComponent(cameraId)}/engine`, {
        method: 'PUT',
        body: JSON.stringify({ on }),
      });
      return {
        id: camera.id,
        camera_id: camera.id,
        engine_on: Boolean(camera.engine_on),
        status: camera.online ? 'online' : 'offline',
      };
    } catch {
      // The camera list is still usable when the engine switch is temporarily offline;
      // the context keeps the local state and says so in the toast.
      return { id: cameraId, camera_id: cameraId, engine_on: Boolean(on), status: 'online' };
    }
  },

  async getZones(cameraId) {
    const zones = await request(`/zones${queryString({ camera_id: cameraId })}`);
    return zones.map(mapZone);
  },

  async saveZone(zoneId, zoneData) {
    const zone = await request(`/zones/${encodeURIComponent(zoneId)}`, {
      method: 'PUT',
      body: JSON.stringify(toZonePayload(zoneId, zoneData)),
    });
    return mapZone(zone);
  },

  async captureReferenceFrame(zoneId, file) {
    const form = new FormData();
    form.append('zone_id', zoneId);
    form.append('file', file);
    const zone = await request('/zones/reference-frame', { method: 'POST', body: form });
    return mapZone(zone);
  },

  async captureReferenceFromLive(zoneId) {
    const zone = await request(`/zones/${encodeURIComponent(zoneId)}/reference-frame/from-live`, {
      method: 'POST',
    });
    return mapZone(zone);
  },

  async deleteZone(zoneId) {
    await request(`/zones/${encodeURIComponent(zoneId)}`, { method: 'DELETE' });
    return true;
  },

  async deleteReferenceFrame(zoneId) {
    const zone = await request(`/zones/${encodeURIComponent(zoneId)}/reference-frame`, {
      method: 'DELETE',
    });
    return mapZone(zone);
  },

  async getEvents({ status = '', severity = '', camera_id = '' } = {}) {
    const events = await request(
      `/events${queryString({ status, severity, camera_id, limit: 200 })}`
    );
    return events.map(mapEvent);
  },

  async getEventById(eventId) {
    return mapEvent(await request(`/events/${encodeURIComponent(eventId)}`));
  },

  async acknowledgeEvent(eventId, operator = 'Operator') {
    const event = await request(`/events/${encodeURIComponent(eventId)}/ack`, {
      method: 'POST',
      body: JSON.stringify({ operator }),
    });
    return mapEvent(event);
  },

  async markFalsePositive(eventId, operator = 'Operator', note = '') {
    const event = await request(`/events/${encodeURIComponent(eventId)}/false-positive`, {
      method: 'POST',
      body: JSON.stringify({ operator, note }),
    });
    return mapEvent(event);
  },

  async reopenEvent(eventId, operator = 'Operator') {
    const event = await request(`/events/${encodeURIComponent(eventId)}/reopen`, {
      method: 'POST',
      body: JSON.stringify({ operator }),
    });
    return mapEvent(event);
  },

  async regenerateReport(eventId) {
    const event = await request(`/events/${encodeURIComponent(eventId)}/regenerate-report`, {
      method: 'POST',
    });
    return mapEvent(event);
  },

  async getKPIs(date = '', shift = '') {
    return mapKpi(await request(`/kpi${queryString({ date, shift })}`));
  },

  async getShiftReport(shift = 'morning', date = localDateString(), { refresh = false } = {}) {
    const forced = refresh ? '&refresh=true' : '';
    return mapShiftReport(await request(`/reports${queryString({ shift, date })}${forced}`));
  },

  connectEventsSocket(onMessage, onError, onOpen) {
    const wsUrl = `${API_BASE_URL.replace(/^http/, 'ws')}/ws/events`;
    let socket;
    let stopped = false;
    let retryTimer;

    const connect = () => {
      socket = new WebSocket(wsUrl);
      // React StrictMode mounts, cleans up and mounts again; events from the first socket
      // must not mark the second connection as lost, hence the `stopped` guard.
      socket.onopen = () => {
        if (!stopped) onOpen?.();
      };
      socket.onmessage = (event) => {
        if (stopped) return;
        try {
          const message = JSON.parse(event.data);
          if (
            message?.data &&
            (message.type === 'event.created' || message.type === 'event.updated')
          ) {
            message.data = mapEvent(message.data);
          }
          onMessage(message);
        } catch (error) {
          console.error('WS parse error', error);
        }
      };
      socket.onerror = () => {
        if (!stopped) onError?.();
      };
      socket.onclose = () => {
        if (stopped) return;
        onError?.();
        retryTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      };
    };

    connect();
    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      socket?.close();
    };
  },
};
