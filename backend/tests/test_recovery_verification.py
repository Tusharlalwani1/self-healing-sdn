"""Phase 3: controlled service evidence, real parser/service/SQLite, no SDN IO."""
import asyncio
import copy
import csv
import io
import json
import tempfile
import time
import shutil
import sys
import unittest
from types import SimpleNamespace
from pathlib import Path
from unittest.mock import AsyncMock, patch
from fastapi import FastAPI
from backend.api import verification as api
from backend.api import links
from backend.database import db
from backend.services import mininet_client as mc, mininet_worker as mw
from backend.services.ping_accounting import PingAccounting
from backend.services.recovery_verification import RecoveryVerificationEngine, classify
from backend.services import recovery_verification as verification_service
from backend.services.verification_config import VerificationConfig
from backend.services.verification_window import VerificationWindow
from backend.services.report_generator import report_generator
from backend.services.operation_error import OperationError
from backend.services.service_intent import resolve_intent
from backend.tests.test_runtime_errors import request
from backend.tests import test_mesh_experiments as mesh_tests
from backend.services import experiment_runner as er
from backend.services.topology_catalog import TOPOLOGIES
from backend.tests import test_traffic_accounting as accounting_tests


def evidence(tx=100, rx=100, rtt=25, **changes):
    return dict(post_recovery_tx=tx, post_recovery_rx=rx, post_recovery_avg_rtt_ms=rtt,
                post_recovery_min_rtt_ms=rtt, post_recovery_max_rtt_ms=rtt,
                complete=True, observation_duration_sec=2.1, reply_bins_observed=2, **changes)


class ClassificationTests(unittest.TestCase):
    def test_verified(self):
        self.assertEqual(classify(evidence())[0:2], ('VERIFIED', 'STABLE_SERVICE'))

    def test_loss_degraded(self):
        self.assertEqual(classify(evidence(rx=80))[0:2], ('DEGRADED', 'EXCESSIVE_LOSS'))

    def test_rtt_degraded(self):
        self.assertEqual(classify(evidence(rtt=150))[0:2], ('DEGRADED', 'EXCESSIVE_RTT'))

    def test_no_reception(self):
        self.assertEqual(classify(evidence(rx=0, rtt=None))[0:2], ('FAILED', 'NO_RECEPTION'))

    def test_no_attempts(self):
        self.assertEqual(classify(evidence(tx=0, rx=0, rtt=None))[0:2], ('FAILED', 'NO_ATTEMPTS'))

    def test_single_reply_is_not_recovery(self):
        self.assertEqual(classify(evidence(rx=1))[0:2], ('FAILED', 'INSUFFICIENT_EVIDENCE'))

    def test_short_or_unfinished_window_is_not_verified(self):
        for patch_data in ({'observation_duration_sec': .2}, {'complete': False}, {'post_recovery_tx': 5, 'post_recovery_rx': 5}):
            data = evidence();data.update(patch_data)
            self.assertEqual(classify(data)[0], 'FAILED')

    def test_burst_does_not_prove_stability(self):
        data=evidence();data['reply_bins_observed']=1
        self.assertEqual(classify(data)[0:2], ('DEGRADED', 'UNSTABLE_RECEPTION'))

    def test_optional_vs_required_rtt(self):
        self.assertEqual(classify(evidence(rtt=None))[0], 'VERIFIED')
        self.assertEqual(classify(evidence(rtt=None), VerificationConfig(require_rtt=True))[0:2], ('DEGRADED', 'RTT_UNAVAILABLE'))

    def test_invalid_counters_and_nonfinite_rtt_are_not_evidence(self):
        for data in ({}, evidence(tx=2,rx=3), evidence(tx=-1,rx=0), evidence(rtt=float('nan')), evidence(tx=True)):
            self.assertEqual(classify(data)[0:2], ('FAILED', 'EVIDENCE_UNAVAILABLE'))

    def test_controller_logs_and_paths_are_not_classification_evidence(self):
        self.assertEqual(classify({'HEALED': True, 'duration_ms': 3.2, 'new_path':['s1','s3','s9']})[0], 'FAILED')

    def test_threshold_boundaries_and_configuration(self):
        self.assertEqual(classify(evidence(rx=95,rtt=100))[0], 'VERIFIED')
        for kwargs in ({'timeout_sec':1}, {'observation_sec':float('nan')}, {'min_received':1}):
            with self.assertRaises(ValueError): VerificationConfig(**kwargs)


class WindowTests(unittest.TestCase):
    def setUp(self):
        self.stats={'transmitted':0,'received':0,'history':[]}
        self.accounting=PingAccounting(self.stats)
        self.window=VerificationWindow(VerificationConfig().as_dict())
        self.accounting.verification_windows['incident']=self.window

    def test_real_counters_and_reply_sequences_exclude_old_delayed_and_duplicate_replies(self):
        self.accounting.feed('100/100 packets, 0% loss',0)
        self.accounting.feed('64 bytes: icmp_seq=99 ttl=64 time=900 ms',.1)
        for i in range(1,21):
            self.accounting.feed(f'64 bytes: icmp_seq={100+i} ttl=64 time=20 ms', i*.1)
        self.accounting.feed('64 bytes: icmp_seq=110 ttl=64 time=20 ms (DUP!)',2.01)
        self.accounting.feed('120/120 packets, 0% loss',2.1)
        self.accounting.feed('64 bytes: icmp_seq=121 ttl=64 time=20 ms',2.3)
        result=self.window.snapshot(3.2)
        self.assertEqual((result['post_recovery_tx'],result['post_recovery_rx']), (20,20))
        self.assertEqual(result['post_recovery_avg_rtt_ms'],20)
        self.assertEqual(result['reply_bins_observed'],2)
        self.assertTrue(result['complete'])
        self.assertEqual(self.stats['transmitted'],120)  # normal C06 cumulative accounting unchanged
        self.assertEqual(classify(result)[0],'VERIFIED')

    def test_outage_counts_attempts_without_replies(self):
        self.accounting.feed('0/100 packets, 100% loss',0)
        self.accounting.feed('0/140 packets, 100% loss',2.1)
        result=self.window.snapshot(3.2)
        self.assertEqual((result['post_recovery_tx'],result['post_recovery_rx']), (40,0))
        self.assertIsNone(result['post_recovery_avg_rtt_ms'])
        self.assertEqual(classify(result)[0],'FAILED')

    def test_no_counters_or_no_attempts_never_becomes_zero_loss(self):
        self.assertIsNone(self.window.snapshot(10)['post_recovery_loss_percent'])
        self.accounting.feed('0/0 packets, 0% loss',0)
        self.accounting.feed('0/0 packets, 0% loss',2.1)
        result=self.window.snapshot(3.2)
        self.assertIsNone(result['post_recovery_loss_percent'])
        self.assertEqual(classify(result)[1],'NO_ATTEMPTS')

    def test_rtt_upper_bound_is_reception_not_a_fabricated_rtt(self):
        self.accounting.feed('0/0 packets, 0% loss',0)
        self.accounting.feed('64 bytes: icmp_seq=1 ttl=64 time<1 ms',.5)
        self.accounting.feed('1/1 packets, 0% loss',2.1)
        result=self.window.snapshot(3.2)
        self.assertEqual(result['post_recovery_rx'],1)
        self.assertIsNone(result['post_recovery_avg_rtt_ms'])

    def test_end_of_short_finite_job_does_not_invent_stability(self):
        self.accounting.feed('0/0 packets, 0% loss',0)
        self.accounting.feed('64 bytes: icmp_seq=1 ttl=64 time=20 ms',.1)
        self.accounting.feed('1 packets transmitted, 1 received, 0% packet loss',.2)
        self.assertTrue(self.window.snapshot(.2)['complete'])
        self.assertEqual(classify(self.window.snapshot(.2))[1],'INSUFFICIENT_EVIDENCE')

    def test_only_a_final_lifetime_summary_is_not_post_failure_success(self):
        self.accounting.feed('300 packets transmitted, 300 received, 0% packet loss',.1)
        result=self.window.snapshot(.1)
        self.assertTrue(result['complete'])
        self.assertEqual(result['post_recovery_tx'],0)
        self.assertIsNone(result['post_recovery_loss_percent'])
        self.assertEqual(classify(result)[1],'NO_ATTEMPTS')

    def test_worker_owned_window_and_no_cumulative_metric_mutation(self):
        worker=mw.MininetWorker()
        worker.runtime_id='r1'
        job={**self.stats,'_accounting':self.accounting,'_started_monotonic':0,
             'runtime_id':'r1','controller_generation':'g1','experiment_id':None,'active':True}
        worker.traffic_jobs['job']=job
        req={'command':'begin_verification','job_id':'job','verification_id':'v1','runtime_id':'r1',
             'controller_generation':'g1','experiment_id':None,'config':VerificationConfig().as_dict()}
        result=worker.verification_evidence(req)
        self.assertEqual(result['verification_id'],'v1')
        self.assertEqual(job['transmitted'],0)
        with self.assertRaises(Exception): worker.verification_evidence({**req,'runtime_id':'old'})


class EngineTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.addCleanup(patch.stopall)
        self.directory=tempfile.TemporaryDirectory();self.addCleanup(self.directory.cleanup)
        patch.object(db,'DB_PATH',Path(self.directory.name)/'test.sqlite').start();db.init_db();db.init_db()
        self.client=mc.MininetClient();self.client.simulation_state='RUNNING'
        self.client.controller_type='reactive';self.client.controller_generation='g1'
        self.client._traffic_owners['job']={'runtime_id':self.client.runtime_id,'controller_generation':'g1',
                                           'experiment_id':None,'src':'h1','dst':'h2'}
        self.result=evidence()
        self.client._send_command=AsyncMock(side_effect=self.command)
        self.broadcast=AsyncMock()
        self.engine=RecoveryVerificationEngine(persist=db.save_verification,broadcast=self.broadcast)
        self.addAsyncCleanup(self.engine.shutdown)
        self.app=FastAPI();self.app.include_router(api.router)
        patch.object(api,'verification_engine',self.engine).start()

    async def command(self, payload, **kwargs):
        return {'status':'ok', **{k:payload[k] for k in
            ('verification_id','job_id','runtime_id','controller_generation','experiment_id')},
            'evidence':{} if payload['command']=='begin_verification' else copy.deepcopy(self.result)}

    async def begin(self, job='job'):
        return await self.engine.begin(self.client,job,['s2','s5'],time.time())

    async def test_lifecycle_rest_ws_persistence_and_path_unknown(self):
        started=await self.begin()
        self.assertEqual(started['verification_status'],'VERIFYING')
        final=await self.engine.wait(started['verification_id'])
        self.assertEqual(final['verification_status'],'VERIFIED')
        self.assertEqual(final['path_verification_status'],'UNAVAILABLE')
        self.assertEqual((final['source_host'],final['destination_host']),('h1','h2'))
        events=[c.args[0]['verification']['verification_status'] for c in self.broadcast.call_args_list]
        self.assertEqual(events,['VERIFYING','VERIFIED'])
        for path in ('/api/verification/current','/api/verification/'+final['verification_id']):
            status,body=await request(self.app,path,method='GET')
            self.assertEqual((status,body['verification_status']),(200,'VERIFIED'))
        self.assertEqual(db.get_verifications()[0]['verification_id'],final['verification_id'])
        self.assertEqual(len(db.get_event_logs()),2)

    async def test_no_traffic_not_started_never_sends_probe(self):
        result=await self.begin(None)
        self.assertEqual((result['verification_status'],result['reason_code']),('NOT_STARTED','NO_ACTIVE_TRAFFIC'))
        self.client._send_command.assert_not_awaited()
        self.assertIsNone(result['post_recovery_loss_percent'])

    async def test_old_controller_job_cannot_supply_current_before_or_after_evidence(self):
        self.client._traffic_owners['job']['controller_generation']='old-generation'
        result=await self.engine.begin(self.client,'job',['s2','s5'],time.time(),before={
            'job_id':'job','runtime_id':self.client.runtime_id,'transmitted':100,'received':100,'avg_rtt':20})
        self.assertEqual(result['verification_status'],'NOT_STARTED')
        self.assertIsNone(result['before'])
        self.assertIsNone(result['post_recovery_loss_percent'])
        self.client._send_command.assert_not_awaited()

    async def test_manual_link_failure_triggers_existing_owned_traffic_window(self):
        self.app.include_router(links.router)
        with patch.object(links,'mininet_client',self.client), patch.object(links,'verification_engine',self.engine), \
             patch.object(links.traffic_service,'snapshot',return_value={'job_id':'job','runtime_id':self.client.runtime_id,
                 'active':True,'transmitted':0,'received':0,'loss_percent':0}), \
             patch.object(self.client,'set_link_status',AsyncMock(return_value={'status':'ok'})):
            status,_=await request(self.app,'/api/links/down',{'node1':'s2','node2':'s5'})
        self.assertEqual(status,200)
        result=await self.engine.wait(self.engine.latest['verification_id'])
        self.assertEqual(result['verification_status'],'VERIFIED')
        self.assertIsNone(result['before']['loss_percent'])

    async def test_delayed_registration_keeps_full_observation_budget_for_44_successful_replies(self):
        """Live Mesh regression: queue time must not consume collection/grace.

        Real accounting/window logic; virtual monotonic time models slow worker
        registration deterministically without sleeping for the live delay.
        """
        self.client.topology_id='multipath_mesh'
        worker=mw.MininetWorker();worker.runtime_id=self.client.runtime_id
        clock=[0.0]
        origin=-36.096840001
        job={'transmitted':441,'received':441,'history':[], 'active':True,
             '_started_monotonic':origin,**self.client._traffic_owners['job']}
        job['_accounting']=PingAccounting(job)
        worker.traffic_jobs['job']=job
        polls=[]
        async def queued_command(payload,**kwargs):
            if payload['command']=='begin_verification':
                # The command's lock/socket queue consumes most of the old
                # countdown before a worker-owned window can even exist.
                clock[0]+=7.1
                result=worker.verification_evidence(payload)
                job['_accounting'].feed('743/745 packets, 0.2% loss',clock[0]-origin)
                return result
            if not polls:
                start=clock[0]
                for i in range(1,45):
                    clock[0]=start+i*2.293151265/44
                    job['_accounting'].feed(f'64 bytes: icmp_seq={745+i} ttl=64 time=32.07 ms',clock[0]-origin)
                job['_accounting'].feed('787/789 packets, 0.2% loss',clock[0]-origin)
            else:
                clock[0]+=self.engine.config.reply_grace_sec+.001
            result=worker.verification_evidence(payload)
            polls.append(copy.deepcopy(result['evidence']))
            return result
        self.client._send_command=AsyncMock(side_effect=queued_command)
        self.app.include_router(links.router)
        with patch.object(verification_service,'time',SimpleNamespace(time=time.time,monotonic=lambda:clock[0])), \
             patch.object(mw,'time',SimpleNamespace(monotonic=lambda:clock[0])), \
             patch.object(links,'mininet_client',self.client), patch.object(links,'verification_engine',self.engine), \
             patch.object(links.traffic_service,'snapshot',return_value={'job_id':'job','runtime_id':self.client.runtime_id,
                 'active':True,'transmitted':441,'received':441,'avg_rtt':32.06}), \
             patch.object(self.client,'set_link_status',AsyncMock(return_value={'status':'ok'})):
            status,_=await request(self.app,'/api/links/down',{'node1':'s1','node2':'s2'})
            self.assertEqual(status,200)
            final=await self.engine.wait(self.engine.latest['verification_id'])
        self.assertFalse(polls[0]['complete'])
        self.assertEqual((polls[0]['post_recovery_tx'],polls[0]['post_recovery_rx']),(44,44))
        self.assertEqual(polls[0]['reply_bins_observed'],2)
        self.assertEqual(final['verification_status'],'VERIFIED')
        self.assertTrue(polls[-1]['complete'])
        self.assertEqual(final['reason_code'],'STABLE_SERVICE')
        self.assertTrue(final['reachability_restored']);self.assertTrue(final['stability_passed'])
        self.assertEqual((final['post_recovery_tx'],final['post_recovery_rx']),(44,44))
        self.assertEqual(final['post_recovery_loss_percent'],0)
        self.assertAlmostEqual(final['post_recovery_avg_rtt_ms'],32.07)
        self.assertGreaterEqual(final['evidence']['observation_duration_sec'],2)
        self.assertEqual(final['path_verification_status'],'UNAVAILABLE')
        self.assertEqual(final['config'],VerificationConfig().as_dict())
        self.assertTrue(job['active'])  # Traffic did not end to "complete" the window.
        job['_accounting'].feed('1000 packets transmitted, 998 received, 0.2% packet loss',60)
        self.assertEqual((job['transmitted'],job['received']),(1000,998))

    async def test_measurement_registration_still_has_bounded_setup_timeout(self):
        self.engine.config=VerificationConfig(timeout_sec=.12,observation_sec=.02,reply_grace_sec=.01,poll_sec=.005)
        entered=asyncio.Event()
        async def unavailable(*args,**kwargs):
            entered.set()
            await asyncio.Event().wait()
        self.client._send_command=AsyncMock(side_effect=unavailable)
        result=await asyncio.wait_for(self.begin(),1)
        self.assertTrue(entered.is_set())
        self.assertEqual((result['verification_status'],result['reason_code']),('FAILED','MEASUREMENT_UNAVAILABLE'))
        self.assertIsNone(result['post_recovery_tx'])

    async def test_incomplete_verification_can_independently_satisfy_intent_on_available_measurements(self):
        self.engine.config=VerificationConfig(timeout_sec=.12,observation_sec=.02,reply_grace_sec=.01,poll_sec=.005)
        self.client._traffic_owners['job']['service_intent']=resolve_intent()
        self.result=evidence(tx=44,rx=44,rtt=32.07)
        self.result['complete']=False
        started=await self.begin();final=await self.engine.wait(started['verification_id'])
        self.assertEqual((final['verification_status'],final['reason_code']),('FAILED','VERIFICATION_TIMEOUT'))
        self.assertTrue(final['reachability_restored']);self.assertFalse(final['stability_passed'])
        self.assertEqual(self.engine.intent_engine.latest['evaluation_status'],'SATISFIED')
        self.assertEqual(final['path_verification_status'],'UNAVAILABLE')

    async def test_runtime_replaced_during_failure_ack_cannot_attribute_incident_to_replacement(self):
        self.app.include_router(links.router)
        async def replace(*args,**kwargs):
            self.client.runtime_id='replacement'
            return {'status':'ok'}
        with patch.object(links,'mininet_client',self.client), patch.object(links,'verification_engine',self.engine), \
             patch.object(links.traffic_service,'snapshot',return_value={}), \
             patch.object(self.client,'set_link_status',AsyncMock(side_effect=replace)):
            status,_=await request(self.app,'/api/links/down',{'node1':'s2','node2':'s5'})
        self.assertEqual(status,409)
        self.assertIsNone(self.engine.current())
        self.assertEqual(db.get_verifications(),[])

    async def test_controller_generation_replaced_before_trigger_rejects_stale_context(self):
        context={**self.client.runtime_context(),**self.client.controller_context()}
        self.client.controller_generation='g2'
        with self.assertRaises(OperationError):
            await self.engine.begin(self.client,'job',['s2','s5'],time.time(),failure_context=context)
        self.assertIsNone(self.engine.current())

    async def test_completed_experiment_evidence_stays_scoped_after_owner_released(self):
        self.client.experiment_id='exp1'
        self.client._traffic_owners['job']['experiment_id']='exp1'
        started=await self.begin();await self.engine.wait(started['verification_id'])
        self.client.experiment_id=None
        self.assertEqual(self.engine.current()['experiment_id'],'exp1')
        self.client.controller_generation='new'
        self.assertIsNone(self.engine.current())

    async def test_runtime_topology_generation_and_stop_hide_current_not_history(self):
        started=await self.begin();await self.engine.wait(started['verification_id'])
        for key,value in [('runtime_id','other'),('topology_id','multipath_mesh'),('controller_generation','g2'),('simulation_state','STOPPED')]:
            old=getattr(self.client,key);setattr(self.client,key,value)
            self.assertIsNone(self.engine.current())
            status,body=await request(self.app,'/api/verification/current',method='GET')
            self.assertEqual((status,body),(200,None))
            setattr(self.client,key,old)
        self.assertEqual(len(db.get_verifications()),1)

    async def test_forged_worker_ownership_is_failed_not_verified(self):
        self.client._send_command.side_effect=None
        self.client._send_command.return_value={'status':'ok','evidence':self.result,'runtime_id':'old'}
        result=await self.begin()
        self.assertEqual(result['verification_status'],'FAILED')
        self.assertEqual(result['reason_code'],'MEASUREMENT_UNAVAILABLE')

    async def test_timeout_no_evidence_and_shutdown_do_not_verify(self):
        self.engine.config=VerificationConfig(timeout_sec=.12,observation_sec=.02,reply_grace_sec=.01,poll_sec=.005)
        self.result={}
        started=await self.begin();result=await self.engine.wait(started['verification_id'])
        self.assertEqual((result['verification_status'],result['reason_code']),('FAILED','VERIFICATION_TIMEOUT'))
        started=await self.begin();await self.engine.shutdown()
        self.assertEqual(db.get_verification(started['verification_id'])['reason_code'],'SHUTDOWN')

    async def test_superseding_failure_cancels_old_observation(self):
        self.result={}
        first=await self.begin()
        second=await self.begin()
        self.assertEqual(db.get_verification(first['verification_id'])['reason_code'],'SUPERSEDED')
        self.assertNotEqual(first['verification_id'],second['verification_id'])

    async def test_history_validation_and_unknown_id(self):
        self.assertEqual((await request(self.app,'/api/verification/no-such-id',method='GET'))[0],404)
        self.assertEqual((await request(self.app,'/api/verification/history?limit=0',method='GET'))[0],422)

    async def test_old_experiment_data_preserved_and_exports_verification(self):
        old={'id':'old','controller':'baseline','status':'COMPLETED','start_time':'2026-01-01','summary':{}}
        db.save_experiment(old)
        started=await self.begin();final=await self.engine.wait(started['verification_id'])
        self.assertNotIn('verification',db.get_experiment_by_id('old')['summary'])
        new={**old,'id':'new','summary':{'verification':final}}
        db.save_experiment(new)
        saved=db.get_experiment_by_id('new')
        self.assertEqual(json.loads(report_generator.generate_json(saved))['verification']['verification_status'],'VERIFIED')
        row=next(csv.DictReader(io.StringIO(report_generator.generate_csv([saved]))))
        self.assertEqual(row['verification_status'],'VERIFIED')
        self.assertEqual(row['post_recovery_tx'],'100')
        self.assertIn('UNAVAILABLE',report_generator.generate_html_report(saved))


class ExperimentVerificationTests(mesh_tests.MeshExperimentTests):
    async def test_verification_finalization_error_cannot_skip_owned_link_cleanup(self):
        with patch.object(er.verification_engine, 'finish', AsyncMock(side_effect=RuntimeError('verification finalization failed'))):
            with self.assertRaises(OperationError):
                await self.runner.run_experiment('reactive',topology_id='multipath_mesh',failure_delay_sec=0,fail_src='s6',fail_dst='s9')
        self.assertEqual(self.links[('s6','s9')], 'UP')
        self.assertIsNone(self.client.experiment_id)
        self.assertTrue(all(not job['active'] for job in self.jobs.values()))
        saved=db.get_experiments()[0]
        self.assertEqual(saved['status'],'FAILED')
        self.assertTrue(any('Verification finalization' in reason for reason in saved['summary']['cleanup_errors']))

    async def test_six_controller_topology_combinations_use_measurements_not_mode(self):
        engine=RecoveryVerificationEngine(persist=db.save_verification,broadcast=AsyncMock())
        self.addAsyncCleanup(engine.shutdown)
        patch.object(er,'verification_engine',engine).start()
        original=self.client._send_command.side_effect
        async def command(payload,**kwargs):
            if payload['command'] in ('begin_verification','get_verification'):
                return {'status':'ok',**{k:payload[k] for k in ('verification_id','job_id','runtime_id','controller_generation','experiment_id')},
                        'evidence':evidence() if payload['command']=='get_verification' else {}}
            return await original(payload,**kwargs)
        self.client._send_command.side_effect=command
        for topology_id in ('diamond','multipath_mesh'):
            definition=TOPOLOGIES[topology_id]
            for controller in ('baseline','reactive','fast_failover'):
                self.links={pair:'UP' for pair in definition['inter_switch_links']}
                result=await self.runner.run_experiment(controller,topology_id=topology_id,failure_delay_sec=0,fail_src='s1',fail_dst='s2')
                verification=result['summary']['verification']
                self.assertEqual(verification['verification_status'],'VERIFIED')  # even Baseline if real service is present
                self.assertEqual(verification['controller_mode'],controller)
                self.assertEqual(verification['topology_id'],topology_id)
                self.assertEqual(verification['experiment_id'],result['id'])
                self.assertEqual(verification['path_verification_status'],'UNAVAILABLE')
                self.assertEqual(db.get_experiment_by_id(result['id'])['summary']['verification']['post_recovery_tx'],100)


@unittest.skipUnless(sys.platform == 'linux' and shutil.which('ping'), 'Requires Linux iputils')
class LocalDataplaneEvidenceTests(unittest.IsolatedAsyncioTestCase):
    """Real ping stdout/signals over loopback only. These are NOT Mininet tests."""
    async def run_window(self, outage):
        worker, _ = accounting_tests.LocalPingWorkerTests.start(self, outage=outage, count=100)
        client=mc.MininetClient();client.simulation_state='RUNNING'
        client.controller_generation='g1';client.controller_type='baseline'
        worker.runtime_id=client.runtime_id
        owner={'runtime_id':client.runtime_id,'controller_generation':'g1','experiment_id':None,'src':'loopback','dst':'loopback-test'}
        client._traffic_owners['test']=owner
        with worker.traffic_lock:
            worker.traffic_jobs['test'].update(owner)
        # The existing worker reader establishes its monotonic origin.
        for _ in range(100):
            if '_started_monotonic' in worker.traffic_jobs['test']: break
            await asyncio.sleep(.01)
        async def command(payload,**kwargs): return worker.verification_evidence(payload)
        client._send_command=AsyncMock(side_effect=command)
        engine=RecoveryVerificationEngine(broadcast=AsyncMock())
        self.addAsyncCleanup(engine.shutdown)
        started=await engine.begin(client,'test',['fixture-a','fixture-b'],time.time())
        return await engine.wait(started['verification_id'])

    async def test_real_loopback_replies_verify_without_changing_job_counters(self):
        result=await self.run_window(False)
        self.assertEqual(result['verification_status'],'VERIFIED')
        self.assertGreaterEqual(result['post_recovery_tx'],20)
        self.assertEqual(result['post_recovery_tx'],result['post_recovery_rx'])
        self.assertIsNotNone(result['post_recovery_avg_rtt_ms'])
        self.assertEqual(result['path_verification_status'],'UNAVAILABLE')

    async def test_real_no_reply_loopback_bound_attempts_fail_with_null_rtt(self):
        result=await self.run_window(True)
        self.assertEqual(result['verification_status'],'FAILED')
        self.assertEqual(result['reason_code'],'NO_RECEPTION')
        self.assertGreater(result['post_recovery_tx'],0)
        self.assertEqual(result['post_recovery_rx'],0)
        self.assertEqual(result['post_recovery_loss_percent'],100)
        self.assertIsNone(result['post_recovery_avg_rtt_ms'])
