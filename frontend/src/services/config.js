// Build-time configuration, read once at module load.
//
// `import.meta.env` only exists under Vite. Plain Node (the unit tests) sees `undefined`,
// so an unguarded property read would throw while importing these modules. Each accessor
// below keeps the literal `import.meta.env.X` expression Vite replaces at build time and
// falls back to a safe default everywhere else.

function readEnv(read, fallback) {
  try {
    const value = read();
    return value === undefined || value === null || value === '' ? fallback : value;
  } catch {
    return fallback;
  }
}

const withoutTrailingSlashes = (value) => String(value).replace(/\/+$/, '');

/** Backend origin for the real API; snapshots and streams are served from the same host. */
export const API_BASE_URL = withoutTrailingSlashes(
  readEnv(() => import.meta.env.VITE_API_URL, 'http://localhost:8000')
);

/** Deploy base (`/` locally, `/LocalSight/` on Pages); fixtures build asset paths on it. */
export const APP_BASE_URL = (() => {
  const base = readEnv(() => import.meta.env.BASE_URL, '/');
  return base.endsWith('/') ? base : `${base}/`;
})();

/** Demo mode: the fixtures replace the backend, no request leaves the page. */
export const USE_MOCK =
  String(readEnv(() => import.meta.env.VITE_USE_MOCK, 'false')).toLowerCase() === 'true';

/** `dev.py demo --webcam` seeds one camera with the laptop stream; only its label differs. */
export const WEBCAM_CAMERA_ID = readEnv(() => import.meta.env.VITE_WEBCAM_CAMERA, '');
