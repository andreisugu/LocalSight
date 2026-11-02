// Cameras and the per-camera engine switch.
//
// The engine toggle is optimistic: the UI flips immediately, then the API answer (when it
// carries one) replaces the row. A backend that cannot be reached leaves the local state
// in place and the toast says so, because a demo must not lose the switch to a fetch error.

import { useMemo, useState } from 'react';
import { INITIAL_CAMERAS } from '../constants/mockData.js';
import { localSightApi, USE_MOCK } from '../services/api.js';

const DEFAULT_CAMERA_ID = 'stand12';

export function useCameraStore({ showToast }) {
  const [cameras, setCameras] = useState(USE_MOCK ? INITIAL_CAMERAS : []);
  const [selectedCameraId, setSelectedCameraId] = useState(DEFAULT_CAMERA_ID);

  const activeCamera = useMemo(
    () => cameras.find((camera) => camera.id === selectedCameraId)
      || cameras[0]
      || (USE_MOCK ? INITIAL_CAMERAS[0] : null),
    [cameras, selectedCameraId]
  );

  const toggleEngine = async (cameraId) => {
    const camera = cameras.find((item) => item.id === cameraId);
    const nextState = !camera?.engine_on;
    setCameras((prev) => prev.map((item) => (
      item.id === cameraId ? { ...item, engine_on: nextState } : item
    )));
    try {
      const updated = await localSightApi.setEngineState(cameraId, nextState);
      if (updated?.engine_on !== undefined) {
        setCameras((prev) => prev.map((item) => (
          item.id === cameraId
            ? { ...item, engine_on: updated.engine_on, status: updated.status || item.status }
            : item
        )));
      }
      showToast(`Stare motor pentru ${cameraId}: ${nextState ? 'PORNIT (ON)' : 'OPRIT (OFF)'}`);
    } catch {
      // Keep the local state; the operator asked for it and the toast says it is local.
      showToast(`Stare motor pentru ${cameraId}: ${nextState ? 'PORNIT (ON)' : 'OPRIT (OFF)'} (stare locală)`);
    }
  };

  return { cameras, setCameras, selectedCameraId, setSelectedCameraId, activeCamera, toggleEngine };
}
