#!/usr/bin/env node
/**
 * Guard for the GitHub Pages subpath deploy (https://<user>.github.io/LocalSight/).
 *
 * The app is built with VITE_BASE=/LocalSight/, so every internal URL that lands
 * in the shipped HTML has to carry that prefix. The history router means a stray
 * absolute `/assets/...` would only surface in production, never in a local dev
 * server or a default-base CI build — this script fails the build instead.
 *
 * Run after a `VITE_BASE=/LocalSight/ npm run build` (plus the pages.yml SPA
 * fallback copy) from the `frontend` directory. No dependencies: `node scripts/check-base.mjs`.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED_BASE = '/LocalSight/';
const REQUIRED_MODELS = ['efficientdet_lite0.onnx', 'efficientdet_lite2.onnx', 'yunet.onnx'];

const frontendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(frontendDir, 'dist');
const indexPath = join(distDir, 'index.html');
const fallbackPath = join(distDir, '404.html');

const failures = [];
const fail = (message) => failures.push(message);

/** Read a file as UTF-8, recording a failure instead of throwing. */
function readOrFail(file, label) {
  if (!existsSync(file)) {
    fail(`${label} is missing: ${file}`);
    return null;
  }
  if (statSync(file).isDirectory()) {
    fail(`${label} is a directory, expected a file: ${file}`);
    return null;
  }
  return readFileSync(file, 'utf8');
}

// --- 1. Build present -------------------------------------------------------
if (!existsSync(indexPath)) {
  console.error(`FAIL: ${indexPath} does not exist.`);
  console.error(`      Build first: VITE_BASE=${EXPECTED_BASE} npm run build`);
  process.exit(1);
}

const indexHtml = readOrFail(indexPath, 'build entry point');

// --- 2. Every internal reference carries the deploy base --------------------
// Matches src="...", href='...' and bare src=value in the emitted HTML.
const ATTR_RE = /\b(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
const NON_ASSET_SCHEMES = /^(?:data|blob|mailto|tel|javascript):/i;

const references = [];
if (indexHtml !== null) {
  for (const match of indexHtml.matchAll(ATTR_RE)) {
    references.push((match[1] ?? match[2] ?? match[3] ?? '').trim());
  }
}

const internal = [];
let external = 0;
let nonAsset = 0;

for (const reference of references) {
  if (reference === '' || reference.startsWith('#')) {
    nonAsset += 1;
    continue;
  }
  // Absolute URLs and protocol-relative URLs are not affected by Vite's base.
  if (reference.startsWith('//') || (/^[a-z][a-z0-9+.-]*:/i.test(reference) && !NON_ASSET_SCHEMES.test(reference))) {
    external += 1;
    continue;
  }
  if (NON_ASSET_SCHEMES.test(reference)) {
    nonAsset += 1;
    continue;
  }
  internal.push(reference);
}

if (internal.length === 0) {
  fail(`no internal src/href references found in dist/index.html; expected assets under ${EXPECTED_BASE}`);
}

for (const reference of internal) {
  if (!reference.startsWith(EXPECTED_BASE)) {
    fail(
      `reference "${reference}" does not start with ${EXPECTED_BASE} ` +
        `(did the build run with VITE_BASE=${EXPECTED_BASE}? a bare "/" breaks the Pages subpath)`,
    );
  }
}

// --- 3. Pages SPA fallback must mirror the shell ----------------------------
const fallbackHtml = readOrFail(fallbackPath, 'SPA fallback dist/404.html');
if (fallbackHtml !== null && indexHtml !== null && fallbackHtml !== indexHtml) {
  fail('dist/404.html differs from dist/index.html (pages.yml copies index.html to 404.html)');
}

// --- 4. The COOP/COEP worker must be published ------------------------------
// Without it the engine still runs, but on one thread; a missing file would be a silent
// 2x regression that only shows up in production performance.
const coiPath = join(distDir, 'coi-serviceworker.js');
const coiSource = readOrFail(coiPath, 'COOP/COEP worker dist/coi-serviceworker.js');
if (coiSource !== null) {
  const needed = ['Cross-Origin-Opener-Policy', 'Cross-Origin-Embedder-Policy'];
  const missing = needed.filter((header) => !coiSource.includes(header));
  if (missing.length) {
    fail(`dist/coi-serviceworker.js does not set ${missing.join(', ')}`);
  }
}

// --- 5. Browser models must be published -----------------------------------
const modelsDir = join(distDir, 'models');
const presentModels = REQUIRED_MODELS.filter((name) => existsSync(join(modelsDir, name)));
for (const name of REQUIRED_MODELS) {
  if (!presentModels.includes(name)) {
    fail(`model dist/models/${name} is missing (the engine loads it in the browser)`);
  }
}

// --- Summary ---------------------------------------------------------------
const ok = failures.length === 0;
console.log(`base check: expected ${EXPECTED_BASE} (GitHub Pages subpath)`);
console.log(
  `  index.html refs: ${references.length} total, ${internal.length} internal, ` +
    `${external} external, ${nonAsset} non-asset`,
);
console.log(
  `  404.html fallback: ${fallbackHtml === null ? 'missing' : fallbackHtml === indexHtml ? 'identical to index.html' : 'differs'}`,
);
console.log(`  models: ${presentModels.length}/${REQUIRED_MODELS.length} present (${REQUIRED_MODELS.join(', ')})`);
console.log(`  COOP/COEP worker: ${coiSource === null ? 'missing' : 'present'}`);

if (ok) {
  console.log(`OK: ${internal.length} internal ref(s) under ${EXPECTED_BASE}, fallback and models intact`);
  process.exit(0);
}

console.error(`FAIL: ${failures.length} problem(s) found`);
for (const failure of failures) {
  console.error(`  - ${failure}`);
}
process.exit(1);
