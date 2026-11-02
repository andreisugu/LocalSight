// Session-only coverage samples: the raw evidence behind the Reports coverage receipt.
//
// One sample says "at `at`, camera `cameraId` was in status". The engine records one per
// second while it runs, plus one on every visibility change; `utils/coverage.js` turns the
// list into per-camera coverage. The list lives in React state and is never written to
// localStorage or sent anywhere: closing the tab ends the receipt, and Reports must say so.
//
// The cap is a memory bound, not a policy: 5 000 samples is ~83 minutes of one camera at the
// 1 s cadence. Past that the oldest sample is dropped, so a long session loses its start
// before it loses its end.

import { useCallback, useState } from 'react';
import { COVERAGE_STATE } from '../utils/coverage.js';

/** Newest samples kept in memory; older ones are dropped first. */
export const MAX_COVERAGE_SAMPLES = 5000;

const STATUS_SET = new Set(Object.values(COVERAGE_STATE));

/**
 * Validate and normalize one sample. Both the contract casing (`camera_id`) and the local
 * casing (`cameraId`) are accepted, so a caller never has to translate mid-stream; the
 * stored shape is the local one `utils/coverage.js` documents.
 *
 * @param {unknown} sample
 * @returns {{cameraId: string, at: number, status: string}|null}
 */
export function normalizeCoverageSample(sample) {
  if (!sample || typeof sample !== 'object' || Array.isArray(sample)) return null;
  const value = /** @type {{cameraId?: unknown, camera_id?: unknown, at?: unknown, status?: unknown}} */ (sample);
  const rawCamera = value.cameraId ?? value.camera_id;
  const cameraId = typeof rawCamera === 'string' ? rawCamera.trim() : '';
  if (!cameraId) return null;
  if (typeof value.at !== 'number' || !Number.isFinite(value.at)) return null;
  const status = typeof value.status === 'string' ? value.status.trim().toLowerCase() : '';
  if (!STATUS_SET.has(status)) return null;
  return { cameraId, at: value.at, status };
}

/**
 * Append one sample, capped. Pure, so the tests pin the bound without React.
 *
 * @param {Array<{cameraId: string, at: number, status: string}>} samples
 * @param {unknown} sample
 * @returns {Array<{cameraId: string, at: number, status: string}>} the same list when the
 *   sample is unusable, otherwise a new list of at most `MAX_COVERAGE_SAMPLES` entries.
 */
export function appendCoverageSample(samples, sample) {
  const list = Array.isArray(samples) ? samples : [];
  const normalized = normalizeCoverageSample(sample);
  if (!normalized) return list;
  if (list.length < MAX_COVERAGE_SAMPLES) return [...list, normalized];
  return [...list.slice(list.length - MAX_COVERAGE_SAMPLES + 1), normalized];
}

/**
 * The coverage sample store. Session-only by design: no storage read, no storage write.
 *
 * @returns {{
 *   coverageSamples: Array<{cameraId: string, at: number, status: string}>,
 *   recordCoverageSample: (sample: unknown) => boolean,
 *   clearCoverageSamples: () => void,
 * }}
 */
export default function useCoverageSamples() {
  const [coverageSamples, setCoverageSamples] = useState([]);

  const recordCoverageSample = useCallback((sample) => {
    const normalized = normalizeCoverageSample(sample);
    if (!normalized) return false;
    setCoverageSamples((previous) => appendCoverageSample(previous, normalized));
    return true;
  }, []);

  const clearCoverageSamples = useCallback(() => setCoverageSamples([]), []);

  return { coverageSamples, recordCoverageSample, clearCoverageSamples };
}
