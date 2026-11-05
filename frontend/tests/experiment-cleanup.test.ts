import assert from 'node:assert/strict';
import { beforeEach, afterEach, test } from 'node:test';
import { useSDNStore } from '../src/stores/sdnStore';

const originalFetch = globalThis.fetch;
let sequence = 0;
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
beforeEach(() => {
  useSDNStore.setState({ experimentRunId: `cleanup-${++sequence}`, experimentRunning: true,
    experimentProgress: { status: 'RUNNING' }, error: null });
  globalThis.fetch = (async () => response([])) as typeof fetch;
});
afterEach(() => { globalThis.fetch = originalFetch; });

test('cancel waits for backend finalization, targets exact run, then shows CANCELLED', async () => {
  let resolve!: (value: Response) => void;
  let target = '';
  globalThis.fetch = ((url: string) => {
    if (url.includes('/cancel')) {
      target = url;
      return new Promise<Response>(done => { resolve = done; });
    }
    return Promise.resolve(response([]));
  }) as typeof fetch;
  const id = useSDNStore.getState().experimentRunId;
  const pending = useSDNStore.getState().cancelExperiment();
  assert.equal(useSDNStore.getState().experimentRunning, true);
  assert.equal(useSDNStore.getState().experimentProgress?.status, 'CANCELLING');
  assert.ok(target.endsWith(`run_id=${id}`));
  resolve(response({ status: 'CANCELLED' }));
  await pending;
  assert.equal(useSDNStore.getState().experimentRunning, false);
  assert.equal(useSDNStore.getState().experimentProgress?.status, 'CANCELLED');
});

test('late COMPLETED cannot overwrite cancelled run terminal state', async () => {
  globalThis.fetch = (async (url: string) => response(url.includes('/cancel') ? { status: 'CANCELLED' } : [])) as typeof fetch;
  const id = useSDNStore.getState().experimentRunId;
  await useSDNStore.getState().cancelExperiment();
  useSDNStore.getState().handleWebSocketMessage({ event_type: 'EXPERIMENT_FINISHED', run_id: id,
    experiment: { status: 'COMPLETED' } });
  assert.equal(useSDNStore.getState().experimentProgress?.status, 'CANCELLED');
});

test('cleanup API failure is displayed and does not claim cancelled', async () => {
  globalThis.fetch = (async () => response({ detail: { message: 'Experiment cleanup failed' } }, 502)) as typeof fetch;
  await assert.rejects(useSDNStore.getState().cancelExperiment(), /Experiment cleanup failed/);
  assert.equal(useSDNStore.getState().error, 'Experiment cleanup failed');
  assert.equal(useSDNStore.getState().experimentRunning, true);
  assert.equal(useSDNStore.getState().experimentProgress?.status, 'RUNNING');
});

test('FAILED cleanup websocket makes run terminal even when cancel HTTP fails', async () => {
  let resolve!: (value: Response) => void;
  globalThis.fetch = ((url: string) => url.includes('/cancel')
    ? new Promise<Response>(done => { resolve = done; }) : Promise.resolve(response([]))) as typeof fetch;
  const id = useSDNStore.getState().experimentRunId;
  const pending = useSDNStore.getState().cancelExperiment();
  useSDNStore.getState().handleWebSocketMessage({ event_type: 'EXPERIMENT_FINISHED', run_id: id,
    experiment: { status: 'FAILED' }, error: 'Experiment cleanup failed' });
  resolve(response({ detail: { message: 'Experiment cleanup failed' } }, 502));
  await assert.rejects(pending);
  assert.equal(useSDNStore.getState().experimentRunning, false);
  assert.equal(useSDNStore.getState().experimentProgress?.status, 'FAILED');
});

test('old cancellation response cannot finish replacement run B', async () => {
  let resolve!: (value: Response) => void;
  globalThis.fetch = ((url: string) => url.includes('/cancel')
    ? new Promise<Response>(done => { resolve = done; }) : Promise.resolve(response([]))) as typeof fetch;
  const pending = useSDNStore.getState().cancelExperiment();
  useSDNStore.setState({ experimentRunId: 'replacement-B', experimentRunning: true, experimentProgress: { status: 'RUNNING' } });
  resolve(response({ status: 'CANCELLED' }));
  await pending;
  assert.equal(useSDNStore.getState().experimentRunId, 'replacement-B');
  assert.equal(useSDNStore.getState().experimentRunning, true);
});

test('late progress cannot remove CANCELLING while cleanup is pending', async () => {
  let resolve!: (value: Response) => void;
  globalThis.fetch = ((url: string) => url.includes('/cancel')
    ? new Promise<Response>(done => { resolve = done; }) : Promise.resolve(response([]))) as typeof fetch;
  const id = useSDNStore.getState().experimentRunId;
  const pending = useSDNStore.getState().cancelExperiment();
  useSDNStore.getState().handleWebSocketMessage({ event_type: 'EXPERIMENT_PROGRESS', run_id: id, status: 'FAILURE_INJECTED' });
  assert.equal(useSDNStore.getState().experimentProgress?.status, 'CANCELLING');
  resolve(response({ status: 'CANCELLED' }));
  await pending;
});
