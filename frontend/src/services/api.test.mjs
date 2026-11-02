import test from 'node:test';
import assert from 'node:assert/strict';
import { localSightApi, TYPE_LABELS, USE_MOCK } from './api.js';

const METHODS = [
  'getHealth',
  'getCameras',
  'setEngineState',
  'toggleEngine',
  'getZones',
  'saveZone',
  'deleteZone',
  'captureReferenceFrame',
  'captureReferenceFromLive',
  'deleteReferenceFrame',
  'getEvents',
  'getEventById',
  'acknowledgeEvent',
  'markFalsePositive',
  'reopenEvent',
  'regenerateReport',
  'getKPIs',
  'getShiftReport',
  'connectEventsSocket',
  'shiftToApi',
  'currentShiftId',
  'shiftDate',
];

test('the facade keeps the whole exported surface', () => {
  for (const method of METHODS) {
    assert.equal(typeof localSightApi[method], 'function', method);
  }
});

test('mock mode is off unless the build asks for it', () => {
  // Node has no Vite env, which is the same default the production bundle uses.
  assert.equal(USE_MOCK, false);
});

test('type labels cover the contract enum plus the legacy aliases', () => {
  assert.deepEqual(TYPE_LABELS, {
    RESTRICTED_ZONE: 'Zonă restricționată',
    NO_PPE: 'Echipament lipsă',
    PPE_VIOLATION: 'Echipament lipsă',
    SMOKING: 'Fumat',
    CAMERA_OFFLINE: 'Cameră offline',
    UNATTENDED_BAGGAGE: 'Bagaj abandonat',
  });
});

test('shift helpers are available without a backend', () => {
  assert.equal(localSightApi.shiftToApi('shift_2'), 'afternoon');
  assert.equal(localSightApi.currentShiftId(new Date('2026-11-02T15:00:00+02:00')), 'shift_2');
  assert.equal(localSightApi.shiftDate('shift_2', new Date('2026-11-02T15:00:00+02:00')), '2026-11-02');
});
