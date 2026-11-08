import React from 'react';
import assert from 'node:assert/strict';
import { beforeEach, afterEach, test, mock } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { useSDNStore } from '../src/stores/sdnStore';
import { AdaptiveHealingCard } from '../src/components/AdaptiveHealingCard';
import { SoftDegradationPanel } from '../src/components/SoftDegradationPanel';
import { isAdaptive, pathContains, type AdaptiveCycle } from '../src/services/adaptive';
import { emptyTopology, mergeTopology } from '../src/services/topology';
import { emptyTraffic } from '../src/services/telemetry';
import { controllerComparison } from '../src/services/metrics';

const originalFetch = globalThis.fetch;
function fixture(patch: Partial<AdaptiveCycle> = {}): AdaptiveCycle {
  const candidate={candidate_id:'h1>s1>s3>s4>h2',path:['h1','s1','s3','s4','h2'],components:{configured_delay_sum_ms:0,worst_observed_tc_loss_percent:null,policy_cost:12.123456},reason:'Fixture deterministic choice'};
  const verification={verification_status:'VERIFIED',post_recovery_loss_percent:0,post_recovery_avg_rtt_ms:31.051428571};
  return {cycle_id:'c1',runtime_id:'r1',runtime_revision:1,topology_id:'diamond',controller_generation:'g1',job_id:'j1',traffic_sequence:1,
    created_at:1,sequence:2,status:'COMPLETED',outcome:'SATISFIED',trigger:'HARD_FAILURE',trigger_link:['s1','s2'],reason:'Recovery VERIFIED and service intent SATISFIED.',
    intent_snapshot:{name:'Standard'},selected_candidate:candidate,installed_path:candidate.path,observed_path:null,
    path_scope:'Computed candidates and installed rules are not observed dataplane paths.',config:{max_attempts:3},candidates:[candidate],
    attempts:[{attempt:1,status:'COMPLETED',candidate,verification,intent_evaluation:{evaluation_status:'SATISFIED'}}],...patch};
}
beforeEach(()=>{
  mock.method(React,'useSyncExternalStore',(_subscribe:unknown,snapshot:()=>unknown)=>snapshot());
  const topology=emptyTopology();topology.topology_id='diamond';
  useSDNStore.setState({adaptive:null,adaptiveError:null,runtimeId:'r1',runtimeRevision:1,controllerGeneration:'g1',
    activeController:'adaptive',controllerStatus:'READY',simulationState:'RUNNING',topology,trafficStats:{...emptyTraffic(),job_id:'j1',traffic_sequence:1}});
});
afterEach(()=>{globalThis.fetch=originalFetch;mock.restoreAll();});
const emit=(v:unknown)=>useSDNStore.getState().handleWebSocketMessage({event_type:'ADAPTIVE_HEALING',adaptive:v});

test('adaptive contract accepts fourth strategy without inventing observed paths',()=>{
  assert.ok(isAdaptive(fixture()));assert.ok(!isAdaptive({}));
  for(const broken of [{...fixture(),config:null},{...fixture(),attempts:[{}]},
    {...fixture(),candidates:[{...fixture().candidates[0],components:{risk:'invalid'}}]}, {...fixture(),observed_path:['invented']}]) assert.ok(!isAdaptive(broken));
  assert.equal(mergeTopology(emptyTopology(),{active_controller:'adaptive'}).active_controller,'adaptive');
  assert.ok(pathContains(fixture().installed_path,'s3','s1'));assert.ok(!pathContains(fixture().installed_path,'s1','s2'));
});
test('compact card exposes result and collapsed policy/provenance with null semantics',()=>{
  emit(fixture());const html=renderToStaticMarkup(<AdaptiveHealingCard/>);
  assert.ok(html.includes('service-intent-card adaptive-healing-card'));
  for(const text of ['ADAPTIVE HEALING','Standard Intent','Adaptive Strategy','SATISFIED','Attempt 1 of 3','TRIGGER','DECISION','RECOVERY','INTENT','0% post-recovery loss','31.05 ms RTT','HEALING COMPLETE','RECOVERY PATH','Installed','Observed dataplane path','Unavailable','N/A','12.12'])assert.ok(html.includes(text),text);
  assert.ok(html.includes('<details'));assert.ok(!html.includes('<details open'));assert.ok(!html.includes('12.123456'));
});
test('presentation preserves evidence and distinguishes computed installed and unavailable observed paths',()=>{
  const value=fixture();const before=JSON.stringify(value);emit(value);
  const html=renderToStaticMarkup(<AdaptiveHealingCard/>);
  assert.ok(html.includes('Computed candidate'));assert.ok(html.includes('Installed route nodes'));
  assert.ok(html.includes('Installed rules do not establish an observed dataplane path.'));
  assert.ok(!html.includes('Actual Path'));assert.ok(!html.includes('31.051428571'));
  assert.equal(JSON.stringify(value),before);
});
test('no cycle and missing measurements remain unavailable rather than fabricated zero',()=>{
  let html=renderToStaticMarkup(<AdaptiveHealingCard/>);assert.ok(html.includes('NOT STARTED'));assert.ok(!html.includes('HEALING COMPLETE'));
  const value=fixture({installed_path:null});value.attempts[0].verification={verification_status:'FAILED'};emit(value);
  html=renderToStaticMarkup(<AdaptiveHealingCard/>);assert.ok(html.includes('Measurements unavailable'));
  assert.ok(!html.includes('0% post-recovery loss'));assert.ok(!html.includes(' ms RTT'));assert.ok(!html.includes('Installed route nodes'));
});
test('in-progress and second-attempt views explain the closed loop without changing outcome',()=>{
  const value=fixture({outcome:null,status:'VERIFYING'});value.attempts[0].verification=null;value.attempts[0].intent_evaluation=null;emit(value);
  let html=renderToStaticMarkup(<AdaptiveHealingCard/>);assert.ok(html.includes('HEALING IN PROGRESS'));assert.ok(html.includes('VERIFYING'));assert.ok(!html.includes('HEALING COMPLETE'));
  const retry=fixture({outcome:null,status:'VERIFYING'});retry.attempts[0].intent_evaluation={evaluation_status:'VIOLATED'};
  retry.attempts.push({...retry.attempts[0],attempt:2,verification:null,intent_evaluation:null});emit(retry);
  html=renderToStaticMarkup(<AdaptiveHealingCard/>);assert.ok(html.includes('RE-HEALING'));assert.ok(html.includes('Attempt 2 of 3'));
  assert.ok(html.includes('previous attempt restored connectivity but violated the service intent'));
});
test('terminal warning and failure summaries use distinct semantic tones',()=>{
  for(const [outcome,css,title] of [['BEST_ACHIEVABLE','warning','BEST ACHIEVABLE'],['ESCALATED','warning','OPERATOR REVIEW REQUIRED'],['FAILED','bad','RECOVERY NOT VERIFIED']] as const){
    emit(fixture({outcome}));const html=renderToStaticMarkup(<AdaptiveHealingCard/>);
    assert.ok(html.includes(`adaptive-outcome-${css}`));assert.ok(html.includes(title));assert.ok(!html.includes('HEALING COMPLETE'));
  }
});
test('old three strategies do not show adaptive card',()=>{
  for(const activeController of ['baseline','reactive','fast_failover'] as const){useSDNStore.setState({activeController});emit(fixture());assert.equal(useSDNStore.getState().adaptive,null);assert.equal(renderToStaticMarkup(<AdaptiveHealingCard/>),'');}
});
test('soft panel explains automatic Adaptive reaction and retains detection-only wording in Reactive',()=>{
  assert.ok(renderToStaticMarkup(<SoftDegradationPanel/>).includes('Adaptive mode may automatically reroute and verify service'));
  useSDNStore.setState({activeController:'reactive'});
  const html=renderToStaticMarkup(<SoftDegradationPanel/>);assert.ok(html.includes('Detection only:'));assert.ok(!html.includes('Adaptive mode may automatically'));
});
test('rejects stale runtime topology generation job sequence and malformed messages',()=>{
  for(const value of [fixture({runtime_id:'old'}),fixture({runtime_revision:0}),fixture({topology_id:'multipath_mesh'}),fixture({controller_generation:'old'}),fixture({traffic_sequence:0}),{},null])emit(value);
  assert.equal(useSDNStore.getState().adaptive,null);
});
test('rejects late REST overwrite after newer websocket transition',async()=>{
  let resolve!:(value:Response)=>void;globalThis.fetch=()=>new Promise(r=>{resolve=r;});
  const pending=useSDNStore.getState().fetchAdaptive();emit(fixture({sequence:5}));
  resolve(new Response(JSON.stringify(fixture({sequence:2})),{status:200}));await pending;
  assert.equal(useSDNStore.getState().adaptive?.sequence,5);
});
test('late API failure does not erase newer websocket result',async()=>{
  let resolve!:(value:Response)=>void;globalThis.fetch=()=>new Promise(r=>{resolve=r;});
  const pending=useSDNStore.getState().fetchAdaptive();emit(fixture());
  resolve(new Response(JSON.stringify({detail:'Worker unavailable'}),{status:503}));await pending;
  assert.equal(useSDNStore.getState().adaptive?.outcome,'SATISFIED');assert.equal(useSDNStore.getState().adaptiveError,null);
});
test('API failure displayed truthfully and empty current has no fake result',async()=>{
  globalThis.fetch=async()=>new Response(JSON.stringify({detail:'Worker unavailable'}),{status:503});await useSDNStore.getState().fetchAdaptive();
  assert.ok(renderToStaticMarkup(<AdaptiveHealingCard/>).includes('Worker unavailable'));
  globalThis.fetch=async()=>new Response('null',{status:200});await useSDNStore.getState().fetchAdaptive();assert.equal(useSDNStore.getState().adaptive,null);
});
test('older cycle and older transition cannot overwrite current result',()=>{
  emit(fixture({created_at:3,sequence:5}));emit(fixture({created_at:1,cycle_id:'old'}));emit(fixture({created_at:3,sequence:2}));
  assert.equal(useSDNStore.getState().adaptive?.sequence,5);
});
test('controller stop clears live adaptive evidence',()=>{
  emit(fixture());useSDNStore.getState().handleWebSocketMessage({event_type:'CONTROLLER_STATUS',controller:'adaptive',status:'STOPPED',controller_generation:'g1'});
  assert.equal(useSDNStore.getState().adaptive,null);
});
test('REST controller reconciliation clears failed or replaced Adaptive evidence without WebSocket',async()=>{
  emit(fixture());
  globalThis.fetch=async()=>new Response(JSON.stringify([{id:'adaptive',is_active:true,status:'FAILED',controller_generation:'g1',features:[]}]),{status:200});
  await useSDNStore.getState().fetchControllers();assert.equal(useSDNStore.getState().adaptive,null);
  useSDNStore.setState({controllerStatus:'READY'});emit(fixture());
  globalThis.fetch=async()=>new Response(JSON.stringify([{id:'adaptive',is_active:true,status:'READY',controller_generation:'g2',features:[]}]),{status:200});
  await useSDNStore.getState().fetchControllers();assert.equal(useSDNStore.getState().adaptive,null);assert.equal(useSDNStore.getState().controllerGeneration,'g2');
});
test('initial reconnect hydrates lifecycle before adopting adaptive evidence',()=>{
  useSDNStore.setState({activeController:null,controllerStatus:'STOPPED',controllerGeneration:null});
  useSDNStore.getState().handleWebSocketMessage({event_type:'INITIAL_STATE',runtime_id:'r1',runtime_revision:1,topology_id:'diamond',
    simulation_state:'RUNNING',controller:'adaptive',controller_status:'READY',controller_generation:'g1',adaptive:fixture()});
  assert.equal(useSDNStore.getState().adaptive?.outcome,'SATISFIED');
});
test('terminal outcomes remain distinct text and do not imply recovery satisfied',()=>{
  for(const outcome of ['BEST_ACHIEVABLE','ESCALATED','FAILED'] as const){emit(fixture({outcome}));assert.ok(renderToStaticMarkup(<AdaptiveHealingCard/>).includes(outcome.replaceAll('_',' ')));}
});
test('analytics includes adaptive only from actual completed experiment measurements',()=>{
  const records=[{controller:'adaptive',status:'COMPLETED',packets_transmitted:100,packets_received:98,packet_loss_percent:2,avg_rtt_ms:31,recovery_duration_ms:null}] as any;
  const [row]=controllerComparison(records);assert.equal(row.controller,'adaptive');assert.equal(row.packetLoss,2);assert.equal(row.processingMs,null);assert.deepEqual(controllerComparison([]),[]);
});
