// Tests for the fetch wrapper, with a stubbed `fetch`: no server, no DOM.
//
// The regression these pin down (review P1-1): the error path used to call
// `response.json()` and, in the catch, `response.text()` on the same body. A real
// `Response` is single-use, so a non-JSON error (a proxy's HTML page, an empty 502)
// threw `TypeError: Body is unusable` instead of `502 <detail>`, and the 409-recovery
// path in `useIncidentStore` never saw the `409` prefix.

import test from 'node:test';
import assert from 'node:assert/strict';

import { queryString, request, resolveAsset } from './http.js';
import { isConflictError } from '../utils/incidentState.js';

/**
 * One `Response` stand-in whose body can be consumed once, like the real one.
 * Calling `text()`/`json()` twice throws the browser's exact message.
 */
function stubResponse({ status = 200, statusText = '', body = '' } = {}) {
  const state = { reads: 0 };
  const read = () => {
    if (state.reads > 0) throw new TypeError('Body is unusable: Body has already been read');
    state.reads += 1;
    return body;
  };
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    reads: () => state.reads,
    text: async () => read(),
    json: async () => JSON.parse(read()),
  };
}

/** Swap the global `fetch` for one call and always restore it. */
async function withFetch(response, run) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return response;
  };
  try {
    await run(calls);
  } finally {
    globalThis.fetch = original;
  }
}

test('a JSON error keeps its status and detail', async () => {
  const response = stubResponse({
    status: 409,
    statusText: 'Conflict',
    body: JSON.stringify({ detail: 'Incidentul a fost modificat între timp.' }),
  });

  await withFetch(response, async () => {
    await assert.rejects(
      request('/events/x/ack', { method: 'POST', body: JSON.stringify({ operator: 'Ana' }) }),
      (error) => {
        assert.equal(
          error.message,
          '409 Incidentul a fost modificat între timp.'
        );
        // The contract the incident store depends on: the 409 recovery, not a rollback.
        assert.equal(isConflictError(error), true);
        return true;
      }
    );
  });

  assert.equal(response.reads(), 1, 'the error body is read once');
});

test('a non-JSON error body is reported instead of throwing "Body is unusable"', async () => {
  const html = '<html><body>502 Bad Gateway</body></html>';
  const response = stubResponse({ status: 502, statusText: 'Bad Gateway', body: html });

  await withFetch(response, async () => {
    await assert.rejects(request('/health'), (error) => {
      assert.ok(!/Body is unusable/.test(error.message), error.message);
      assert.ok(error.message.startsWith('502 '), error.message);
      assert.match(error.message, /502 Bad Gateway/);
      assert.equal(isConflictError(error), false);
      return true;
    });
  });

  assert.equal(response.reads(), 1);
});

test('an empty error body falls back to the status text', async () => {
  const response = stubResponse({ status: 502, statusText: 'Bad Gateway', body: '' });

  await withFetch(response, async () => {
    await assert.rejects(request('/health'), { message: '502 Bad Gateway' });
  });
});

test('a JSON error without a detail keeps the payload', async () => {
  await withFetch(stubResponse({ status: 422, body: '{"zone_id":"required"}' }), async () => {
    await assert.rejects(request('/zones'), {
      message: '422 {"zone_id":"required"}',
    });
  });
});

test('a 204 resolves to null without touching the body', async () => {
  const response = stubResponse({ status: 204 });

  await withFetch(response, async (calls) => {
    assert.equal(await request('/zones/z', { method: 'DELETE' }), null);
    assert.equal(calls[0].url, 'http://localhost:8000/zones/z');
    assert.equal(calls[0].options.method, 'DELETE');
  });

  assert.equal(response.reads(), 0, 'a bodyless answer is not parsed');
});

test('a successful answer is parsed as JSON', async () => {
  await withFetch(stubResponse({ status: 200, body: '{"id":"cam-1"}' }), async (calls) => {
    assert.deepEqual(await request('/cameras/cam-1'), { id: 'cam-1' });
    // A JSON body is announced to the backend; the request stays a plain GET otherwise.
    assert.equal(calls[0].options.headers['Content-Type'], undefined);
  });
});

test('queryString and resolveAsset keep their shapes', () => {
  assert.equal(queryString({ camera_id: 'stand12', limit: 200, status: '' }), '?camera_id=stand12&limit=200');
  assert.equal(queryString(), '');
  assert.equal(resolveAsset('/snapshots/a.jpg'), 'http://localhost:8000/snapshots/a.jpg');
  assert.equal(resolveAsset('blob:http://localhost:5173/x'), 'blob:http://localhost:5173/x');
  assert.equal(resolveAsset(''), '');
});
