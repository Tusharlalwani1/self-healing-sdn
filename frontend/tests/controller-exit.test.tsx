import React from 'react';
import assert from 'node:assert/strict';
import { beforeEach, afterEach, test, mock } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { useSDNStore } from '../src/stores/sdnStore';
import { TopNavbar } from '../src/components/TopNavbar';
import { ControllersView } from '../src/pages/ControllersView';
import { emptyTopology, mergeTopology } from '../src/services/topology';

const originalFetch = globalThis.fetch;
const controller = { id: 'reactive' as const, status: 'READY' as const, is_active: true,
  name: 'Reactive', features: [], description: '' };
beforeEach(() => {
  useSDNStore.setState({ controllers: [controller], activeController: 'reactive', controllerStatus: 'READY',
    simulationState: 'RUNNING', topology: mergeTopology(emptyTopology(), {
      simulation_state: 'RUNNING', active_controller: 'reactive',
    }), error: null, loading: false, experimentRunning: false });
  globalThis.fetch = (() => new Promise(() => {})) as typeof fetch;
  // SSR otherwise reads Zustand's construction-time snapshot. Render current
  // state through React's existing renderer, without introducing a DOM harness.
  mock.method(React, 'useSyncExternalStore', (_subscribe: unknown, snapshot: () => unknown) => snapshot());
});
afterEach(() => { globalThis.fetch = originalFetch; mock.restoreAll(); });

test('controller failure removes healthy card/navbar indication without stopping Mininet', () => {
  useSDNStore.getState().handleWebSocketMessage({ event_type: 'CONTROLLER_STATUS', controller: 'reactive',
    status: 'FAILED', exit_code: -9, pid: 123, error: 'Managed Ryu exited unexpectedly with code -9' });
  assert.equal(useSDNStore.getState().controllerStatus, 'FAILED');
  assert.equal(useSDNStore.getState().simulationState, 'RUNNING');
  assert.equal(useSDNStore.getState().controllers[0].exit_code, -9);
  const navbar = renderToStaticMarkup(<TopNavbar />);
  assert.match(navbar, /MININET RUNNING \/ CONTROLLER FAILED/);
  assert.doesNotMatch(navbar, /SIMULATION RUNNING/);
  const cards = renderToStaticMarkup(<ControllersView />);
  assert.match(cards, /FAILED/);
  assert.doesNotMatch(cards, /ACTIVE RUNNING|Currently Controlling Datapath/);
});

test('late READY REST reply cannot overwrite a newer failure WebSocket message', async () => {
  const resolve: ((value: Response) => void)[] = [];
  globalThis.fetch = (() => new Promise<Response>((done) => resolve.push(done))) as typeof fetch;
  const old = useSDNStore.getState().fetchControllers();
  useSDNStore.getState().handleWebSocketMessage({ event_type: 'CONTROLLER_STATUS', controller: 'reactive', status: 'FAILED' });
  resolve[0](new Response(JSON.stringify([controller])));
  await old;
  assert.equal(useSDNStore.getState().controllerStatus, 'FAILED');
  assert.equal(useSDNStore.getState().controllers[0].status, 'FAILED');
});

test('reconnect hydrates failed health separately from running simulation', () => {
  useSDNStore.getState().handleWebSocketMessage({ event_type: 'INITIAL_STATE', controller: 'reactive',
    controller_status: 'FAILED', simulation_state: 'RUNNING' });
  assert.equal(useSDNStore.getState().controllerStatus, 'FAILED');
  assert.equal(useSDNStore.getState().simulationState, 'RUNNING');
});

test('fresh READY update restores healthy presentation', () => {
  useSDNStore.getState().handleWebSocketMessage({ event_type: 'CONTROLLER_STATUS', controller: 'reactive', status: 'FAILED' });
  useSDNStore.getState().handleWebSocketMessage({ event_type: 'CONTROLLER_STATUS', controller: 'reactive', status: 'READY' });
  assert.equal(useSDNStore.getState().controllerStatus, 'READY');
  assert.match(renderToStaticMarkup(<ControllersView />), /ACTIVE RUNNING/);
});
