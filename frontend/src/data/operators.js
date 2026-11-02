// Operator roles offered in the header.
//
// Roles, not people: the picker never lists a name, because the audit log should show the
// person who confirmed, and nobody wants a colleague's name hard-coded in a demo build.
// The operator types their own name; this browser remembers it.

export const AVAILABLE_OPERATORS = [
  { id: 'dispatcher', name: 'Dispecer', role: 'Dispecer siguranță airside', badge: 'DISPECER' },
  { id: 'shift-lead', name: 'Șef tură', role: 'Șef tură rampă & apron', badge: 'SEF TURA' },
  { id: 'inspector', name: 'Inspector', role: 'Inspector siguranță sol', badge: 'INSPECTOR' },
];

/** Name used when an action arrives without one (the API's own default). */
const DEFAULT_OPERATOR_NAME = 'Operator';

/**
 * The pre-rebrand dataset stored people, so a browser may still hold one of those ids or
 * names. They map onto today's roles instead of silently losing the selection.
 */
const LEGACY_ROLE_IDS = Object.freeze({
  ariana: 'dispatcher',
  mihai: 'shift-lead',
  radu: 'inspector',
});

const LEGACY_ROLE_NAMES = Object.freeze({
  'ariana v.': 'dispatcher',
  'mihai d.': 'shift-lead',
  'radu p.': 'inspector',
});

const normalize = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * Resolve a stored operator id, role name or legacy person onto a current role.
 *
 * @returns {object|null} The matching fixture, or `null` when nothing matches.
 */
export function migrateOperator(value, operators = AVAILABLE_OPERATORS) {
  const raw = normalize(value);
  if (!raw || !Array.isArray(operators)) return null;

  const key = raw.toLowerCase();
  const roleId = LEGACY_ROLE_IDS[key] || LEGACY_ROLE_NAMES[key] || key;
  return (
    operators.find((operator) => operator.id === roleId) ||
    operators.find((operator) => operator.name.toLowerCase() === key) ||
    null
  );
}

/**
 * The name to store on an action: a known role or a name the operator typed.
 * Empty input falls back to the API's generic default, never to a person.
 */
export function resolveOperatorName(value, operators = AVAILABLE_OPERATORS) {
  const migrated = migrateOperator(value, operators);
  return migrated ? migrated.name : normalize(value) || DEFAULT_OPERATOR_NAME;
}
