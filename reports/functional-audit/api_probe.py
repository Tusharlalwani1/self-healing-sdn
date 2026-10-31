"""Audit-only HTTP probe; preserves DB records and records raw responses."""
import json, time, urllib.request, urllib.error, pathlib, sys
OUT = pathlib.Path(__file__).parent / 'api-evidence.jsonl'
def request(method, path, body=None, label=''):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request('http://127.0.0.1:8000'+path, data=data, method=method, headers={'Content-Type':'application/json'})
    started = time.time()
    try:
        with urllib.request.urlopen(req, timeout=45) as response:
            code, raw = response.status, response.read().decode()
    except urllib.error.HTTPError as e:
        code, raw = e.code, e.read().decode()
    except Exception as e:
        code, raw = 0, str(e)
    try: result = json.loads(raw)
    except Exception: result = raw
    record = dict(timestamp=time.time(), label=label, method=method, path=path, body=body, http=code, elapsed=round(time.time()-started,3), response=result)
    with OUT.open('a') as f: f.write(json.dumps(record)+'\n')
    print(label or path, code, str(result)[:240], flush=True)
    return result
if __name__ == '__main__':
    for path in ['/api/system/health','/api/system/status','/api/controllers','/api/controllers/logs','/api/simulation/status','/api/topology','/api/topology/switch/1','/api/traffic/stats','/api/experiments/history','/api/events/logs','/api/reports/export-all?format=json','/api/reports/export-all?format=csv','/api/experiments/audit-missing','/api/reports/audit-missing/export','/api/reports/audit-missing/export?format=bad','/api/topology/switch/nope','/api/nonexistent','/']:
        request('GET',path)
    for method,path,body in [('POST','/api/controllers/select',{}),('POST','/api/controllers/select',{'controller_type':'invalid'}),('POST','/api/links/down',{}),('POST','/api/traffic/start',{'interval':'bad'}),('POST','/api/experiments/run',{'packet_count':'bad'}),('DELETE','/api/experiments/audit-missing',None),('POST','/api/experiments/cancel',None),('POST','/api/traffic/stop',None),('POST','/api/links/down',{'node1':'s1','node2':'s2'}),('POST','/api/links/up',{'node1':'s1','node2':'s2'}),('POST','/api/links/restore-all',None),('POST','/api/traffic/start',{}),('POST','/api/simulation/stop',None),('POST','/api/simulation/stop',None)]:
        request(method,path,body,'stopped/invalid')
    request('POST','/api/simulation/start',{},'native start no controller selected')
    request('GET','/api/simulation/status',label='native start result')
    request('POST','/api/simulation/stop',label='native cleanup')
    request('POST','/api/controllers/stop',label='native cleanup')
