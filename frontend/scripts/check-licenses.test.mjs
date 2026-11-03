import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  auditLockfile,
  auditShip,
  evaluateLicense,
  licenseExpression,
  licenseIdentifiers,
  packageNameFromPath,
  REQUIRED_SHIP_FILES,
  runCheck,
} from './check-licenses.mjs';

const FRONTEND = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** A `public/` tree that satisfies every ship check. Tests mutate a copy of it. */
function shipTree(overrides = {}) {
  const files = {
    NOTICE: 'EfficientDet-Lite0, YuNet face detector, ONNX Runtime Web. No AGPL model ships.',
    'LICENSES.txt': 'MIT, ISC, BSD-3-Clause and Apache-2.0 runtime notices follow.',
    'THIRD_PARTY_NOTICES.txt':
      'Intel Math Kernel Library (Intel MKL)\nEigen 3.4\nXNNPACK\n',
    'models/LICENSE-APACHE-2.0.txt': 'Apache License, Version 2.0',
    'models/LICENSE-CC-BY-3.0.txt': 'Creative Commons Attribution 3.0',
    'models/efficientdet_lite0.onnx': null,
    'models/efficientdet_lite2.onnx': null,
    'models/yunet.onnx': null,
    'models/README.md': 'EfficientDet weights are Apache-2.0, YuNet is MIT.',
  };
  return { ...files, ...overrides };
}

/** A one-package lockfile, so each test states exactly which licence it exercises. */
function lockWith(license, overrides = {}) {
  return {
    lockfileVersion: 3,
    packages: {
      '': { name: 'localsight', version: '1.0.0' },
      'node_modules/example': { version: '1.0.0', license, ...overrides },
    },
  };
}

// --- Licence evaluation -----------------------------------------------------

test('copyleft licences are rejected', () => {
  for (const license of ['GPL-3.0-only', 'GPL-2.0', 'AGPL-3.0', 'LGPL-2.1', 'LGPL-3.0-or-later', 'SSPL-1.0']) {
    const verdict = evaluateLicense(license);
    assert.equal(verdict.status, 'forbidden', `${license} should be forbidden`);
  }
});

test('source-available and unlicensed states are rejected', () => {
  for (const license of ['BUSL-1.1', 'Commons Clause', 'UNLICENSED']) {
    assert.equal(evaluateLicense(license).status, 'forbidden', `${license} should be forbidden`);
  }
});

test('an empty, missing or file-pointer licence is unknown', () => {
  for (const value of [undefined, null, '', '   ', { type: '' }, 'SEE LICENSE IN LICENSE.txt']) {
    assert.equal(evaluateLicense(value).status, 'unknown', `${String(value)} should be unknown`);
  }
});

test('a licence outside the allow list is unknown, not silently allowed', () => {
  const verdict = evaluateLicense('WTFPL');
  assert.equal(verdict.status, 'unknown');
  assert.match(verdict.reason, /WTFPL/);
});

test('the current permissive set is allowed', () => {
  for (const license of ['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'CC-BY-4.0', '0BSD', 'BlueOak-1.0.0']) {
    assert.equal(evaluateLicense(license).status, 'allowed', `${license} should be allowed`);
  }
});

test('weak copyleft is reported for review but not failed', () => {
  const verdict = evaluateLicense('MPL-2.0');
  assert.equal(verdict.status, 'review');
  assert.match(verdict.reason, /MPL-2.0/);
});

test('compound expressions are judged per identifier', () => {
  assert.equal(evaluateLicense('MIT OR Apache-2.0').status, 'allowed');
  assert.equal(evaluateLicense('MIT AND GPL-3.0-only').status, 'forbidden');
  assert.equal(evaluateLicense({ type: 'ISC' }).status, 'allowed');
  assert.equal(licenseExpression([{ type: 'MIT' }, 'Apache-2.0']), 'MIT OR Apache-2.0');
  assert.deepEqual(licenseIdentifiers('Apache-2.0 WITH LLVM-exception'), ['APACHE-2.0']);
});

// --- Lockfile audit ---------------------------------------------------------

test('a GPL dependency fails the lockfile audit in either scope', () => {
  for (const scope of [{}, { dev: true }]) {
    const result = auditLockfile(lockWith('GPL-3.0-only', scope));
    assert.equal(result.ok, false);
    assert.equal(result.totals.forbidden, 1);
    assert.equal(result.violations[0].target, 'example@1.0.0 (node_modules/example)');
  }
});

test('an unknown licence fails the audit and is named', () => {
  const result = auditLockfile(lockWith(undefined));
  assert.equal(result.ok, false);
  assert.equal(result.totals.unknown, 1);
  assert.match(result.violations[0].message, /empty licence/);
});

test('a permissive lockfile passes and groups packages by licence', () => {
  const lock = {
    lockfileVersion: 3,
    packages: {
      '': { name: 'localsight', license: 'BUSL-1.1' },
      'node_modules/react': { version: '18.3.1', license: 'MIT' },
      'node_modules/caniuse-lite': { version: '1.0.0', license: 'CC-BY-4.0', dev: true },
      'node_modules/@scope/pkg': { version: '2.0.0', license: 'Apache-2.0', dev: true },
    },
  };
  const result = auditLockfile(lock);
  assert.equal(result.ok, true);
  // The root entry is this repository's own BUSL-1.1, never a dependency.
  assert.equal(result.totals.packages, 3);
  assert.equal(result.totals.unknown, 0);
  assert.deepEqual(
    result.byLicense.map((row) => [row.license, row.prod, row.dev, row.total]),
    [
      ['Apache-2.0', 0, 1, 1],
      ['CC-BY-4.0', 0, 1, 1],
      ['MIT', 1, 0, 1],
    ],
  );
});

test('an old lockfile format fails instead of being guessed at', () => {
  const result = auditLockfile({ lockfileVersion: 2, packages: {} });
  assert.equal(result.ok, false);
  assert.match(result.violations[0].message, /lockfileVersion 2/);
});

test('a scoped package name is recovered from its lock path', () => {
  assert.equal(packageNameFromPath('node_modules/@protobufjs/base64'), '@protobufjs/base64');
  assert.equal(packageNameFromPath('node_modules/a/node_modules/b'), 'b');
});

// --- Ship artefact audit ----------------------------------------------------

test('the complete ship tree passes', () => {
  const result = auditShip(shipTree());
  assert.deepEqual(result.violations, []);
  assert.equal(result.found, REQUIRED_SHIP_FILES.length);
  assert.deepEqual(result.missing, []);
});

test('a missing notice or model fails and is named', () => {
  const tree = shipTree();
  delete tree['NOTICE'];
  delete tree['models/yunet.onnx'];
  const result = auditShip(tree);
  assert.equal(result.found, REQUIRED_SHIP_FILES.length - 2);
  assert.deepEqual(result.missing, ['NOTICE', 'models/yunet.onnx']);
  assert.equal(result.violations.filter((v) => v.kind === 'ship').length, 2);
});

test('a notice that stops naming the models fails', () => {
  const result = auditShip(shipTree({ NOTICE: 'Third-party notices. No AGPL model ships.' }));
  assert.equal(result.violations.length, 1);
  assert.match(result.violations[0].message, /EfficientDet/);
});

test('a bare AGPL mention in NOTICE fails, a disclaimer does not', () => {
  const bare = auditShip(shipTree({ NOTICE: 'EfficientDet YuNet ONNX Runtime — AGPL-3.0 model.' }));
  assert.match(bare.violations.map((v) => v.message).join(' '), /no AGPL component/);

  const disclaimed = auditShip(
    shipTree({ NOTICE: 'EfficientDet YuNet ONNX Runtime. No AGPL-licensed model is part of this build.' }),
  );
  assert.deepEqual(disclaimed.violations, []);
});

test('YOLO and Ultralytics model paths are rejected', () => {
  for (const name of ['models/yolo26n.onnx', 'models/ultralytics-det.onnx', 'models/yolo.onnx']) {
    const result = auditShip(shipTree({ [name]: null }));
    assert.equal(result.violations.length, 1, `${name} should fail`);
    assert.match(result.violations[0].message, /AGPL/);
  }
});

test('a THIRD_PARTY_NOTICES file that is not the ORT notice fails', () => {
  const result = auditShip(shipTree({ 'THIRD_PARTY_NOTICES.txt': 'Some unrelated notices.' }));
  assert.equal(result.violations.length, 1);
  assert.match(result.violations[0].message, /ONNX Runtime bundle notice/);
});

// --- Current tree -----------------------------------------------------------

test('the current repository passes the guard', () => {
  const result = runCheck(FRONTEND);
  const detail = result.violations.map((v) => `${v.target}: ${v.message}`).join('\n');
  assert.equal(result.ok, true, detail);
  assert.ok(result.deps.totals.packages > 100, 'expected the full lockfile to be audited');
  assert.equal(result.deps.totals.forbidden, 0);
  assert.equal(result.deps.totals.unknown, 0);
  assert.equal(result.ship.found, REQUIRED_SHIP_FILES.length);
  assert.deepEqual(
    result.ship.models.filter((name) => /yolo|ultralytics/i.test(name)),
    [],
  );
});
