// Isolated production-bundle browser test. All API/WS data below is a fixture;
// this server never forwards traffic to FastAPI, Mininet, Ryu, OVS or SQLite.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import assert from 'node:assert/strict';
import { meshSnapshot,meshOption,diamondOption } from './meshFixture.ts';

const options=[diamondOption,meshOption], dist=resolve('dist'), out=resolve('../reports/multipath-mesh');
await mkdir(out,{recursive:true});
let mode='reactive',running=false,topologyId='diamond',revision=1,records=[];
let snapshot={...structuredClone(meshSnapshot),nodes:[],links:[],switches:[],hosts:[],active_paths:[]};
const requests=[],checks=[],consoleErrors=[];
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
      const record={id:'mesh-ui-fixture',run_id:body.run_id,controller:body.controller,status:'COMPLETED',start_time:'2026-11-05T00:00:00',failure_link:`${body.fail_link_src}-${body.fail_link_dst}`,packets_transmitted:null,packets_received:null,packet_loss_percent:null,avg_rtt_ms:null,recovery_duration_ms:null,summary:{topology_id:body.topology_id,topology_label:options.find(o=>o.id===body.topology_id).label,fixture:true}};
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
  await evaluate('Array.from(document.querySelectorAll(".failuresimulator-page tbody tr")).find(r=>r.textContent.includes("s6 ↔ s9")).querySelector("button").click()');
  await waitFor('Array.from(document.querySelectorAll(".failuresimulator-page tbody tr")).find(r=>r.textContent.includes("s6 ↔ s9")).textContent.includes("DOWN")');
  assert.deepEqual(requests.find(r=>r.path==='/api/links/down').body,{node1:'s6',node2:'s9'});
  await nav('topology');await waitFor('document.querySelector(".react-flow__edge-text")?.textContent.includes("FAIL")');await screenshot('mesh-failed-link-fixture');
  await click('Restore All Links');await waitFor('!document.querySelector(".react-flow__edge-text")');
  checks.push('Native s9/h2 inspection, Escape, dynamic 16-link failure inventory, exact s6-s9 mutation and restore styling');
  await nav('experiment');await waitFor('document.querySelectorAll("#experimentlabview-field-1 option").length===14');
  await evaluate('(()=>{const e=document.querySelector("#experimentlabview-field-1");e.value="s6-s9";e.dispatchEvent(new Event("change",{bubbles:true}));})()');
  await click('Run Automated Experiment');await waitFor('document.querySelector(".experimentlab-page tbody").textContent.includes("mesh-ui-fixture")');
  const experiment=requests.find(r=>r.path==='/api/experiments/run').body;
  assert.equal(experiment.topology_id,'multipath_mesh');assert.equal(experiment.fail_link_src,'s6');assert.equal(experiment.fail_link_dst,'s9');
  assert.equal(experiment.packet_count,300);assert.ok(experiment.run_id);
  assert.ok(await evaluate('document.querySelector(".experimentlab-page tbody").textContent.includes("Multi-Path Mesh")'));
  await nav('analytics');await select('Analytics topology','multipath_mesh');
  checks.push('Experiment failure selector has 14 actual ISLs; mesh request/provenance retained; analytics topology filter works');
  await click('Stop Simulation');await waitFor('document.querySelector(".runtime-status").textContent.includes("STOPPED")');
  await select('Network topology','diamond');await select('Active controller','baseline');await waitFor(`document.querySelector('select[aria-label="Active controller"]').value==="baseline"`);
  await click('Start Simulation');await waitFor('document.querySelector(".runtime-status").textContent.includes("RUNNING")');
  await nav('topology');await waitFor('document.querySelectorAll(".react-flow__node-switchNode").length===4');
  assert.equal(await evaluate('document.querySelectorAll(".react-flow__edge").length'),6);
  assert.deepEqual(requests.filter(r=>r.path==='/api/simulation/start').at(-1).body,{controller_type:'baseline',topology_id:'diamond'});
  checks.push('Stop → Diamond + Baseline renders 4 switches / 6 links without stale mesh nodes or edges');
  assert.deepEqual(consoleErrors,[]);console.log(JSON.stringify({checks,requests,consoleErrors},null,2));await cdp('Browser.close');
}finally{clearInterval(keepAlive);socket?.close();browser.kill();await new Promise(r=>server.close(r));await writeFile(resolve(out,'browser-evidence.json'),JSON.stringify({fixture:true,checks,requests,consoleErrors},null,2));}
