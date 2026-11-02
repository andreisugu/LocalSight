// Which operator action is allowed from which status. Mirrors the ACTIONS table of the
// SafeSight backend (removed from this fork; in git history). In the static build anything
// else is refused locally, with no API to return a 409.
const ALLOWED_FROM = {
  ack: ['open', 'escalated'],
  false_positive: ['open', 'escalated', 'acknowledged'],
  reopen: ['acknowledged', 'false_positive', 'escalated', 'resolved'],
};

export function canDo(action, status) {
  return Boolean(ALLOWED_FROM[action]?.includes(status));
}
