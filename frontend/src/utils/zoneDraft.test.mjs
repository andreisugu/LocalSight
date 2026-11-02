import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_FIELDS,
  HISTORY_LIMIT,
  NUDGE_STEP,
  SHAPE_PRESETS,
  buildZonePayload,
  cameraOptions,
  canDeletePoint,
  draftAfterDelete,
  draftFromZone,
  draftReducer,
  emptyDraft,
  formatPoints,
  normalisePoints,
  parsePointList,
  preferredZone,
  roundPoint,
  shortcutFor,
  slugify,
  uniqueZoneId,
  validateDraft,
} from './zoneDraft.js';
import { crossingEdges } from './polygon.js';

// Two helper points on a 0..1 frame; the actual coordinates never matter to the
// state machine, only that they are inside it.
const P = (x, y) => ({ x, y });
const SQUARE = [P(0.1, 0.1), P(0.9, 0.1), P(0.9, 0.9), P(0.1, 0.9)];
const BOW_TIE = [P(0.1, 0.1), P(0.9, 0.9), P(0.9, 0.1), P(0.1, 0.9)];

/** Run a list of actions in order, as the view would. */
function run(state, ...actions) {
  return actions.reduce((current, action) => draftReducer(current, action), state);
}

function draftWith(points, { closed = true, zoneId = 'zona-test' } = {}) {
  const state = draftReducer(emptyDraft(), { type: 'set-id', zoneId });
  return { ...state, points: normalisePoints(points), closed };
}

test('a blank draft has no geometry, no history and the default fields', () => {
  const draft = emptyDraft();
  assert.equal(draft.zoneId, '');
  assert.equal(draft.isNew, false);
  assert.deepEqual(draft.points, []);
  assert.equal(draft.closed, false);
  assert.equal(draft.selectedIndex, null);
  assert.deepEqual(draft.fields, DEFAULT_FIELDS);
  assert.deepEqual(draft.past, []);
  assert.deepEqual(draft.future, []);
  assert.equal(draft.gesture, null);
});

test('each blank draft owns its arrays and fields', () => {
  const a = emptyDraft();
  const b = emptyDraft();
  a.points.push(P(0.5, 0.5));
  a.fields.name = 'mutat';
  assert.deepEqual(b.points, []);
  assert.equal(b.fields.name, '');
});

test('add point appends in order, clamps to the frame and records history', () => {
  const draft = run(
    emptyDraft(),
    { type: 'set-id', zoneId: 'zona-test' },
    { type: 'add-point', point: P(0.25, 0.5) },
    { type: 'add-point', point: P(-1, 2) },
    { type: 'add-point', point: P(0.99999, 0.333333) }
  );
  assert.deepEqual(draft.points, [P(0.25, 0.5), P(0, 1), P(1, 0.3333)]);
  assert.equal(draft.closed, false);
  assert.equal(draft.past.length, 3);
  assert.deepEqual(draft.past[0].points, []);
});

test('a click on a closed polygon does not add a point, it only deselects', () => {
  const closed = { ...draftWith(SQUARE), selectedIndex: 2 };
  const next = draftReducer(closed, { type: 'add-point', point: P(0.5, 0.5) });
  assert.equal(next.points.length, 4);
  assert.equal(next.selectedIndex, null);
  assert.equal(next.past.length, 0);
});

test('inserting on an edge is one undoable step once the gesture ends', () => {
  const start = draftWith([P(0.1, 0.1), P(0.9, 0.1), P(0.5, 0.9)]);
  const dragged = run(
    start,
    { type: 'begin-gesture' },
    { type: 'insert-point', index: 0, point: P(0.5, 0.1) },
    { type: 'move-point', index: 1, point: P(0.6, 0.1) },
    { type: 'end-gesture' }
  );
  assert.deepEqual(
    dragged.points,
    [P(0.1, 0.1), P(0.6, 0.1), P(0.9, 0.1), P(0.5, 0.9)]
  );
  assert.equal(dragged.past.length, 1);
  assert.deepEqual(draftReducer(dragged, { type: 'undo' }).points, start.points);
});

test('a whole drag is a single undo step, and an unmoved gesture records nothing', () => {
  const start = draftWith(SQUARE);
  const moved = run(
    start,
    { type: 'begin-gesture' },
    { type: 'move-point', index: 0, point: P(0.2, 0.2) },
    { type: 'move-point', index: 0, point: P(0.3, 0.3) },
    { type: 'end-gesture' }
  );
  assert.equal(moved.past.length, 1);
  assert.deepEqual(moved.points[0], P(0.3, 0.3));
  assert.deepEqual(draftReducer(moved, { type: 'undo' }).points, SQUARE);

  const still = run(start, { type: 'begin-gesture' }, { type: 'end-gesture' });
  assert.equal(still.past.length, 0);
  assert.equal(still.gesture, null);
});

test('cancelling a gesture puts the points back and records nothing', () => {
  const start = draftWith(SQUARE);
  const cancelled = run(
    start,
    { type: 'begin-gesture' },
    { type: 'move-point', index: 1, point: P(0.5, 0.5) },
    { type: 'cancel-gesture' }
  );
  assert.deepEqual(cancelled.points, SQUARE);
  assert.equal(cancelled.past.length, 0);
  assert.equal(cancelled.gesture, null);
});

test('an arrow nudge moves one point, stays inside the frame and can be undone', () => {
  const start = draftWith(SQUARE);
  const nudged = draftReducer(start, { type: 'nudge-point', index: 0, dx: -0.5, dy: 0.01 });
  assert.deepEqual(nudged.points[0], P(0, 0.11));
  assert.equal(nudged.selectedIndex, 0);
  assert.deepEqual(draftReducer(nudged, { type: 'undo' }).points, SQUARE);
});

test('a closed polygon keeps three points; an open outline may lose any', () => {
  const triangle = draftWith([P(0, 0), P(1, 0), P(0.5, 1)]);
  assert.equal(canDeletePoint(triangle, 0), false);
  assert.equal(draftReducer(triangle, { type: 'delete-point', index: 0 }), triangle);

  const open = { ...triangle, closed: false };
  assert.equal(canDeletePoint(open, 0), true);
  assert.deepEqual(draftReducer(open, { type: 'delete-point', index: 0 }).points, [P(1, 0), P(0.5, 1)]);

  const quad = draftWith(SQUARE);
  assert.equal(canDeletePoint(quad, 3), true);
  const cut = draftReducer(quad, { type: 'delete-point', index: 3 });
  assert.equal(cut.points.length, 3);
  assert.equal(cut.selectedIndex, null);
});

test('delete-selection follows the selected index and is a no-op without one', () => {
  const quad = { ...draftWith(SQUARE), selectedIndex: 1 };
  const cut = draftReducer(quad, { type: 'delete-selection' });
  assert.deepEqual(cut.points, [P(0.1, 0.1), P(0.9, 0.9), P(0.1, 0.9)]);
  assert.equal(draftReducer({ ...quad, selectedIndex: null }, { type: 'delete-selection' }).points.length, 4);
});

test('closing needs three points, is undoable, and opening brings the draft back', () => {
  const open = { ...draftWith(SQUARE, { closed: false }) };
  const tooSmall = { ...open, points: [P(0, 0), P(1, 1)] };
  assert.equal(draftReducer(tooSmall, { type: 'close' }), tooSmall);

  const closed = draftReducer(open, { type: 'close' });
  assert.equal(closed.closed, true);
  assert.equal(closed.past.length, 1);
  assert.equal(draftReducer(closed, { type: 'close' }), closed);

  const reopened = draftReducer(closed, { type: 'open' });
  assert.equal(reopened.closed, false);
  assert.equal(reopened.past.length, 2);
  assert.equal(draftReducer(reopened, { type: 'open' }), reopened);
});

test('undo and redo are bounded and stay symmetric', () => {
  const blank = emptyDraft();
  assert.equal(draftReducer(blank, { type: 'undo' }), blank);
  assert.equal(draftReducer(blank, { type: 'redo' }), blank);

  const closed = run(
    draftWith(SQUARE, { closed: false }),
    { type: 'add-point', point: P(0.5, 0.5) },
    { type: 'close' }
  );
  const undone = draftReducer(closed, { type: 'undo' });
  assert.equal(undone.closed, false);
  assert.equal(undone.points.length, 5);
  const redone = draftReducer(undone, { type: 'redo' });
  assert.equal(redone.closed, true);
  assert.deepEqual(redone.points, closed.points);
  assert.equal(redone.selectedIndex, null);
});

test('a new edit drops the redo stack', () => {
  const closed = run(draftWith(SQUARE, { closed: false }), { type: 'close' });
  const undone = draftReducer(closed, { type: 'undo' });
  assert.equal(undone.future.length, 1);
  const edited = draftReducer(undone, { type: 'add-point', point: P(0.5, 0.5) });
  assert.deepEqual(edited.future, []);
  assert.equal(draftReducer(edited, { type: 'redo' }), edited);
});

test('history is capped, so a long session cannot grow without bound', () => {
  let draft = emptyDraft();
  for (let index = 0; index < HISTORY_LIMIT + 5; index += 1) {
    draft = draftReducer(draft, { type: 'add-point', point: P(index / 100, 0.5) });
  }
  assert.equal(draft.past.length, HISTORY_LIMIT);
  assert.equal(draft.points.length, HISTORY_LIMIT + 5);
});

test('loading a zone hydrates points, parameters and a clean history', () => {
  const draft = draftReducer(emptyDraft(), {
    type: 'load',
    zone: {
      zone_id: 'engine-left',
      name: 'Motor stâng',
      rule_type: 'PPE_REQUIRED',
      active_when: 'engine_on',
      severity: 'WARNING',
      debounce_s: 0.5,
      notify_channel: 'slack',
      escalate_after_s: 120,
      polygon: [
        { x: 0.02, y: 0.48 },
        { x: 0.4, y: 0.48 },
        { x: 0.62, y: 0.6 },
        { x: 0.7, y: 0.86 },
      ],
    },
  });
  assert.equal(draft.zoneId, 'engine-left');
  assert.equal(draft.closed, true);
  assert.equal(draft.points.length, 4);
  assert.equal(draft.fields.name, 'Motor stâng');
  assert.equal(draft.fields.rule_type, 'PPE_REQUIRED');
  assert.equal(draft.fields.active_when, 'engine_on');
  assert.equal(draft.fields.severity, 'WARNING');
  assert.equal(draft.fields.debounce_s, 0.5);
  assert.equal(draft.fields.escalate_after_s, 120);
  assert.deepEqual(draft.past, []);
  assert.equal(draft.isNew, false);
});

test('a zone with fewer than three points loads open, an empty one loads blank', () => {
  const two = draftFromZone({ zone_id: 'a', polygon: [P(0.1, 0.1), P(0.2, 0.2)] });
  assert.equal(two.closed, false);
  assert.equal(two.fields.name, 'a');
  const none = draftFromZone(undefined);
  assert.equal(none.zoneId, '');
  assert.equal(none.closed, false);
  assert.deepEqual(none.points, []);
});

test('a new zone gets a clean id, a matching name and no history', () => {
  const draft = run(
    draftWith(SQUARE),
    { type: 'set-field', field: 'name', value: 'vechi' },
    { type: 'create', zoneId: 'Stand-12 Zona' }
  );
  assert.equal(draft.zoneId, 'stand-12-zona');
  assert.equal(draft.isNew, true);
  assert.equal(draft.fields.name, 'stand-12-zona');
  assert.deepEqual(draft.points, []);
  assert.equal(draft.closed, false);
  assert.deepEqual(draft.past, []);
});

test('saving clears the new flag and editing an existing zone keeps it false', () => {
  const created = draftReducer(emptyDraft(), { type: 'create', zoneId: 'noua' });
  assert.equal(draftReducer(created, { type: 'saved' }).isNew, false);
  const existing = draftReducer(emptyDraft(), { type: 'load', zone: { zone_id: 'veche' } });
  assert.equal(draftReducer(existing, { type: 'saved' }), existing);
});

test('switching camera resets the draft, deleting the last zone clears the form', () => {
  const dirty = run(draftWith(SQUARE), { type: 'set-field', field: 'name', value: 'X' });
  const switched = draftReducer(dirty, { type: 'camera-changed' });
  assert.deepEqual(switched, emptyDraft());

  assert.deepEqual(draftAfterDelete([]), emptyDraft());
  const next = draftAfterDelete([{ zone_id: 'ramasa', polygon: SQUARE }]);
  assert.equal(next.zoneId, 'ramasa');
  assert.equal(next.closed, true);

  assert.deepEqual(draftReducer(dirty, { type: 'delete-result', remainingZones: [] }), emptyDraft());
  const afterDelete = draftReducer(dirty, { type: 'delete-result', remainingZones: [{ zone_id: 'ramasa' }] });
  assert.equal(afterDelete.zoneId, 'ramasa');
});

test('selecting another zone leaves the new-zone mode and loads through the camera effect', () => {
  const created = draftReducer(emptyDraft(), { type: 'create', zoneId: 'noua' });
  const selected = draftReducer(created, { type: 'select-zone', zoneId: 'Stand 12' });
  assert.equal(selected.zoneId, 'stand-12');
  assert.equal(selected.isNew, false);
  assert.equal(selected.selectedIndex, null);
});

test('the camera opens on engine-left when it exists, otherwise the first zone', () => {
  assert.equal(preferredZone([]), null);
  assert.equal(preferredZone([{ zone_id: 'a' }]).zone_id, 'a');
  assert.equal(
    preferredZone([{ zone_id: 'a' }, { zone_id: 'engine-left' }]).zone_id,
    'engine-left'
  );
});

test('ids are slugified and collisions get a numeric suffix', () => {
  assert.equal(slugify('Zonă Motoare Stânga!'), 'zona-motoare-stanga');
  assert.equal(slugify(''), '');
  assert.equal(uniqueZoneId('stand12-zona', []), 'stand12-zona');
  assert.equal(
    uniqueZoneId('stand12-zona', [{ zone_id: 'stand12-zona' }, { zone_id: 'stand12-zona-2' }]),
    'stand12-zona-3'
  );
  assert.equal(uniqueZoneId('---', []), 'zona-noua');
});

test('a bow-tie is rejected before save and reports the crossing edges', () => {
  const draft = draftWith(BOW_TIE);
  const check = validateDraft(draft);
  assert.equal(check.ok, false);
  assert.equal(check.canSave, false);
  assert.equal(check.hasCrossing, true);
  assert.deepEqual([...check.crossing].sort(), [...crossingEdges(BOW_TIE, true)].sort());
  assert.equal(check.errors.some((error) => error.code === 'crossing'), true);
});

test('an empty or one-point draft cannot be saved and says why', () => {
  const blank = validateDraft(emptyDraft());
  assert.equal(blank.ok, false);
  assert.deepEqual(blank.errors.map((error) => error.code), ['missing-id', 'too-few-points']);

  const one = validateDraft({ ...draftWith([P(0.5, 0.5)], { closed: false }) });
  assert.equal(one.ok, false);
  assert.equal(one.errors[0].code, 'too-few-points');

  const two = validateDraft(draftWith([P(0, 0), P(1, 1)], { closed: false }));
  assert.equal(two.errors[0].code, 'too-few-points');

  const openTriangle = validateDraft(draftWith([P(0, 0), P(1, 0), P(0.5, 1)], { closed: false }));
  assert.deepEqual(openTriangle.errors.map((error) => error.code), ['open']);

  assert.equal(validateDraft(draftWith(SQUARE)).ok, true);
});

test('an invalid zone id is rejected even with a good polygon', () => {
  const check = validateDraft({ ...draftWith(SQUARE), zoneId: 'Zona Mare' });
  assert.deepEqual(check.errors.map((error) => error.code), ['invalid-id']);
});

test('the save payload carries the contract fields and normalised points', () => {
  const state = {
    ...draftWith(SQUARE),
    zoneId: 'stand12-zona',
    fields: {
      ...DEFAULT_FIELDS,
      name: '  Stand 12  ',
      rule_type: 'PPE_REQUIRED',
      active_when: 'engine_on',
      severity: 'WARNING',
      debounce_s: '2.5',
      escalate_after_s: '30',
    },
  };
  const payload = buildZonePayload(state, {
    cameraId: 'stand12',
    zone: { required_ppe: ['hi_vis_vest'], reference_frame: 'frames/z.jpg' },
  });
  assert.deepEqual(payload, {
    zone_id: 'stand12-zona',
    camera_id: 'stand12',
    name: 'Stand 12',
    rule_type: 'PPE_REQUIRED',
    active_when: 'engine_on',
    required_ppe: ['hi_vis_vest'],
    severity: 'WARNING',
    debounce_s: 2.5,
    notify_channel: 'slack',
    escalate_after_s: 30,
    polygon: SQUARE,
    reference_frame: 'frames/z.jpg',
  });
  assert.notEqual(payload.polygon, state.points);
});

test('payload defaults: name falls back to the id, no escalation, no reference', () => {
  const payload = buildZonePayload(draftWith(SQUARE), { cameraId: 'cam' });
  assert.equal(payload.name, 'zona-test');
  assert.equal(payload.escalate_after_s, null);
  assert.equal(payload.debounce_s, 1);
  assert.deepEqual(payload.required_ppe, []);
  assert.equal(payload.reference_frame, null);

  const noDebounce = buildZonePayload(
    { ...draftWith(SQUARE), fields: { ...DEFAULT_FIELDS, debounce_s: '' } },
    { cameraId: 'cam' }
  );
  assert.equal(noDebounce.debounce_s, 0);
});

test('the JSON textarea accepts a valid list and reports every bad shape', () => {
  assert.deepEqual(parsePointList(formatPoints(SQUARE)), { points: SQUARE, error: null });
  const clamped = parsePointList(formatPoints([P(2, -1), P(0.5, 0.5), P(0.2, 0.2)]));
  assert.deepEqual(clamped.points, [P(1, 0), P(0.5, 0.5), P(0.2, 0.2)]);

  assert.match(parsePointList('nu e json').error, /parsa/);
  assert.match(parsePointList('{"x":1}').error, /minimum 3/);
  assert.match(parsePointList('[{"x":0,"y":0},{"x":1,"y":1}]').error, /minimum 3/);
  assert.match(
    parsePointList('[{"x":0,"y":0},{"x":"1","y":1},{"x":1,"y":1}]').error,
    /minimum 3/
  );
});

test('applying points replaces the geometry as one undoable step', () => {
  const start = draftWith(SQUARE);
  const applied = draftReducer(start, { type: 'apply-points', points: BOW_TIE });
  assert.equal(applied.closed, true);
  assert.deepEqual(applied.points, BOW_TIE);
  assert.equal(applied.past.length, 1);
  assert.deepEqual(draftReducer(applied, { type: 'undo' }).points, SQUARE);
});

test('the shape presets are closed polygons and are undoable', () => {
  assert.equal(SHAPE_PRESETS.rectangle.length, 4);
  assert.equal(SHAPE_PRESETS.triangle.length, 3);
  const fromEmpty = draftReducer(emptyDraft(), { type: 'apply-shape', shape: 'rectangle' });
  assert.equal(fromEmpty.closed, true);
  assert.deepEqual(fromEmpty.points, SHAPE_PRESETS.rectangle.map(roundPoint));
  assert.equal(validateDraft(draftReducer(fromEmpty, { type: 'set-id', zoneId: 'x' })).ok, true);
  assert.deepEqual(draftReducer(fromEmpty, { type: 'undo' }).points, []);
  assert.equal(draftReducer(fromEmpty, { type: 'apply-shape', shape: 'hexagon' }), fromEmpty);
});

test('reordering untangles a bow-tie and is undoable', () => {
  const tangled = draftWith(BOW_TIE);
  const ordered = draftReducer(tangled, { type: 'reorder' });
  assert.equal(ordered.closed, true);
  assert.equal(ordered.points.length, 4);
  assert.equal(crossingEdges(ordered.points, true).size, 0);
  assert.equal(ordered.selectedIndex, null);
  assert.deepEqual(draftReducer(ordered, { type: 'undo' }).points, BOW_TIE);
});

test('redraw empties the frame, opens the outline and can be undone', () => {
  const start = draftWith(SQUARE);
  const empty = draftReducer(start, { type: 'redraw' });
  assert.deepEqual(empty.points, []);
  assert.equal(empty.closed, false);
  assert.equal(empty.selectedIndex, null);
  const back = draftReducer(empty, { type: 'undo' });
  assert.deepEqual(back.points, SQUARE);
  assert.equal(back.closed, true);
});

test('parameter edits do not touch history or the geometry', () => {
  const start = draftWith(SQUARE);
  const named = draftReducer(start, { type: 'set-field', field: 'name', value: 'Nou' });
  assert.equal(named.fields.name, 'Nou');
  assert.equal(named.past.length, 0);
  assert.equal(named.points, start.points);
  assert.equal(draftReducer(named, { type: 'set-field', field: 'unknown', value: 1 }), named);
});

test('selecting is idempotent and cleared by edits that invalidate the index', () => {
  const start = draftWith(SQUARE);
  const selected = draftReducer(start, { type: 'select', index: 2 });
  assert.equal(draftReducer(selected, { type: 'select', index: 2 }), selected);
  assert.equal(draftReducer(selected, { type: 'select', index: null }).selectedIndex, null);
  const nudged = draftReducer(selected, { type: 'nudge-point', index: 2, dx: 0.01 });
  assert.equal(nudged.selectedIndex, 2);
  assert.equal(draftReducer(nudged, { type: 'undo' }).selectedIndex, null);
  const cut = draftReducer(selected, { type: 'delete-point', index: 1 });
  assert.equal(cut.selectedIndex, null);
});

test('the reducer never mutates the state it was given', () => {
  const start = draftWith(SQUARE);
  const before = JSON.parse(JSON.stringify(start));
  run(
    start,
    { type: 'begin-gesture' },
    { type: 'move-point', index: 0, point: P(0.4, 0.4) },
    { type: 'end-gesture' },
    { type: 'delete-point', index: 1 },
    { type: 'set-field', field: 'name', value: 'X' },
    { type: 'undo' }
  );
  assert.deepEqual(start, before);
});

test('points are clamped and rounded to four decimals, bad input becomes zero', () => {
  assert.deepEqual(roundPoint({ x: -0.2, y: 1.5 }), P(0, 1));
  assert.deepEqual(roundPoint({ x: 0.123456, y: 0.987654 }), P(0.1235, 0.9877));
  assert.deepEqual(roundPoint({ x: Number.NaN, y: '0.5' }), P(0, 0.5));
  assert.deepEqual(roundPoint(undefined), P(0, 0));
});

test('the camera picker labels carry name, id, offline state and zone count', () => {
  const options = cameraOptions(
    [
      { id: 'stand12', name: 'CAM-01', status: 'online' },
      { id: 'taxiway-b', code: 'CAM-02', status: 'offline' },
      { id: 'no-name' },
    ],
    [{ camera_id: 'stand12' }, { camera_id: 'stand12' }, { camera_id: 'taxiway-b' }]
  );
  assert.equal(options[0].label, 'CAM-01 (stand12) · 2 zone');
  assert.equal(options[1].label, 'CAM-02 (taxiway-b) · offline · 1 zone');
  assert.equal(options[2].label, 'no-name (no-name) · 0 zone');
  assert.deepEqual(cameraOptions(), []);
});

test('keyboard shortcuts resolve to draft actions and ignore everything else', () => {
  assert.deepEqual(shortcutFor({ key: 'z', ctrlKey: true }, 2), {
    type: 'undo',
    preventDefault: true,
  });
  assert.deepEqual(shortcutFor({ key: 'Z', metaKey: true, shiftKey: true }, 2), {
    type: 'redo',
    preventDefault: true,
  });
  assert.deepEqual(shortcutFor({ key: 'Escape' }, null), {
    type: 'select',
    index: null,
    preventDefault: false,
  });
  assert.deepEqual(shortcutFor({ key: 'Delete' }, 1), {
    type: 'delete-selection',
    preventDefault: true,
  });
  assert.deepEqual(shortcutFor({ key: 'Backspace' }, 0), {
    type: 'delete-selection',
    preventDefault: true,
  });
  assert.deepEqual(shortcutFor({ key: 'ArrowLeft' }, 0), {
    type: 'nudge-point',
    index: 0,
    dx: -NUDGE_STEP.normal,
    dy: 0,
    preventDefault: true,
  });
  assert.deepEqual(shortcutFor({ key: 'ArrowDown', shiftKey: true }, 3), {
    type: 'nudge-point',
    index: 3,
    dx: 0,
    dy: NUDGE_STEP.fine,
    preventDefault: true,
  });
  assert.equal(shortcutFor({ key: 'ArrowLeft' }, null), null);
  assert.equal(shortcutFor({ key: 'a' }, 1), null);
  assert.equal(shortcutFor({}, 1), null);
});

test('a shortcut action fed straight into the reducer does what the key promises', () => {
  const start = { ...draftWith(SQUARE), selectedIndex: 0 };
  const nudged = draftReducer(start, shortcutFor({ key: 'ArrowRight' }, 0));
  assert.deepEqual(nudged.points[0], P(0.102, 0.1));
  const deleted = draftReducer(nudged, shortcutFor({ key: 'Delete' }, 0));
  assert.equal(deleted.points.length, 3);
  assert.deepEqual(draftReducer(deleted, shortcutFor({ key: 'z', ctrlKey: true }, 0)).points, nudged.points);
});
