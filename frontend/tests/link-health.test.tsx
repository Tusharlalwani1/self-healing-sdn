import React from 'react';
import assert from 'node:assert/strict';
import { beforeEach, afterEach, test, mock } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { useSDNStore } from '../src/stores/sdnStore';
import { LinkHealthCard, NetworkHealthSummary } from '../src/components/LinkHealthCard';
import { SoftDegradationPanel } from '../src/components/SoftDegradationPanel';
import { healthAppearance, healthNumber, isHealthSnapshot, type HealthSnapshot } from '../src/services/linkHealth';
import { emptyTopology } from '../src/services/topology';
import { emptyTraffic } from '../src/services/telemetry';

const originalFetch = globalThis.fetch;
const snapshot = (status:'HEALTHY'|'DEGRADED'|'CRITICAL'|'UNKNOWN'='CRITICAL'): HealthSnapshot => ({
  runtime_id:'r1',runtime_revision:1,topology_id:'diamond',controller_generation:'g1',simulation_state:'RUNNING',sequence:1,
  threshold_label:'Project demonstration thresholds',config:{healthy_additional_delay_ms:10,critical_additional_delay_ms:100,healthy_loss_percent:1,critical_loss_percent:10},
  links:[{runtime_id:'r1',runtime_revision:1,topology_id:'diamond',controller_generation:'g1',link_id:'s1-s2',src:'s1',dst:'s2',
    operational_status:'UP',health_status:status,injected:true,configured_additional_delay_ms:100,configured_loss_percent:10,
    observed_loss_percent:3.333333333,observed_avg_rtt_ms:null,sample_count:30,observation_window_sec:2,detected_at:100,sampled_at:102,
    reason:'Kernel-read impairment exceeds threshold.',reason_code:'CRITICAL_QUALITY',measurement_source:'LINUX_TC_NETEM_READBACK_AND_COUNTERS',
    evidence_scope:'TC egress only; not end-to-end ICMP loss or RTT.'}]
});
const emit = (health:unknown, error?:string) => useSDNStore.getState().handleWebSocketMessage({event_type:'LINK_HEALTH',health,error});
beforeEach(()=>{
  mock.method(React,'useSyncExternalStore',(_subscribe:unknown,snapshot:()=>unknown)=>snapshot());
  const topology=emptyTopology();topology.topology_id='diamond';
  topology.nodes=[{id:'s1',name:'s1',type:'switch',ports:{}},{id:'s2',name:'s2',type:'switch',ports:{}},{id:'h1',name:'h1',type:'host',ports:{}}];
  topology.links=[{id:'s1-s2',src:'s1',dst:'s2',status:'UP',src_intf:'s1-eth1',dst_intf:'s2-eth1'},
    {id:'h1-s1',src:'h1',dst:'s1',status:'UP',src_intf:'h1-eth0',dst_intf:'s1-eth2'}];
  useSDNStore.setState({runtimeId:'r1',runtimeRevision:1,controllerGeneration:'g1',simulationState:'RUNNING',topology,
    linkHealth:null,linkHealthError:null,experimentRunning:false,softDegradationLinkKey:null,
    softDegradationDraft:{additionalDelayMs:'100',lossPercent:'0'},trafficStats:emptyTraffic()});
});
afterEach(()=>{globalThis.fetch=originalFetch;mock.restoreAll();});

test('health displays text, configured and observed evidence separately with null RTT',()=>{
  emit(snapshot());
  const html=renderToStaticMarkup(<LinkHealthCard src="s1" dst="s2"/>);
  for(const text of ['UP / CRITICAL','Kernel-read additional delay','100 ms','Kernel-read configured loss','10%',
    'Measured TC egress loss','3.33%','Measured per-link RTT','N/A','Technical details']) assert.ok(html.includes(text),text);
  assert.ok(!html.includes('<details open'));
  assert.equal(healthNumber(null),'N/A');assert.equal(healthNumber(30.90000000002,' ms'),'30.9 ms');
});
test('all states remain accessible by text and distinct patterns; hard DOWN wins',()=>{
  for(const status of ['HEALTHY','DEGRADED','CRITICAL','UNKNOWN'] as const){
    emit(snapshot(status));
    assert.ok(renderToStaticMarkup(<LinkHealthCard src="s1" dst="s2"/>).includes('UP / '+status));
    assert.equal(healthAppearance('UP',status).label,'UP / '+status);
  }
  assert.notEqual(healthAppearance('UP','CRITICAL').dash,healthAppearance('UP','DEGRADED').dash);
  const topology=structuredClone(useSDNStore.getState().topology);topology.links[0].status='DOWN';useSDNStore.setState({topology});
  const html=renderToStaticMarkup(<LinkHealthCard src="s1" dst="s2"/>);
  assert.ok(html.includes('>DOWN<'));assert.ok(!html.includes('3.33%'));
  assert.equal(healthAppearance('DOWN','HEALTHY').label,'DOWN');
});
test('summary counts only runtime inter-switch links and unmeasured is UNKNOWN',()=>{
  let html=renderToStaticMarkup(<NetworkHealthSummary/>);
  assert.ok(html.includes('UNKNOWN'));assert.ok(html.includes('host links excluded'));
  emit(snapshot());html=renderToStaticMarkup(<NetworkHealthSummary/>);
  assert.match(html,/CRITICAL<\/dt><dd>1/);
});
test('dynamic selector excludes hosts and blocks stopped, DOWN and experiment mutations',()=>{
  let html=renderToStaticMarkup(<SoftDegradationPanel/>);
  assert.ok(html.includes('Soft degradation / link remains UP'));assert.ok(html.includes('s1 ↔ s2 (UP)'));
  assert.ok(!html.includes('h1 ↔ s1'));assert.ok(html.includes('Restore All Degradations'));
  useSDNStore.setState({experimentRunning:true});html=renderToStaticMarkup(<SoftDegradationPanel/>);
  assert.match(html,/disabled="">Inject Degradation/);
});
test('quality request carries existing runtime ownership and propagates API failure',async()=>{
  let body:any;
  globalThis.fetch=(async(url,options)=>{
    if(String(url).includes('/degradation/inject')){body=JSON.parse(String(options?.body));return new Response(JSON.stringify({detail:{message:'Real tc failure'}}),{status:502});}
    return new Response(JSON.stringify(snapshot()));
  }) as typeof fetch;
  await assert.rejects(useSDNStore.getState().changeLinkQuality('inject','s1','s2',100,10),/Real tc failure/);
  assert.deepEqual(body,{runtime_id:'r1',runtime_revision:1,src:'s1',dst:'s2',additional_delay_ms:100,loss_percent:10});
});
test('old runtime, topology, generation, sequence and malformed WS samples cannot mutate current health',()=>{
  const s=snapshot();emit(s);const accepted=useSDNStore.getState().linkHealth;
  for(const stale of [{...s,runtime_id:'old'},{...s,runtime_revision:0},{...s,topology_id:'multipath_mesh'},
    {...s,controller_generation:'old'},{...s,sequence:0},{...s,links:[{...s.links[0],health_status:'FABRICATED'}]}]){
    emit(stale);assert.equal(useSDNStore.getState().linkHealth,accepted);
  }
  emit({...s,controller_generation:'old'},'Old failure');
  assert.equal(useSDNStore.getState().linkHealth,accepted);
  assert.equal(isHealthSnapshot({...s,links:[{...s.links[0],operational_status:'DOWN'}]}),false);
});
test('late REST failure cannot erase a newer WS snapshot',async()=>{
  let reject!:(e:Error)=>void;
  globalThis.fetch=(()=>new Promise((_resolve,j)=>{reject=j;})) as typeof fetch;
  const pending=useSDNStore.getState().fetchLinkHealth();
  emit({...snapshot(),sequence:5});reject(new Error('Old request failed'));await pending;
  assert.equal(useSDNStore.getState().linkHealth?.sequence,5);
  assert.equal(useSDNStore.getState().linkHealthError,null);
});
test('runtime change and stopped UI do not render old health as current',()=>{
  emit(snapshot());useSDNStore.setState({runtimeId:'r2',runtimeRevision:2});
  assert.ok(!renderToStaticMarkup(<LinkHealthCard src="s1" dst="s2"/>).includes('3.33%'));
  useSDNStore.setState({simulationState:'STOPPED'});
  assert.ok(!renderToStaticMarkup(<NetworkHealthSummary/>).includes('<dd>1</dd>'));
});

function meshSelection() {
  const topology=structuredClone(useSDNStore.getState().topology);
  topology.topology_id='multipath_mesh';
  topology.nodes.push({id:'s5',name:'s5',type:'switch',ports:{}});
  topology.links.push({id:'s5-s2',src:'s2',dst:'s5',status:'UP',src_intf:'s2-eth2',dst_intf:'s5-eth1'});
  useSDNStore.setState({topology});
  useSDNStore.getState().selectSoftDegradationLink('s2-s5');
}
function assertMeshSelected() {
  const html=renderToStaticMarkup(<SoftDegradationPanel/>);
  assert.match(html,/<option value="s2-s5" selected="">/);
  assert.ok(html.includes('s2 ↔ s5 / Link quality'));
  assert.equal(useSDNStore.getState().softDegradationLinkKey,'s2-s5');
}
function assertLossDraft() {
  const html=renderToStaticMarkup(<SoftDegradationPanel/>);
  assert.match(html,/Additional delay \(ms\)<input[^>]*value="0"/);
  assert.match(html,/Configured packet loss \(%\)<input[^>]*value="10"/);
  assert.deepEqual(useSDNStore.getState().softDegradationDraft,{additionalDelayMs:'0',lossPercent:'10'});
}
test('soft-degradation endpoint selection survives navigation and remount with current evidence',()=>{
  meshSelection();assertMeshSelected();
  useSDNStore.getState().setTab('traffic');
  useSDNStore.getState().setTab('simulator');
  const health=snapshot();health.topology_id='multipath_mesh';
  health.links=[{...health.links[0],topology_id:'multipath_mesh',link_id:'s2-s5',src:'s2',dst:'s5'}];
  emit(health);assertMeshSelected();
  const html=renderToStaticMarkup(<SoftDegradationPanel/>);
  assert.ok(html.includes('UP / CRITICAL'));assert.ok(html.includes('100 ms'));
});
test('traffic lifecycle, health WS/polling, reordering and rerenders preserve soft link selection',async()=>{
  meshSelection();
  useSDNStore.getState().updateSoftDegradationDraft({additionalDelayMs:'0',lossPercent:'10'});
  for(const [event_type,active] of [['TRAFFIC_STARTED',true],['TRAFFIC_TICK',true],['TRAFFIC_COMPLETED',false]] as const){
    useSDNStore.getState().handleWebSocketMessage({event_type,stats:{...emptyTraffic(),runtime_id:'r1',job_id:'job',traffic_sequence:1,active,transmitted:500,received:500}});
    assertMeshSelected();
    assertLossDraft();
  }
  const health=snapshot();health.topology_id='multipath_mesh';
  health.links=[{...health.links[0],topology_id:'multipath_mesh',link_id:'s2-s5',src:'s2',dst:'s5'}];
  emit(health);assertMeshSelected();assertLossDraft();
  globalThis.fetch=(async()=>new Response(JSON.stringify({...health,sequence:2}))) as typeof fetch;
  await useSDNStore.getState().fetchLinkHealth();assertMeshSelected();assertLossDraft();
  const topology=structuredClone(useSDNStore.getState().topology);topology.links.reverse();useSDNStore.setState({topology});
  assertMeshSelected();
  useSDNStore.setState({runtimeId:'r2',runtimeRevision:2});
  assertMeshSelected(); // A replacement runtime may still contain these endpoints.
  assertLossDraft();
});
test('unavailable selected endpoints fall back to valid inter-switch link without mutating network state',()=>{
  meshSelection();
  useSDNStore.getState().updateSoftDegradationDraft({additionalDelayMs:'0',lossPercent:'10'});
  const topology=emptyTopology();topology.topology_id='diamond';
  topology.nodes=[{id:'s1',name:'s1',type:'switch',ports:{}},{id:'s2',name:'s2',type:'switch',ports:{}}];
  topology.links=[{id:'s1-s2',src:'s1',dst:'s2',status:'UP',src_intf:'s1-eth1',dst_intf:'s2-eth1'}];
  useSDNStore.setState({runtimeId:'r2',runtimeRevision:2,topology});
  const before=structuredClone(topology);
  const html=renderToStaticMarkup(<SoftDegradationPanel/>);
  assert.match(html,/<option value="s1-s2" selected="">/);
  assert.ok(html.includes('s1 ↔ s2 / Link quality'));
  assert.deepEqual(useSDNStore.getState().topology,before);
  assertLossDraft();
  useSDNStore.setState({topology:emptyTopology()});
  assert.ok(renderToStaticMarkup(<SoftDegradationPanel/>).includes('No runtime links'));
});

test('loss-only draft and selected endpoints survive navigation independently of authoritative kernel evidence',()=>{
  meshSelection();
  assert.deepEqual(useSDNStore.getState().softDegradationDraft,{additionalDelayMs:'100',lossPercent:'0'});
  useSDNStore.getState().updateSoftDegradationDraft({additionalDelayMs:'0'});
  useSDNStore.getState().updateSoftDegradationDraft({lossPercent:'10'});
  assertMeshSelected();assertLossDraft();
  useSDNStore.getState().setTab('traffic');useSDNStore.getState().setTab('simulator');
  assertMeshSelected();assertLossDraft();
  const health=snapshot();health.topology_id='multipath_mesh';
  health.links=[{...health.links[0],topology_id:'multipath_mesh',link_id:'s2-s5',src:'s2',dst:'s5'}];
  emit(health);assertLossDraft();
  // The existing fixture has 100ms kernel delay; an unapplied draft stays 0ms.
  assert.ok(renderToStaticMarkup(<SoftDegradationPanel/>).includes('100 ms'));
  assert.equal(useSDNStore.getState().linkHealth?.links[0].configured_additional_delay_ms,100);
});
test('editing, restoring and rendering draft fields never sends an impairment request',()=>{
  const fetch=mock.fn(async()=>new Response('{}'));globalThis.fetch=fetch;
  meshSelection();
  useSDNStore.getState().updateSoftDegradationDraft({additionalDelayMs:'0',lossPercent:'10'});
  assertLossDraft();
  useSDNStore.getState().setTab('traffic');useSDNStore.getState().setTab('simulator');
  assertLossDraft();assertMeshSelected();
  assert.equal(fetch.mock.callCount(),0);
  // Blank/incomplete user input is retained and validated rather than defaulted.
  useSDNStore.getState().updateSoftDegradationDraft({additionalDelayMs:''});
  assert.match(renderToStaticMarkup(<SoftDegradationPanel/>),/disabled="">Inject Degradation/);
  assert.equal(useSDNStore.getState().softDegradationDraft.additionalDelayMs,'');
  assert.equal(fetch.mock.callCount(),0);
});
