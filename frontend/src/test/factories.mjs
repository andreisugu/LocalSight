// Fixtures shared by the unit tests of the shift report and its export.
//
// Both modules count the same contract `EventOut` rows, so a test that invents its own copy
// of the shape can drift from the other one without anybody noticing. One factory here:
// every field the report reads, with values that already exercise the winter offset
// (16:00Z is 18:00 in Bucharest while EET is in force).

/** The shift label the two report tests build with. */
export const SHIFT_LABEL = 'Tura 2 (Prânz: 14:00 - 22:00)';

/** A contract-shaped incident; pass only the fields the test cares about. */
export function makeEvent(overrides = {}) {
  return {
    event_id: 'evt_stand12_1793356933120_17',
    type: 'RESTRICTED_ZONE',
    severity: 'CRITICAL',
    status: 'open',
    camera_id: 'stand12',
    zone_id: 'engine-left',
    detected_at: '2026-11-02T16:00:00.000Z',
    acked_at: null,
    report: null,
    ...overrides,
  };
}
