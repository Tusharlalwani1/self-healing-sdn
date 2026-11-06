// Read-only QA against the production app served by the existing FastAPI backend.
// No controller, simulation, traffic, experiment, link or database writes are sent.
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const base = process.env.SDN_QA_URL || 'http://127.0.0.1:8000';
const out = resolve(process.env.SDN_QA_OUTPUT || '../reports/ui-polish');
await mkdir(out,{recursive:true});
const browser = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', ['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=9225',`--user-data-dir=${resolve('node_modules/.tmp/ui-browser')}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
const delay = ms=>new Promise(r=>setTimeout(r,ms));
let socket;
const keepAlive=setInterval(()=>{},1000);
const evidence={base,pages:[],consoleErrors:[],writeRequests:[],failedResponses:[],apiReads:[],checks:[]};
try {
  let target;
  for(let i=0;i<40;i++){try{target=(await(await fetch('http://127.0.0.1:9225/json')).json()).find(t=>t.type==='page');if(target)break;}catch{} await delay(250);}
  assert.ok(target,'Headless Edge debugging endpoint available');
  socket=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});
  let id=0;const pending=new Map();
  socket.onmessage=event=>{
    const msg=JSON.parse(event.data);
    if(msg.id){const task=pending.get(msg.id);if(task){pending.delete(msg.id);msg.error?task.reject(new Error(JSON.stringify(msg.error))):task.resolve(msg.result);}}
    else if(msg.method==='Runtime.exceptionThrown')evidence.consoleErrors.push(msg.params.exceptionDetails.exception?.description||msg.params.exceptionDetails.text);
    else if(msg.method==='Runtime.consoleAPICalled'&&msg.params.type==='error')evidence.consoleErrors.push(msg.params.args.map(a=>a.value||a.description).join(' '));
    else if(msg.method==='Network.requestWillBeSent'){
      if(!['GET','HEAD','OPTIONS'].includes(msg.params.request.method))evidence.writeRequests.push(msg.params.request);
      else if(msg.params.request.url.includes('/api/'))evidence.apiReads.push(msg.params.request.url.replace(base,''));
    }else if(msg.method==='Network.responseReceived'&&msg.params.response.status>=400)evidence.failedResponses.push({url:msg.params.response.url,status:msg.params.response.status});
  };
  const cdp=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;const timer=setTimeout(()=>{pending.delete(n);reject(new Error(`CDP timed out: ${method}`));},10000);pending.set(n,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});socket.send(JSON.stringify({id:n,method,params}));});
  const evaluate=async expression=>{const r=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);return r.result.value;};
  const screenshot=async (name,fullPage=false)=>{const metrics=fullPage?await cdp('Page.getLayoutMetrics'):null;const data=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:fullPage,...(metrics?{clip:{x:0,y:0,width:metrics.cssContentSize.width,height:metrics.cssContentSize.height,scale:1}}:{})});await writeFile(resolve(out,name+'.png'),Buffer.from(data.data,'base64'));};
  const waitFor=async expression=>{for(let i=0;i<40;i++){if(await evaluate(expression))return;await delay(250);}throw new Error(`UI condition timed out: ${expression}`);};
  await cdp('Page.enable');await cdp('Runtime.enable');await cdp('Network.enable');
  evidence.nativeReducedMotion=await evaluate('matchMedia("(prefers-reduced-motion: reduce)").matches');
  await cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1050,deviceScaleFactor:1,mobile:false});
  await cdp('Page.navigate',{url:base+'/'});await delay(1700);
  assert.match(await evaluate('document.body.innerText'),/Networks fail/);
  assert.equal(await evaluate('document.querySelector(".runtime-bar")===null'),true);
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'),true);
  await screenshot('landing-desktop');
  assert.equal(await evaluate('document.querySelectorAll(".headline-line").length'),3);
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".headline-line:nth-child(3)>em")).animationName'),'headline-reveal');
  const samplePhase=async time=>evaluate(`document.querySelector('.network-illustration').getAnimations({subtree:true}).filter(a=>a.effect.getTiming().duration===12000).forEach(a=>{a.pause();a.currentTime=${time};})`);
  await samplePhase(2000);await delay(80);
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".story-primary")).opacity'),'1');
  await screenshot('hero-healthy');
  await samplePhase(4400);await delay(80);
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".story-failure")).opacity'),'1');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".packet-primary")).opacity'),'0');
  await screenshot('hero-link-down');
  await samplePhase(7200);await delay(80);
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".story-recovery")).opacity'),'1');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".packet-backup")).opacity'),'1');
  await screenshot('hero-recovered');
  await evaluate('document.querySelector(".network-illustration").getAnimations({subtree:true}).forEach(a=>a.play())');
  evidence.checks.push('Staged headline and healthy / link-down / recovered SVG phases verified');
  if(await evaluate('matchMedia("(hover: hover) and (pointer: fine)").matches')) {
    const center=await evaluate('(()=>{const r=document.querySelector(".hero-actions .button").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()');
    await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',...center});await delay(250);
    assert.notEqual(await evaluate('getComputedStyle(document.querySelector(".hero-actions .button")).transform'),'none');
    await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1});
    evidence.checks.push('Primary CTA hover responds without triggering navigation');
  }
  await evaluate(`document.querySelector('.landing-nav a[href="#approach"]').click()`);
  await waitFor('document.querySelector("#approach").getBoundingClientRect().top < 100 && document.querySelector("#approach").dataset.revealed === "true"');
  await delay(1100);await screenshot('landing-process');
  assert.equal(await evaluate('document.querySelector(".network-illustration").dataset.playing'),'false');
  await evaluate(`document.querySelector('.landing-nav a[href="#strategies"]').click()`);
  await waitFor('document.querySelector("#strategies").getBoundingClientRect().top < 100 && document.querySelector("#strategies").dataset.revealed === "true"');
  await delay(1100);await screenshot('landing-strategies');
  const reveals=await evaluate('document.querySelectorAll("[data-revealed=true]").length');
  await evaluate('window.__revealReplays=0;window.__originalAnimate=Element.prototype.animate;Element.prototype.animate=function(...args){if(this.closest("#approach"))window.__revealReplays++;return window.__originalAnimate.apply(this,args)}');
  await evaluate('document.querySelector("#approach").scrollIntoView()');await delay(900);
  assert.ok(await evaluate('document.querySelectorAll("[data-revealed=true]").length')>=reveals);
  assert.equal(await evaluate('window.__revealReplays'),0);
  await evaluate('Element.prototype.animate=window.__originalAnimate');
  evidence.checks.push('Native smooth anchors, once-per-section scroll reveals and offscreen illustration pause verified');
  // Reveal remaining sections before the full-page capture; no hidden fixture content.
  for(const selector of ['.capability-grid','.architecture-section','.final-cta']){await evaluate(`document.querySelector('${selector}').scrollIntoView()`);await delay(1100);}
  await evaluate('window.scrollTo({top:0,behavior:"instant"})');await delay(700);
  await screenshot('landing-full',true);
  await cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".packet")).animationName'),'none');evidence.checks.push('Reduced-motion illustration is static');
  assert.equal(await evaluate('getComputedStyle(document.documentElement).scrollBehavior'),'auto');
  assert.equal(await evaluate('document.querySelector(".hero-copy h1").getAnimations({subtree:true}).length'),0);
  await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await delay(250);
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'),true);await screenshot('landing-mobile');
  await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1050,deviceScaleFactor:1,mobile:false});
  await cdp('Page.navigate',{url:base+'/dashboard'});await delay(2000);
  await waitFor(`document.querySelectorAll('select[aria-label="Active controller"] option').length===4`);
  await waitFor('document.querySelector(".socket-status")?.innerText.includes("CONNECTED")');
  evidence.checks.push('Three actual controller options loaded and WebSocket connected');
  const pages={overview:'Network at a glance',topology:'Network inspector',controllers:'Choose a recovery strategy',traffic:'Traffic monitor',simulator:'Test a broken path',experiment:'Experiment lab',analytics:'Performance analytics',logs:'Event timeline',settings:'System & configuration'};
  for(const [tab,heading]of Object.entries(pages)){
    const path=tab==='overview'?'/dashboard':'/dashboard/'+tab;
    if(tab!=='overview'){await evaluate(`document.querySelector('nav[aria-label="Control center pages"] a[href="${path}"]').click()`);await delay(650);}
    assert.equal(await evaluate('location.pathname'),path);
    assert.equal(await evaluate('document.querySelector("main h1")?.textContent'),heading);
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'),true);
    const missingLabels=await evaluate(`Array.from(document.querySelectorAll('select,input')).filter(e=>!e.labels?.length&&!e.getAttribute('aria-label')).map(e=>e.outerHTML)`);
    assert.deepEqual(missingLabels,[],`${tab} form labels`);
    evidence.pages.push({tab,path,heading,overflow:false,labels:true});
    if(['overview','topology','experiment','traffic','analytics','logs'].includes(tab))await screenshot(tab+'-desktop');
    if(tab==='controllers')assert.equal(await evaluate('document.querySelectorAll(".controllers-page .grid > .panel").length'),3);
  }
  for(const [tab,heading] of Object.entries(pages)) {
    const path=tab==='overview'?'/dashboard':'/dashboard/'+tab;
    await cdp('Page.navigate',{url:base+path});
    await waitFor(`document.querySelector('main h1')?.textContent===${JSON.stringify(heading)}`);
  }
  evidence.checks.push('All nine dashboard deep links render directly through FastAPI');
  await cdp('Page.reload');await waitFor(`document.querySelector('main h1')?.textContent===${JSON.stringify(pages.settings)}`);evidence.checks.push('Direct refresh restores System & Config route');
  await evaluate('history.back()');await waitFor(`location.pathname==='/dashboard/logs' && document.querySelector('main h1')?.textContent===${JSON.stringify(pages.logs)}`);
  await evaluate('history.forward()');await waitFor(`location.pathname==='/dashboard/settings' && document.querySelector('main h1')?.textContent===${JSON.stringify(pages.settings)}`);evidence.checks.push('Back and forward keep URL and rendered page aligned');
  await cdp('Emulation.setDeviceMetricsOverride',{width:1024,height:900,deviceScaleFactor:1,mobile:false});await delay(250);assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'),true);await screenshot('system-laptop');
  await cdp('Emulation.setDeviceMetricsOverride',{width:768,height:1024,deviceScaleFactor:1,mobile:false});await delay(250);assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'),true);await screenshot('system-tablet');evidence.checks.push('Laptop and tablet controls do not cause page overflow');
  assert.deepEqual(evidence.writeRequests,[]);assert.deepEqual(evidence.consoleErrors,[]);assert.deepEqual(evidence.failedResponses,[]);
  evidence.apiReads=[...new Set(evidence.apiReads)];
  await writeFile(resolve(out,'browser-evidence.json'),JSON.stringify(evidence,null,2));
  console.log(JSON.stringify(evidence,null,2));
  await cdp('Browser.close');
} finally { clearInterval(keepAlive);socket?.close();browser.kill();await writeFile(resolve(out,'browser-evidence.json'),JSON.stringify(evidence,null,2)); }
