"""Explicit topology/OVS/verification transport fixtures; no live SDN claims."""
import asyncio
import copy
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from backend.api import adaptive as routes
from backend.database import db
from backend.services.adaptive_policy import candidates, improves
from backend.services.adaptive_healing import AdaptiveHealing, OWNER_KEYS
from backend.services.adaptive_forwarding import apply_path
from backend.services.mininet_client import MininetClient
from backend.services.operation_error import OperationError
from backend.services.service_intent import resolve_intent
from backend.services.topology_catalog import TOPOLOGIES
from backend.tests.test_runtime_errors import request


def network(name='multipath_mesh'):
    definition = TOPOLOGIES[name]
    return {'topology_id': name, 'switches': definition['switches'], 'hosts': ['h1','h2'],
            'links': [{'src': a, 'dst': b, 'status': 'UP', 'src_port': i+1, 'dst_port': i+2}
                      for i, (a,b) in enumerate([*definition['host_links'], *definition['inter_switch_links']])]}


def quality(topo):
    return {'links': [dict(src=l['src'], dst=l['dst'], health_status='UNKNOWN', operational_status='UP',
        configured_additional_delay_ms=0, configured_loss_percent=0, observed_loss_percent=None, quality_revision=0)
        for l in topo['links'] if l['src'] in topo['switches'] and l['dst'] in topo['switches']]}


class PolicyTests(unittest.TestCase):
    def test_mesh_bounded_loop_free_deterministic(self):
        t = network(); q = quality(t)
        rows = candidates(t,q,'h1','h2',resolve_intent())
        self.assertTrue(1 < len(rows) <= 24)
        self.assertEqual(rows,candidates(t,q,'h1','h2',resolve_intent()))
        self.assertEqual(len(rows),len({r['candidate_id'] for r in rows}))
        self.assertTrue(all(len(p['path']) == len(set(p['path'])) for p in rows))

    def test_down_link_excluded(self):
        t=network()
        next(l for l in t['links'] if {l['src'],l['dst']} == {'s2','s5'})['status']='DOWN'
        self.assertFalse(any('s2>s5' in p['candidate_id'] or 's5>s2' in p['candidate_id'] for p in candidates(t,quality(t),'h1','h2',resolve_intent())))

    def test_diamond_compatibility(self):
        self.assertEqual(len(candidates(network('diamond'),quality(network('diamond')),'h1','h2',resolve_intent())),2)

    def test_critical_strongly_avoided(self):
        t=network('diamond');q=quality(t);q['links'][0]['health_status']='CRITICAL'
        self.assertEqual(candidates(t,q,'h1','h2',resolve_intent())[0]['components']['critical_links'],0)

    def test_degraded_penalty(self):
        t=network('diamond');q=quality(t);q['links'][0]['health_status']='DEGRADED'
        self.assertEqual(candidates(t,q,'h1','h2',resolve_intent())[0]['components']['degraded_links'],0)

    def test_unknown_and_missing_not_zero_measurements(self):
        t=network('diamond');rows=candidates(t,{},'h1','h2',resolve_intent())
        c=rows[0]['components']
        self.assertEqual(c['unknown_links'],2)
        self.assertIsNone(c['configured_delay_sum_ms'])
        self.assertIsNone(c['worst_observed_tc_loss_percent'])
        self.assertIsNone(c['observed_path_rtt_ms'])

    def test_intents_choose_differently_with_supported_risks(self):
        t=network('diamond');q=quality(t)
        q['links'][0]['configured_additional_delay_ms']=20
        q['links'][2]['configured_loss_percent']=1
        interactive=candidates(t,q,'h1','h2',resolve_intent({'profile_id':'interactive'}))[0]
        reliable=candidates(t,q,'h1','h2',resolve_intent({'profile_id':'reliable'}))[0]
        self.assertNotEqual(interactive['path'],reliable['path'])

    def test_configured_loss_distinct_from_observed(self):
        t=network('diamond');q=quality(t)
        for r in q['links']:r.update(configured_loss_percent=10, observed_loss_percent=None)
        c=candidates(t,q,'h1','h2',resolve_intent())[0]['components']
        self.assertEqual(c['configured_loss_risk_sum_percent'],20)
        self.assertIsNone(c['worst_observed_tc_loss_percent'])

    def test_no_justified_retry_from_hops_only(self):
        t=network('diamond');a,b=candidates(t,quality(t),'h1','h2',resolve_intent())
        self.assertFalse(improves(a,b,{'requirements':{'average_rtt':{'status':'FAIL'}}}))


class CycleTests(unittest.IsolatedAsyncioTestCase):
    def setup_service(self, profile='standard'):
        c=MininetClient();c.runtime_id='r1';c.runtime_revision=1;c.topology_id='diamond'
        c.controller_type='adaptive';c.controller_generation='g1';c.simulation_state='RUNNING';c._traffic_sequence=1
        job={**c.runtime_context(),**c.controller_context(),'job_id':'j1','traffic_sequence':1,'experiment_id':None,'active':True,
             'src':'h1','dst':'h2','service_intent':resolve_intent({'profile_id':profile})}
        c._traffic_owners={'j1':copy.deepcopy(job)}
        t=network('diamond');c.get_topology=AsyncMock(return_value=t)
        h={**c.runtime_context(),**c.controller_context(),**quality(t)}
        health=SimpleNamespace(current=lambda:copy.deepcopy(h))
        v=SimpleNamespace(begin=AsyncMock(),wait=AsyncMock(),finish=AsyncMock())
        service=AdaptiveHealing(c,v,health,lambda:copy.deepcopy(job),lambda:True,AsyncMock())
        service.config['cooldown_sec']=0
        async def send(req, **kwargs):
            return {**req,'status':'ok','installed_path':req['path'],'source':'OVS_OPENFLOW13_FLOW_READBACK','observed_path':None}
        c._send_command=AsyncMock(side_effect=send)
        async def begin(*args,**kwargs):
            return {'verification_id':'v'+str(v.begin.await_count)}
        v.begin.side_effect=begin
        async def wait(vid):
            return {**{k:service.latest[k] for k in OWNER_KEYS},'verification_id':vid,'incident_id':service.latest['cycle_id'],
                'verification_status':'VERIFIED','reason_code':'STABLE_SERVICE','reason':'Fixture service stable',
                'controller_mode':'adaptive','source_host':'h1','destination_host':'h2','failed_link':[],
                'failure_timestamp':1,'reachability_restored':True,'post_recovery_tx':40,'post_recovery_rx':40,
                'post_recovery_loss_percent':0,'post_recovery_avg_rtt_ms':30}
        v.wait.side_effect=wait
        return service,c,job,h,t,v

    async def finish(self,s):
        await s.wait()
        return s.latest

    async def test_satisfied_terminal_real_action_then_verification(self):
        s,c,*_=self.setup_service();await s.trigger('HARD_FAILURE',['s1','s2']);r=await self.finish(s)
        self.assertEqual(r['outcome'],'SATISFIED');self.assertEqual(len(r['attempts']),1)
        self.assertEqual(c._send_command.await_args.args[0]['command'],'apply_adaptive_path')
        self.assertIsNone(r['observed_path']);self.assertIsNotNone(r['attempts'][0]['verification'])

    async def test_verified_violated_no_improvement_best_achievable(self):
        s,*_=self.setup_service('interactive');await s.trigger('HARD_FAILURE');r=await self.finish(s)
        self.assertEqual(r['outcome'],'BEST_ACHIEVABLE');self.assertEqual(len(r['attempts']),1)

    async def test_missing_evidence_escalates_instead_of_best_claim(self):
        s,c,j,h,*_=self.setup_service('interactive');h['links']=[]
        await s.trigger('HARD_FAILURE');r=await self.finish(s)
        self.assertEqual(r['outcome'],'ESCALATED')

    async def test_reheals_only_after_fresh_supported_improvement(self):
        s,c,j,h,t,v=self.setup_service('interactive');original=v.wait.side_effect
        async def wait(vid):
            result=await original(vid)
            if v.wait.await_count == 1:
                first=s.latest['selected_candidate']['path']
                next(r for r in h['links'] if r['src'] in first and r['dst'] in first)['configured_additional_delay_ms']=100
            else:result['post_recovery_avg_rtt_ms']=20
            return result
        v.wait.side_effect=wait
        await s.trigger('SOFT_DEGRADATION');r=await self.finish(s)
        self.assertEqual(r['outcome'],'SATISFIED');self.assertEqual(len(r['attempts']),2)
        self.assertNotEqual(*[a['candidate']['candidate_id'] for a in r['attempts']])
        self.assertNotEqual(*[a['verification_id'] for a in r['attempts']])

    async def test_attempt_limit_and_no_oscillation(self):
        s,c,j,h,t,v=self.setup_service('interactive');s.config['max_attempts']=2;original=v.wait.side_effect
        async def wait(vid):
            result=await original(vid)
            first=s.latest['selected_candidate']['path']
            for row in h['links']:row['configured_additional_delay_ms']=100 if row['src'] in first and row['dst'] in first else 0
            return result
        v.wait.side_effect=wait
        await s.trigger('HARD_FAILURE');r=await self.finish(s)
        self.assertEqual(r['outcome'],'ESCALATED');self.assertEqual(len(r['attempts']),2)
        self.assertEqual(len({a['candidate']['candidate_id'] for a in r['attempts']}),2)

    async def test_mesh_default_three_attempt_bound_never_reuses_candidate(self):
        s,c,j,h,t,v=self.setup_service('interactive')
        c.topology_id='multipath_mesh';j['topology_id']=c.topology_id
        c._traffic_owners['j1']['topology_id']=c.topology_id
        mesh=network();c.get_topology.return_value=mesh
        h.update(c.runtime_context());h['links']=quality(mesh)['links']
        original=v.wait.side_effect
        async def wait(vid):
            result=await original(vid)
            path=s.latest['selected_candidate']['path']
            for row in h['links']:
                row['configured_additional_delay_ms']=100 if row['src'] in path and row['dst'] in path else 0
            return result
        v.wait.side_effect=wait
        await s.trigger('HARD_FAILURE');r=await self.finish(s)
        self.assertEqual(r['config']['max_attempts'],3)
        self.assertEqual(r['outcome'],'ESCALATED')
        self.assertEqual(len(r['attempts']),3)
        self.assertEqual(len({a['candidate']['candidate_id'] for a in r['attempts']}),3)
        self.assertEqual(c._send_command.await_count,3)

    async def test_old_verification_cannot_complete_replacement_cycle(self):
        s,c,j,h,t,v=self.setup_service();original=v.wait.side_effect
        replacement={}
        async def wait(vid):
            result=await original(vid)
            replacement.update(copy.deepcopy(s.latest),cycle_id='replacement-cycle',status='EVALUATING',outcome=None)
            s.latest=replacement
            return result
        v.wait.side_effect=wait
        await s.trigger('HARD_FAILURE');await s.wait()
        self.assertIs(s.latest,replacement)
        self.assertIsNone(replacement['outcome'])
        self.assertEqual(replacement['status'],'EVALUATING')
        self.assertEqual(c._send_command.await_count,1)

    async def test_stale_external_intent_evaluation_cannot_trigger_retry(self):
        s,c,j,h,t,v=self.setup_service()
        stale={'verification_id':'old-window','controller_generation':'old-generation','evaluation_status':'VIOLATED'}
        v.intent_engine=SimpleNamespace(latest=stale,current=AsyncMock(return_value=stale))
        await s.trigger('HARD_FAILURE');r=await self.finish(s)
        self.assertEqual(r['outcome'],'SATISFIED')
        self.assertEqual(len(r['attempts']),1)
        self.assertEqual(r['attempts'][0]['intent_evaluation']['evaluation_status'],'SATISFIED')
        self.assertNotEqual(r['attempts'][0]['verification_id'],stale['verification_id'])
        v.intent_engine.current.assert_not_awaited()

    async def test_soft_monitor_transition_during_observation_preserves_closed_loop(self):
        s,c,j,h,t,v=self.setup_service('interactive');original=v.wait.side_effect
        observing,release=asyncio.Event(),asyncio.Event()
        async def wait(vid):
            if v.wait.await_count == 1:
                observing.set();await release.wait()
                return await original(vid)
            r=await original(vid);r['post_recovery_avg_rtt_ms']=20;return r
        v.wait.side_effect=wait
        await s.trigger('HARD_FAILURE');await observing.wait();cycle=s.latest['cycle_id']
        path=s.installed['path'];row=next(r for r in h['links'] if r['src'] in path and r['dst'] in path)
        row.update(health_status='DEGRADED',configured_additional_delay_ms=20)
        await s.tick();self.assertEqual(s.latest['cycle_id'],cycle);self.assertEqual(len(s.latest['additional_incidents']),1)
        release.set();r=await self.finish(s)
        self.assertEqual(r['outcome'],'SATISFIED');self.assertEqual(len(r['attempts']),2)
        v.finish.assert_not_awaited()

    async def test_failed_verification_not_overridden_by_intent(self):
        s,c,j,h,t,v=self.setup_service();original=v.wait.side_effect
        async def wait(vid):
            r=await original(vid);r['verification_status']='FAILED';return r
        v.wait.side_effect=wait
        await s.trigger('HARD_FAILURE');r=await self.finish(s)
        self.assertEqual(r['outcome'],'FAILED');self.assertEqual(r['attempts'][0]['intent_evaluation']['evaluation_status'],'SATISFIED')

    async def test_stale_verification_rejected(self):
        s,c,j,h,t,v=self.setup_service();original=v.wait.side_effect
        async def wait(vid):
            r=await original(vid);r['controller_generation']='old';return r
        v.wait.side_effect=wait
        await s.trigger('HARD_FAILURE');r=await self.finish(s)
        self.assertEqual(r['outcome'],'ESCALATED');self.assertIsNone(r['attempts'][0]['intent_evaluation'])

    async def test_stale_apply_not_claimed_installed(self):
        s,c,*_=self.setup_service();original=c._send_command.side_effect
        async def send(req,**kwargs):
            r=await original(req);c.runtime_id='replacement';return r
        c._send_command.side_effect=send
        await s.trigger('HARD_FAILURE');r=await self.finish(s)
        self.assertEqual(r['outcome'],'ESCALATED');self.assertIsNone(r['installed_path']);self.assertIsNone(s.current())

    async def test_queued_old_cycle_cannot_apply(self):
        s,c,*_=self.setup_service()
        await c._runtime_lock.acquire();await s.trigger('HARD_FAILURE');await asyncio.sleep(0)
        c.controller_generation='new';c._runtime_lock.release();await self.finish(s)
        c._send_command.assert_not_awaited()

    async def test_worker_error_never_success(self):
        s,c,*_=self.setup_service();c._send_command.side_effect=OperationError(502,'OVS failed')
        await s.trigger('HARD_FAILURE');r=await self.finish(s)
        self.assertEqual(r['outcome'],'ESCALATED');self.assertIsNone(r['installed_path'])

    async def test_no_active_traffic_no_cycle(self):
        s,c,j,*_=self.setup_service();j['active']=False
        self.assertIsNone(await s.trigger('HARD_FAILURE'));c._send_command.assert_not_awaited()

    async def test_old_three_never_adapt(self):
        for mode in ('baseline','reactive','fast_failover'):
            s,c,*_=self.setup_service();c.controller_type=mode
            self.assertIsNone(await s.trigger('SOFT_DEGRADATION'));await s.tick();c._send_command.assert_not_awaited()

    async def test_soft_transition_on_installed_route_once(self):
        s,c,j,h,t,v=self.setup_service();await s.tick();await self.finish(s)
        path=s.installed['path'];row=next(r for r in h['links'] if r['src'] in path and r['dst'] in path)
        row.update(health_status='CRITICAL',configured_additional_delay_ms=100)
        await s.tick();await self.finish(s);count=c._send_command.await_count
        self.assertEqual(s.latest['trigger'],'SOFT_DEGRADATION')
        await s.tick();self.assertEqual(c._send_command.await_count,count)

    async def test_unrelated_soft_link_does_not_trigger(self):
        s,c,j,h,*_=self.setup_service();await s.tick();await self.finish(s);path=s.installed['path']
        row=next(r for r in h['links'] if r['src'] not in path or r['dst'] not in path);row['health_status']='CRITICAL'
        await s.tick();self.assertEqual(s.latest['trigger'],'SERVICE_START')

    async def test_cancel_stops_observation_and_retry(self):
        s,c,j,h,t,v=self.setup_service();started=asyncio.Event()
        async def wait(vid):started.set();await asyncio.Event().wait()
        v.wait.side_effect=wait
        v.finish.return_value={'verification_id':'cancelled-window','verification_status':'FAILED'}
        await s.trigger('HARD_FAILURE');await started.wait();await s.cancel()
        self.assertEqual(s.latest['outcome'],'ESCALATED');v.finish.assert_awaited_once()
        self.assertEqual(s.latest['attempts'][0]['status'],'CANCELLED')
        self.assertEqual(s.latest['attempts'][0]['verification']['verification_id'],'cancelled-window')
        self.assertEqual(c._send_command.await_count,1)

    async def test_custom_snapshot_frozen(self):
        s,c,j,*_=self.setup_service();j['service_intent']=resolve_intent({'profile_id':'custom','custom':{
            'profile_id':'custom','name':'Research custom','priority':'HIGH','require_reachability':True,'max_loss_percent':2,'max_avg_rtt_ms':40}})
        c._traffic_owners['j1']['service_intent']=copy.deepcopy(j['service_intent'])
        await s.trigger('HARD_FAILURE');c._traffic_owners['j1']['service_intent']['max_avg_rtt_ms']=1
        r=await self.finish(s);self.assertEqual(r['intent_snapshot']['max_avg_rtt_ms'],40)

    async def test_cooldown_queues_instead_of_repeated_actions(self):
        s,c,*_=self.setup_service();s.config['cooldown_sec']=2
        await s.trigger('SERVICE_START');await self.finish(s)
        first=s.latest['cycle_id'];await s.trigger('HARD_FAILURE',['s1','s2'])
        self.assertEqual(s.latest['cycle_id'],first);self.assertIsNotNone(s.pending)
        self.assertEqual(c._send_command.await_count,1)

    async def test_explicit_trigger_is_not_replaced_by_monitor_service_start(self):
        s,c,*_=self.setup_service()
        await s.trigger('HARD_FAILURE',['s1','s2']);await self.finish(s)
        cycle=s.latest['cycle_id'];await s.tick()
        self.assertEqual(s.latest['cycle_id'],cycle);self.assertEqual(c._send_command.await_count,1)

    async def test_pending_irrelevant_incident_does_not_block_future_monitoring(self):
        s,c,j,h,*_=self.setup_service();await s.trigger('SERVICE_START');await self.finish(s)
        path=s.installed['path'];row=next(r for r in h['links'] if r['src'] not in path or r['dst'] not in path)
        s.pending=('SOFT_DEGRADATION',[row['src'],row['dst']],row)
        await s.tick();self.assertIsNone(s.pending);self.assertEqual(c._send_command.await_count,1)

    async def test_concurrent_triggers_cannot_leave_two_applying_cycles(self):
        s,c,*_=self.setup_service()
        await asyncio.gather(s.trigger('SERVICE_START'),s.trigger('HARD_FAILURE',['s1','s2']))
        await self.finish(s)
        self.assertEqual(s.latest['trigger'],'HARD_FAILURE');self.assertTrue(s.cycle_task.done())
        self.assertEqual(s.latest['outcome'],'SATISFIED')

    async def test_cancel_during_verification_admission_finalizes_owned_tap(self):
        s,c,j,h,t,v=self.setup_service();registered=asyncio.Event()
        async def begin(*args,**kwargs):
            v.latest={'verification_id':'registered-before-ack','incident_id':s.latest['cycle_id']}
            registered.set();await asyncio.Event().wait()
        v.begin.side_effect=begin
        await s.trigger('HARD_FAILURE');await registered.wait();await s.cancel()
        self.assertEqual(v.finish.await_args.args[0],'registered-before-ack')


class WorkerTests(unittest.TestCase):
    def fixture(self):
        t=network('diamond');calls=[];flows={}
        req={'runtime_id':'r1','controller_generation':'g1','experiment_id':None,'job_id':'j1','cycle_id':'c1','attempt':1,
             'path':['h1','s1','s2','s4','h2']}
        job={**req,'controller':'adaptive','active':True,'src':'h1','dst':'h2','proc':SimpleNamespace(poll=lambda:None)}
        def run(args):
            calls.append(args)
            action,sw=args[3],args[4]
            if action=='del-flows':flows[sw]=[]
            if action=='add-flow':flows.setdefault(sw,[]).append(args[5])
            if action=='dump-flows':return '\n'.join(flows.get(sw,[]))
            return ''
        w=SimpleNamespace(net=SimpleNamespace(get=lambda name:SimpleNamespace(MAC=lambda:'00:00:00:00:00:01' if name=='h1' else '00:00:00:00:00:02')),
            runtime_id='r1',traffic_jobs={'j1':job},get_topology=lambda:t,_run_ovs=run)
        return w,req,calls,t

    def test_bidirectional_checked_flow_action(self):
        w,req,calls,t=self.fixture();r=apply_path(w,req)
        self.assertEqual(r['installed_path'],req['path']);self.assertIsNone(r['observed_path'])
        self.assertEqual(len(r['flows']),6);self.assertEqual(sum('dump-flows' in c for c in calls),6)

    def test_readback_failure_truthful_cleanup(self):
        w,req,calls,t=self.fixture();original=w._run_ovs
        w._run_ovs=lambda args: '' if 'dump-flows' in args else original(args)
        with self.assertRaises(OperationError):apply_path(w,req)
        self.assertEqual(sum('del-flows' in c for c in calls),8)

    def test_down_candidate_rejected_before_writes(self):
        w,req,calls,t=self.fixture();t['links'][2]['status']='DOWN'
        with self.assertRaises(OperationError):apply_path(w,req)
        self.assertFalse(calls)

    def test_stale_and_nonadaptive_job_rejected(self):
        for changes in ({'controller_generation':'old'},{'controller':'reactive'},{'active':False}):
            w,req,calls,t=self.fixture();w.traffic_jobs['j1'].update(changes)
            with self.assertRaises(OperationError):apply_path(w,req)
            self.assertFalse(calls)


class PersistenceApiTests(unittest.IsolatedAsyncioTestCase):
    async def test_empty_history_detail_and_additive_persistence(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(db,'DB_PATH',Path(folder)/'test.db'):
            db.init_db();self.assertEqual(db.get_adaptive_cycles(),[])
            app=FastAPI();app.include_router(routes.router)
            with patch.object(routes,'get_adaptive_cycles',db.get_adaptive_cycles):
                code,body=await request(app,'/api/adaptive/history',method='GET');self.assertEqual(code,200);self.assertEqual(body,[])
                code,_=await request(app,'/api/adaptive/cycles/missing',method='GET');self.assertEqual(code,404)
                r={'cycle_id':'a1','runtime_id':'r1','created_at':1,'updated_at':2,'status':'COMPLETED','outcome':'SATISFIED','reason':'Fixture',
                   'attempts':[{'verification':{'post_recovery_avg_rtt_ms':32.03684210526316},'intent_snapshot':resolve_intent()}],'candidates':[]}
                db.save_adaptive_cycle(r);self.assertEqual(db.get_adaptive_cycles()[0],r)
                code,body=await request(app,'/api/adaptive/cycles/a1/attempts',method='GET');self.assertEqual(code,200);self.assertEqual(body,r['attempts'])
                self.assertEqual(db.get_event_logs()[0]['source'],'ADAPTIVE')

    async def test_config_bounds_and_no_current_data(self):
        app=FastAPI();app.include_router(routes.router)
        with patch.object(routes.adaptive_healing,'latest',None):
            code,value=await request(app,'/api/adaptive/current',method='GET');self.assertEqual(code,200);self.assertIsNone(value)
        code,_=await request(app,'/api/adaptive/config',{'max_attempts':99},method='PUT');self.assertEqual(code,422)
        code,_=await request(app,'/api/adaptive/config',{'cooldown_sec':float('nan')},method='PUT');self.assertEqual(code,422)
