// Which operator action is allowed from which incident status. This is the frozen parity
// table of the SafeSight backend (removed from this fork; in git history): offering a button
// the API would answer with a 409 is worse than not offering it, so the two tables changed
// together. In the static build anything else is refused locally.
const ALLOWED_FROM = new Map([
  ['ack', new Set(['open', 'escalated'])],
  ['false_positive', new Set(['open', 'escalated', 'acknowledged'])],
  ['reopen', new Set(['acknowledged', 'false_positive', 'escalated', 'resolved'])],
]);
/**
 * @param {string|undefined|null} action
 * @param {string|undefined|null} status
 * @returns {boolean} true only when the backend would accept the action right now.
 */
export const canDo = (action, status) => ALLOWED_FROM.get(action)?.has(status) ?? false;
