#!/usr/bin/env node
/**
 * Source-level licence guard for the static LocalSight build.
 *
 * Two questions, both answered without network access and without installing anything:
 *
 *   1. Does `package-lock.json` still resolve to permissive code only? Every package
 *      entry (production *and* dev) is checked. Anything copyleft — GPL, AGPL, LGPL,
 *      SSPL — or under a source-available licence (BUSL, Commons Clause, UNLICENSED),
 *      or with an empty/unreadable licence field, fails the run. An unknown licence
 *      fails too: the allow list is explicit, so a new dependency has to be looked at
 *      instead of slipping in because nobody read it.
 *
 *   2. Does the build still ship the legal artefacts that make the permissive models
 *      and the bundled ONNX Runtime WASM distributable? The notices, the two model
 *      licence texts and the three model files must be present, `NOTICE` must name
 *      EfficientDet, YuNet and ONNX Runtime, and no YOLO/Ultralytics weight may
 *      reappear under `public/models/` (those are AGPL).
 *
 * The project itself is BUSL-1.1 (see LICENSE); that is why the root lock entry (path
 * `""`) is skipped — it describes this repository, not a dependency.
 *
 * MPL-2.0, EPL-2.0 and CDDL-1.0 are reported as `review`, not as failures: they are
 * weak, file-level copyleft and the enumerated failure list above does not include them.
 * They still show up loudly in the summary so a human decides before merging.
 *
 * Usage, from `frontend/`:
 *   node scripts/check-licenses.mjs          # human-readable, exit 0/1
 *   node scripts/check-licenses.mjs --json   # same data as JSON on stdout
 *
 * Not shipped, not imported by the app. Tests: scripts/check-licenses.test.mjs.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND_DEFAULT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// --- Policy -----------------------------------------------------------------

/** The allow list. An identifier that is not here is `unknown` and fails the run. */
export const ALLOWED_LICENSES = new Map([
  ['MIT', 'permissive'],
  ['MIT-0', 'permissive'],
  ['ISC', 'permissive'],
  ['BSD-2-CLAUSE', 'permissive'],
  ['BSD-3-CLAUSE', 'permissive'],
  ['0BSD', 'permissive'],
  ['APACHE-2.0', 'permissive'],
  ['BLUEOAK-1.0.0', 'permissive'],
  ['PYTHON-2.0', 'permissive'],
  ['ZLIB', 'permissive'],
  ['BSL-1.0', 'permissive'],
  ['UNLICENSE', 'public-domain'],
  ['CC0-1.0', 'public-domain'],
  ['CC-BY-3.0', 'attribution'],
  ['CC-BY-4.0', 'attribution'],
]);

/**
 * Weak, file-level copyleft. Not on the failure list above, but a new one deserves a
 * human look before it enters a build that is redistributed as WASM/JS.
 */
export const REVIEW_LICENSES = new Set(['MPL-2.0', 'EPL-2.0', 'CDDL-1.0']);

/** Hard failures. Checked on the raw expression so a compound string cannot hide one. */
export const FORBIDDEN_MARKERS = [
  ['AGPL', /\bAGPL/i],
  ['LGPL', /\bLGPL/i],
  ['GPL', /\bGPL/i],
  ['SSPL', /\bSSPL/i],
  ['BUSL', /\bBUSL\b|Business Source License/i],
  ['Commons Clause', /Commons Clause/i],
  ['UNLICENSED', /^UNLICENSED$/i],
];

/** Files that must exist in `frontend/public/`, relative to it. */
export const REQUIRED_SHIP_FILES = [
  'NOTICE',
  'LICENSES.txt',
  'THIRD_PARTY_NOTICES.txt',
  'models/LICENSE-APACHE-2.0.txt',
  'models/LICENSE-CC-BY-3.0.txt',
  'models/efficientdet_lite0.onnx',
  'models/efficientdet_lite2.onnx',
  'models/yunet.onnx',
  'models/README.md',
];

/** Strings each notice must contain. `LICENSES.txt` lists licence families, not packages. */
export const REQUIRED_NOTICE_TEXT = {
  NOTICE: ['EfficientDet', 'YuNet', 'ONNX Runtime'],
  'LICENSES.txt': ['MIT', 'ISC', 'BSD', 'Apache'],
  'models/README.md': ['Apache-2.0', 'MIT'],
};

/** `THIRD_PARTY_NOTICES.txt` is the upstream ONNX Runtime bundle notice: any two of these
 *  components identify it. Checking one exact line would break on an ORT upgrade. */
export const ORT_NOTICE_MARKERS = ['Intel Math', 'Eigen', 'XNNPACK', 'ONNX Runtime'];

/** A model path that would reintroduce AGPL weights (`yolo26n.onnx` included). */
export const FORBIDDEN_MODEL_PATH = /(?:^|[/_.-])(?:yolo|ultralytics)/i;

/** `NOTICE` may mention AGPL only to say none ships. Historical context is allowed. */
const AGPL_DISCLAIMER = /\b(?:no|not|never|without)\s+(?:an?\s+)?AGPL|AGPL[^.\n]*\bnot\b|\bnu\s+(?:exist[ăa]|e)\s+AGPL/i;

// --- Licence evaluation -----------------------------------------------------

/** Flatten npm's `license` field (string, `{ type }`, or an array) into one expression. */
export function licenseExpression(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) {
    return value.map((entry) => licenseExpression(entry)).filter(Boolean).join(' OR ');
  }
  const raw = typeof value === 'string' ? value : value?.type;
  return typeof raw === 'string' ? raw.trim() : '';
}

/** Split an SPDX-ish expression into identifiers, dropping operators and `WITH` exceptions. */
export function licenseIdentifiers(expression) {
  if (!expression) return [];
  return expression
    .split(/\s+(?:OR|AND)\s+/i)
    .map((part) => part.replace(/[()]/g, '').split(/\s+WITH\s+/i)[0].trim())
    .filter(Boolean)
    .map((part) => part.toUpperCase().replace(/\s+/g, '-'));
}

/**
 * Decide one package's licence.
 * @returns {{ license: string, status: 'allowed'|'review'|'forbidden'|'unknown', reason: string }}
 */
export function evaluateLicense(value) {
  const expression = licenseExpression(value);
  if (!expression) {
    return { license: '(none)', status: 'unknown', reason: 'empty licence field' };
  }
  if (/^SEE LICEN[CS]E IN\b/i.test(expression)) {
    return { license: expression, status: 'unknown', reason: 'licence only points at a file' };
  }

  for (const [label, pattern] of FORBIDDEN_MARKERS) {
    if (pattern.test(expression)) {
      return { license: expression, status: 'forbidden', reason: `${label} is copyleft` };
    }
  }

  const ids = licenseIdentifiers(expression);
  if (ids.length === 0) {
    return { license: expression, status: 'unknown', reason: 'no licence identifier' };
  }

  const unknown = ids.filter((id) => !ALLOWED_LICENSES.has(id) && !REVIEW_LICENSES.has(id));
  if (unknown.length) {
    return {
      license: expression,
      status: 'unknown',
      reason: `not on the allow list: ${unknown.join(', ')}`,
    };
  }

  const review = ids.filter((id) => REVIEW_LICENSES.has(id));
  if (review.length) {
    return {
      license: expression,
      status: 'review',
      reason: `weak copyleft, review before release: ${review.join(', ')}`,
    };
  }

  return { license: expression, status: 'allowed', reason: ALLOWED_LICENSES.get(ids[0]) };
}

// --- Dependency audit -------------------------------------------------------

/** `node_modules/@scope/name` -> `@scope/name`. */
export function packageNameFromPath(path) {
  const parts = path.split('/');
  const index = parts.lastIndexOf('node_modules');
  if (index === -1) return path;
  const rest = parts.slice(index + 1);
  return rest[0]?.startsWith('@') ? `${rest[0]}/${rest[1] ?? ''}` : rest[0] ?? path;
}

/**
 * Audit a parsed lockfile object. Pure: no filesystem access.
 * @returns {{
 *   ok: boolean,
 *   violations: Array<{ kind: string, target: string, message: string }>,
 *   packages: Array<{ path: string, name: string, version: string, scope: 'prod'|'dev', license: string, status: string, reason: string }>,
 *   byLicense: Array<{ license: string, prod: number, dev: number, total: number }>,
 *   totals: { packages: number, prod: number, dev: number, forbidden: number, unknown: number, review: number, lockfileVersion: number },
 * }}
 */
export function auditLockfile(lock) {
  const violations = [];
  const packages = [];
  const lockfileVersion = Number(lock?.lockfileVersion ?? 0);

  if (lockfileVersion < 3) {
    violations.push({
      kind: 'lockfile',
      target: 'package-lock.json',
      message: `lockfileVersion ${lockfileVersion || '(missing)'}; this guard expects npm 9+ (v3)`,
    });
  }

  for (const [path, entry] of Object.entries(lock?.packages ?? {})) {
    // `""` is this repository (BUSL-1.1), not a dependency; links are workspace aliases.
    if (path === '' || entry?.link) continue;

    const name = entry?.name ?? packageNameFromPath(path);
    const scope = entry?.dev ? 'dev' : 'prod';
    const verdict = evaluateLicense(entry?.license);
    packages.push({
      path,
      name,
      version: entry?.version ?? '(unknown)',
      scope,
      ...verdict,
    });

    if (verdict.status === 'forbidden' || verdict.status === 'unknown') {
      violations.push({
        kind: 'dependency',
        target: `${name}@${entry?.version ?? '(unknown)'} (${path})`,
        message: `${verdict.license}: ${verdict.reason}`,
      });
    }
  }

  packages.sort((a, b) => a.path.localeCompare(b.path));

  const counts = new Map();
  for (const pkg of packages) {
    const row = counts.get(pkg.license) ?? { license: pkg.license, prod: 0, dev: 0, total: 0 };
    row[pkg.scope] += 1;
    row.total += 1;
    counts.set(pkg.license, row);
  }
  const byLicense = [...counts.values()].sort((a, b) => b.total - a.total || a.license.localeCompare(b.license));

  const countStatus = (status) => packages.filter((pkg) => pkg.status === status).length;

  return {
    ok: violations.length === 0,
    violations,
    packages,
    byLicense,
    totals: {
      packages: packages.length,
      prod: packages.filter((pkg) => pkg.scope === 'prod').length,
      dev: packages.filter((pkg) => pkg.scope === 'dev').length,
      forbidden: countStatus('forbidden'),
      unknown: countStatus('unknown'),
      review: countStatus('review'),
      lockfileVersion,
    },
  };
}

// --- Ship artefact audit ----------------------------------------------------

/**
 * Audit the files that must travel with the build. Pure: pass a plain object.
 *
 * `files` maps a path relative to `frontend/public/` to its text content, or `null` for
 * a binary whose content is not read. A key that is absent means the file is missing.
 */
export function auditShip(files = {}) {
  const violations = [];
  const present = Object.keys(files);
  const missing = REQUIRED_SHIP_FILES.filter((name) => files[name] === undefined);

  for (const name of missing) {
    violations.push({
      kind: 'ship',
      target: name,
      message: 'required licence/model artefact is missing from frontend/public/',
    });
  }

  const text = (name) => (typeof files[name] === 'string' ? files[name] : null);

  for (const [name, required] of Object.entries(REQUIRED_NOTICE_TEXT)) {
    const body = text(name);
    if (body === null) continue;
    const absent = required.filter((needle) => !body.includes(needle));
    if (absent.length) {
      violations.push({
        kind: 'content',
        target: name,
        message: `does not mention ${absent.map((needle) => `"${needle}"`).join(', ')}`,
      });
    }
  }

  const ortNotice = text('THIRD_PARTY_NOTICES.txt');
  if (ortNotice !== null) {
    const found = ORT_NOTICE_MARKERS.filter((marker) => ortNotice.includes(marker));
    if (found.length < 2) {
      violations.push({
        kind: 'content',
        target: 'THIRD_PARTY_NOTICES.txt',
        message: `does not look like the ONNX Runtime bundle notice (found ${found.length}/${ORT_NOTICE_MARKERS.length} of: ${ORT_NOTICE_MARKERS.join(', ')})`,
      });
    }
  }

  const notice = text('NOTICE');
  if (notice !== null && /\bAGPL/i.test(notice) && !AGPL_DISCLAIMER.test(notice)) {
    violations.push({
      kind: 'content',
      target: 'NOTICE',
      message: 'mentions AGPL without stating that no AGPL component ships',
    });
  }

  const models = present.filter((name) => name.startsWith('models/'));
  for (const name of models) {
    if (FORBIDDEN_MODEL_PATH.test(name)) {
      violations.push({
        kind: 'ship',
        target: name,
        message: 'YOLO/Ultralytics weights are AGPL and must not ship',
      });
    }
  }

  return {
    violations,
    required: REQUIRED_SHIP_FILES.length,
    found: REQUIRED_SHIP_FILES.length - missing.length,
    missing,
    models,
  };
}

// --- Filesystem loading -----------------------------------------------------

const TEXTUAL_FILE = /(?:^|\/)(?:NOTICE|LICENSES\.txt|THIRD_PARTY_NOTICES\.txt|README\.md|LICENSE[^/]*\.txt)$/;

/** Read the required artefacts and the full `models/` listing from a real tree. */
export function loadShipTree(publicDir) {
  /** @type {Record<string, string|null>} */
  const files = {};
  if (!existsSync(publicDir)) return files;

  const modelsDir = join(publicDir, 'models');
  if (existsSync(modelsDir) && statSync(modelsDir).isDirectory()) {
    for (const name of readdirSync(modelsDir)) {
      const absolute = join(modelsDir, name);
      if (!statSync(absolute).isFile()) continue;
      const key = `models/${name}`;
      files[key] = TEXTUAL_FILE.test(key) ? readFileSync(absolute, 'utf8') : null;
    }
  }

  for (const name of REQUIRED_SHIP_FILES) {
    if (name.startsWith('models/')) continue;
    const absolute = join(publicDir, name);
    if (existsSync(absolute) && statSync(absolute).isFile()) {
      files[name] = readFileSync(absolute, 'utf8');
    }
  }

  return files;
}

/** Run both audits against a real frontend directory. */
export function runCheck(frontendDir = FRONTEND_DEFAULT) {
  const lockfilePath = join(frontendDir, 'package-lock.json');
  const lock = JSON.parse(readFileSync(lockfilePath, 'utf8'));
  const deps = auditLockfile(lock);
  const ship = auditShip(loadShipTree(join(frontendDir, 'public')));
  const violations = [...deps.violations, ...ship.violations];

  return { ok: violations.length === 0, violations, deps, ship };
}

// --- CLI --------------------------------------------------------------------

function printReport(result) {
  const { deps, ship } = result;
  console.log(
    `lockfile: ${deps.totals.packages} packages (v${deps.totals.lockfileVersion}), ` +
      `${deps.totals.prod} prod / ${deps.totals.dev} dev`,
  );

  const width = Math.max(8, ...deps.byLicense.map((row) => row.license.length));
  for (const row of deps.byLicense) {
    console.log(
      `  ${row.license.padEnd(width)}  ${String(row.total).padStart(3)}  ` +
        `(prod ${row.prod}, dev ${row.dev})`,
    );
  }

  console.log(
    `  forbidden ${deps.totals.forbidden}, unknown ${deps.totals.unknown}, review ${deps.totals.review}`,
  );
  console.log(`ship artefacts: ${ship.found}/${ship.required} required present`);
  console.log(`  models: ${ship.models.join(', ') || '(none)'}`);

  const review = deps.packages.filter((pkg) => pkg.status === 'review');
  for (const pkg of review) {
    console.warn(`  review: ${pkg.name}@${pkg.version} -> ${pkg.license} (${pkg.reason})`);
  }
}

function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('usage: node scripts/check-licenses.mjs [--json]');
    return 0;
  }

  const unknown = argv.filter((arg) => arg !== '--json');
  if (unknown.length) {
    console.error(`check-licenses: unknown argument: ${unknown.join(' ')}\nusage: node scripts/check-licenses.mjs [--json]`);
    return 2;
  }

  let result;
  try {
    result = runCheck(FRONTEND_DEFAULT);
  } catch (error) {
    console.error(`check-licenses: could not read the tree: ${error.message}`);
    return 1;
  }

  if (argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printReport(result);
  }

  if (result.ok) {
    if (!argv.includes('--json')) {
      console.log(
        `OK: ${result.deps.totals.packages} package(s) permissive, ` +
          `${result.ship.found}/${result.ship.required} ship artefacts, no YOLO weights`,
      );
    }
    return 0;
  }

  if (!argv.includes('--json')) {
    console.error(`FAIL: ${result.violations.length} licence problem(s)`);
    for (const violation of result.violations) {
      console.error(`  - [${violation.kind}] ${violation.target}: ${violation.message}`);
    }
  }
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
