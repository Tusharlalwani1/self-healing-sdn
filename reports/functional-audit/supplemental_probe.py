import asyncio,json,pathlib,sys,sqlite3,time
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]))
from api_probe import request
import websockets
async def ws_test():
    results=[]
    for i in range(2):
        async with websockets.connect('ws://127.0.0.1:8000/ws/events') as ws:
            initial=json.loads(await ws.recv()); await ws.send('ping')
            pong=await ws.recv(); await ws.send('{invalid JSON')
            await ws.send('ping'); again=await ws.recv()
            results.append(dict(connection=i,initial=initial,pong=pong,after_malformed=again))
    (pathlib.Path(__file__).parent/'websocket-probe.json').write_text(json.dumps(results,indent=2))
asyncio.run(ws_test())
history=request('GET','/api/experiments/history',label='post-experiment persistence')
if history:
    eid=history[0]['id']
    request('GET','/api/experiments/'+eid,label='stored experiment detail')
    for fmt in ['json','csv','html']:
        request('GET',f'/api/reports/{eid}/export?format={fmt}',label='stored report export')
for path in ['/api/experiments/history?limit=-1','/api/events/logs?limit=-1','/api/reports/export-all?format=invalid','/api/topology/switch/999']:
    request('GET',path,label='edge cases')
for path,body in [('/api/links/down',dict(node1='s1',node2='s4')),('/api/links/up',dict(node1='missing',node2='s2')),('/api/traffic/start',dict(src='missing',dst='h2',count=2))]:
    request('POST',path,body,label='invalid SDN input')
request('POST','/api/traffic/stop',label='invalid traffic cleanup')
request('GET','/api/events/logs?limit=15',label='invalid actions persistence check')
