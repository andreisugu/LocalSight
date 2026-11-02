// Transport for the real backend: one fetch wrapper, one query serialiser, one asset
// resolver. Nothing here knows about cameras or incidents; the mappers keep that.

import { API_BASE_URL } from './config.js';

function apiUrl(path) {
  return `${API_BASE_URL}${path}`;
}

/** `?a=1&b=2`, skipping empty values so an unset filter is simply absent. */
export function queryString(params = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  }
  const serialized = query.toString();
  return serialized ? `?${serialized}` : '';
}

const ABSOLUTE_URL = /^[a-z][a-z0-9+.-]*:/i;

/** Absolute URL for a snapshot or stream path the backend returned. */
export function resolveAsset(url, base = API_BASE_URL) {
  if (!url) return '';
  // `http:`, `https:`, `data:` and `blob:` already carry their own scheme; prefixing them
  // with the API origin would turn a working snapshot into a 404.
  if (ABSOLUTE_URL.test(url)) return url;
  return `${base}${url.startsWith('/') ? '' : '/'}${url}`;
}

/**
 * JSON request against the backend.
 *
 * The error message is `${status} ${detail}` because the context reads the 409 prefix to
 * tell "someone else changed this incident" apart from a network failure. A 204 (DELETE
 * `/zones/{id}`) has no body to parse.
 */
export async function request(path, options = {}) {
  const isForm = options.body instanceof FormData;
  const headers = {
    ...(options.body && !isForm ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers || {}),
  };

  const response = await fetch(apiUrl(path), { ...options, headers });
  if (!response.ok) {
    let detail = '';
    try {
      const payload = await response.json();
      detail = payload.detail || JSON.stringify(payload);
    } catch {
      detail = await response.text();
    }
    throw new Error(`${response.status} ${detail || response.statusText}`);
  }
  if (response.status === 204) return null;
  return response.json();
}
