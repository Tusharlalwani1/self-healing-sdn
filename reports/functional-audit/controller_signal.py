import os,signal,subprocess,sys,json,pathlib,time
action=sys.argv[1]
pids=[]
for pid in subprocess.check_output(['pgrep','-f','/ryu-manager'],text=True).split():
    try:
        cmd=pathlib.Path('/proc',pid,'cmdline').read_bytes().replace(b'\0',b' ').decode()
        if '/controller_ff.py' in cmd and 'python' in cmd:
            os.kill(int(pid),getattr(signal,'SIG'+action));pids.append(int(pid))
    except ProcessLookupError: pass
record=dict(action=action,pids=pids,time=time.time())
with (pathlib.Path(__file__).parent/'signal-evidence.jsonl').open('a') as f:f.write(json.dumps(record)+'\n')
print(record)
