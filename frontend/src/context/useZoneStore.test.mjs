// Tests for the zone save flow: the optimistic merge, the rollback when the API rejects
// and the toast order.
//
// The hook needs React, so the flow itself is a plain function (`runSaveZone`) and the
// React setter and `showToast` are injected here. Review P1-2: save used to be optimistic
// without a rollback and toasted success before the await, so a failed save left a phantom
// zone next to "salvată"; delete already did it correctly.

import test from 'node:test';
import assert from 'node:assert/strict';

import { runSaveZone } from './useZoneStore.js';

/** The two zones from the seed config, enough to exercise update and append. */
function initialZones() {
  return [
    { zone_id: 'engine-left', name: 'Motor stâng', severity: 'CRITICAL' },
    { zone_id: 'engine-right', name: 'Motor dreapta', severity: 'CRITICAL' },
  ];
}

/** A stand-in for `useState`'s setter plus a toast recorder. */
function fakeStore(zones) {
  const state = { list: zones, toasts: [], toastsBeforeApi: null };
  const setZones = (next) => {
    state.list = typeof next === 'function' ? next(state.list) : next;
  };
  const showToast = (message) => state.toasts.push(message);
  return { state, setZones, showToast };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('a successful save shows the draft at once and the API row afterwards', async () => {
  const zones = initialZones();
  const { state, setZones, showToast } = fakeStore(zones);
  const response = deferred();
  const api = { saveZone: () => response.promise };

  const pending = runSaveZone({
    zoneId: 'engine-left',
    zoneData: { name: 'Motor stâng (nou)', debounce_s: 2 },
    zones,
    setZones,
    showToast,
    api,
  });

  // Optimistic: the draft is already in the list, nothing claims success yet.
  assert.equal(state.list[0].name, 'Motor stâng (nou)');
  assert.equal(state.list[0].debounce_s, 2);
  assert.deepEqual(state.toasts, []);

  response.resolve({ name: 'Motor stâng (nou)', debounce_s: 2, severity: 'CRITICAL', saved: true });
  await pending;

  assert.equal(state.list[0].saved, true);
  assert.equal(state.list[0].zone_id, 'engine-left');
  assert.deepEqual(state.toasts, ['Zona engine-left salvată. Rețeaua AI o aplică fără restart.']);
});

test('a rejected save restores the previous list and only reports the failure', async () => {
  const zones = initialZones();
  const before = structuredClone(zones);
  const { state, setZones, showToast } = fakeStore(zones);
  const response = deferred();
  const api = { saveZone: () => response.promise };

  const pending = runSaveZone({
    zoneId: 'engine-left',
    zoneData: { name: 'Motor stâng (nou)' },
    zones,
    setZones,
    showToast,
    api,
  });

  // The optimistic update happened first, so the rollback has something to undo.
  assert.equal(state.list[0].name, 'Motor stâng (nou)');

  response.reject(new Error('502 Bad Gateway'));
  await pending;

  assert.deepEqual(state.list, before, 'the phantom zone is gone');
  assert.deepEqual(state.toasts, ['Salvarea zonei a eșuat: 502 Bad Gateway']);
  // Also: no mutation of the list the caller handed over, so the rollback is exact.
  assert.deepEqual(zones, before);
});

test('a rejected save of a new zone removes the appended row', async () => {
  const zones = initialZones();
  const { state, setZones, showToast } = fakeStore(zones);
  const api = { saveZone: async () => { throw new Error('network down'); } };

  await runSaveZone({
    zoneId: 'baggage-area',
    zoneData: { zone_id: 'baggage-area', name: 'Bagaje' },
    zones,
    setZones,
    showToast,
    api,
  });

  assert.equal(state.list.length, 2);
  assert.equal(state.list.some((zone) => zone.zone_id === 'baggage-area'), false);
  assert.deepEqual(state.toasts, ['Salvarea zonei a eșuat: network down']);
});

test('a successful save of a new zone appends the API row', async () => {
  const zones = initialZones();
  const { state, setZones, showToast } = fakeStore(zones);
  const api = { saveZone: async () => ({ name: 'Bagaje', severity: 'WARNING' }) };

  await runSaveZone({
    zoneId: 'baggage-area',
    zoneData: { name: 'Bagaje' },
    zones,
    setZones,
    showToast,
    api,
  });

  assert.equal(state.list.length, 3);
  assert.deepEqual(state.list[2], {
    name: 'Bagaje',
    severity: 'WARNING',
    zone_id: 'baggage-area',
  });
  assert.equal(state.toasts.length, 1);
});
