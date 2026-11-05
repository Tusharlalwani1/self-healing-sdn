import React from 'react';
import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { LandingPage } from '../src/pages/LandingPage';
import { dashboardPages, dashboardPath, tabFromPath } from '../src/services/navigation';
import { layoutTopology } from '../src/services/topologyLayout';
import { ExecutionTimeline } from '../src/components/experiments/ExecutionTimeline';
import type { TopologyNode, TopologyLink } from '../src/types';
import { ExperimentLabView } from '../src/pages/ExperimentLabView';
import { SwitchInspectorModal } from '../src/components/modals/SwitchInspectorModal';
import { useSDNStore } from '../src/stores/sdnStore';

test('all nine navigation destinations round-trip, including trailing slash and overview', () => {
  for (const tab of Object.keys(dashboardPages) as (keyof typeof dashboardPages)[]) {
    assert.equal(tabFromPath(dashboardPath(tab)), tab);
    assert.equal(tabFromPath(dashboardPath(tab) + '/'), tab);
  }
  for (const path of ['/', '/other', '/dashboard/no-such-page', '/dashboard/constructor', '/dashboardfoo']) assert.equal(tabFromPath(path), null);
});
test('public landing labels its illustration and preserves architectural/measurement boundaries', () => {
  const html = renderToStaticMarkup(<LandingPage/>);
  assert.match(html, /Illustration · not live telemetry/);
  assert.match(html, /Launch Control Center/);
  assert.match(html, /href="\/dashboard"/);
  assert.match(html, /without automatic rerouting/);
  assert.match(html, /controller processing with network outage or local switching time/);
  assert.doesNotMatch(html, /SLA-aware|Sign up|Pricing|99\.9%/);
});
test('layout includes every node without overlaps, unknown names or disconnected components', () => {
  const nodes: TopologyNode[] = Array.from({length:24}, (_,i) => ({id:`node-${i}`,name:`node-${i}`,type:i===0?'host':'switch',ports:{}}));
  const links = nodes.slice(1,20).map((n,i) => ({src:nodes[Math.floor(i/2)].name,dst:n.name})) as TopologyLink[];
  const layout = layoutTopology(nodes,links);
  assert.equal(Object.keys(layout).length,24);
  assert.equal(new Set(Object.values(layout).map(p=>`${p.x},${p.y}`)).size,24);
  for (const p of Object.values(layout)) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
  assert.deepEqual(layout, layoutTopology([...nodes].reverse(),[...links].reverse()));
  assert.deepEqual(layoutTopology([],[]),{});
});
test('execution timeline highlights only the reported stage and does not invent recovery/cleanup milestones', () => {
  const html=renderToStaticMarkup(<ExecutionTimeline status="FAILURE_INJECTED"/>);
  assert.equal((html.match(/aria-current="step"/g)||[]).length,1);
  assert.match(html,/aria-current="step">Failure injected/);
  assert.doesNotMatch(html,/Recovery verified|Cleanup complete/);
  const pending=renderToStaticMarkup(<ExecutionTimeline status="CANCELLING"/>);
  assert.doesNotMatch(pending,/aria-current="step"/);
  assert.match(pending,/Waiting for backend cleanup/);
});
test('failed experiment terminal message stays visible instead of an idle success presentation', () => {
  const previous = useSDNStore.getState();
  mock.method(React, 'useSyncExternalStore', (_subscribe: unknown, snapshot: () => unknown) => snapshot());
  try {
    useSDNStore.setState({experimentRunning:false,experimentProgress:{status:'FAILED',message:'Traffic worker unavailable'},experimentsHistory:[]});
    const html=renderToStaticMarkup(<ExperimentLabView/>);
    assert.match(html,/Traffic worker unavailable/);
    assert.match(html,/Failed or cancelled runs are not successful benchmark samples/);
    assert.doesNotMatch(html,/initiate a controlled failure benchmark/);
  } finally { useSDNStore.setState(previous); mock.restoreAll(); }
});
test('host inspection exposes only reported host data and missing fields stay N/A', () => {
  const html=renderToStaticMarkup(<SwitchInspectorModal node={{id:'custom',name:'custom',type:'host',ports:{}}} onClose={()=>{}}/>);
  assert.match(html,/Host custom/);assert.match(html,/N\/A/);
  assert.doesNotMatch(html,/10\.0\.0\.\?/);
  assert.match(html,/aria-label="Close inspector"/);
});
