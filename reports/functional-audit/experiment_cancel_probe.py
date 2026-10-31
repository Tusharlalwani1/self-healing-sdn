import asyncio,json,pathlib,sys,time, socket
from api_probe import request
import websockets
async def probe(trigger,label):
    async with websockets.connect('ws://127.0.0.1:8000/ws/events') as ws:
        await ws.recv()
        run=asyncio.create_task(asyncio.to_thread(request,'POST','/api/experiments/run',dict(controller='fast_failover',packet_count=int(sys.argv[3]) if len(sys.argv)>3 else 40,traffic_interval=0.1,failure_delay_sec=2,fail_link_src='s1',fail_link_dst='s2'),label))
        cancelled=False
        events=[]
        deadline=time.monotonic()+70
        while time.monotonic()<deadline and not run.done():
            try: msg=json.loads(await asyncio.wait_for(ws.recv(),timeout=1))
            except asyncio.TimeoutError:continue
            if msg.get('event_type','').startswith('EXPERIMENT'):
                events.append(msg)
                if msg.get('status')==trigger and not cancelled:
                    await asyncio.to_thread(request,'POST','/api/experiments/cancel',None,label+' cancel')
                    cancelled=True
        result=await run
        # Collect worker jobs without altering them, to check cleanup.
        s=socket.socket(socket.AF_UNIX);s.settimeout(4);s.connect('/tmp/mininet_worker.sock')
        logs=request('GET','/api/events/logs?limit=30',label=label+' events')
        records=dict(label=label,trigger=trigger,cancelled=cancelled,result=result,events=events)
        with (pathlib.Path(__file__).parent/'cancellation-evidence.jsonl').open('a') as f:f.write(json.dumps(records)+'\n')
        s.close()
asyncio.run(probe(sys.argv[1],sys.argv[2]))
