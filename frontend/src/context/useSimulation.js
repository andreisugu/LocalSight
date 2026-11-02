// Demo simulator (mock builds only, from the header menu).
//
// It fabricates an incident in the same shape the edge sends, prepends it to the shared
// list, selects it and announces it. It is the one place that invents data, so it is
// isolated here and reachable only from the mock-only header menu.

import { DEMO_STILLS } from '../constants/mockData.js';
import { playCriticalAlertSound } from '../utils/sound.js';

const SIMULATED_CAMERA_ID = 'stand12';
const SIMULATED_ZONE_ID = 'engine-left';

export function useSimulation({ showToast, setEvents, setSelectedEventId }) {
  const simulateIncomingWsEvent = (type = 'RESTRICTED_ZONE', severity = 'CRITICAL') => {
    const newId = `evt_${SIMULATED_CAMERA_ID}_${Date.now()}_${Math.floor(Math.random() * 80 + 10)}`;
    const newEvent = {
      event_id: newId,
      // The one flag that separates a menu-created demo event from a fixture: it stays
      // visible even with the demo fixtures hidden, because the operator asked for it.
      simulated: true,
      type,
      severity,
      camera_id: SIMULATED_CAMERA_ID,
      zone_id: SIMULATED_ZONE_ID,
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
      escalate_after_s: 30,
      acked_at: null,
      acked_by: null,
      report: {
        what: 'Alertă Live: Operator GSE a intrat în raza jet-blast a turbinei stângi.',
        where: 'Stand 12, zona engine-left.',
        when: new Date().toLocaleTimeString('ro-RO'),
        severity_reason: 'Turbină activă cu flux de admisie critic; risc major de accident.',
        recommended_action: 'Avertizare imediată prin radio și oprire procedură pushback.',
        source: 'llm',
      },
    };

    setEvents((prev) => [newEvent, ...prev]);
    setSelectedEventId(newId);

    if (severity === 'CRITICAL') playCriticalAlertSound();
    showToast(`Eveniment nou detectat prin WebSocket: ${newEvent.report.what}`);
  };

  return { simulateIncomingWsEvent };
}
