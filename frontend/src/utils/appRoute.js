// Address <-> screen mapping for the static build.
//
// Every screen has a URL so a refresh, Back/Forward and a link shared from Slack keep the
// place. The app can be served from a subpath (GitHub Pages: `/LocalSight/`), so the
// caller passes `BASE` in: `import.meta.env.BASE_URL` ends with a slash, the providers
// strip it, and these helpers never read the environment themselves (that keeps them
// importable by Node's test runner).

/** Screen id -> path below BASE. Order defines the reverse lookup. */
export const VIEW_PATHS = Object.freeze({
  live: '/',
  incidents: '/incidents',
  zones: '/zones',
  reports: '/reports',
  settings: '/settings',
  // Spike page, reachable by URL only: no sidebar entry.
  lab: '/lab',
  // Measurement page, reachable by URL only: no sidebar entry.
  bench: '/bench',
});

/** The detail screen is not a plain entry: it carries the incident id. */
export const INCIDENT_VIEW = 'incident_detail';

/**
 * Remove the deploy subpath. A path that only shares a prefix (`/LocalSightX`) is left
 * alone, exactly like the original check.
 *
 * @param {string} pathname
 * @param {string} [base] deploy prefix without a trailing slash ('' in dev)
 * @returns {string}
 */
export function stripBase(pathname, base = '') {
  const raw = String(pathname || '/');
  if (!base) return raw;
  if (raw === base || raw.startsWith(`${base}/`)) return raw.slice(base.length);
  return raw;
}

/**
 * @param {string} pathname
 * @param {string} [base]
 * @returns {{view: string, eventId: string|null}}
 */
export function routeFromPath(pathname, base = '') {
  const path = stripBase(pathname, base).replace(/\/+$/, '') || '/';
  const incident = path.match(/^\/incidents\/([^/]+)$/);
  if (incident) return { view: INCIDENT_VIEW, eventId: decodeURIComponent(incident[1]) };
  const view = Object.keys(VIEW_PATHS).find((key) => VIEW_PATHS[key] === path);
  return { view: view || 'live', eventId: null };
}

/**
 * @param {string} view
 * @param {string|null} [eventId]
 * @param {string} [base]
 * @returns {string} an absolute path that already contains BASE
 */
export function pathFor(view, eventId, base = '') {
  const path = view === INCIDENT_VIEW
    ? (eventId ? `/incidents/${encodeURIComponent(eventId)}` : VIEW_PATHS.incidents)
    : (VIEW_PATHS[view] || '/');
  return `${base}${path}`;
}

/**
 * The route the first render starts from. A malformed address must not take the app down:
 * it falls back to Live, which is the screen the sidebar highlights anyway.
 *
 * @param {string} pathname
 * @param {string} [base]
 * @returns {{view: string, eventId: string|null}}
 */
export function readInitialRoute(pathname, base = '') {
  try {
    return routeFromPath(pathname, base);
  } catch {
    return { view: 'live', eventId: null };
  }
}
