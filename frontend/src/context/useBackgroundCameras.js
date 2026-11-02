// Background cameras: the React lifecycle around the pure manager.
//
// The preference is OFF by default and lives under its own key, `localsight.backgroundCameras`
// ('1'/'0'). A missing, corrupt or hand-edited value is OFF: only an explicit '1' starts the
// extra workers. Settings writes the same key through `setEnabled`, so the panel and the
// manager can never disagree.
//
// This hook mounts in `SecurityProvider`, which sits above the routed screens: switching
// from Live to Incidents/Reports/Settings leaves the workers running. It owns three things
// the manager cannot know:
//
// - which cameras have a playable same-origin clip (the local webcam is never one: one
//   device, one permission prompt, and Live already asks for it);
// - the zones and reference frame per camera, read once per engine start;
// - the Live ownership signal (`liveEngineCameraId`): while the Live view's browser engine
//   is ON for a camera, the manager must not process that camera a second time.
//
// The manager never sees a camera list that changes identity just because React re-rendered:
// the effect depends on a key built from camera ids and statuses, callbacks are read through
// a ref, and a zone edit restarts the engines once after a debounce instead of on every
// keystroke.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createBackgroundCameras } from '../engine/backgroundCameras.js';
import {
  BACKGROUND_INTERVAL_MS,
  backgroundVideoSource,
  createBackgroundEngine,
} from '../engine/createBackgroundEngine.js';
import {
  WEBCAM_CAMERA_ID,
  demoClipFor,
  parseList,
  toEngineZones,
} from '../components/live/liveMedia.js';
import { DEMO_REFERENCE_FRAMES } from '../constants/mockData.js';

export const BACKGROUND_STORAGE_KEY = 'localsight.backgroundCameras';
export const BACKGROUND_MAX_CAMERAS = 3;
export const BACKGROUND_MIN_CORES = 4;
const ZONE_RESTART_DEBOUNCE_MS = 800;

function defaultStorage() {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    // Private mode or a blocked storage getter.
    return null;
  }
}

/**
 * Read the operator's choice. Default OFF, and only the literal '1' enables it.
 *
 * @param {{getItem(key: string): string|null}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readBackgroundPreference(storage = defaultStorage()) {
  try {
    return storage?.getItem(BACKGROUND_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Persist the choice. Storage refusal loses the preference, not this tab's state.
 *
 * @param {boolean} value
 * @param {{setItem(key: string, value: string): void}|null|undefined} [storage]
 * @returns {boolean}
 */
export function storeBackgroundPreference(value, storage = defaultStorage()) {
  const next = Boolean(value);
  try {
    storage?.setItem(BACKGROUND_STORAGE_KEY, next ? '1' : '0');
  } catch {
    // The choice still applies to this tab.
  }
  return next;
}

/**
 * Cameras that can run in the background: a seeded demo clip, not the local webcam and not
 * an offline row. `demoCameraIds` (VITE_DEMO_CAMERA) narrows the list when a launcher
 * configured one; an empty list means "every camera with a clip". The count is not capped
 * here: the manager refuses the whole run above its own limit, and Settings shows why.
 *
 * @param {Array<{id?: string, status?: string}>} cameras
 * @param {{demoCameraIds?: string[], clipEntries?: string[]}} [options]
 * @returns {Array<object>}
 */
export function backgroundCandidates(cameras, { demoCameraIds = [], clipEntries = [] } = {}) {
  return (Array.isArray(cameras) ? cameras : []).filter((camera) => {
    if (!camera || typeof camera.id !== 'string' || camera.id.length === 0) return false;
    if (camera.id === WEBCAM_CAMERA_ID) return false;
    if (camera.status === 'offline') return false;
    if (demoCameraIds.length > 0 && !demoCameraIds.includes(camera.id)) return false;
    // A configured clip entry is authoritative; without one the seeded media/<id>.mp4 is
    // the source. A missing file is reported as `unsupported` per camera, not hidden.
    return clipEntries.length === 0 || Boolean(demoClipFor(camera.id, clipEntries));
  });
}

/**
 * The frame the zones were drawn on, per camera: an uploaded reference wins, otherwise the
 * demo still. Same rule as Live, kept here because a background engine has no view to ask.
 *
 * @param {Array<object>} zones
 * @param {string} cameraId
 * @returns {string|null}
 */
export function backgroundReferenceUrl(zones, cameraId) {
  const cameraZones = (Array.isArray(zones) ? zones : [])
    .filter((zone) => zone && zone.camera_id === cameraId);
  const uploaded = cameraZones.find((zone) => zone.reference_frame_url)?.reference_frame_url;
  return uploaded || DEMO_REFERENCE_FRAMES[cameraId] || null;
}

/**
 * A stable fingerprint of the zone geometry and rules. The manager reads zones once per
 * engine start, so only a real editshould restart the engines.
 *
 * @param {Array<object>} zones
 * @returns {string}
 */
export function zoneSignature(zones) {
  return (Array.isArray(zones) ? zones : [])
    .filter((zone) => zone && typeof zone.zone_id === 'string')
    .map((zone) => [
      zone.zone_id,
      zone.camera_id,
      zone.rule_type,
      zone.active_when,
      zone.severity,
      zone.debounce_s,
      zone.escalate_after_s,
      zone.reference_frame_url || '',
      (zone.polygon || []).map((point) => (
        Array.isArray(point) ? `${point[0]},${point[1]}` : `${point?.x},${point?.y}`
      )).join(';'),
      (zone.required_ppe || []).join(','),
    ].join('|'))
    .join('||');
}

/**
 * @param {{
 *   cameras: Array<object>,
 *   zones: Array<object>,
 *   addEngineEvents: (events: Array<object>) => void,
 *   liveEngineCameraId?: string|null,
 * }} options
 * @returns {{
 *   enabled: boolean,
 *   setEnabled: (value: boolean) => void,
 *   getStatus: () => object|null,
 *   candidateIds: string[],
 * }}
 */
export function useBackgroundCameras({
  cameras,
  zones,
  addEngineEvents,
  liveEngineCameraId = null,
}) {
  const [enabled, setEnabledState] = useState(readBackgroundPreference);
  const managerRef = useRef(null);

  const demo = useMemo(() => ({
    demoCameraIds: parseList(import.meta.env.VITE_DEMO_CAMERA),
    clipEntries: parseList(import.meta.env.VITE_DEMO_CLIP),
  }), []);

  const candidates = useMemo(
    () => backgroundCandidates(cameras, demo),
    [cameras, demo]
  );

  // Identity of the run, not of the array: a camera toggle or a store re-render must not
  // tear down two workers and reload three ONNX sessions.
  const runKey = candidates
    .map((camera) => `${camera.id}:${camera.status}:${camera.engine_on ? 1 : 0}`)
    .join('|');

  const latest = useRef({
    zones,
    addEngineEvents,
    candidates,
    enabled,
    liveEngineCameraId,
  });
  latest.current = { zones, addEngineEvents, candidates, enabled, liveEngineCameraId };

  // One manager per camera set. It survives route changes because the provider does.
  useEffect(() => {
    if (!runKey) return undefined;
    const list = latest.current.candidates;
    const manager = createBackgroundCameras({
      cameras: list,
      zonesForCamera: (camera) => toEngineZones(latest.current.zones, camera.id),
      engineFactory: ({ cameraId, zones: engineZones }) => createBackgroundEngine({
        cameraId,
        zones: engineZones,
        referenceUrl: backgroundReferenceUrl(latest.current.zones, cameraId),
        intervalMs: BACKGROUND_INTERVAL_MS,
        videoSource: backgroundVideoSource(cameraId, demo),
      }),
      intervalMs: BACKGROUND_INTERVAL_MS,
      maxCameras: BACKGROUND_MAX_CAMERAS,
      minHardwareConcurrency: BACKGROUND_MIN_CORES,
      onEvent: (event) => latest.current.addEngineEvents([event]),
    });
    managerRef.current = manager;
    manager.start();
    // Ownership first: enabling after it must never start a worker for the camera Live
    // already feeds. The manager skips that entry and starts the others.
    manager.setActiveCamera(latest.current.liveEngineCameraId || null);
    manager.setEnabled(latest.current.enabled);
    return () => {
      manager.stop();
      if (managerRef.current === manager) managerRef.current = null;
    };
  }, [runKey, demo]);

  // The operator's switch. Storage is written here, so Settings only calls the setter.
  const setEnabled = useCallback((value) => {
    const next = storeBackgroundPreference(value);
    setEnabledState(next);
  }, []);

  useEffect(() => {
    latest.current.enabled = enabled;
    managerRef.current?.setEnabled(enabled);
  }, [enabled]);

  // Live's ownership: the manager skips a camera whose Live engine is actually running.
  useEffect(() => {
    latest.current.liveEngineCameraId = liveEngineCameraId;
    managerRef.current?.setActiveCamera(liveEngineCameraId || null);
  }, [liveEngineCameraId]);

  // Zones are read at engine start. A real edit restarts the run once, after the editor
  // stops changing the polygon; the models come back from the HTTP cache.
  const zoneKey = useMemo(() => zoneSignature(zones), [zones]);
  const previousZoneKey = useRef(zoneKey);
  useEffect(() => {
    if (previousZoneKey.current === zoneKey) return undefined;
    previousZoneKey.current = zoneKey;
    if (!latest.current.enabled) return undefined;
    const timer = setTimeout(() => {
      const manager = managerRef.current;
      if (!manager) return;
      manager.stop();
      manager.start();
      manager.setActiveCamera(latest.current.liveEngineCameraId || null);
      manager.setEnabled(latest.current.enabled);
    }, ZONE_RESTART_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [zoneKey]);

  useEffect(() => () => {
    managerRef.current?.stop();
    managerRef.current = null;
  }, []);

  const getStatus = useCallback(() => managerRef.current?.status() ?? null, []);

  return {
    enabled,
    setEnabled,
    getStatus,
    candidateIds: candidates.map((camera) => camera.id),
  };
}

export default useBackgroundCameras;
