"""Phase 5 deterministic worker/kernel-boundary and service/API regressions.

FakeKernel is an explicit TC transport fixture, not claimed live Mininet evidence.
All database tests use a temporary file.
"""
import asyncio
import copy
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from pydantic import ValidationError
from backend.api import link_health as routes
from backend.database import db
from backend.models.link_health import HealthConfig, InjectionRequest
from backend.services.link_health import LinkHealthService
from backend.services.link_quality import LinkQuality
from backend.services.mininet_client import MininetClient
from backend.services.mininet_worker import MininetWorker
from backend.services.operation_error import OperationError, validate_worker_result
from backend.services.topology_catalog import TOPOLOGIES
from backend.tests.test_runtime_errors import request


class FakeKernel:
    def __init__(self, topology='diamond'):
        self.states = {}
        self.commands = []
        self.fail = set()
        definition = TOPOLOGIES[topology]
        switches = [SimpleNamespace(name=n) for n in definition['switches']]
        nodes = {n.name:n for n in switches}
        nodes.update({n:SimpleNamespace(name=n) for n in ('h1','h2')})
        links = []
        for index, pair in enumerate([*definition['inter_switch_links'], *definition['host_links']]):
            intfs = []
            for node in pair:
                intf = SimpleNamespace(name=f'{node}-eth{index}',node=nodes[node],params={'delay':'5ms','bw':10},up=True)
                intf.isUp = lambda intf=intf: intf.up
                intfs.append(intf)
                self.states[intf.name] = {'kind':'netem','handle':'10:','parent':'5:1',
                    'options':{'limit':1000,'delay':{'delay':.005,'jitter':0,'correlation':0},'ecn':False,'gap':0},'packets':0,'drops':0}
            links.append(SimpleNamespace(intf1=intfs[0],intf2=intfs[1]))
        self.worker = SimpleNamespace(net=SimpleNamespace(links=links,switches=switches),runtime_id='r1',topology_id=topology)
        self.quality = LinkQuality(self.worker)
        self.quality.tc = self.tc

    def tc(self, args):
        self.commands.append(args)
        name = args[args.index('dev')+1]
        if args[0] == '-j':
            return json.dumps([self.states[name]])
        if name in self.fail:
            raise OperationError(502,'Fixture tc failure')
        q = self.states[name]
        q['options']['delay']['delay'] = float(args[args.index('delay')+1][:-2])/1000
        q['options']['loss-random'] = {'loss':float(args[args.index('loss')+1][:-1])/100,'correlation':0}
        return ''

    def packets(self, sent=10, dropped=0):
        for q in self.states.values():
            q['packets'] += sent
            q['drops'] += dropped


class QualityWorkerTests(unittest.TestCase):
    def setUp(self):
        self.kernel = FakeKernel()
        self.q = self.kernel.quality

    def test_delay_loss_and_combined_remain_up(self):
        for delay, loss in ((100,0),(0,10),(80,5)):
            self.q.change('r1','s1','s2',delay,loss)
            record = self.q.snapshot('r1')['links'][0]
            self.assertEqual(record['operational_status'],'UP')
            self.assertAlmostEqual(record['configured_additional_delay_ms'],delay)
            self.assertAlmostEqual(record['configured_loss_percent'],loss)
            self.assertEqual([e['delay_ms'] for e in record['endpoints']],[5+delay]*2)
        self.assertTrue(all(cmd[:2] == ['qdisc','change'] for cmd in self.kernel.commands if cmd[0] != '-j'))

    def test_clear_preserves_original_delay_limit_parent_and_bandwidth(self):
        self.q.change('r1','s1','s2',100,10)
        self.q.change('r1','s2','s1',clear=True)
        record = self.q.snapshot('r1')['links'][0]
        self.assertEqual(record['configured_additional_delay_ms'],0)
        self.assertEqual(record['configured_loss_percent'],0)
        self.assertFalse(record['injected'])
        for e in record['endpoints']:
            self.assertEqual((e['delay_ms'],e['parent'],e['limit']),(5,'5:1',1000))
        self.assertFalse(self.q.change('r1','s1','s2',clear=True)['changed'])
        self.assertTrue(all(i.params['bw'] == 10 for l in self.kernel.worker.net.links for i in (l.intf1,l.intf2)))

    def test_invalid_missing_host_down_and_stale_requests(self):
        cases = [('r1','s1','s2',-1,0,400),('r1','s1','s2',0,101,400),
                 ('r1','s1','s2',float('nan'),0,400),('r1','s1','s2',0,0,400),
                 ('r1','s1','s9',10,0,404),('r1','h1','s1',10,0,400),('old','s1','s2',10,0,409)]
        for runtime,a,b,delay,loss,status in cases:
            with self.subTest(a=a,b=b,delay=delay,loss=loss):
                with self.assertRaises(OperationError) as exc:self.q.change(runtime,a,b,delay,loss)
                self.assertEqual(exc.exception.status_code,status)
        self.kernel.worker.net.links[0].intf1.up=False
        with self.assertRaises(OperationError) as exc:self.q.change('r1','s1','s2',100,0)
        self.assertEqual(exc.exception.status_code,409)
        self.kernel.worker.net=None
        with self.assertRaises(OperationError):self.q.snapshot('r1')

    def test_dynamic_bulk_both_topologies_and_idempotency(self):
        for topology,count in (('diamond',4),('multipath_mesh',14)):
            kernel = FakeKernel(topology)
            for a,b in TOPOLOGIES[topology]['inter_switch_links']:
                kernel.quality.change('r1',a,b,80,5)
            result = kernel.quality.clear_all('r1')
            self.assertEqual(result['total_links'],count)
            self.assertEqual(len(result['results']),count)
            self.assertTrue(all(not r['injected'] for r in kernel.quality.snapshot('r1')['links']))
            self.assertTrue(all(r['status']=='unchanged' for r in kernel.quality.clear_all('r1')['results']))

    def test_partial_worker_failure_identifies_link_and_rollback(self):
        self.q.change('r1','s1','s2',100,10)
        self.q.change('r1','s2','s4',100,10)
        name = self.kernel.worker.net.links[0].intf1.name
        self.kernel.fail.add(name)
        with self.assertRaises(OperationError) as exc:self.q.clear_all('r1')
        failures = [r for r in exc.exception.results if r['status']=='error']
        self.assertEqual([r['link_id'] for r in failures],['s1-s2'])
        self.assertIn(name,failures[0]['details']['rollback_failed_interfaces'])
        self.assertIn('s1-s2',self.q.originals)
        self.assertNotIn('s2-s4',self.q.originals)

    def test_down_clear_is_error_and_does_not_restore_hard_link(self):
        self.q.change('r1','s1','s2',100,0)
        self.kernel.worker.net.links[0].intf2.up=False
        with self.assertRaises(OperationError):self.q.clear_all('r1')
        self.assertFalse(self.kernel.worker.net.links[0].intf2.up)
        self.assertIn('s1-s2',self.q.originals)

    def test_unsupported_qdisc_rejected_before_mutation(self):
        state = next(iter(self.kernel.states.values()))
        state['options']['reorder']={'correlation':.1}
        with self.assertRaises(OperationError):self.q.change('r1','s1','s2',100,0)
        self.assertFalse(any(c[0]=='qdisc' for c in self.kernel.commands))

    def test_worker_error_results_survive_transport(self):
        with self.assertRaises(OperationError) as exc:
            validate_worker_result({'status':'error','message':'Partial restore','results':[{'link_id':'s2-s5'}]},'clear_all_degradations')
        self.assertEqual(exc.exception.status_code,502)
        self.assertEqual(exc.exception.results,[{'link_id':'s2-s5'}])

    def test_worker_stop_clears_quality_ownership_for_next_topology(self):
        worker=MininetWorker()
        self.kernel.worker=worker
        worker.net=FakeKernel().worker.net
        worker.net.stop=lambda:None
        worker.runtime_id='r1';worker.topology_id='diamond'
        worker.link_quality.originals={'s1-s2':[{'delay_ms':5}]}
        worker.link_quality.revisions={'s1-s2':3}
        with patch.object(worker,'_clean_simulation_resources'):
            worker.stop_network()
        self.assertIsNone(worker.net)
        self.assertEqual(worker.link_quality.originals,{})
        self.assertEqual(worker.link_quality.revisions,{})

    def test_hard_down_up_between_polls_invalidates_quality_window_without_clearing_impairment(self):
        worker=MininetWorker();worker.net=self.kernel.worker.net;worker.link_quality=self.q
        def status(a,b,state):
            for link in worker.net.links:
                if {link.intf1.node.name,link.intf2.node.name}=={a,b}:
                    link.intf1.up=link.intf2.up=state=='up'
        worker.net.configLinkStatus=status
        self.q.change('r1','s1','s2',100,0)
        initial=self.q.revisions['s1-s2']
        with patch('backend.services.mininet_worker.OVSSwitch',SimpleNamespace,create=True), patch('backend.services.mininet_worker.subprocess.run'):
            worker.set_link_status('s1','s2','down')
            worker.set_link_status('s1','s2','up')
        self.assertEqual(self.q.revisions['s1-s2'],initial+2)
        self.assertEqual(self.q.snapshot('r1')['links'][0]['configured_additional_delay_ms'],100)


class HealthServiceTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.kernel=FakeKernel()
        self.client=MininetClient()
        self.client.runtime_id='r1';self.client.runtime_revision=1;self.client.simulation_state='RUNNING'
        self.client.controller_type='reactive';self.client.controller_generation='g1'
        self.time=100.
        self.events=[]
        self.broadcast=AsyncMock()
        self.service=LinkHealthService(self.client,self.broadcast,self.events.append,clock=lambda:self.time)
        async def command(payload,**_):
            cmd=payload['command']
            if cmd=='get_link_quality':return self.kernel.quality.snapshot(payload['runtime_id'])
            if cmd=='clear_all_degradations':return self.kernel.quality.clear_all(payload['runtime_id'])
            return self.kernel.quality.change(payload['runtime_id'],payload['src'],payload['dst'],
                payload.get('additional_delay_ms',0),payload.get('loss_percent',0),clear=cmd=='clear_degradation')
        self.client._send_command=AsyncMock(side_effect=command)

    async def healthy(self):
        await self.service.sample()
        self.time+=2;self.kernel.packets()
        return await self.service.sample()

    async def test_no_traffic_unknown_and_null_not_zero(self):
        await self.service.sample();self.time+=2
        snapshot=await self.service.sample()
        for record in snapshot['links']:
            self.assertEqual(record['health_status'],'UNKNOWN')
            self.assertIsNone(record['observed_loss_percent']);self.assertIsNone(record['observed_avg_rtt_ms'])

    async def test_transitions_escalation_no_duplicates_and_confirmed_recovery(self):
        snapshot=await self.healthy()
        self.assertEqual(snapshot['links'][0]['health_status'],'HEALTHY')
        self.kernel.quality.change('r1','s1','s2',50,0)
        await self.service.sample();await self.service.sample()
        self.assertEqual(len([e for e in self.events if e['link_id']=='s1-s2']),2)
        self.assertEqual(self.service.records['s1-s2']['health_status'],'DEGRADED')
        self.kernel.quality.change('r1','s1','s2',100,10)
        await self.service.sample();await self.service.sample()
        record=self.service.records['s1-s2']
        self.assertEqual(record['health_status'],'CRITICAL')
        self.assertEqual(record['configured_loss_percent'],10)
        self.assertIsNone(record['observed_loss_percent'])
        self.kernel.quality.change('r1','s1','s2',clear=True)
        await self.service.sample()
        self.assertEqual(self.service.records['s1-s2']['health_status'],'UNKNOWN')
        self.time+=2;self.kernel.packets();await self.service.sample()
        self.assertEqual(self.service.records['s1-s2']['health_status'],'HEALTHY')
        self.assertEqual([e['current_health'] for e in self.events if e['link_id']=='s1-s2'],
                         ['HEALTHY','DEGRADED','CRITICAL','UNKNOWN','HEALTHY'])

    async def test_measured_loss_uses_counter_delta_not_configured_probability(self):
        await self.service.sample();self.time+=2;self.kernel.packets(80,20)
        await self.service.sample()
        record=self.service.records['s1-s2']
        self.assertEqual(record['configured_loss_percent'],0)
        self.assertEqual(record['observed_loss_percent'],20)
        self.assertEqual(record['sample_count'],200)
        self.assertEqual(record['health_status'],'CRITICAL')

    async def test_hard_down_invalidates_health_and_up_reevaluates(self):
        await self.healthy()
        self.kernel.worker.net.links[0].intf1.up=False
        await self.service.sample()
        record=self.service.records['s1-s2']
        self.assertEqual((record['operational_status'],record['health_status']),('DOWN','UNKNOWN'))
        self.assertIsNone(record['observed_loss_percent'])
        self.kernel.worker.net.links[0].intf1.up=True
        await self.service.sample()
        self.assertEqual(self.service.records['s1-s2']['health_status'],'UNKNOWN')

    async def test_counter_reset_and_idle_expire_healthy(self):
        await self.healthy()
        self.time+=2
        for q in self.kernel.states.values():q['packets']=0
        await self.service.sample()
        self.assertEqual(self.service.records['s1-s2']['health_status'],'UNKNOWN')
        self.assertIsNone(self.service.records['s1-s2']['observed_loss_percent'])

    async def test_single_direction_does_not_prove_healthy_but_can_prove_loss(self):
        await self.service.sample();self.time+=2
        interface=self.kernel.worker.net.links[0].intf1.name
        self.kernel.states[interface]['packets']=20
        await self.service.sample()
        self.assertEqual(self.service.records['s1-s2']['health_status'],'UNKNOWN')
        self.time+=2;self.kernel.states[interface]['drops']=20
        await self.service.sample()
        self.assertEqual(self.service.records['s1-s2']['observed_loss_percent'],100)
        self.assertEqual(self.service.records['s1-s2']['health_status'],'CRITICAL')

    async def test_unbounded_sampling_gap_cannot_prove_health(self):
        await self.service.sample();self.time+=20;self.kernel.packets(100)
        await self.service.sample()
        self.assertEqual(self.service.records['s1-s2']['health_status'],'UNKNOWN')
        self.assertIsNone(self.service.records['s1-s2']['observed_loss_percent'])

    async def test_monitor_worker_failure_invalidates_and_shutdown_cancels(self):
        await self.healthy()
        self.client._send_command=AsyncMock(side_effect=OperationError(502,'Worker unavailable'))
        self.broadcast.reset_mock()
        received=asyncio.Event()
        async def capture(message):
            if message.get('error'):received.set()
        self.broadcast.side_effect=capture
        with self.assertLogs('sdn.link_health',level='ERROR'):
            self.service.start()
            await asyncio.wait_for(received.wait(),2)
            await self.service.shutdown()
        self.assertEqual(self.service.current()['links'],[])
        self.assertIsNone(self.service.task)

    async def test_runtime_topology_generation_ownership(self):
        await self.healthy();old=self.service.owner
        self.client.runtime_id='r2';self.client.runtime_revision=2;self.client.topology_id='multipath_mesh'
        self.client._notify_runtime()
        self.assertEqual(self.service.current()['links'],[])
        with self.assertRaises(OperationError):await self.service.consume(self.kernel.quality.snapshot('r1'),old)
        self.kernel=FakeKernel('multipath_mesh');self.kernel.worker.runtime_id='r2'
        snapshot=await self.service.sample()
        self.assertEqual(len(snapshot['links']),14)
        self.assertTrue(all(r['health_status']=='UNKNOWN' for r in snapshot['links']))
        self.client.controller_generation='g2'
        self.assertEqual(self.service.current()['links'],[])

    async def test_mutation_pins_runtime_and_refreshes_kernel_state(self):
        req={'runtime_id':'r1','runtime_revision':1,'src':'s1','dst':'s2','additional_delay_ms':100,'loss_percent':0}
        await self.service.mutate('inject_degradation',req)
        self.assertEqual(self.service.records['s1-s2']['health_status'],'CRITICAL')
        with self.assertRaises(OperationError):await self.service.mutate('inject_degradation',{**req,'runtime_revision':0})

    async def test_stale_rpc_response_cannot_publish(self):
        async def stale(*_,**__):
            self.client.runtime_revision+=1
            return self.kernel.quality.snapshot('r1')
        self.client._send_command=AsyncMock(side_effect=stale)
        with self.assertRaises(OperationError):await self.service.sample()
        self.broadcast.assert_not_awaited()

    async def test_failed_partial_mutation_invalidates_cached_healthy(self):
        await self.healthy()
        self.client._send_command=AsyncMock(side_effect=OperationError(502,'Partial TC write',results=['s1-s2']))
        with self.assertRaises(OperationError) as exc:
            await self.service.mutate('inject_degradation',{'runtime_id':'r1','runtime_revision':1,'src':'s1','dst':'s2'})
        self.assertEqual(exc.exception.results,['s1-s2'])
        self.assertEqual(self.service.current()['links'],[])

    async def test_mutation_readback_rejects_runtime_changed_between_commands(self):
        original_sample=self.service.sample
        async def changed(**kwargs):
            self.client.runtime_revision+=1
            return await original_sample(**kwargs)
        self.service.sample=changed
        with self.assertRaises(OperationError) as exc:
            await self.service.mutate('inject_degradation',{'runtime_id':'r1','runtime_revision':1,
                'src':'s1','dst':'s2','additional_delay_ms':100,'loss_percent':0})
        self.assertEqual(exc.exception.status_code,409)

    async def test_config_validation_and_missing_evidence(self):
        for kwargs in ({'healthy_loss_percent':20},{'critical_loss_percent':float('nan')},{'observation_window_sec':0}):
            with self.assertRaises(ValidationError):HealthConfig(**kwargs)
        await self.healthy()
        snapshot=await self.service.update_config(HealthConfig(healthy_loss_percent=2))
        self.assertTrue(all(r['health_status']=='UNKNOWN' for r in snapshot['links']))

    async def test_api_validation_errors_stopped_stale_and_experiment_guard(self):
        app=FastAPI();app.include_router(routes.router)
        with patch.object(routes,'link_health',self.service):
            body={'runtime_id':'r1','runtime_revision':1,'src':'s1','dst':'s2','additional_delay_ms':100}
            status,_=await request(app,'/api/degradation/inject',body)
            self.assertEqual(status,200)
            for extra in ({'loss_percent':101},{'loss_percent':float('inf')},{'additional_delay_ms':-1}):
                status,_=await request(app,'/api/degradation/inject',{**body,**extra})
                self.assertEqual(status,422)
            status,data=await request(app,'/api/link-health',method='GET')
            self.assertEqual(status,200);self.assertEqual(len(data['links']),4)
            with patch.object(routes,'require_manual_control',side_effect=OperationError(409,'Experiment owns runtime')):
                status,_=await request(app,'/api/degradation/clear-all',{'runtime_id':'r1','runtime_revision':1})
                self.assertEqual(status,409)
            status,_=await request(app,'/api/degradation/inject',{**body,'runtime_id':'old'})
            self.assertEqual(status,409)
            self.client.simulation_state='STOPPED'
            status,_=await request(app,'/api/degradation/inject',body)
            self.assertEqual(status,409)

    async def test_persistence_round_trip_preserves_old_tables_and_only_transitions(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(db,'DB_PATH',Path(directory)/'test.sqlite'):
            db.init_db();db.init_db()
            self.service.persist=db.save_degradation_incident
            await self.service.sample()
            self.kernel.quality.change('r1','s1','s2',100,10)
            await self.service.sample();await self.service.sample()
            records=db.get_degradation_incidents()
            self.assertEqual(len(records),1)
            self.assertEqual(records[0]['current_health'],'CRITICAL')
            self.assertIsNone(records[0]['observed_loss_percent'])
            self.assertEqual(len(db.get_event_logs()),1)


if __name__ == '__main__':
    unittest.main()
