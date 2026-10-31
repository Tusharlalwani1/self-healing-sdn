const version=await(await fetch('http://127.0.0.1:9222/json/version')).json();
const ws=new WebSocket(version.webSocketDebuggerUrl);
await new Promise(resolve=>ws.addEventListener('open',resolve,{once:true}));
ws.send(JSON.stringify({id:1,method:'Browser.close'}));
await new Promise(resolve=>ws.addEventListener('close',resolve,{once:true}));
console.log('Closed only the separate audit browser.');
