// Which operator action is allowed from which incident status. The UI mirrors `ACTIONS`
// in backend/app/services/events.py: offering a button that the API would answer with a
// 409 is worse than not offering it, so the two tables change together.
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
