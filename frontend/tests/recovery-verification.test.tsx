import React from 'react';
import assert from 'node:assert/strict';
import { beforeEach, afterEach, test, mock } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { useSDNStore } from '../src/stores/sdnStore';
import { RecoveryVerificationCard } from '../src/components/RecoveryVerificationCard';
import { emptyTopology } from '../src/services/topology';
import type { RecoveryVerification } from '../src/types';

const originalFetch = globalThis.fetch;
const record = (patch: Partial<RecoveryVerification> = {}): RecoveryVerification => ({
  verification_id:'v1',incident_id:null,runtime_id:'r1',runtime_revision:1,topology_id:'multipath_mesh',
  controller_mode:'reactive',controller_generation:'g1',experiment_id:null,job_id:'job',
  source_host:'h1',destination_host:'h2',failed_link:['s2','s5'],failure_timestamp:100,
  verification_status:'VERIFYING',verification_started_at:100,verification_completed_at:null,
  verification_duration_sec:null,post_recovery_tx:null,post_recovery_rx:null,post_recovery_loss_percent:null,
  post_recovery_avg_rtt_ms:null,post_recovery_min_rtt_ms:null,post_recovery_max_rtt_ms:null,
  reachability_restored:null,stability_passed:null,path_verification_status:'UNAVAILABLE',
  path_verification_reason:'No observed path',reason_code:'OBSERVING',reason:'Collecting real evidence',
  evidence_scope:'Post-failure window, not local FF switching time',...patch,
});
const emit = (value: RecoveryVerification) => useSDNStore.getState().handleWebSocketMessage({event_type:'RECOVERY_VERIFICATION',verification:value});
beforeEach(()=>{
  mock.method(React, 'useSyncExternalStore', (_subscribe: unknown, snapshot: () => unknown) => snapshot());
  useSDNStore.setState({verification:null,verificationError:null,controllerGeneration:'g1',runtimeId:'r1',runtimeRevision:1,
    simulationState:'RUNNING',activeController:'reactive',controllerStatus:'READY',topology:emptyTopology()});
  globalThis.fetch=(async()=>new Response('[]')) as typeof fetch;
});
afterEach(()=>{globalThis.fetch=originalFetch;mock.restoreAll();});

test('backend transitions render all five states without frontend classification',()=>{
  for(const verification_status of ['NOT_STARTED','VERIFYING','VERIFIED','DEGRADED','FAILED'] as const){
    const value=record({verification_status});
    const html=renderToStaticMarkup(<RecoveryVerificationCard verification={value}/>);
    assert.ok(html.includes('Post-Recovery Avg RTT'));
    assert.ok(html.includes(verification_status.replaceAll('_',' ')));
    assert.ok(html.includes('UNAVAILABLE'));
  }
});
test('no evidence renders unavailable loss and RTT rather than zero',()=>{
  const html=renderToStaticMarkup(<RecoveryVerificationCard verification={record()}/>);
  assert.ok(html.includes('N/A / N/A'));assert.ok(html.includes('Unavailable'));
  assert.ok(!html.includes('0%'));assert.ok(!html.includes('0 ms'));
});
test('verification metrics display at most two decimals without mutating evidence',()=>{
  for (const [rtt, expected] of [[27.051428571428566,'27.05 ms'],[30.900000000000002,'30.9 ms'],[32.15249999999999,'32.15 ms']] as const) {
    const value=Object.freeze(record({post_recovery_avg_rtt_ms:rtt,
      post_recovery_loss_percent:0.2976190476190476,verification_duration_sec:3.5569293489970732}));
    const original=JSON.stringify(value);
    const html=renderToStaticMarkup(<RecoveryVerificationCard verification={value}/>);
    assert.ok(html.includes(`>${expected}</dd>`));
    assert.ok(html.includes('>0.3%</dd>'));
    assert.ok(html.includes('>3.56 s</dd>'));
    assert.ok(!html.includes(String(rtt)));
    assert.equal(JSON.stringify(value),original);
  }
});
test('verification display preserves genuine zeros and unavailable values',()=>{
  const html=renderToStaticMarkup(<RecoveryVerificationCard verification={record({
    post_recovery_avg_rtt_ms:0,post_recovery_loss_percent:0,verification_duration_sec:0})}/>);
  for (const expected of ['0 ms','0%','0 s']) assert.ok(html.includes(`>${expected}</dd>`));
  assert.ok(!html.includes('>0.00'));
  const missing=renderToStaticMarkup(<RecoveryVerificationCard verification={record()}/>);
  assert.ok(!missing.includes('>0 ms</dd>'));
  assert.ok(!missing.includes('>0%</dd>'));
  assert.ok(missing.includes('>N/A</dd>'));
});
test('historical experiments without Phase 3 evidence are not assigned a result',()=>{
  const html=renderToStaticMarkup(<RecoveryVerificationCard verification={null}/>);
  assert.ok(html.includes('NOT RECORDED'));
  assert.ok(!html.includes('VERIFIED</span>'));
});
test('current WS evidence is accepted but old runtime and generation are rejected',()=>{
  emit(record());
  emit(record({runtime_id:'old',verification_status:'VERIFIED'}));
  emit(record({controller_generation:'old',verification_status:'VERIFIED'}));
  assert.equal(useSDNStore.getState().verification?.verification_status,'VERIFYING');
});
test('malformed verification payload cannot crash monitoring or claim success',()=>{
  useSDNStore.getState().handleWebSocketMessage({event_type:'RECOVERY_VERIFICATION',verification:{...record(),failed_link:null}});
  useSDNStore.getState().handleWebSocketMessage({event_type:'RECOVERY_VERIFICATION',verification:{...record(),reachability_restored:'yes'}});
  assert.equal(useSDNStore.getState().verification,null);
});
test('late VERIFYING and older incident cannot overwrite final service result',()=>{
  emit(record({verification_status:'FAILED'}));emit(record());
  emit(record({verification_id:'old',failure_timestamp:99,verification_status:'VERIFIED'}));
  assert.equal(useSDNStore.getState().verification?.verification_status,'FAILED');
});
test('late REST snapshot cannot overwrite a newer WS final result',async()=>{
  let resolve!: (value: Response)=>void;
  globalThis.fetch=(()=>new Promise<Response>(r=>{resolve=r;})) as typeof fetch;
  const request=useSDNStore.getState().fetchVerification();
  emit(record({verification_status:'VERIFIED'}));
  resolve(new Response(JSON.stringify(record())));await request;
  assert.equal(useSDNStore.getState().verification?.verification_status,'VERIFIED');
});
test('older overlapping verification REST request cannot replace a newer result',async()=>{
  const replies: ((r: Response)=>void)[]=[];
  globalThis.fetch=(()=>new Promise<Response>(r=>replies.push(r))) as typeof fetch;
  const old=useSDNStore.getState().fetchVerification();
  const fresh=useSDNStore.getState().fetchVerification();
  replies[1](new Response(JSON.stringify(record({verification_status:'VERIFIED'}))));await fresh;
  replies[0](new Response(JSON.stringify(record())));await old;
  assert.equal(useSDNStore.getState().verification?.verification_status,'VERIFIED');
});
test('new controller generation clears old evidence and rejects old events',()=>{
  emit(record({verification_status:'VERIFIED'}));
  useSDNStore.getState().handleWebSocketMessage({event_type:'CONTROLLER_STATUS',controller:'reactive',status:'STARTING',controller_generation:'g2'});
  emit(record({verification_status:'VERIFIED'}));
  assert.equal(useSDNStore.getState().verification,null);
});
test('a failed controller cannot resurrect VERIFIED from a delayed same-generation message',()=>{
  emit(record({verification_status:'VERIFIED'}));
  useSDNStore.getState().handleWebSocketMessage({event_type:'CONTROLLER_STATUS',controller:'reactive',status:'FAILED',controller_generation:'g1'});
  emit(record({verification_status:'VERIFIED'}));
  assert.equal(useSDNStore.getState().verification,null);
});
test('reconnect restores only owned current evidence; stopped snapshot clears it',()=>{
  const snapshot={event_type:'INITIAL_STATE',runtime_id:'r1',runtime_revision:1,controller:'reactive',
    controller_generation:'g1',controller_status:'READY',simulation_state:'RUNNING',verification:record({verification_status:'VERIFIED'})};
  useSDNStore.getState().handleWebSocketMessage(snapshot);
  assert.equal(useSDNStore.getState().verification?.verification_status,'VERIFIED');
  useSDNStore.getState().handleWebSocketMessage({...snapshot,simulation_state:'STOPPED'});
  assert.equal(useSDNStore.getState().verification,null);
});
test('verification API error is visible without inventing a service result',async()=>{
  globalThis.fetch=(async()=>new Response(JSON.stringify({detail:'Verification unavailable'}),{status:503})) as typeof fetch;
  await useSDNStore.getState().fetchVerification();
  assert.equal(useSDNStore.getState().verification,null);
  assert.match(renderToStaticMarkup(<RecoveryVerificationCard/>),/Verification API error: Verification unavailable/);
});
