#!/usr/bin/env node
/**
 * The local feature loop, in one command: licence guard, unit tests, the real static
 * builds, and both browser suites, with a timing table at the end.
 *
 *   npm run verify                     # unit + build + smoke (5) + Pages (6)
 *   npm run verify -- --with-persistence   # ... plus the slow durable-store suite
 *   npm run verify:fast                # unit + build only, no browser
 *
 * What it saves compared to running the suites one by one: the unit tests run once, each
 * build happens once, and every suite reuses one already-built server through
 * `PW_BASE_URL` instead of Playwright's `webServer` rebuilding and restarting per run. The
 * servers listen on port 0, so parallel agents and worktrees never collide on 4173/4317.
 *
 * Two builds, not one, and that is not an accident: the smoke suite runs at the root base
 * (`page.goto('/incidents')`, and it asserts `^/incidents/<id>$`) while the Pages suite
 * asserts the `/LocalSight/` shape. `VITE_BASE` is baked into the bundle, so one artifact
 * cannot honestly serve both. `dist/` is left holding the Pages build, like CI and the
 * deploy.
 *
 * Not shipped, not imported by the app.
 */
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SERVE = join(FRONTEND, 'scripts', 'serve-test.mjs');
const DIST = join(FRONTEND, 'dist');
const PAGES_BASE = '/LocalSight/';

const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) {
  console.log('usage: npm run verify [-- --with-persistence]');
  process.exit(0);
}
const withPersistence = argv.includes('--with-persistence');
const unknown = argv.filter((arg) => arg !== '--with-persistence');
if (unknown.length) {
  console.error(`[verify] unknown argument: ${unknown.join(' ')}\nusage: npm run verify [-- --with-persistence]`);
  process.exit(2);
}

/** @type {Array<{name: string, ms: number, ok: boolean}>} */
const timings = [];
const servers = new Set();

function log(message) {
  console.log(`\n[verify] ${message}`);
}

/** Run a command from `frontend/`, inheriting stdio so failures are readable. */
function run(command, args, env = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: FRONTEND,
      stdio: 'inherit',
      env: { ...process.env, ...env },
      // `npm`/`npx` are shell shims on Windows; a single command string keeps that working.
      shell: process.platform === 'win32',
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} ${args.join(' ')} exited with ${code ?? signal}`));
    });
  });
}

/** Start serve-test on a free port and wait for the one JSON line it prints. */
function startServer(base) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [SERVE, '--base', base, '--port', '0', '--json'], {
      cwd: FRONTEND,
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    servers.add(child);

    let buffer = '';
    let settled = false;
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };

    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline === -1) return;
      try {
        settle(resolvePromise, { child, info: JSON.parse(buffer.slice(0, newline)) });
      } catch (error) {
        settle(reject, new Error(`serve-test printed no JSON: ${buffer}`));
      }
    });
    child.on('error', (error) => settle(reject, error));
    child.on('exit', (code) => {
      servers.delete(child);
      settle(reject, new Error(`serve-test exited before it listened (code ${code})`));
    });
  });
}

/** SIGTERM, then SIGKILL if the process does not go away. */
function stopServer(child) {
  return new Promise((resolvePromise) => {
    if (!child || child.exitCode !== null) {
      servers.delete(child);
      resolvePromise();
      return;
    }
    const kill = setTimeout(() => child.kill('SIGKILL'), 5000);
    child.once('exit', () => {
      clearTimeout(kill);
      servers.delete(child);
      resolvePromise();
    });
    child.kill('SIGTERM');
  });
}

/** Run one step, record its wall clock, and rethrow so the caller can stop. */
async function step(name, fn) {
  log(name);
  const started = performance.now();
  try {
    await fn();
    timings.push({ name, ms: performance.now() - started, ok: true });
  } catch (error) {
    timings.push({ name, ms: performance.now() - started, ok: false });
    throw error;
  }
}

function printTimings() {
  const width = Math.max(...timings.map((entry) => entry.name.length), 4);
  console.log('\n[verify] timings');
  for (const entry of timings) {
    console.log(`  ${entry.name.padEnd(width)}  ${(entry.ms / 1000).toFixed(1).padStart(5)}s  ${entry.ok ? 'ok' : 'FAILED'}`);
  }
  const total = timings.reduce((sum, entry) => sum + entry.ms, 0);
  console.log(`  ${'total'.padEnd(width)}  ${(total / 1000).toFixed(1).padStart(5)}s`);
}

/** Copy the shell to 404.html exactly like pages.yml does. */
function writeFallback() {
  const index = join(DIST, 'index.html');
  if (!existsSync(index)) throw new Error(`${index} is missing after the build`);
  copyFileSync(index, join(DIST, '404.html'));
}

/**
 * Both suites talk to a server this script owns. `PW_BASE_URL` makes the Playwright
 * configs skip their `webServer` (no rebuild, no second server); PW_PORT/PW_PAGES_PORT are
 * cleared so a value inherited from the shell cannot confuse the run.
 */
function playwrightEnv(baseUrl) {
  const env = { ...process.env, PW_BASE_URL: baseUrl };
  delete env.PW_PORT;
  delete env.PW_PAGES_PORT;
  return env;
}

async function withServer(base, fn) {
  const { child, info } = await startServer(base);
  log(`serving ${info.url} (pid ${child.pid})`);
  try {
    return await fn(info);
  } finally {
    await stopServer(child);
  }
}

async function main() {
  await step('licences (check-licenses)', () => run('npm', ['run', 'check:licenses']));

  await step('unit (node --test)', () => run('npm', ['run', 'test:unit']));

  // Smoke runs at the root base, so it gets its own build. See the file comment.
  await step('build (VITE_USE_MOCK=true, base /)', () =>
    run('npm', ['run', 'build'], { VITE_USE_MOCK: 'true', VITE_BASE: '' })
  );
  await step('smoke e2e (5)', () =>
    withServer('/', (info) =>
      run('npx', ['playwright', 'test'], playwrightEnv(new URL('/', info.url).href))
    )
  );

  await step(`build (VITE_USE_MOCK=true, base ${PAGES_BASE})`, () =>
    run('npm', ['run', 'build'], { VITE_USE_MOCK: 'true', VITE_BASE: PAGES_BASE })
  );
  await step('404.html fallback', async () => writeFallback());
  await step('pages e2e (6)', () =>
    withServer(PAGES_BASE, (info) =>
      run('npx', ['playwright', 'test', '--config=playwright.pages.config.js'], playwrightEnv(info.url))
    )
  );

  if (withPersistence) {
    // Reuses the Pages build and shape: the slow suite costs a second server start, no build.
    await step('persistence e2e', () =>
      withServer(PAGES_BASE, (info) =>
        run('npx', ['playwright', 'test', '--config=playwright.persistence.config.js'], playwrightEnv(info.url))
      )
    );
  }
}

let interrupted = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    if (interrupted) process.exit(130);
    interrupted = true;
    log(`received ${signal}; stopping servers`);
    await Promise.all([...servers].map(stopServer));
    process.exit(130);
  });
}

try {
  await main();
  printTimings();
  console.log(`[verify] green; dist/ holds the Pages build (${PAGES_BASE})`);
} catch (error) {
  console.error(`\n[verify] FAILED: ${error.message}`);
  await Promise.all([...servers].map(stopServer));
  printTimings();
  process.exit(1);
} finally {
  await Promise.all([...servers].map(stopServer));
}
