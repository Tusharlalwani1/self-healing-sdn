import { intentProfilesFixture } from './intentFixture.ts';
// Isolated production-bundle browser test. All API/WS data below is a fixture;
// this server never forwards traffic to FastAPI, Mininet, Ryu, OVS or SQLite.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import assert from 'node:assert/strict';
import { meshSnapshot,meshOption,diamondOption } from './meshFixture.ts';

const options=[diamondOption,meshOption], dist=resolve('dist'), out=resolve(process.env.SDN_QA_OUTPUT || '../reports/multipath-mesh');
await mkdir(out,{recursive:true});
let mode='reactive',running=false,topologyId='diamond',revision=1,records=[];
let snapshot={...structuredClone(meshSnapshot),nodes:[],links:[],switches:[],hosts:[],active_paths:[]};
const requests=[],checks=[],consoleErrors=[];
let verificationFixtureState=null, intentFixtureState=null;
const qualityFixture = new Map();
let healthSequence=0;
function healthFixture(){
  const owner={runtime_id:state().runtime_id,runtime_revision:revision,topology_id:topologyId,controller_generation:'fixture-g1'};
  return {...owner,simulation_state:running?'RUNNING':'STOPPED',sequence:++healthSequence,threshold_label:'Project demonstration thresholds',
    config:{healthy_additional_delay_ms:10,critical_additional_delay_ms:100,healthy_loss_percent:1,critical_loss_percent:10},
    links:running?snapshot.links.filter(l=>l.src.startsWith('s')&&l.dst.startsWith('s')).map(l=>{
      const key=[l.src,l.dst].sort().join('-'), q=qualityFixture.get(key), impaired=q?.runtime===owner.runtime_id;
      return {...owner,link_id:key,src:l.src,dst:l.dst,operational_status:l.status,
        health_status:l.status==='DOWN'?'UNKNOWN':impaired?'CRITICAL':'UNKNOWN',injected:impaired,
        configured_additional_delay_ms:impaired?q.delay:0,configured_loss_percent:impaired?q.loss:0,
        observed_loss_percent:null,observed_avg_rtt_ms:null,sample_count:null,observation_window_sec:null,
        detected_at:100,sampled_at:102,reason_code:impaired?'CRITICAL_QUALITY':'NO_TRAFFIC_OR_INSUFFICIENT_EVIDENCE',
        reason:impaired?'Kernel-read impairment meets a critical threshold.':'No bounded traffic evidence.',
        measurement_source:'BROWSER_FIXTURE_NOT_REAL_TC',evidence_scope:'Isolated browser fixture; no SDN measurements.'};
    }):[]};
}
function state(){return {...snapshot,topology_id:topologyId,topology_label:options.find(o=>o.id===topologyId).label,active_topology_id:running?topologyId:null,runtime_id:`fixture-${revision}`,runtime_revision:revision,simulation_state:running?'RUNNING':'STOPPED',active_controller:mode};}
function network(id){
  if(id==='multipath_mesh')return structuredClone(meshSnapshot);
  const names=diamondOption.switches;
  return {...structuredClone(meshSnapshot),switches:names,hosts:['h1','h2'],nodes:[...names.map((name,i)=>({id:name,name,type:'switch',dpid:i+1,ports:{}})),...['h1','h2'].map((name,i)=>({id:name,name,type:'host',ip:`10.0.0.${i+1}`,ports:{}}))],links:[...diamondOption.host_links,...diamondOption.inter_switch_links].map(([src,dst])=>({id:`${src}-${dst}`,src,dst,status:'UP',src_intf:`${src}-eth1`,dst_intf:`${dst}-eth1`})),active_paths:[]};
}
const server=createServer(async(req,res)=>{
  try{
    const path=new URL(req.url,'http://fixture').pathname;
    const json=value=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
    let body={};if(req.method==='POST'){let raw='';for await(const c of req)raw+=c;body=raw?JSON.parse(raw):{};requests.push({path,body});}
    if(path==='/api/topology/options')return json(options);
    if(path==='/api/topology')return json(state());
    if(path==='/api/controllers')return json(['baseline','reactive','fast_failover'].map(id=>({id,name:id,description:'Isolated browser fixture',features:[],is_active:id===mode,status:id===mode?'READY':'STOPPED'})));
    if(path==='/api/controllers/select'){mode=body.controller_type;return json({status:'ok',controller:mode});}
    if(path==='/api/system/status')return json({os:'Test fixture',python_version:'N/A',controller_port:6653,mininet_available:false,ovs_service_running:false,openflow_port_active:false});
    if(path==='/api/events/logs')return json([]);
    if(path==='/api/intents/profiles')return json(intentProfilesFixture);
    if(path==='/api/intents/evaluation/current')return json(running && intentFixtureState?.runtime_id===state().runtime_id ? intentFixtureState : null);
    if(path==='/api/verification/current')return json(running && verificationFixtureState?.runtime_id===state().runtime_id ? verificationFixtureState : null);
    if(path==='/api/link-health')return json(healthFixture());
    if(path.startsWith('/api/degradation/')){
      assert.equal(body.runtime_id,state().runtime_id);assert.equal(body.runtime_revision,revision);
      const key=[body.src,body.dst].sort().join('-');
      if(path.endsWith('/inject'))qualityFixture.set(key,{runtime:state().runtime_id,delay:body.additional_delay_ms,loss:body.loss_percent});
      if(path.endsWith('/clear'))qualityFixture.delete(key);
      if(path.endsWith('/clear-all'))qualityFixture.clear();
      return json({status:'ok'});
    }
    if(path==='/api/traffic/stats')return json({runtime_id:state().runtime_id,traffic_sequence:0,active:false,transmitted:0,received:0,loss_percent:0,duration_sec:0,history:[]});
    if(path==='/api/simulation/start'){topologyId=body.topology_id;mode=body.controller_type||mode;snapshot=network(topologyId);running=true;revision++;return json({status:'ok',...state()});}
    if(path==='/api/simulation/stop'){running=false;revision++;snapshot={...snapshot,nodes:[],links:[],switches:[],hosts:[],active_paths:[]};return json({status:'ok',...state()});}
    if(path==='/api/links/down'||path==='/api/links/up'){
      const link=snapshot.links.find(l=>new Set([l.src,l.dst,body.node1,body.node2]).size===2);
      assert.ok(link,'UI targets an actual fixture link');link.status=path.endsWith('/down')?'DOWN':'UP';return json({status:'ok',link_status:link.status});
    }
    if(path==='/api/links/restore-all'){snapshot.links.forEach(l=>l.status='UP');return json({status:'ok'});}
    if(path.startsWith('/api/topology/switch/'))return json({dpid:Number(path.split('/').at(-1)),switch:'s'+path.split('/').at(-1),flows:[],groups:[],ports:[]});
    if(path==='/api/experiments/history')return json(records);
    if(path==='/api/experiments/run'){
      const record={id:'mesh-ui-fixture',run_id:body.run_id,controller:body.controller,status:'COMPLETED',start_time:'2026-11-05T00:00:00',failure_link:`${body.fail_link_src}-${body.fail_link_dst}`,packets_transmitted:null,packets_received:null,packet_loss_percent:null,avg_rtt_ms:null,recovery_duration_ms:null,summary:{service_intent:body.service_intent?.custom,intent_evaluation:intentFixtureState,verification:verificationFixtureState,topology_id:body.topology_id,topology_label:options.find(o=>o.id===body.topology_id).label,fixture:true}};
      records=[record];return json(record);
    }
    if(path.startsWith('/api/'))throw new Error('Unexpected fixture API '+path);
    const file=path.startsWith('/assets/')?resolve(dist,'.'+path):resolve(dist,'index.html');
    assert.ok(file.startsWith(dist+sep));const content=await readFile(file);res.writeHead(200,{'Content-Type':{'.js':'text/javascript','.css':'text/css','.html':'text/html'}[extname(file)]||'application/octet-stream'});res.end(content);
  }catch(error){res.writeHead(500);res.end(String(error));}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const browser=spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=9228',`--user-data-dir=${resolve('node_modules/.tmp/mesh-browser')}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
const delay=ms=>new Promise(r=>setTimeout(r,ms));let socket;const keepAlive=setInterval(()=>{},1000);
try{
  let target;for(let i=0;i<60;i++){try{target=(await(await fetch('http://127.0.0.1:9228/json')).json()).find(t=>t.type==='page');if(target)break;}catch{}await delay(250);}
  assert.ok(target);socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});let id=0;const pending=new Map();
  socket.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);}}else if(m.method==='Runtime.exceptionThrown')consoleErrors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);else if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')consoleErrors.push(m.params.args.map(a=>a.value||a.description).join(' '));};
  const cdp=(method,params={})=>new Promise((resolve,reject)=>{const n=++id,t=setTimeout(()=>reject(new Error('CDP timeout '+method)),15000);pending.set(n,{resolve:v=>{clearTimeout(t);resolve(v);},reject:e=>{clearTimeout(t);reject(e);}});socket.send(JSON.stringify({id:n,method,params}));});
  const evaluate=async expression=>{const r=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
  const waitFor=async expression=>{for(let i=0;i<80;i++){if(await evaluate(expression))return;await delay(100);}throw new Error('UI condition timed out '+expression);};
  const click=async text=>evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes(${JSON.stringify(text)})).click()`);
  const select=async(label,value)=>evaluate(`(()=>{const e=document.querySelector('select[aria-label=${JSON.stringify(label)}]');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const nav=async tab=>{const path=tab==='overview'?'/dashboard':'/dashboard/'+tab;await evaluate(`document.querySelector('nav a[href="${path}"]').click()`);await waitFor(`location.pathname===${JSON.stringify(path)}`);await delay(250);};
  const screenshot=async name=>{const r=await cdp('Page.captureScreenshot',{format:'png'});await writeFile(resolve(out,name+'.png'),Buffer.from(r.data,'base64'));};
  await cdp('Runtime.enable');await cdp('Page.enable');await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1050,deviceScaleFactor:1,mobile:false});
  await cdp('Page.addScriptToEvaluateOnNewDocument',{source:`window.__sockets=[];window.WebSocket=class{static OPEN=1;readyState=1;constructor(){window.__sockets.push(this);setTimeout(()=>this.onopen?.({}),0)}send(){}close(){this.readyState=3;this.onclose?.({})}};window.__emit=m=>window.__sockets.filter(s=>s.readyState===1).forEach(s=>s.onmessage?.({data:JSON.stringify(m)}));`});
  await cdp('Page.navigate',{url:base+'/dashboard'});await waitFor(`document.querySelectorAll('select[aria-label="Network topology"] option').length===2`);
  await select('Network topology','multipath_mesh');await nav('traffic');await nav('overview');
  assert.equal(await evaluate(`document.querySelector('select[aria-label="Network topology"]').value`),'multipath_mesh');
  await click('Start Simulation');await waitFor('document.querySelector(".runtime-status").textContent.includes("RUNNING")');
  assert.deepEqual(requests.find(r=>r.path==='/api/simulation/start').body,{controller_type:'reactive',topology_id:'multipath_mesh'});
  await evaluate(`window.__emit(${JSON.stringify({event_type:'TOPOLOGY_UPDATE',topology:state()})})`);
  await nav('topology');await waitFor('document.querySelectorAll(".react-flow__node-switchNode").length===9');
  assert.equal(await evaluate('document.querySelectorAll(".react-flow__node-hostNode").length'),2);
  assert.equal(await evaluate('document.querySelectorAll(".react-flow__edge").length'),16);
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);await screenshot('mesh-topology-fixture');
  checks.push('Mesh selection persists across navigation; explicit mesh + Reactive request; 9 switches / 2 hosts / 16 edges render');
  await evaluate(`document.querySelector('button[aria-label="Inspect switch s9"]').click()`);await waitFor('document.querySelector("dialog[open]")?.textContent.includes("Flow Table (0)")');
  await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await waitFor('!document.querySelector("dialog[open]")');
  await evaluate(`document.querySelector('button[aria-label="Inspect host h2"]').click()`);await waitFor('document.querySelector("dialog[open]")?.textContent.includes("10.0.0.2")');await evaluate(`document.querySelector('dialog[open] button[aria-label="Close inspector"]').click()`);
  await nav('simulator');await waitFor('document.querySelectorAll(".failuresimulator-page tbody tr").length===16');
  // Phase 3 UI evidence only: these messages are controlled fixtures, not SDN
  // measurements. Exercise production rendering and ownership over the real WS handler.
  await evaluate(`window.__emit(${JSON.stringify({event_type:'INITIAL_STATE',runtime_id:state().runtime_id,runtime_revision:revision,controller:'reactive',controller_generation:'fixture-g1',controller_status:'READY',simulation_state:'RUNNING',active_paths:[],verification:null})})`);
  await evaluate(`window.__emit(${JSON.stringify({event_type:'LINK_HEALTH',health:healthFixture()})})`);
  await waitFor(`document.querySelector('.health-controls select')?.options.length===14`);
  await evaluate(`(()=>{const e=document.querySelector('.health-controls select');e.value='s2-s5';e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await click('Inject Degradation');
  await waitFor(`document.querySelector('.link-health-card')?.textContent.includes('100 ms')`);
  assert.ok(await evaluate(`document.querySelector('.soft-degradation .status').textContent.includes('UP / CRITICAL')`));
  const qualityMutationsBeforeNavigation=requests.filter(r=>r.path.startsWith('/api/degradation/')).length;
  await nav('traffic');await nav('simulator');
  await waitFor(`document.querySelector('.health-controls select')?.value==='s2-s5'`);
  assert.ok(await evaluate(`document.querySelector('.soft-degradation .panel-heading').textContent.includes('s2 ↔ s5') && document.querySelector('.soft-degradation .status').textContent.includes('UP / CRITICAL')`));
  await evaluate(`window.__emit(${JSON.stringify({event_type:'LINK_HEALTH',health:healthFixture()})})`);
  assert.equal(await evaluate(`document.querySelector('.health-controls select').value`),'s2-s5');
  assert.equal(requests.filter(r=>r.path.startsWith('/api/degradation/')).length,qualityMutationsBeforeNavigation);
  checks.push('Soft-degradation s2-s5 selection and CRITICAL evidence survive real page unmount/remount and health WS updates without network mutations');
  assert.deepEqual(requests.find(r=>r.path==='/api/degradation/inject').body,{runtime_id:state().runtime_id,runtime_revision:revision,src:'s2',dst:'s5',additional_delay_ms:100,loss_percent:0});
  assert.ok(await evaluate(`document.querySelector('.link-health-card').textContent.includes('N/A') && !document.querySelector('.link-health-card details').open`));
  await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  await evaluate(`document.querySelector('.soft-degradation').scrollIntoView({block:'start'})`);
  assert.ok(await evaluate(`document.querySelector('.health-controls').getBoundingClientRect().right<=innerWidth && getComputedStyle(document.querySelector('.health-controls')).gridTemplateColumns.split(' ').length===1`));
  await screenshot('soft-degradation-mobile-fixture');
  await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1050,deviceScaleFactor:1,mobile:false});
  await click('Restore Link Quality');await waitFor(`document.querySelector('.soft-degradation .status').textContent.includes('UP / UNKNOWN')`);
  await click('Restore All Degradations');
  await waitFor(`Array.from(document.querySelectorAll('.soft-degradation button')).some(b=>b.textContent==='Inject Degradation'&&!b.disabled)`);
  checks.push('Phase 5 fixture: 14-ISL selector, runtime-pinned injection, UP / CRITICAL, configured vs N/A measured metrics, collapsed provenance, 390px controls, quality restoration UNKNOWN');
  const qualityDraft = () => evaluate(`Array.from(document.querySelectorAll('.health-controls input')).map(e=>e.value)`);
  const mutationsBeforeDraft=requests.filter(r=>r.path.startsWith('/api/degradation/')).length;
  await evaluate(`(()=>{const inputs=document.querySelectorAll('.health-controls input');for(const [i,value] of ['0','10'].entries()){Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(inputs[i],value);inputs[i].dispatchEvent(new Event('input',{bubbles:true}));}})()`);
  assert.deepEqual(await qualityDraft(),['0','10']);
  assert.equal(requests.filter(r=>r.path.startsWith('/api/degradation/')).length,mutationsBeforeDraft);
  await click('Inject Degradation');
  await waitFor(`document.querySelector('.soft-degradation .status')?.textContent.includes('UP / CRITICAL')`);
  assert.deepEqual(requests.filter(r=>r.path==='/api/degradation/inject').at(-1).body,{runtime_id:state().runtime_id,runtime_revision:revision,src:'s2',dst:'s5',additional_delay_ms:0,loss_percent:10});
  const mutationsAfterLossInjection=requests.filter(r=>r.path.startsWith('/api/degradation/')).length;
  await nav('traffic');await nav('simulator');
  assert.equal(await evaluate(`document.querySelector('.health-controls select').value`),'s2-s5');
  assert.deepEqual(await qualityDraft(),['0','10']);
  assert.ok(await evaluate(`Array.from(document.querySelectorAll('.link-health-card .health-evidence-grid dd')).slice(0,2).map(e=>e.textContent).join('|')==='0 ms|10%'`));
  await evaluate(`window.__emit(${JSON.stringify({event_type:'LINK_HEALTH',health:healthFixture()})})`);
  assert.deepEqual(await qualityDraft(),['0','10']);
  assert.equal(requests.filter(r=>r.path.startsWith('/api/degradation/')).length,mutationsAfterLossInjection);
  await click('Restore Link Quality');
  await waitFor(`document.querySelector('.soft-degradation .status')?.textContent.includes('UP / UNKNOWN')`);
  assert.deepEqual(await qualityDraft(),['0','10']);
  checks.push('Loss-only 0ms / 10% draft survives actual navigation/remount and WS evidence updates; matching POST occurs only on explicit injection; clearing quality does not overwrite editable draft');
  const verificationFixture={verification_id:'fixture-verification',incident_id:null,runtime_id:state().runtime_id,runtime_revision:revision,topology_id:'multipath_mesh',controller_mode:'reactive',controller_generation:'fixture-g1',experiment_id:null,job_id:'fixture-job',source_host:'h1',destination_host:'h2',failed_link:['s6','s9'],failure_timestamp:1,verification_status:'VERIFYING',post_recovery_tx:null,post_recovery_rx:null,post_recovery_loss_percent:null,post_recovery_avg_rtt_ms:null,reachability_restored:null,stability_passed:null,path_verification_status:'UNAVAILABLE',reason:'Controlled browser fixture; not live SDN evidence.',evidence_scope:'Post-failure service evidence; local FF switching time not measured.'};
  for(const status of ['VERIFYING','VERIFIED','DEGRADED','FAILED']){
    const value={...verificationFixture,verification_duration_sec:null,verification_id:'fixture-'+status,verification_status:status,failure_timestamp:['VERIFYING','VERIFIED','DEGRADED','FAILED'].indexOf(status)+1};
    verificationFixtureState=value;
    await evaluate(`window.__emit(${JSON.stringify({event_type:'RECOVERY_VERIFICATION',verification:value})})`);
    await waitFor(`document.querySelector('.failuresimulator-page .panel .status')?.textContent===${JSON.stringify(status)}`);
    assert.ok(await evaluate(`document.querySelector('.failuresimulator-page').textContent.includes('UNAVAILABLE')`));
  }
  await evaluate(`window.__emit(${JSON.stringify({event_type:'RECOVERY_VERIFICATION',verification:{...verificationFixture,runtime_id:'old-runtime',verification_status:'VERIFIED'}})})`);
  assert.equal(await evaluate(`document.querySelector('.failuresimulator-page .panel .status')?.textContent`),'FAILED');
  await screenshot('recovery-verification-fixture');
  checks.push('Recovery verification production card renders all backend states, unknown path and unavailable metrics; rejects old-runtime WS evidence');
  await evaluate('Array.from(document.querySelectorAll(".failuresimulator-page tbody tr")).find(r=>r.textContent.includes("s6 ↔ s9")).querySelector("button").click()');
  await waitFor('Array.from(document.querySelectorAll(".failuresimulator-page tbody tr")).find(r=>r.textContent.includes("s6 ↔ s9")).textContent.includes("DOWN")');
  assert.deepEqual(requests.find(r=>r.path==='/api/links/down').body,{node1:'s6',node2:'s9'});
  await nav('topology');await waitFor(`Array.from(document.querySelectorAll('.react-flow__edge-text')).some(e=>e.textContent.includes('FAIL'))`);await screenshot('mesh-failed-link-fixture');
  await click('Restore All Links');await waitFor(`!Array.from(document.querySelectorAll('.react-flow__edge-text')).some(e=>e.textContent.includes('FAIL'))`);
  checks.push('Native s9/h2 inspection, Escape, dynamic 16-link failure inventory, exact s6-s9 mutation and restore styling');
  await nav('experiment');await waitFor('document.querySelectorAll("#experimentlabview-field-1 option").length===14');
  await evaluate('(()=>{const e=document.querySelector("#experimentlabview-field-1");e.value="s6-s9";e.dispatchEvent(new Event("change",{bubbles:true}));})()');
  await select('Service intent profile','custom');
  const input=async(label,value)=>evaluate(`(()=>{const e=document.querySelector('input[aria-label="${label}"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await input('Intent maximum RTT','25');await input('Intent maximum loss','1');await select('Intent priority','HIGH');
  verificationFixtureState={...verificationFixture,verification_id:'intent-demo',failure_timestamp:10,verification_status:'VERIFIED',verification_duration_sec:3.5,post_recovery_tx:40,post_recovery_rx:40,post_recovery_loss_percent:0,post_recovery_avg_rtt_ms:32.1525,reachability_restored:true,stability_passed:true};
  intentFixtureState={evaluation_id:'intent-demo',verification_id:'intent-demo',verification_status:'VERIFIED',runtime_id:state().runtime_id,runtime_revision:revision,topology_id:'multipath_mesh',controller_mode:'reactive',controller_generation:'fixture-g1',experiment_id:null,job_id:'fixture-job',source_host:'h1',destination_host:'h2',failed_link:['s6','s9'],failure_timestamp:10,intent_snapshot:{profile_id:'custom',name:'Custom',priority:'HIGH',require_reachability:true,max_loss_percent:1,max_avg_rtt_ms:25},evaluation_status:'VIOLATED',reason:'Measured RTT exceeded the intent threshold.',reason_code:'RTT_THRESHOLD_EXCEEDED',created_at:10,completed_at:14,measurement_source:'Recovery Verification Engine',evidence:{},requirements:{reachability:{target:true,actual:true,unit:'',status:'PASS'},packet_loss:{target:1,actual:0,unit:'%',status:'PASS'},average_rtt:{target:25,actual:32.1525,unit:'ms',status:'FAIL'}}};
  await evaluate(`window.__emit(${JSON.stringify({event_type:'RECOVERY_VERIFICATION',verification:verificationFixtureState})})`);
  await evaluate(`window.__emit(${JSON.stringify({event_type:'INTENT_EVALUATION',evaluation:intentFixtureState})})`);
  await waitFor(`document.querySelector('.experimentlab-page').textContent.includes('32.15 ms') && Array.from(document.querySelectorAll('.experimentlab-page .status')).some(s=>s.textContent==='VIOLATED')`);
  assert.ok(await evaluate(`Array.from(document.querySelectorAll('.experimentlab-page .status')).some(s=>s.textContent==='VERIFIED')`));
  assert.equal(await evaluate(`document.querySelector('.experimentlab-page .service-intent-card details').open`),false);
  assert.equal(await evaluate(`document.querySelectorAll('.experimentlab-page .service-intent-card .intent-requirement-failed').length`),1);
  assert.ok(await evaluate(`parseFloat(getComputedStyle(document.querySelector('.service-intent-card .intent-comparison td')).paddingLeft)>=10`));
  assert.ok(await evaluate(`document.querySelector('.service-intent-card .intent-summary').textContent.includes('Recovered service did not meet')`));
  await evaluate(`document.querySelector('.service-intent-card summary').click()`);
  assert.ok(await evaluate(`document.querySelector('.service-intent-card details').open && document.querySelector('.service-intent-card details').textContent.includes('RTT_THRESHOLD_EXCEEDED')`));
  await evaluate(`document.querySelector('.service-intent-card summary').click()`);
  await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  await evaluate(`document.querySelector('.service-intent-card').scrollIntoView({block:'center'})`);
  assert.ok(await evaluate(`(()=>{const card=document.querySelector('.service-intent-card');const table=card.querySelector('.intent-comparison-scroll');return card.getBoundingClientRect().right<=innerWidth && table.scrollWidth>=table.clientWidth})()`));
  await screenshot('intent-mobile-fixture');
  await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1050,deviceScaleFactor:1,mobile:false});
  await screenshot('intent-verified-but-violated-fixture');
  checks.push('Custom intent editor captures 25 ms / 1% / HIGH; production cards show Recovery VERIFIED and Intent VIOLATED with 32.15 ms actual evidence');
  await click('Run Automated Experiment');await waitFor('Array.from(document.querySelectorAll(".experimentlab-page tbody")).some(t=>t.textContent.includes("mesh-ui-fixture"))');
  const experiment=requests.find(r=>r.path==='/api/experiments/run').body;
  assert.equal(experiment.topology_id,'multipath_mesh');assert.equal(experiment.fail_link_src,'s6');assert.equal(experiment.fail_link_dst,'s9');
  assert.equal(experiment.packet_count,300);assert.ok(experiment.run_id);assert.equal(experiment.service_intent.custom.max_avg_rtt_ms,25);assert.equal(experiment.service_intent.custom.max_loss_percent,1);assert.equal(experiment.service_intent.custom.priority,'HIGH');
  assert.ok(await evaluate('Array.from(document.querySelectorAll(".experimentlab-page tbody")).some(t=>t.textContent.includes("Multi-Path Mesh"))'));
  await nav('analytics');await select('Analytics topology','multipath_mesh');
  assert.ok(await evaluate(`document.querySelector('.analytics-page').textContent.includes('Violated: 1')`));
  checks.push('Experiment failure selector has 14 actual ISLs; mesh request/provenance retained; analytics topology filter works');
  await click('Stop Simulation');await waitFor('document.querySelector(".runtime-status").textContent.includes("STOPPED")');
  await select('Network topology','diamond');await select('Active controller','baseline');await waitFor(`document.querySelector('select[aria-label="Active controller"]').value==="baseline"`);
  await click('Start Simulation');await waitFor('document.querySelector(".runtime-status").textContent.includes("RUNNING")');
  await nav('topology');await waitFor('document.querySelectorAll(".react-flow__node-switchNode").length===4');
  assert.equal(await evaluate('document.querySelectorAll(".react-flow__edge").length'),6);
  assert.deepEqual(requests.filter(r=>r.path==='/api/simulation/start').at(-1).body,{controller_type:'baseline',topology_id:'diamond'});
  checks.push('Stop → Diamond + Baseline renders 4 switches / 6 links without stale mesh nodes or edges');
  await nav('simulator');await waitFor(`document.querySelector('.health-controls select')?.options.length===4`);
  const fallback=await evaluate(`document.querySelector('.health-controls select').value`);
  assert.equal(fallback,'s1-s2');
  assert.deepEqual(await qualityDraft(),['0','10']);
  await nav('traffic');await nav('simulator');
  assert.equal(await evaluate(`document.querySelector('.health-controls select').value`),fallback);
  checks.push('Unavailable Mesh selection falls back to valid Diamond inter-switch endpoint key and retains fallback across navigation');
  assert.deepEqual(consoleErrors,[]);console.log(JSON.stringify({checks,requests,consoleErrors},null,2));await cdp('Browser.close');
}finally{clearInterval(keepAlive);socket?.close();browser.kill();await new Promise(r=>server.close(r));await writeFile(resolve(out,'browser-evidence.json'),JSON.stringify({fixture:true,checks,requests,consoleErrors},null,2));}
