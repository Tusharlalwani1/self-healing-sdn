import React from 'react';
import assert from 'node:assert/strict';
import { beforeEach, afterEach, test, mock } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { useSDNStore } from '../src/stores/sdnStore';
import { useIntentConfigurationStore } from '../src/stores/intentConfigurationStore';
import { useTrafficConfigurationStore } from '../src/stores/trafficConfigurationStore';
import { ServiceIntentCard } from '../src/components/ServiceIntentCard';
import { ServiceIntentEditor } from '../src/components/ServiceIntentEditor';
import { RecoveryVerificationCard } from '../src/components/RecoveryVerificationCard';
import { customIntentError, intentCounts, intentNumber, type IntentEvaluation, type ServiceIntent } from '../src/services/intent';
import { emptyTraffic } from '../src/services/telemetry';
import { emptyTopology } from '../src/services/topology';
import type { RecoveryVerification } from '../src/types';

const originalFetch = globalThis.fetch;
const profile: ServiceIntent = {profile_id:'interactive',name:'Interactive / Low Latency',priority:'HIGH',
  require_reachability:true,max_loss_percent:1,max_avg_rtt_ms:25};
const value = (patch: Partial<IntentEvaluation> = {}): IntentEvaluation => ({
  evaluation_id:'i1',verification_id:'v1',verification_status:'VERIFIED',runtime_id:'r1',runtime_revision:1,
  topology_id:'multipath_mesh',controller_mode:'reactive',controller_generation:'g1',experiment_id:null,job_id:'job',
  source_host:'h1',destination_host:'h2',failed_link:['s2','s5'],failure_timestamp:100,intent_snapshot:profile,
  evaluation_status:'VIOLATED',requirements:{reachability:{target:true,actual:true,unit:'',status:'PASS'},
    packet_loss:{target:1,actual:0,unit:'%',status:'PASS'},average_rtt:{target:25,actual:32.15249999999999,unit:'ms',status:'FAIL'}},
  reason:'Measured RTT exceeded target.',reason_code:'RTT_THRESHOLD_EXCEEDED',created_at:100,completed_at:104,
  measurement_source:'Recovery Verification Engine measured post-failure evidence',evidence:{},...patch,
});
const emit = (evaluation: IntentEvaluation) => useSDNStore.getState().handleWebSocketMessage({event_type:'INTENT_EVALUATION',evaluation});
beforeEach(() => {
  mock.method(React,'useSyncExternalStore',(_subscribe: unknown,snapshot:()=>unknown)=>snapshot());
  useSDNStore.setState({intentEvaluation:null,intentError:null,verification:null,verificationError:null,
    runtimeId:'r1',runtimeRevision:1,controllerGeneration:'g1',activeController:'reactive',controllerStatus:'READY',
    simulationState:'RUNNING',trafficStats:emptyTraffic(),experimentProgress:null,topology:emptyTopology()});
  useIntentConfigurationStore.setState(useIntentConfigurationStore.getInitialState());
  globalThis.fetch=(async(url)=>new Response(JSON.stringify(String(url).endsWith('/controllers') ? [] : String(url).endsWith('/topology') ? emptyTopology() : null))) as typeof fetch;
});
afterEach(() => {globalThis.fetch=originalFetch;mock.restoreAll();});

test('server profiles render demonstration requirements and priority metadata disclaimer',async()=>{
  globalThis.fetch=(async()=>new Response(JSON.stringify([profile]))) as typeof fetch;
  await useIntentConfigurationStore.getState().loadProfiles();
  useIntentConfigurationStore.getState().update('traffic',{profile_id:'interactive'});
  const html=renderToStaticMarkup(<ServiceIntentEditor workflow="traffic"/>);
  for(const word of ['Interactive / Low Latency','25 ms','1%','Project demonstration defaults','does not enforce QoS']) assert.ok(html.includes(word));
});
test('custom editor validates finite positive RTT and loss bounds instead of clamping',()=>{
  const store=useIntentConfigurationStore.getState();
  store.update('traffic',{profile_id:'custom',custom:{...profile,profile_id:'custom',max_avg_rtt_ms:0}});
  assert.throws(()=>store.selection('traffic'),/RTT/);
  assert.ok(renderToStaticMarkup(<ServiceIntentEditor workflow="traffic"/>).includes('role="alert"'));
  for(const loss of [-1,101,NaN,Infinity])assert.match(customIntentError({...profile,max_loss_percent:loss})!,/loss/);
  store.update('traffic',{custom:{...profile,profile_id:'custom',name:'My service',max_avg_rtt_ms:40}});
  assert.equal(store.selection('traffic').custom?.max_avg_rtt_ms,40);
});
test('traffic and experiment drafts remain independent and immutable snapshots are sent',async()=>{
  const draft=useIntentConfigurationStore.getState();
  draft.update('traffic',{profile_id:'custom',custom:{...profile,profile_id:'custom'}});
  const selection=draft.selection('traffic');
  draft.update('traffic',{custom:{...profile,profile_id:'custom',max_avg_rtt_ms:500}});
  assert.equal(selection.custom?.max_avg_rtt_ms,25);
  assert.equal(draft.selection('experiment').profile_id,'standard');
  let sent: any;
  globalThis.fetch=(async(_url,options)=>{sent=JSON.parse(String(options?.body));return new Response(JSON.stringify({job_id:'job',runtime_id:'r1',active:true}));}) as typeof fetch;
  useTrafficConfigurationStore.getState().setConfiguration({src:'h2',dst:'h1',interval:.1,count:500});
  const config=useTrafficConfigurationStore.getState().configuration;
  await useSDNStore.getState().startTraffic({...config,service_intent:selection});
  assert.equal(sent.count,500);assert.equal(sent.service_intent.custom.max_avg_rtt_ms,25);
  emit(value());
  useSDNStore.getState().handleWebSocketMessage({event_type:'TRAFFIC_COMPLETED',stats:{...emptyTraffic(),runtime_id:'r1',job_id:'job',active:false,transmitted:500,received:500}});
  assert.deepEqual(useTrafficConfigurationStore.getState().configuration,config);
  assert.equal(draft.selection('traffic').custom?.max_avg_rtt_ms,500);
});
test('target versus actual, failure status and clean numbers are rendered without mutation',()=>{
  const result=Object.freeze(value());const before=JSON.stringify(result);
  const html=renderToStaticMarkup(<ServiceIntentCard evaluation={result}/>);
  for(const text of ['VIOLATED','25 ms','32.15 ms','0%','Fail','Restored'])assert.ok(html.includes(text));
  assert.ok(!html.includes('32.15249999999999'));assert.equal(JSON.stringify(result),before);
  assert.equal(intentNumber(.2976190476190476,'%'),'0.3%');assert.equal(intentNumber(null,' ms'),'N/A');
});
test('SATISFIED, UNAVAILABLE, EVALUATING and old record N/A are backend states',()=>{
  for(const evaluation_status of ['SATISFIED','UNAVAILABLE','EVALUATING'] as const)
    assert.ok(renderToStaticMarkup(<ServiceIntentCard evaluation={value({evaluation_status})}/>).includes(evaluation_status));
  const html=renderToStaticMarkup(<ServiceIntentCard evaluation={null}/>);
  assert.ok(html.includes('N/A'));assert.ok(!html.includes('>SATISFIED<'));
});
test('primary intent card is concise while provenance stays in a closed disclosure',()=>{
  const html=renderToStaticMarkup(<ServiceIntentCard evaluation={value()}/>);
  const [primary, details]=html.split('<details');
  assert.ok(primary.includes('SERVICE INTENT'));
  assert.ok(primary.includes('Recovered service did not meet the selected requirements.'));
  for(const text of ['Interactive / Low Latency','25 ms','32.15 ms','Reactive']) assert.ok(primary.includes(text));
  for(const text of ['Verification ID','Traffic job ID','Priority','RTT_THRESHOLD_EXCEEDED','bounded service window']) assert.ok(!primary.includes(text));
  assert.ok(details.startsWith(' class="intent-technical-details">'));
  for(const text of ['Technical details','Verification ID','Traffic job ID','Evaluation ID','HIGH','RTT_THRESHOLD_EXCEEDED','Measurement source','bounded service window'])
    assert.ok(details.includes(text),text);
  assert.equal((primary.match(/class="intent-requirement-failed"/g)||[]).length,1);
  assert.ok(primary.includes('<th scope="row">Post-Recovery Avg RTT</th>'));
  assert.ok(primary.includes('<th scope="col">Status</th>'));
});
test('human summaries follow backend states without interpreting evidence',()=>{
  for(const [evaluation_status,summary] of [
    ['SATISFIED','Your service requirements were met after recovery.'],
    ['VIOLATED','Recovered service did not meet the selected requirements.'],
    ['UNAVAILABLE','Service requirements could not be evaluated from the available evidence.'],
    ['EVALUATING','Evaluating your service requirements after recovery.'],
  ] as const) {
    const html=renderToStaticMarkup(<ServiceIntentCard evaluation={value({evaluation_status})}/>);
    assert.ok(html.includes(summary));
  }
});
test('a captured experiment policy remains visible when no verification was started',()=>{
  const html=renderToStaticMarkup(<ServiceIntentCard evaluation={null} intent={profile}/>);
  assert.ok(html.includes('Interactive / Low Latency'));assert.ok(html.includes('HIGH'));
  assert.ok(html.includes('NOT EVALUATED'));assert.ok(!html.includes('>SATISFIED<'));
});
test('unavailable actual RTT is N/A and unknown reachability is not failure',()=>{
  const html=renderToStaticMarkup(<ServiceIntentCard evaluation={value({evaluation_status:'UNAVAILABLE',requirements:{
    reachability:{target:true,actual:null,unit:'',status:'UNAVAILABLE'},average_rtt:{target:25,actual:null,unit:'ms',status:'UNAVAILABLE'}}})}/>);
  assert.ok(html.includes('<td>N/A</td>'));assert.ok(!html.includes('Not restored'));assert.ok(!html.includes('>0 ms<'));
});
test('Recovery VERIFIED and Intent VIOLATED render simultaneously',()=>{
  const verification={verification_id:'v1',verification_status:'VERIFIED',runtime_id:'r1',controller_mode:'reactive',
    topology_id:'multipath_mesh',source_host:'h1',destination_host:'h2',failed_link:['s2','s5'],failure_timestamp:100,
    reachability_restored:true,post_recovery_avg_rtt_ms:32,reason:'Stable service'} as RecoveryVerification;
  const html=renderToStaticMarkup(<><RecoveryVerificationCard verification={verification}/><ServiceIntentCard evaluation={value()}/></>);
  assert.ok(html.includes('>VERIFIED</span>'));assert.ok(html.includes('>VIOLATED</span>'));
});
test('WS rejects stale runtime revision controller job and malformed data',()=>{
  useSDNStore.setState({trafficStats:{...emptyTraffic(),job_id:'job'}});
  emit(value());
  for(const patch of [{runtime_id:'old'},{runtime_revision:0},{controller_generation:'g0'},{job_id:'old'},{failure_timestamp:99}])emit(value({...patch,evaluation_status:'SATISFIED'}));
  assert.equal(useSDNStore.getState().intentEvaluation?.evaluation_status,'VIOLATED');
  useSDNStore.getState().handleWebSocketMessage({event_type:'INTENT_EVALUATION',evaluation:{...value(),requirements:{rtt:null}}});
  assert.equal(useSDNStore.getState().intentEvaluation?.evaluation_status,'VIOLATED');
});
test('a newer traffic job rejects an old experiment evaluation even after experiment completion',()=>{
  useSDNStore.setState({trafficStats:{...emptyTraffic(),job_id:'new-job',traffic_sequence:3}});
  emit(value({experiment_id:'old-experiment',traffic_sequence:2}));
  assert.equal(useSDNStore.getState().intentEvaluation,null);
});
test('new job WS clears a previous intent but older unrelated traffic cannot clear experiment evidence',()=>{
  emit(value({experiment_id:'experiment',traffic_sequence:2}));
  useSDNStore.getState().handleWebSocketMessage({event_type:'TRAFFIC_STARTED',stats:{...emptyTraffic(),runtime_id:'r1',job_id:'old',traffic_sequence:1,active:true}});
  assert.equal(useSDNStore.getState().intentEvaluation?.evaluation_status,'VIOLATED');
  useSDNStore.getState().handleWebSocketMessage({event_type:'TRAFFIC_STARTED',stats:{...emptyTraffic(),runtime_id:'r1',job_id:'new',traffic_sequence:3,active:true}});
  assert.equal(useSDNStore.getState().intentEvaluation,null);
});
test('late EVALUATING cannot overwrite a terminal result',()=>{
  emit(value());emit(value({evaluation_status:'EVALUATING'}));
  assert.equal(useSDNStore.getState().intentEvaluation?.evaluation_status,'VIOLATED');
});
test('late REST does not replace a newer WS result',async()=>{
  let resolve!: (value:Response)=>void;
  globalThis.fetch=(()=>new Promise<Response>(r=>{resolve=r;})) as typeof fetch;
  const pending=useSDNStore.getState().fetchIntentEvaluation();
  emit(value());resolve(new Response(JSON.stringify(value({evaluation_status:'EVALUATING'}))));await pending;
  assert.equal(useSDNStore.getState().intentEvaluation?.evaluation_status,'VIOLATED');
});
test('controller and runtime switching clear current intent and prevent stale resurrection',()=>{
  emit(value());
  useSDNStore.getState().handleWebSocketMessage({event_type:'CONTROLLER_STATUS',controller:'reactive',controller_generation:'g2',status:'STARTING'});
  assert.equal(useSDNStore.getState().intentEvaluation,null);emit(value());assert.equal(useSDNStore.getState().intentEvaluation,null);
  useSDNStore.setState({controllerGeneration:'g1',controllerStatus:'READY'});emit(value());
  useSDNStore.getState().handleWebSocketMessage({event_type:'SIMULATION_STATUS',state:'STOPPED',runtime_id:'r2',runtime_revision:2});
  assert.equal(useSDNStore.getState().intentEvaluation,null);
});
test('reconnect restores current evaluation after runtime hydration',()=>{
  useSDNStore.getState().handleWebSocketMessage({event_type:'INITIAL_STATE',runtime_id:'r1',runtime_revision:1,
    controller:'reactive',controller_generation:'g1',controller_status:'READY',simulation_state:'RUNNING',intent_evaluation:value()});
  assert.equal(useSDNStore.getState().intentEvaluation?.evaluation_status,'VIOLATED');
});
test('API errors stay visible rather than inventing satisfaction',async()=>{
  globalThis.fetch=(async()=>new Response(JSON.stringify({detail:'Database unavailable'}),{status:503})) as typeof fetch;
  await useSDNStore.getState().fetchIntentEvaluation();
  assert.equal(useSDNStore.getState().intentEvaluation,null);
  assert.ok(renderToStaticMarkup(<ServiceIntentCard/>).includes('Database unavailable'));
});
test('analytics excludes old records and reports actual requirement failure counts',()=>{
  const summary=intentCounts([{summary:{}},{summary:{intent_evaluation:value()}},
    {summary:{intent_evaluation:value({evaluation_status:'SATISFIED',requirements:{}})}},
    {summary:{intent_evaluation:value({evaluation_status:'UNAVAILABLE',requirements:{}})}}]);
  assert.deepEqual(summary,{total:3,satisfied:1,violated:1,unavailable:1,satisfiedRate:50,reasons:{average_rtt:1}});
  assert.equal(intentCounts([{summary:{}}]).satisfiedRate,null);
});
