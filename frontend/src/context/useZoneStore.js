// Zones: the polygon list, the reference frame and the editor's save/delete.
//
// All writes are optimistic. A save merges the draft immediately and then the API row; a
// delete removes the zone at once and puts the whole previous list back if the call fails.
// The reference-frame helpers add a cache-busting query to the served image, otherwise the
// browser would keep showing the frame the operator just replaced.

import { useState } from 'react';
import { INITIAL_ZONES } from '../constants/mockData.js';
import { localSightApi, USE_MOCK } from '../services/api.js';

/** The API serves the frame from a stable URL; the `v` parameter makes the new one visible. */
function withFreshPreview(zone) {
  if (!zone?.reference_frame_url) return zone;
  const base = zone.reference_frame_url.split('?')[0];
  return { ...zone, reference_frame_url: `${base}?v=${Date.now()}` };
}

export function useZoneStore({ showToast }) {
  const [zones, setZones] = useState(USE_MOCK ? INITIAL_ZONES : []);

  const saveZone = async (zoneId, zoneData) => {
    setZones((prev) => {
      const index = prev.findIndex((zone) => zone.zone_id === zoneId);
      if (index >= 0) {
        const updated = [...prev];
        updated[index] = { ...updated[index], ...zoneData };
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
