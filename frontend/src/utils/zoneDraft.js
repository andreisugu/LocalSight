// Zone editor draft state machine.
//
// The editor is a small document store: a polygon being drawn plus the parameters
// that become the saved zone. Everything that changes that document goes through
// `draftReducer`, so undo/redo, validation and the save payload have exactly one
// definition and can be tested in Node without a DOM.
//
// Points are normalised { x, y } in 0..1; a point outside the frame is clamped,
// never rejected, because a drag can end a pixel past the border.

import { crossingEdges, orderAroundCentroid } from './polygon.js';

/** Undo steps kept per draft. Older entries fall off the back. */
export const HISTORY_LIMIT = 60;

/** A saved zone id is the key other modules reference: lowercase, digits, dashes. */
const ZONE_ID_PATTERN = /^[a-z0-9-]+$/;

/** Defaults for a zone that does not exist yet. Never mutated; copied per draft. */
export const DEFAULT_FIELDS = Object.freeze({
  name: '',
  rule_type: 'RESTRICTED',
  active_when: 'always',
  severity: 'CRITICAL',
  debounce_s: 1,
  notify_channel: 'slack',
  escalate_after_s: null,
});

/** Template polygons for the toolbar. Copy before use: the presets are frozen. */
export const SHAPE_PRESETS = Object.freeze({
  rectangle: Object.freeze([
    Object.freeze({ x: 0.2, y: 0.2 }),
    Object.freeze({ x: 0.8, y: 0.2 }),
    Object.freeze({ x: 0.8, y: 0.8 }),
    Object.freeze({ x: 0.2, y: 0.8 }),
  ]),
  triangle: Object.freeze([
    Object.freeze({ x: 0.5, y: 0.18 }),
    Object.freeze({ x: 0.82, y: 0.8 }),
    Object.freeze({ x: 0.18, y: 0.8 }),
  ]),
});

/** Normalise a free-text label into a zone id. */
export function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/** The first free id shaped like `<base>-zona`, `<base>-zona-2`, ... */
export function uniqueZoneId(base, zones = []) {
  const root = slugify(base) || 'zona-noua';
  const taken = new Set((zones || []).map((zone) => zone.zone_id));
  if (!taken.has(root)) return root;
  let suffix = 2;
  while (taken.has(`${root}-${suffix}`)) suffix += 1;
  return `${root}-${suffix}`;
}

/** Clamp to the frame and drop floating-point noise (4 decimals ≈ 0.1 px). */
export function roundPoint(point) {
  const clamp = (value) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Number(Math.max(0, Math.min(1, number)).toFixed(4));
  };
  return { x: clamp(point?.x), y: clamp(point?.y) };
}

export function normalisePoints(points = []) {
  return (points || []).map(roundPoint);
}

/** Blank draft: no id, no polygon, no history. A fresh object every call. */
export function emptyDraft() {
  return {
    zoneId: '',
    isNew: false,
    points: [],
    closed: false,
    selectedIndex: null,
    fields: { ...DEFAULT_FIELDS },
    past: [],
    future: [],
    gesture: null,
  };
}

/** Draft for a zone that already exists in the store. */
export function draftFromZone(zone) {
  const points = normalisePoints(zone?.polygon || []);
  return {
    zoneId: zone?.zone_id || '',
    isNew: false,
    points,
    closed: points.length >= 3,
    selectedIndex: null,
    fields: {
      ...DEFAULT_FIELDS,
      name: zone?.name || zone?.zone_id || '',
      rule_type: zone?.rule_type || DEFAULT_FIELDS.rule_type,
      active_when: zone?.active_when || DEFAULT_FIELDS.active_when,
      severity: zone?.severity || DEFAULT_FIELDS.severity,
      debounce_s: zone?.debounce_s ?? DEFAULT_FIELDS.debounce_s,
      notify_channel: zone?.notify_channel || DEFAULT_FIELDS.notify_channel,
      escalate_after_s: zone?.escalate_after_s ?? null,
    },
    past: [],
    future: [],
    gesture: null,
  };
}

/** Draft for a zone the user is about to create. */
function draftForNewZone(zoneId) {
  const id = slugify(zoneId);
  return {
    ...emptyDraft(),
    zoneId: id,
    isNew: true,
    fields: { ...DEFAULT_FIELDS, name: id },
  };
}

/** The zone the editor opens when the camera changes: the seed zone if it has one. */
export function preferredZone(cameraZones = []) {
  return cameraZones.find((zone) => zone.zone_id === 'engine-left') || cameraZones[0] || null;
}

/** Select options for the camera picker, including the zone count of each camera. */
export function cameraOptions(cameras = [], zones = []) {
  return (cameras || []).map((camera) => {
    const count = (zones || []).filter((zone) => zone.camera_id === camera.id).length;
    const offline = camera.status === 'offline' ? ' · offline' : '';
    return {
      id: camera.id,
      label: `${camera.name || camera.code || camera.id} (${camera.id})${offline} · ${count} zone`,
    };
  });
}

/** Arrow-key nudge: 0.2% of the frame, 1% with Shift. */
export const NUDGE_STEP = Object.freeze({ normal: 0.002, fine: 0.01 });

/**
 * Map a keyboard event (or any object with the same fields) to a draft action.
 * Returns null when the key means nothing here, so the caller can leave it alone.
 * The input-tag guard stays in the view: it needs the real DOM target.
 */
export function shortcutFor(event = {}, selectedIndex = null) {
  const key = event.key || '';
  if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === 'z') {
    return { type: event.shiftKey ? 'redo' : 'undo', preventDefault: true };
  }
  if (key === 'Escape') {
    return { type: 'select', index: null, preventDefault: false };
  }
  if (selectedIndex === null || selectedIndex === undefined) return null;
  if (key === 'Delete' || key === 'Backspace') {
    return { type: 'delete-selection', preventDefault: true };
  }
  const step = event.shiftKey ? NUDGE_STEP.fine : NUDGE_STEP.normal;
  const deltas = {
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, -step],
    ArrowDown: [0, step],
  };
  const delta = deltas[key];
  if (!delta) return null;
  return { type: 'nudge-point', index: selectedIndex, dx: delta[0], dy: delta[1], preventDefault: true };
}


/**
 * Where the draft goes after a delete: the next zone of the camera, or a blank form.
 * Keeping the deleted zone's id and name in the panel is the bug this prevents.
 */
export function draftAfterDelete(remainingZones = []) {
  return remainingZones.length > 0 ? draftFromZone(remainingZones[0]) : emptyDraft();
}

function sameGeometry(a, points, closed) {
  if (!a || a.closed !== closed || a.points.length !== points.length) return false;
  return a.points.every((point, index) => point.x === points[index].x && point.y === points[index].y);
}

/** Record the current geometry, then apply the next one. Clears the redo stack. */
function commit(state, points, closed, selectedIndex = null) {
  return {
    ...state,
    points,
    closed,
    selectedIndex,
    past: [...state.past, { points: state.points, closed: state.closed }].slice(-HISTORY_LIMIT),
    future: [],
  };
}

/** A closed polygon keeps at least three points; while drawing, any point can go. */
export function canDeletePoint(state, index) {
  if (!Number.isInteger(index) || index < 0 || index >= state.points.length) return false;
  return !state.closed || state.points.length > 3;
}

function undo(state) {
  if (state.past.length === 0) return state;
  const previous = state.past[state.past.length - 1];
  return {
    ...state,
    past: state.past.slice(0, -1),
    future: [{ points: state.points, closed: state.closed }, ...state.future].slice(0, HISTORY_LIMIT),
    points: previous.points,
    closed: previous.closed,
    selectedIndex: null,
    gesture: null,
  };
}

function redo(state) {
  if (state.future.length === 0) return state;
  const next = state.future[0];
  return {
    ...state,
    past: [...state.past, { points: state.points, closed: state.closed }].slice(-HISTORY_LIMIT),
    future: state.future.slice(1),
    points: next.points,
    closed: next.closed,
    selectedIndex: null,
    gesture: null,
  };
}

/**
 * The transition function. Every action returns a new state or the same reference
 * when the action is a no-op (empty history, blocked delete, unknown action).
 */
export function draftReducer(state, action = {}) {
  switch (action.type) {
    case 'load':
      return draftFromZone(action.zone);

    case 'reset':
    case 'camera-changed':
      return emptyDraft();

    case 'create':
      return draftForNewZone(action.zoneId);

    case 'select-zone':
      return { ...state, zoneId: slugify(action.zoneId), isNew: false, selectedIndex: null };

    case 'delete-result':
      return draftAfterDelete(action.remainingZones || []);

    case 'saved':
      return state.isNew ? { ...state, isNew: false } : state;

    case 'set-id':
      return { ...state, zoneId: slugify(action.zoneId) };

    case 'set-field':
      if (!(action.field in DEFAULT_FIELDS)) return state;
      return { ...state, fields: { ...state.fields, [action.field]: action.value } };

    case 'select':
      return state.selectedIndex === action.index ? state : { ...state, selectedIndex: action.index };

    case 'add-point':
      if (state.closed) return state.selectedIndex === null ? state : { ...state, selectedIndex: null };
      return commit(state, [...state.points, roundPoint(action.point)], false);

    case 'insert-point': {
      const index = action.index + 1;
      if (!Number.isInteger(action.index) || action.index < 0 || action.index >= state.points.length) {
        return state;
      }
      const points = [...state.points.slice(0, index), roundPoint(action.point), ...state.points.slice(index)];
      return { ...state, points, selectedIndex: index };
    }

    case 'begin-gesture':
      return state.gesture
        ? state
        : { ...state, gesture: { points: state.points, closed: state.closed } };

    case 'end-gesture': {
      if (!state.gesture) return state;
      if (sameGeometry(state.gesture, state.points, state.closed)) return { ...state, gesture: null };
      return {
        ...state,
        gesture: null,
        past: [...state.past, state.gesture].slice(-HISTORY_LIMIT),
        future: [],
      };
    }

    case 'cancel-gesture':
      if (!state.gesture) return state;
      return {
        ...state,
        points: state.gesture.points,
        closed: state.gesture.closed,
        selectedIndex: null,
        gesture: null,
      };

    case 'move-point':
      if (!Number.isInteger(action.index) || action.index < 0 || action.index >= state.points.length) {
        return state;
      }
      return {
        ...state,
        points: state.points.map((point, index) => (index === action.index ? roundPoint(action.point) : point)),
        selectedIndex: action.index,
      };

    case 'nudge-point': {
      const point = state.points[action.index];
      if (!point) return state;
      const moved = roundPoint({ x: point.x + action.dx, y: point.y + action.dy });
      return commit(
        state,
        state.points.map((item, index) => (index === action.index ? moved : item)),
        state.closed,
        action.index
      );
    }

    case 'delete-point':
      if (!canDeletePoint(state, action.index)) return state;
      return commit(
        state,
        state.points.filter((_, index) => index !== action.index),
        state.closed
      );

    case 'delete-selection':
      return draftReducer(state, { type: 'delete-point', index: state.selectedIndex });

    case 'close':
      if (state.closed || state.points.length < 3) return state;
      return commit(state, state.points, true);

    case 'open':
      if (!state.closed) return state;
      return commit(state, state.points, false);

    case 'apply-shape': {
      const preset = SHAPE_PRESETS[action.shape];
      if (!preset) return state;
      return commit(state, normalisePoints(preset), true);
    }

    case 'apply-points':
      return commit(state, normalisePoints(action.points), action.closed ?? true);

    case 'reorder':
      if (state.points.length < 2) return state;
      return commit(state, orderAroundCentroid(state.points), state.closed);

    case 'redraw':
      return commit(state, [], false);

    case 'undo':
      return undo(state);

    case 'redo':
      return redo(state);

    default:
      return state;
  }
}

/**
 * Is this draft saveable? Returns every error, not just the first, plus the crossing
 * edges so the canvas can paint them without recomputing geometry.
 */
export function validateDraft(state) {
  const crossing = crossingEdges(state.points, state.closed);
  const errors = [];

  if (!state.zoneId) {
    errors.push({ code: 'missing-id', message: 'Completează un ID de zonă.' });
  } else if (!ZONE_ID_PATTERN.test(state.zoneId)) {
    errors.push({ code: 'invalid-id', message: 'ID-ul poate conține doar litere mici, cifre și cratime.' });
  }
  if (state.points.length < 3) {
    errors.push({ code: 'too-few-points', message: 'Poligonul are nevoie de minimum 3 puncte.' });
  } else if (!state.closed) {
    errors.push({ code: 'open', message: 'Închide zona: dă click pe primul punct.' });
  }
  if (crossing.size > 0) {
    errors.push({
      code: 'crossing',
      message: 'Laturile zonei se intersectează. Mută punctele sau folosește „Reordonează punctele”.',
    });
  }

  return {
    ok: errors.length === 0,
    canSave: errors.length === 0,
    errors,
    crossing,
    hasCrossing: crossing.size > 0,
  };
}

/**
 * The PUT payload for the saved zone. Normalised points only: never camera state,
 * never a transient preview URL. `required_ppe` and `reference_frame` belong to the
 * existing zone, so they are carried over rather than edited here.
 */
export function buildZonePayload(state, { cameraId, zone = null } = {}) {
  const escalate = state.fields.escalate_after_s;
  return {
    zone_id: state.zoneId,
    camera_id: cameraId,
    name: state.fields.name?.trim() || state.zoneId,
    rule_type: state.fields.rule_type,
    active_when: state.fields.active_when,
    required_ppe: zone?.required_ppe || [],
    severity: state.fields.severity,
    debounce_s: Number(state.fields.debounce_s) || 0,
    notify_channel: 'slack',
    escalate_after_s: escalate === null || escalate === '' ? null : Number(escalate),
    polygon: state.points.map(({ x, y }) => ({ x, y })),
    reference_frame: zone?.reference_frame || null,
  };
}

/** Parse the JSON textarea. Returns points or a message, never throws. */
export function parsePointList(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { points: null, error: 'JSON invalid: nu am putut parsa coordonatele.' };
  }
  const valid =
    Array.isArray(parsed) &&
    parsed.length >= 3 &&
    parsed.every((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y));
  if (!valid) {
    return { points: null, error: 'JSON invalid: ai nevoie de minimum 3 puncte {x, y}.' };
  }
  return { points: normalisePoints(parsed), error: null };
}

/** The textarea content for a point list. */
export function formatPoints(points) {
  return JSON.stringify(points, null, 2);
}
