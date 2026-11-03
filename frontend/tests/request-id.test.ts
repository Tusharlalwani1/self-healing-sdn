import assert from 'node:assert/strict';
import { beforeEach, afterEach, test } from 'node:test';
import { createRequestId } from '../src/services/requestId';
import { useSDNStore } from '../src/stores/sdnStore';

const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
const originalFetch = globalThis.fetch;
const cryptoValue = (value: unknown) => Object.defineProperty(globalThis, 'crypto', { configurable: true, value });
const validId = /^[A-Za-z0-9_-]{1,100}$/;

beforeEach(() => {
  useSDNStore.setState({ experimentRunning: false, experimentRunId: null, experimentProgress: null, error: null });
});
afterEach(() => {
  if (originalCrypto) Object.defineProperty(globalThis, 'crypto', originalCrypto);
  else Reflect.deleteProperty(globalThis, 'crypto');
  globalThis.fetch = originalFetch;
});

test('uses native randomUUID when available', () => {
  cryptoValue({ randomUUID: () => 'native-request-id' });
  assert.equal(createRequestId(), 'native-request-id');
});

test('HTTP-compatible getRandomValues fallback generates version 4 UUIDs', () => {
  let seed = 0;
  cryptoValue({ getRandomValues: (bytes: Uint8Array) => { bytes.fill(++seed); return bytes; } });
  const first = createRequestId();
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.match(first, validId);
  assert.notEqual(first, createRequestId());
});

test('missing Web Crypto does not crash and yields distinct schema-compatible IDs', () => {
  cryptoValue(undefined);
  const ids = Array.from({ length: 100 }, () => createRequestId());
  assert.equal(new Set(ids).size, 100);
  for (const id of ids) assert.match(id, validId);
});

async function startExperimentWithoutUUID(crypto: unknown) {
  cryptoValue(crypto);
  let posted: { url: string; method?: string; body: Record<string, unknown> } | undefined;
  globalThis.fetch = (async (url, options) => {
    if (String(url) === '/api/experiments/run') {
      posted = { url: String(url), method: options?.method, body: JSON.parse(String(options?.body)) };
      assert.equal(useSDNStore.getState().experimentRunning, true);
      assert.equal(posted.body.run_id, useSDNStore.getState().experimentRunId);
      return new Response(JSON.stringify({ id: 'server-experiment', status: 'COMPLETED' }));
    }
    return new Response('[]');
  }) as typeof fetch;
  await useSDNStore.getState().runExperiment({ controller: 'reactive', packet_count: 80 });
  assert.ok(posted);
  assert.equal(posted.method, 'POST');
  assert.equal(posted.body.controller, 'reactive');
  assert.equal(posted.body.packet_count, 80);
  assert.match(String(posted.body.run_id), validId);
  assert.equal(useSDNStore.getState().experimentRunning, false);
}

test('Run Automated Experiment sends the POST when randomUUID is unavailable', async () => {
  await startExperimentWithoutUUID({ getRandomValues: (bytes: Uint8Array) => { bytes.fill(42); return bytes; } });
});

test('Run Automated Experiment also sends the POST when crypto is absent', async () => {
  await startExperimentWithoutUUID(undefined);
});

test('fallback ID generation does not mask backend experiment errors', async () => {
  cryptoValue(undefined);
  let posted = false;
  globalThis.fetch = (async () => {
    posted = true;
    return new Response(JSON.stringify({ detail: { message: 'Controller activation failed' } }), { status: 503 });
  }) as typeof fetch;
  await assert.rejects(useSDNStore.getState().runExperiment({ controller: 'reactive' }), /Controller activation failed/);
  assert.equal(posted, true);
  assert.equal(useSDNStore.getState().error, 'Controller activation failed');
  assert.equal(useSDNStore.getState().experimentRunning, false);
});
