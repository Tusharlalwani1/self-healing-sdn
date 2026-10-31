import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const dir = new URL('.', import.meta.url);
const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const target = targets.find(t=>t.type==='page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve=>ws.addEventListener('open',resolve,{once:true}));
let id=0; const pending=new Map();
const out=record=>fs.appendFileSync(new URL('browser-evidence.jsonl',dir),JSON.stringify({time:new Date().toISOString(),...record})+'\n');
ws.addEventListener('message',e=>{const m=JSON.parse(e.data); if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);} else {if(/Runtime.exceptionThrown|Runtime.consoleAPICalled|Log.entryAdded|Network.webSocket|Network.loadingFailed|Page.javascriptDialog|Browser.download/.test(m.method))out(m);if(m.method==='Page.javascriptDialogOpening')call('Page.handleJavaScriptDialog',{accept:false});}});
function call(method,params={}){return new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));});}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function evaluate(expression){const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});return r.exceptionDetails || r.result.value;}
for(const domain of ['Runtime','Page','Network','Log'])await call(domain+'.enable');
fs.mkdirSync(new URL('downloads/',dir),{recursive:true});
await call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:fileURLToPath(new URL('downloads/',dir)),eventsEnabled:true});
await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
const steps=JSON.parse(fs.readFileSync(new URL(process.argv[2]||'browser-steps.json',dir),'utf8'));
for(const step of steps){
 if(step.cdp)await call(step.cdp,step.params||{});
 if(step.navigate)await call('Page.navigate',{url:step.navigate});
 if(step.click){const status=`(()=>{const b=[...document.querySelectorAll('button,a')].find(b=>b.textContent.trim().includes(${JSON.stringify(step.click)}));return b ? (b.disabled?'DISABLED':'READY'):'NOT FOUND'})()`;const deadline=Date.now()+45000;while(await evaluate(status)==='DISABLED' && Date.now()<deadline)await pause(300);const value=await evaluate(`(()=>{const b=[...document.querySelectorAll('button,a')].find(b=>b.textContent.trim().includes(${JSON.stringify(step.click)})); if(!b)return 'NOT FOUND'; if(b.disabled)return 'DISABLED';b.click();return b.textContent.trim()})()`);out({action:step,result:value});}
 if(step.eval)out({action:step,result:await evaluate(step.eval)});
 await pause(step.wait??800);
 if(step.until){const end=Date.now()+45000;while(Date.now()<end && !await evaluate(step.until))await pause(300);out({until:step.until,result:await evaluate(step.until)});}
 if(step.snapshot){const r=await evaluate(`({text:document.body.innerText,buttons:[...document.querySelectorAll('button')].map(b=>({text:b.textContent.trim(),disabled:b.disabled})),selects:[...document.querySelectorAll('select')].map(s=>({value:s.value,options:[...s.options].map(o=>({text:o.text,value:o.value}))}))})`);out({snapshot:step.snapshot,result:r});console.log(step.snapshot,JSON.stringify(r).slice(0,450));}
 if(step.sdn){const result=execFileSync('wsl.exe',['-d','Ubuntu-22.04','-u','root','--','/usr/bin/python3','/mnt/e/Projects/self-healing-sdn/reports/functional-audit/sdn_snapshot.py',step.sdn],{encoding:'utf8',timeout:30000});console.log(result.slice(0,700));}
 if(step.signal){console.log(execFileSync('wsl.exe',['-d','Ubuntu-22.04','-u','root','--','/usr/bin/python3','/mnt/e/Projects/self-healing-sdn/reports/functional-audit/controller_signal.py',step.signal],{encoding:'utf8',timeout:10000}));}
 if(step.screenshot){const r=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(new URL(step.screenshot,dir),Buffer.from(r.data,'base64'));}
}
ws.close();
