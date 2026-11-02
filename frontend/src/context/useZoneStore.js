// Zones: the polygon list, the reference frame and the editor's save/delete.
//
// All writes are optimistic. A save merges the draft immediately and then the API row; a
// delete removes the zone at once; either one puts the whole previous list back if the
// call fails. The reference-frame helpers add a cache-busting query to the served image,
// otherwise the browser would keep showing the frame the operator just replaced.

import { useState } from 'react';
import { INITIAL_ZONES } from '../constants/mockData.js';
import { localSightApi, USE_MOCK } from '../services/api.js';

/** The API serves the frame from a stable URL; the `v` parameter makes the new one visible. */
function withFreshPreview(zone) {
  if (!zone?.reference_frame_url) return zone;
  const base = zone.reference_frame_url.split('?')[0];
  return { ...zone, reference_frame_url: `${base}?v=${Date.now()}` };
}

/**
 * One save, kept as a plain function so the optimistic-update/rollback contract can be
 * checked under Node (the hook itself needs React).
 *
 * The draft is merged into the list immediately so the editor shows what was saved, and
 * the API row replaces it afterwards. A rejection puts the whole previous list back: the
 * success toast is emitted only after the API answered, so a failed save can never leave a
 * phantom zone next to a "salvată" toast. `zones` is the list captured when the operator
 * pressed save; like `deleteZone`, this assumes no other write is in flight.
 *
 * @param {object} input
 * @param {string} input.zoneId
 * @param {object} input.zoneData Fields from the editor's draft payload.
 * @param {Array<object>} input.zones The list before the optimistic update.
 * @param {(next: Array<object> | ((previous: Array<object>) => Array<object>)) => void} input.setZones
 * @param {(message: string) => void} input.showToast
 * @param {{ saveZone: (zoneId: string, zoneData: object) => Promise<object> }} input.api
 * @returns {Promise<void>}
 */
export async function runSaveZone({ zoneId, zoneData, zones, setZones, showToast, api }) {
  const previous = zones;
  setZones((prev) => {
    const index = prev.findIndex((zone) => zone.zone_id === zoneId);
    if (index >= 0) {
      const updated = [...prev];
      updated[index] = { ...updated[index], ...zoneData };
      return updated;
    }
    // The merge below looks the row up by `zone_id`, so the optimistic row must carry it
    // even if the editor's payload did not.
    return [...prev, { ...zoneData, zone_id: zoneId }];
  });
  try {
    const updated = await api.saveZone(zoneId, zoneData);
    setZones((prev) => {
      const index = prev.findIndex((zone) => zone.zone_id === zoneId);
      if (index >= 0) {
        const next = [...prev];
        next[index] = { ...next[index], ...updated, zone_id: zoneId };
        return next;
      }
      return [...prev, { ...updated, zone_id: zoneId }];
    });
    showToast(`Zona ${zoneId} salvată. Rețeaua AI o aplică fără restart.`);
  } catch (error) {
    setZones(previous);
    showToast(`Salvarea zonei a eșuat: ${error.message}`);
  }
}

export function useZoneStore({ showToast }) {
  const [zones, setZones] = useState(USE_MOCK ? INITIAL_ZONES : []);

  const saveZone = async (zoneId, zoneData) => {
    await runSaveZone({ zoneId, zoneData, zones, setZones, showToast, api: localSightApi });
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

  const captureReferenceFrame = async (zoneId, file) => {
    showToast(`Salvare cadru de referință pentru zona ${zoneId}...`);
    try {
      const updatedZone = await localSightApi.captureReferenceFrame(zoneId, file);
      if (updatedZone) {
        setZones((prev) => prev.map((zone) => (
          zone.zone_id === zoneId ? { ...zone, ...withFreshPreview(updatedZone) } : zone
        )));
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
      setZones((prev) => prev.map((zone) => (
        zone.zone_id === zoneId ? { ...zone, ...withFreshPreview(updated) } : zone
      )));
      showToast('Cadru live preluat ca referință.');
    } catch (error) {
      showToast(`Preluarea cadrului live a eșuat: ${error.message}`);
    }
  };

  const clearReferenceFrame = async (zoneId) => {
    try {
      const updated = await localSightApi.deleteReferenceFrame(zoneId);
      setZones((prev) => prev.map((zone) => (
        zone.zone_id === zoneId ? { ...zone, ...updated } : zone
      )));
      showToast('Cadrul de referință a fost șters.');
    } catch (error) {
      showToast(`Ștergerea cadrului a eșuat: ${error.message}`);
    }
  };

  return {
    zones,
    setZones,
    saveZone,
    deleteZone,
    captureReferenceFrame,
    captureReferenceFromLive,
    clearReferenceFrame,
  };
}
