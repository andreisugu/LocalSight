import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INCIDENT_VIEW,
  VIEW_PATHS,
  pathFor,
  readInitialRoute,
  routeFromPath,
  stripBase,
} from './appRoute.js';

test('every view path maps back to its own view', () => {
  for (const [view, path] of Object.entries(VIEW_PATHS)) {
    assert.deepEqual(routeFromPath(path), { view, eventId: null });
  }
});

test('paths below a deploy base resolve after the prefix is removed', () => {
  assert.deepEqual(routeFromPath('/LocalSight/incidents', '/LocalSight'), {
    view: 'incidents',
    eventId: null,
  });
  assert.deepEqual(routeFromPath('/LocalSight', '/LocalSight'), { view: 'live', eventId: null });
  assert.deepEqual(routeFromPath('/LocalSight/', '/LocalSight'), { view: 'live', eventId: null });
});

test('a path that only shares the base prefix is not stripped', () => {
  assert.equal(stripBase('/LocalSightX/incidents', '/LocalSight'), '/LocalSightX/incidents');
  assert.deepEqual(routeFromPath('/LocalSightX/incidents', '/LocalSight'), { view: 'live', eventId: null });
});

test('an incident address carries the decoded id', () => {
  assert.deepEqual(routeFromPath('/incidents/evt_stand12_1700000000000_17'), {
    view: INCIDENT_VIEW,
    eventId: 'evt_stand12_1700000000000_17',
  });
  assert.deepEqual(routeFromPath('/LocalSight/incidents/a%2Fb', '/LocalSight'), {
    view: INCIDENT_VIEW,
    eventId: 'a/b',
  });
  // Trailing slashes are ignored on every path, not only on the list screens.
  assert.deepEqual(routeFromPath('/incidents/evt_1///'), { view: INCIDENT_VIEW, eventId: 'evt_1' });
});

test('unknown and empty addresses fall back to Live', () => {
  assert.deepEqual(routeFromPath('/nope'), { view: 'live', eventId: null });
  assert.deepEqual(routeFromPath(''), { view: 'live', eventId: null });
  assert.deepEqual(routeFromPath('/incidents/'), { view: 'incidents', eventId: null });
});

test('the archive screen has its own address below the deploy base', () => {
  assert.deepEqual(routeFromPath('/archive'), { view: 'archive', eventId: null });
  assert.deepEqual(routeFromPath('/LocalSight/archive', '/LocalSight'), {
    view: 'archive',
    eventId: null,
  });
  assert.deepEqual(routeFromPath('/LocalSight/archive/', '/LocalSight'), {
    view: 'archive',
    eventId: null,
  });
  assert.equal(pathFor('archive'), '/archive');
  assert.equal(pathFor('archive', null, '/LocalSight'), '/LocalSight/archive');
});

test('pathFor writes the base prefix exactly once', () => {
  assert.equal(pathFor('incidents'), '/incidents');
  assert.equal(pathFor('incidents', null, '/LocalSight'), '/LocalSight/incidents');
  assert.equal(pathFor(INCIDENT_VIEW, 'evt_1', '/LocalSight'), '/LocalSight/incidents/evt_1');
  assert.equal(pathFor(INCIDENT_VIEW, 'a/b'), '/incidents/a%2Fb');
  // A detail view without an id is the list: the address bar must never show a bare parent.
  assert.equal(pathFor(INCIDENT_VIEW, null), '/incidents');
  assert.equal(pathFor('unknown-screen'), '/');
});

test('pathFor and routeFromPath round-trip', () => {
  const id = 'evt_stand12_1700000000000_17';
  const path = pathFor(INCIDENT_VIEW, id, '/LocalSight');
  assert.deepEqual(routeFromPath(path, '/LocalSight'), { view: INCIDENT_VIEW, eventId: id });
});

test('a malformed address still boots on Live', () => {
  assert.deepEqual(readInitialRoute('/incidents/%E0%A4%A'), { view: 'live', eventId: null });
  assert.deepEqual(readInitialRoute('/LocalSight/zones', '/LocalSight'), { view: 'zones', eventId: null });
});
