"""Phase 4 policies consume controlled Phase 3 evidence; no live SDN or user DB IO."""
import copy
import csv
import io
import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch
from fastapi import FastAPI
from pydantic import ValidationError
from backend.api import intents, traffic
from backend.database import db
from backend.models.intent import IntentSelection, ServiceIntent
from backend.models.schemas import TrafficStartRequest, ExperimentRunRequest
from backend.models.verification import RecoveryVerification
from backend.services.service_intent import evaluate, resolve_intent
from backend.services.recovery_verification import RecoveryVerificationEngine, classify
from backend.services.report_generator import report_generator
from backend.tests.test_runtime_errors import request
from backend.tests import test_telemetry_ownership as ownership
from backend.tests import test_mesh_experiments as mesh
from backend.services import experiment_runner as er
from backend.services.topology_catalog import TOPOLOGIES


def verification(**changes):
    value = RecoveryVerification(verification_id='v1', runtime_id='r1', runtime_revision=1,
        topology_id='multipath_mesh', controller_mode='reactive', controller_generation='g1',
        job_id='job', source_host='h1', destination_host='h2', failed_link=['s2','s5'],
        failure_timestamp=100, verification_status='VERIFIED', reason_code='STABLE_SERVICE',
        reason='Controlled measured evidence', post_recovery_tx=40, post_recovery_rx=40,
        post_recovery_loss_percent=0, post_recovery_avg_rtt_ms=32,
        reachability_restored=True, stability_passed=True).model_dump()
    value.update(changes)
    return value


class EvaluationTests(unittest.TestCase):
    def result(self, profile='standard', **changes):
        return evaluate(verification(**changes), resolve_intent({'profile_id':profile}))

    def test_all_requirements_pass(self):
        result = self.result()
        self.assertEqual(result['evaluation_status'], 'SATISFIED')
        self.assertTrue(all(r['status']=='PASS' for r in result['requirements'].values()))

    def test_rtt_threshold_exceeded(self):
        result = self.result('interactive')
        self.assertEqual((result['evaluation_status'],result['reason_code']), ('VIOLATED','RTT_THRESHOLD_EXCEEDED'))
        self.assertEqual(result['requirements']['average_rtt'], {'target':25,'actual':32,'unit':'ms','status':'FAIL'})

    def test_loss_threshold_exceeded(self):
        result=self.result(post_recovery_loss_percent=6)
        self.assertEqual(result['reason_code'],'LOSS_THRESHOLD_EXCEEDED')

    def test_failed_no_reception_is_explicit_reachability_violation_not_missing_rtt_zero(self):
        result=self.result(verification_status='FAILED',reachability_restored=False,
            post_recovery_tx=40,post_recovery_rx=0,post_recovery_loss_percent=100,post_recovery_avg_rtt_ms=None)
        self.assertEqual(result['evaluation_status'],'VIOLATED')
        self.assertEqual(result['requirements']['reachability']['actual'],False)
        self.assertEqual(result['requirements']['average_rtt']['status'],'UNAVAILABLE')

    def test_multiple_requirements_fail(self):
        self.assertEqual(self.result('interactive',post_recovery_loss_percent=2)['reason_code'],'MULTIPLE_REQUIREMENTS_FAILED')

    def test_missing_rtt_is_unavailable(self):
        result=self.result(post_recovery_avg_rtt_ms=None)
        self.assertEqual(result['evaluation_status'],'UNAVAILABLE')
        self.assertIsNone(result['requirements']['average_rtt']['actual'])

    def test_unknown_reachability_and_loss_are_not_false_or_zero(self):
        result=self.result(reachability_restored=None,post_recovery_loss_percent=None)
        self.assertEqual(result['evaluation_status'],'UNAVAILABLE')
        for name in ('reachability','packet_loss'): self.assertIsNone(result['requirements'][name]['actual'])

    def test_no_active_traffic_never_satisfies_even_with_old_success_values(self):
        result=self.result(verification_status='NOT_STARTED',reason_code='NO_ACTIVE_TRAFFIC')
        self.assertEqual((result['evaluation_status'],result['reason_code']),('UNAVAILABLE','NO_ACTIVE_TRAFFIC'))
        self.assertTrue(all(r['actual'] is None for r in result['requirements'].values()))

    def test_verifying_never_finalizes_from_partial_or_old_success_values(self):
        result=self.result(verification_status='VERIFYING')
        self.assertEqual(result['evaluation_status'],'EVALUATING')
        self.assertIsNone(result['completed_at'])

    def test_phase3_verified_and_intent_violated_remain_independent(self):
        evidence={'post_recovery_tx':40,'post_recovery_rx':40,'post_recovery_avg_rtt_ms':32,
            'complete':True,'observation_duration_sec':2.1,'reply_bins_observed':2}
        before=copy.deepcopy(evidence)
        self.assertEqual(classify(evidence)[0],'VERIFIED')
        self.assertEqual(self.result('interactive')['evaluation_status'],'VIOLATED')
        self.assertEqual(evidence,before)
        self.assertEqual(classify(evidence)[0],'VERIFIED')

    def test_degraded_is_not_automatically_violated(self):
        self.assertEqual(self.result('bulk',verification_status='DEGRADED',post_recovery_loss_percent=7)['evaluation_status'],'SATISFIED')

    def test_failed_unknown_measurements_are_unavailable(self):
        result=self.result(verification_status='FAILED',reachability_restored=None,
            post_recovery_loss_percent=None,post_recovery_avg_rtt_ms=None)
        self.assertEqual(result['evaluation_status'],'UNAVAILABLE')

    def test_unconfigured_requirements_are_omitted(self):
        policy={**resolve_intent(), 'profile_id':'custom','require_reachability':False,'max_loss_percent':None}
        result=evaluate(verification(),policy)
        self.assertEqual(list(result['requirements']),['average_rtt'])

    def test_exact_boundaries_pass(self):
        self.assertEqual(self.result('interactive',post_recovery_avg_rtt_ms=25,post_recovery_loss_percent=1)['evaluation_status'],'SATISFIED')

    def test_nonfinite_or_negative_evidence_is_not_zero_or_success(self):
        for value in (float('nan'),float('inf'),-1,True,'32'):
            self.assertEqual(self.result(post_recovery_avg_rtt_ms=value)['evaluation_status'],'UNAVAILABLE')

    def test_old_record_without_snapshot_is_unavailable(self):
        self.assertEqual(evaluate(verification(),None)['reason_code'],'INTENT_UNAVAILABLE')

    def test_profile_and_custom_validation_rejects_invalid_not_clamp(self):
        valid={**resolve_intent(),'profile_id':'custom'}
        self.assertEqual(resolve_intent({'profile_id':'custom','custom':valid}),valid)
        for key,value in [('max_loss_percent',-1),('max_loss_percent',101),('max_loss_percent',float('nan')),
            ('max_avg_rtt_ms',0),('max_avg_rtt_ms',60001),('max_avg_rtt_ms',float('inf')),
            ('max_avg_rtt_ms','25'),('priority','URGENT'),('name','   '),('require_reachability','true')]:
            with self.subTest(key=key,value=value), self.assertRaises(ValidationError):
                ServiceIntent.model_validate({**valid,key:value})
        for selection in ({'profile_id':'unknown'},{'profile_id':'custom'}, {'profile_id':'standard','custom':valid}):
            with self.assertRaises(ValidationError): IntentSelection.model_validate(selection)
        for key in valid:
            incomplete={k:v for k,v in valid.items() if k!=key}
            with self.assertRaises(ValidationError): ServiceIntent.model_validate(incomplete)
        with self.assertRaises(ValidationError):
            ServiceIntent.model_validate({**valid,'require_reachability':False,'max_loss_percent':None,'max_avg_rtt_ms':None})
        for model in (TrafficStartRequest,ExperimentRunRequest):
            with self.assertRaises(ValidationError): model(service_intent={'profile_id':'custom'})


class IntegrationTests(ownership.OwnershipFixture):
    def setUp(self):
        super().setUp()
        self.directory=tempfile.TemporaryDirectory();self.addCleanup(self.directory.cleanup)
        patch.object(db,'DB_PATH',Path(self.directory.name)/'intent.sqlite').start();db.init_db();db.init_db()
        self.engine=RecoveryVerificationEngine(broadcast=AsyncMock())
        self.engine.intent_engine.persist=db.save_intent_evaluation
        self.engine.intent_engine.broadcast=AsyncMock()
        self.addAsyncCleanup(self.engine.shutdown)
        original=self.command
        async def command(payload,**kwargs):
            if payload['command'] in ('begin_verification','get_verification'):
                return {'status':'ok', **{k:payload[k] for k in ('verification_id','job_id','runtime_id','controller_generation','experiment_id')},
                    'evidence':{'post_recovery_tx':40,'post_recovery_rx':40,'post_recovery_avg_rtt_ms':32,
                        'complete':True,'observation_duration_sec':2.1,'reply_bins_observed':2}}
            return await original(payload,**kwargs)
        self.client._send_command.side_effect=command
        self.app=FastAPI();self.app.include_router(intents.router);self.app.include_router(traffic.router)
        patch.object(intents,'verification_engine',self.engine).start()
        patch.object(traffic,'traffic_service',self.service).start()

    async def run_window(self):
        v=await self.engine.begin(self.client,'job',['s2','s5'],time.time())
        await self.engine.wait(v['verification_id'])
        return self.engine.intent_engine.current()

    async def test_http_job_snapshot_ws_and_persistence_reconstruction(self):
        status,_=await request(self.app,'/api/traffic/start',{'count':500,'service_intent':{'profile_id':'interactive'},'job_id':'job'})
        self.assertEqual(status,200)
        result=await self.run_window()
        self.assertEqual(result['evaluation_status'],'VIOLATED')
        self.assertEqual(self.engine.current()['verification_status'],'VERIFIED')
        statuses=[c.args[0]['evaluation']['evaluation_status'] for c in self.engine.intent_engine.broadcast.call_args_list]
        self.assertEqual(statuses,['EVALUATING','VIOLATED'])
        for path in ('/api/intents/evaluation/current','/api/intents/evaluation/'+result['evaluation_id']):
            status,body=await request(self.app,path,method='GET')
            self.assertEqual((status,body),(200,result))
        status,history=await request(self.app,'/api/intents/evaluation/history',method='GET')
        self.assertEqual((status,history),(200,[result]))
        self.assertEqual(result['measurement_source'],'Recovery Verification Engine measured post-failure evidence')
        self.assertEqual(result['job_id'],'job');self.assertEqual(result['failed_link'],['s2','s5'])
        self.assertEqual(db.get_intent_evaluation(result['evaluation_id']),result)
        self.assertEqual(len(db.get_event_logs()),2)

    async def test_immutable_custom_snapshot_survives_draft_changes(self):
        selection={'profile_id':'custom','custom':{**resolve_intent(),'profile_id':'custom','max_avg_rtt_ms':25}}
        await self.client.start_traffic('h1','h2',.05,500,'job',service_intent=selection)
        selection['custom']['max_avg_rtt_ms']=500
        result=await self.run_window()
        self.assertEqual(result['intent_snapshot']['max_avg_rtt_ms'],25)
        self.assertEqual(result['evaluation_status'],'VIOLATED')

    async def test_new_job_runtime_revision_topology_and_generation_invalidate_current_not_history(self):
        await self.client.start_traffic('h1','h2',.05,500,'job')
        result=await self.run_window()
        for field,value in (('runtime_id','replacement'),('runtime_revision',99),('topology_id','multipath_mesh'),('controller_generation','g2')):
            old=getattr(self.client,field);setattr(self.client,field,value)
            self.assertIsNone(self.engine.intent_engine.current())
            setattr(self.client,field,old)
        await self.client.start_traffic('h1','h2',.05,500,'new-job')
        self.assertIsNone(self.engine.intent_engine.current())
        self.assertEqual(db.get_intent_evaluation(result['evaluation_id']),result)

    async def test_old_generation_job_cannot_supply_a_current_policy(self):
        await self.client.start_traffic('h1','h2',.05,500,'job',service_intent={'profile_id':'interactive'})
        self.client.controller_generation='g2'
        await self.engine.begin(self.client,'job',['s2','s5'],time.time())
        self.assertIsNone(self.engine.intent_engine.current())
        record=db.get_intent_evaluations()[0]
        self.assertEqual(record['evaluation_status'],'UNAVAILABLE')
        self.assertIsNone(record['intent_snapshot'])

    async def test_no_traffic_is_unavailable(self):
        await self.engine.begin(self.client,None,['s2','s5'],time.time())
        result=self.engine.intent_engine.current()
        self.assertEqual((result['evaluation_status'],result['reason_code']),('UNAVAILABLE','NO_ACTIVE_TRAFFIC'))
        self.client._send_command.assert_not_awaited()

    async def test_profiles_validation_and_truthful_http_errors(self):
        status,profiles=await request(self.app,'/api/intents/profiles',method='GET')
        self.assertEqual(status,200);self.assertEqual(len(profiles),4)
        status,policy=await request(self.app,'/api/intents/validate',{'profile_id':'interactive'})
        self.assertEqual((status,policy['max_avg_rtt_ms']),(200,25))
        for path in ('/api/intents/validate','/api/traffic/start'):
            data={'profile_id':'custom'} if path.endswith('validate') else {'service_intent':{'profile_id':'custom'}}
            status,_=await request(self.app,path,data);self.assertEqual(status,422)
        for number in (float('nan'),float('inf'),float('-inf')):
            policy={**resolve_intent(),'profile_id':'custom','max_avg_rtt_ms':number}
            data={'profile_id':'custom','custom':policy}
            for path,body in (('/api/intents/validate',data),('/api/traffic/start',{'service_intent':data})):
                status,_=await request(self.app,path,body)
                self.assertEqual(status,422)
        for path in ('/api/intents/evaluation/missing','/api/intents/evaluation/history?limit=0'):
            status,_=await request(self.app,path,method='GET');self.assertIn(status,(404,422))

    async def test_persistence_failure_visible_without_changing_phase3(self):
        self.engine.intent_engine.persist=lambda record: (_ for _ in ()).throw(RuntimeError('disk full'))
        await self.client.start_traffic('h1','h2',.05,500,'job')
        with self.assertLogs('sdn.intent',level='ERROR'):
            result=await self.run_window()
        self.assertIn('persistence failed',result['persistence_error'])
        self.assertEqual(self.engine.current()['verification_status'],'VERIFIED')


class ReportTests(unittest.TestCase):
    def test_separate_json_csv_html_and_old_record_compatibility(self):
        v=verification();snapshot=resolve_intent({'profile_id':'interactive'})
        result=evaluate(v,snapshot)
        record={'id':'x','status':'COMPLETED','controller':'reactive','summary':{'verification':v,
            'service_intent':snapshot,'intent_evaluation':result}}
        exported=json.loads(report_generator.generate_json(record))
        self.assertEqual(exported['verification']['verification_status'],'VERIFIED')
        self.assertEqual(exported['intent_evaluation']['evaluation_status'],'VIOLATED')
        row=list(csv.DictReader(io.StringIO(report_generator.generate_csv([record]))))[0]
        self.assertEqual((row['verification_status'],row['intent_evaluation_status']),('VERIFIED','VIOLATED'))
        self.assertEqual(json.loads(row['intent_requirements_json'])['average_rtt']['actual'],32)
        html=report_generator.generate_html_report(record)
        for word in ('VERIFIED','VIOLATED','average_rtt','25','32','FAIL'):self.assertIn(word,html)
        record['summary']={}
        self.assertIsNone(json.loads(report_generator.generate_json(record))['intent_evaluation'])
        row=list(csv.DictReader(io.StringIO(report_generator.generate_csv([record]))))[0]
        self.assertEqual(row['intent_evaluation_status'],'N/A')
        self.assertIn('Not recorded',report_generator.generate_html_report(record))

    def test_custom_policy_html_is_escaped(self):
        snapshot={**resolve_intent(),'profile_id':'custom','name':'<script>alert(1)</script>'}
        v=verification();result=evaluate(v,snapshot)
        html=report_generator.generate_html_report({'id':'x','controller':'reactive','status':'COMPLETED',
            'summary':{'service_intent':snapshot,'intent_evaluation':result}})
        self.assertNotIn('<script>',html);self.assertIn('&lt;script&gt;',html)


class IntentExperimentTests(mesh.MeshExperimentTests):
    async def test_all_controller_modes_capture_intent_and_evaluation_in_history(self):
        engine=RecoveryVerificationEngine(broadcast=AsyncMock())
        engine.intent_engine.broadcast=AsyncMock();self.addAsyncCleanup(engine.shutdown)
        patch.object(er,'verification_engine',engine).start()
        original=self.client._send_command.side_effect
        async def command(payload,**kwargs):
            if payload['command'] in ('begin_verification','get_verification'):
                return {'status':'ok', **{k:payload[k] for k in ('verification_id','job_id','runtime_id','controller_generation','experiment_id')},
                    'evidence':{'post_recovery_tx':40,'post_recovery_rx':40,'post_recovery_avg_rtt_ms':32,
                        'complete':True,'observation_duration_sec':2.1,'reply_bins_observed':2}}
            return await original(payload,**kwargs)
        self.client._send_command.side_effect=command
        for topology in ('diamond','multipath_mesh'):
            self.client.topology_id=topology
            self.links={pair:'UP' for pair in TOPOLOGIES[topology]['inter_switch_links']}
            src,dst=('s1','s2') if topology=='diamond' else ('s2','s5')
            for mode in ('baseline','reactive','fast_failover'):
                record=await self.runner.run_experiment(mode,topology_id=topology,fail_src=src,fail_dst=dst,
                    failure_delay_sec=0,service_intent={'profile_id':'interactive'})
                saved=db.get_experiment_by_id(record['id'])['summary']
                self.assertEqual(saved['service_intent']['max_avg_rtt_ms'],25)
                self.assertEqual(saved['verification']['verification_status'],'VERIFIED')
                self.assertEqual(saved['intent_evaluation']['evaluation_status'],'VIOLATED')
                self.assertEqual(saved['intent_evaluation']['experiment_id'],record['id'])
                self.assertEqual(saved['intent_evaluation']['topology_id'],topology)
                self.assertIsNone(self.client.experiment_id)
