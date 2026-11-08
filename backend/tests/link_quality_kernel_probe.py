"""Run ONLY inside an isolated `unshare -n` namespace as root.

Exercises the production TC helper against Linux veth/netem, not Mininet/Ryu.
Usage: unshare -n python3 -m backend.tests.link_quality_kernel_probe
"""
import json
import os
import socket
import subprocess
import time
from types import SimpleNamespace
from backend.services.link_quality import LinkQuality


def run(*args):
    return subprocess.check_output(args,text=True)


def main():
    # Refuse to create interfaces in the machine's normal network namespace.
    if os.readlink('/proc/self/ns/net') == os.readlink('/proc/1/ns/net'):
        raise RuntimeError('This probe requires an isolated network namespace')
    # Eliminate autonomous IPv6 discovery packets from the exact-count fixture.
    run('sysctl','-qw','net.ipv6.conf.all.disable_ipv6=1','net.ipv6.conf.default.disable_ipv6=1')
    run('ip','link','add','p5a','type','veth','peer','name','p5b')
    interfaces=[]
    for name,node in (('p5a','s1'),('p5b','s2')):
        run('ip','link','set',name,'up')
        run('tc','qdisc','add','dev',name,'root','handle','5:','htb','default','1')
        run('tc','class','add','dev',name,'parent','5:','classid','5:1','htb','rate','10mbit')
        run('tc','qdisc','add','dev',name,'parent','5:1','handle','10:','netem','delay','5ms')
        interfaces.append(SimpleNamespace(name=name,node=SimpleNamespace(name=node),params={'delay':'5ms','bw':10},
            isUp=lambda:True))
    worker=SimpleNamespace(runtime_id='isolated-probe',topology_id='diamond',net=SimpleNamespace(
        switches=[i.node for i in interfaces],links=[SimpleNamespace(intf1=interfaces[0],intf2=interfaces[1])]))
    quality=LinkQuality(worker)
    checks=[]
    for delay,loss in ((100,0),(0,10),(80,5)):
        quality.change(worker.runtime_id,'s1','s2',delay,loss)
        record=quality.snapshot(worker.runtime_id)['links'][0]
        assert record['operational_status']=='UP'
        assert abs(record['configured_additional_delay_ms']-delay)<.001
        assert abs(record['configured_loss_percent']-loss)<.001
        checks.append(f'Kernel confirmed both directions: +{delay}ms / {loss}% loss, UP')
    quality.change(worker.runtime_id,'s1','s2',0,100)
    before=quality.snapshot(worker.runtime_id)['links'][0]['endpoints'][0]
    with socket.socket(socket.AF_PACKET,socket.SOCK_RAW) as sock:
        sock.bind(('p5a',0))
        frame=b'\xff'*6+b'\x02\x00\x00\x00\x00\x01'+b'\x88\xb5'+b'phase5-probe'.ljust(46,b'\0')
        for _ in range(20):sock.send(frame)
    time.sleep(.05)
    after=quality.snapshot(worker.runtime_id)['links'][0]['endpoints'][0]
    assert after['drops']-before['drops']==20
    assert after['packets']-before['packets']==0
    checks.append('100% netem loss: 20 real Ethernet attempts, 20 qdisc drops, 0 dequeued packets')
    quality.clear_all(worker.runtime_id)
    quality.clear_all(worker.runtime_id)
    for intf in interfaces:
        state=json.loads(run('tc','-j','qdisc','show','dev',intf.name))
        assert sum(q['kind']=='netem' for q in state)==1
        assert sum(q['kind']=='htb' for q in state)==1
        q=quality.read(intf)
        assert abs(q['delay_ms']-5)<.001 and q['loss_percent']==0
        # Ubuntu's tc emits plain text for class output even with -j.
        classes=run('tc','class','show','dev',intf.name)
        assert 'rate 10Mbit' in classes
    checks.append('Repeated clear: one netem, original 5ms / 0% loss, HTB class remains 10Mbps in both directions')
    print(json.dumps({'scope':'Isolated Linux kernel veth/netem probe; NOT live Mininet verification','checks':checks},indent=2))


if __name__=='__main__':
    main()
