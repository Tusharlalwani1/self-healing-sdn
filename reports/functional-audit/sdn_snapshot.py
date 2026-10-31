import subprocess, json, pathlib, time, sys, sqlite3
from api_probe import request
label=sys.argv[1]
commands=[['pgrep','-af','ryu-manager|mininet_worker|mnexec|ping -i'],['ovs-vsctl','show'],['ovs-vsctl','--columns=target,is_connected','list','Controller'],['ip','-br','link']]
for sw in ['s1','s2','s3','s4']:
    commands += [['ovs-vsctl','get','bridge',sw,'protocols']]
    for kind in ['dump-flows','dump-groups','dump-group-stats','dump-ports']:
        commands += [['ovs-ofctl','-O','OpenFlow13',kind,sw]]
results=[]
for cmd in commands:
    p=subprocess.run(cmd,capture_output=True,text=True,timeout=5)
    results.append(dict(command=cmd,returncode=p.returncode,stdout=p.stdout,stderr=p.stderr))
with (pathlib.Path(__file__).parent/'sdn-evidence.jsonl').open('a') as f:
    f.write(json.dumps(dict(label=label,timestamp=time.time(),commands=results))+'\n')
for path in ['/api/simulation/status','/api/topology','/api/traffic/stats','/api/controllers/logs']:
    request('GET',path,label=label)
print('OVS snapshot saved:',label)
