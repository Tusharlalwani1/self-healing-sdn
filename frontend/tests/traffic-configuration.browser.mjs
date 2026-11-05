// Real React/browser regression with an isolated fixture server. Never sends an
// SDN request to the running backend, and never edits production data.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import assert from 'node:assert/strict';

const runtime = 'traffic-config-test';
const initial = () => ({ runtime_id:runtime, traffic_sequence:0, active:false, transmitted:0, received:0, loss_percent:0, duration_sec:0, history:[], avg_rtt:null });
let stats=initial(), sequence=0, statsReads=0;
const requests=[], consoleErrors=[], results=[];
const dist=resolve('dist');
const output=resolve('../reports/traffic-configuration');
await mkdir(output,{recursive:true});
const topology={runtime_id:runtime,runtime_revision:1,nodes:[],links:[],switches:[],hosts:[],active_controller:'reactive',simulation_state:'RUNNING',active_paths:[],backup_paths:[]};
const server=createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://localhost');
    const json=value=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
    if(url.pathname==='/api/controllers')return json([{id:'reactive',name:'Reactive',description:'Test fixture',features:[],status:'READY',is_active:true}]);
    if(url.pathname==='/api/topology')return json(topology);
    if(url.pathname==='/api/system/status')return json({os:'Test fixture',python_version:'N/A',controller_port:6653,mininet_available:false,ovs_service_running:false,openflow_port_active:false});
    if(url.pathname==='/api/events/logs')return json([]);
    if(url.pathname==='/api/traffic/stats'){statsReads++;return json(stats);}
    if(url.pathname==='/api/traffic/start'&&req.method==='POST'){
      let body='';for await(const chunk of req)body+=chunk;
      const config=JSON.parse(body);requests.push(config);
      stats={...initial(),job_id:`config-${++sequence}`,traffic_sequence:sequence,active:true,controller:'reactive',accounting_complete:false};
      return json({status:'ok',...stats});
    }
    if(url.pathname.startsWith('/api/'))throw new Error(`Unexpected API in fixture: ${req.method} ${url.pathname}`);
    const path=url.pathname.startsWith('/assets/')?resolve(dist,'.'+url.pathname):resolve(dist,'index.html');
    if(!path.startsWith(dist+sep))throw new Error('Path outside fixture dist');
    const body=await readFile(path);res.writeHead(200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css'}[extname(path)]||'application/octet-stream'});res.end(body);
  }catch(error){res.writeHead(500);res.end(String(error));}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=9227',`--user-data-dir=${resolve('node_modules/.tmp/traffic-config-browser')}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const keepAlive=setInterval(()=>{},1000);
let socket;
try {
  let target;
  for(let i=0;i<60;i++){try{target=(await(await fetch('http://127.0.0.1:9227/json')).json()).find(t=>t.type==='page');if(target)break;}catch{}await delay(250);}
  assert.ok(target,'Hidden Edge started');
  socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});
  let id=0;const pending=new Map();
  socket.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);}}else if(m.method==='Runtime.exceptionThrown')consoleErrors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);else if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')consoleErrors.push(m.params.args.map(a=>a.value||a.description).join(' '));};
  const cdp=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;const timer=setTimeout(()=>reject(new Error(`CDP timeout ${method}`)),15000);pending.set(n,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});socket.send(JSON.stringify({id:n,method,params}));});
  const evaluate=async expression=>{const r=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
  const waitFor=async expression=>{for(let i=0;i<60;i++){if(await evaluate(expression))return;await delay(100);}throw new Error(`UI condition timed out: ${expression}`);};
  const form=()=>evaluate(`Array.from(document.querySelectorAll('.traffic-page select')).map(e=>e.value)`);
  const setForm=async values=>{for(let i=0;i<values.length;i++)await evaluate(`(()=>{const e=document.querySelectorAll('.traffic-page select')[${i}];e.value=${JSON.stringify(String(values[i]))};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);};
  const emit=async(event_type,sample)=>{stats=sample;await evaluate(`window.__emitTrafficFixture(${JSON.stringify({event_type,stats:sample})})`);await delay(100);};
  const navigate=async tab=>{const path=tab==='overview'?'/dashboard':'/dashboard/'+tab;await evaluate(`document.querySelector('nav[aria-label="Control center pages"] a[href="${path}"]').click()`);await waitFor(`location.pathname===${JSON.stringify(path)}`);};
  await cdp('Page.enable');await cdp('Runtime.enable');
  await cdp('Page.addScriptToEvaluateOnNewDocument',{source:`window.__fixtureSockets=[];window.WebSocket=class {static OPEN=1;readyState=1;constructor(){window.__fixtureSockets.push(this);setTimeout(()=>this.onopen?.({}),0)}send(){}close(){this.readyState=3;this.onclose?.({})}};window.__emitTrafficFixture=message=>{window.__fixtureSockets.filter(s=>s.readyState===1).forEach(s=>s.onmessage?.({data:JSON.stringify(message)}))};`});
  await cdp('Page.navigate',{url:base+'/dashboard/traffic'});
  await waitFor('document.querySelector(".traffic-page") && !Array.from(document.querySelectorAll(".traffic-page button")).find(b=>b.textContent.includes("Start Traffic Stream"))?.disabled');
  await waitFor('document.querySelector(".runtime-status").textContent.includes("RUNNING")');
  assert.deepEqual(await form(),['h1','h2','0.05','300']);
  results.push('Default controls are h1, h2, 0.05 sec, 300 packets');

  for(const config of [{src:'h1',dst:'h2',interval:0.05,count:500},{src:'h2',dst:'h1',interval:0.1,count:1000},{src:'h1',dst:'h2',interval:0.05,count:300}]) {
    const expected=[config.src,config.dst,String(config.interval),String(config.count)];
    await setForm(expected);assert.deepEqual(await form(),expected);
    const before=requests.length;
    await evaluate(`Array.from(document.querySelectorAll('.traffic-page button')).find(b=>b.textContent.includes('Start Traffic Stream')).click()`);
    await waitFor(`document.querySelector('.traffic-page').textContent.includes('Stop Traffic Generator')`);
    assert.equal(requests.length,before+1);assert.deepEqual(requests.at(-1),config);
    assert.deepEqual(await form(),expected,'start acknowledgement preserves controls');
    await emit('TRAFFIC_STARTED',stats);assert.deepEqual(await form(),expected,'WebSocket start preserves controls');
    const tick={...stats,active:true,transmitted:97,received:97,loss_percent:0,avg_rtt:21.9,history:[{seq:97,rtt:21.9,success:true,t:1}]};
    await emit('TRAFFIC_TICK',tick);assert.deepEqual(await form(),expected,'WebSocket tick preserves controls');
    const final={...tick,active:false,transmitted:config.count,received:config.count,accounting_complete:true,history:[{seq:config.count,rtt:21.9,success:true,t:2}]};
    await emit('TRAFFIC_COMPLETED',final);
    await waitFor(`document.querySelector('.traffic-page').textContent.includes('#${config.count}')`);
    assert.deepEqual(await form(),expected,'completion preserves controls');
    const reads=statsReads;await delay(3300);assert.ok(statsReads>reads,'REST telemetry polling exercised');
    assert.deepEqual(await form(),expected,'REST statistics preserve controls');
    results.push(`${config.count} packets: actual POST payload, tick, completion and REST polling preserve all controls`);
    // Match the failure-investigation workflow: inspect another page, then return.
    await evaluate('document.querySelector(".traffic-page").dataset.mountProbe="original"');
    await navigate('topology');await waitFor('!document.querySelector(".traffic-page")');
    await navigate('traffic');await waitFor('!!document.querySelector(".traffic-page")');
    assert.equal(await evaluate('document.querySelector(".traffic-page").dataset.mountProbe'),undefined);
    assert.deepEqual(await form(),expected,'page remount must preserve user traffic configuration');
    results.push(`${config.count} packets: leaving for topology and returning preserves controls after actual remount`);
  }
  // A pending user's next configuration must not be replaced by a previous job's data.
  await setForm(['h2','h1','0.5','100']);
  await emit('TRAFFIC_COMPLETED',{...stats,active:false,transmitted:300,received:300});
  assert.deepEqual(await form(),['h2','h1','0.5','100']);
  results.push('Explicit next-job edits remain independent of previous job telemetry');
  assert.deepEqual(consoleErrors,[]);
  console.log(JSON.stringify({results,requests,consoleErrors},null,2));
  await cdp('Browser.close');
} finally {
  clearInterval(keepAlive);socket?.close();browser.kill();await new Promise(r=>server.close(r));
  await writeFile(resolve(output,'browser-evidence.json'),JSON.stringify({results,requests,consoleErrors},null,2));
}
