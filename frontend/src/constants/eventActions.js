// Which operator action is allowed from which incident status. This is the frozen parity
// table of the SafeSight backend (removed from this fork; in git history): offering a
// button the API would answer with a 409 is worse than not offering it, so the two tables
// changed together. In the static build anything else is refused locally.
const ALLOWED_FROM = Object.freeze({
  ack: Object.freeze(['open', 'escalated']),
  false_positive: Object.freeze(['open', 'escalated', 'acknowledged']),
  reopen: Object.freeze(['acknowledged', 'false_positive', 'escalated', 'resolved']),
});

/**
 * @param {string|undefined|null} action
 * @param {string|undefined|null} status
 * @returns {boolean} true only when the backend would accept the action right now.
 */
export function canDo(action, status) {
  if (!Object.hasOwn(ALLOWED_FROM, action)) return false;
  return ALLOWED_FROM[action].includes(status);
}
