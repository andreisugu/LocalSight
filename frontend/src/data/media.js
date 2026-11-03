// Demo media served from the app itself.
//
// Snapshots used to point at Unsplash and Wikimedia. A product that promises the feed
// never leaves the tab cannot load three third-party domains on every render, and the
// thumbnails have to work offline; the licences are listed in THIRD_PARTY.md. Paths are
// built on the deploy base so they survive the GitHub Pages subpath.

import { APP_BASE_URL } from '../services/config.js';

const STILLS = `${APP_BASE_URL}media/stills/`;

/** Snapshot shown for an incident of each demo camera. */
export const DEMO_STILLS = {
  stand12: `${STILLS}apron-stand.jpg`,
  'taxiway-b': `${STILLS}zone-taxiway-b.jpg`,
  'baggage-area': `${STILLS}baggage-hall.jpg`,
};

/**
 * First frame of each demo clip, at the scale of the stream. The zone editor uses it as
 * a background while a zone has no uploaded `reference_frame`, so the polygon is drawn
 * over the real frame instead of a black rectangle.
 */
export const DEMO_REFERENCE_FRAMES = {
  stand12: `${STILLS}zone-stand12.jpg`,
  'taxiway-b': `${STILLS}zone-taxiway-b.jpg`,
  'baggage-area': `${STILLS}zone-baggage-area.jpg`,
};
