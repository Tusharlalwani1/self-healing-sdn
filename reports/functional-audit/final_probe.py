import subprocess,sys,os,signal,time,pathlib,json
from api_probe import request
root=pathlib.Path(__file__).resolve().parents[2]
def snapshot(label):
    subprocess.run(['/usr/bin/python3',str(pathlib.Path(__file__).parent/'sdn_snapshot.py'),label],check=True)
snapshot('early-cancel-process-cleanup')
request('POST','/api/experiments/run',dict(controller='invalid'),label='invalid experiment controller')
request('POST','/api/simulation/reset',label='reset simulation while running')
snapshot('after-reset')
subprocess.run(['/usr/bin/python3',str(pathlib.Path(__file__).parent/'controller_signal.py'),'TERM'],check=True)
time.sleep(1)
request('GET','/api/controllers',label='unexpected Ryu exit controller status')
request('GET','/api/simulation/status',label='unexpected Ryu exit simulation status')
request('GET','/api/system/status',label='unexpected Ryu exit port status')
snapshot('unexpected-controller-exit')
request('POST','/api/simulation/stop',label='final stop network')
time.sleep(1)
snapshot('network-stopped-worker-alive')
for path,body in [('/api/links/down',dict(node1='s1',node2='s2')),('/api/links/up',dict(node1='s1',node2='s2')),('/api/links/restore-all',None),('/api/traffic/start',dict(count=2)),('/api/traffic/stop',None),('/api/simulation/stop',None)]:
    request('POST',path,body,label='stopped worker available')
request('POST','/api/controllers/stop',label='final stop controller')
request('GET','/api/events/logs?limit=30',label='stopped invalid actions logged')
# Remove only the worker fixture started by this audit; never use broad cleanup.
for pid in subprocess.check_output(['pgrep','-f','mininet_worker.py'],text=True).split():
    try:
        cmd=pathlib.Path('/proc',pid,'cmdline').read_bytes().replace(b'\0',b' ').decode()
        if cmd.startswith('/usr/bin/python3 ') and str(root/'backend/services/mininet_worker.py') in cmd:
            os.kill(int(pid),signal.SIGTERM)
    except ProcessLookupError:pass
time.sleep(1)
request('POST','/api/simulation/stop',label='worker unavailable false-success stop')
snapshot('final-clean-state')
db=__import__('sqlite3').connect('file:'+str(root/'data/sdn_dashboard.db')+'?mode=ro',uri=True)
summary={table:db.execute('SELECT COUNT(*) FROM '+table).fetchone()[0] for table in ['experiments','event_logs']}
summary['historical_experiment_preserved']=db.execute("SELECT COUNT(*) FROM experiments WHERE id='exp_20261027_120440_reactive'").fetchone()[0]
summary['remaining_bridges']=subprocess.check_output(['ovs-vsctl','list-br'],text=True)
summary['worker_socket_exists']=os.path.exists('/tmp/mininet_worker.sock')
db.close()
(pathlib.Path(__file__).parent/'final-cleanup-evidence.json').write_text(json.dumps(summary,indent=2))
print(summary)
