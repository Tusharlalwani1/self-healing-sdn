"""Mesh ownership/cleanup/provenance using isolated DB and fake SDN IO."""
import json
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import AsyncMock, patch
from backend.tests.test_telemetry_ownership import OwnershipFixture
from backend.services import experiment_runner as er
from backend.services.topology_catalog import TOPOLOGIES
from backend.services.report_generator import report_generator
from backend.database import db
from backend.services.operation_error import OperationError


class MeshExperimentTests(OwnershipFixture):
    def setUp(self):
        super().setUp()
        self.client.topology_id='multipath_mesh'
        self.directory=tempfile.TemporaryDirectory();self.addCleanup(self.directory.cleanup)
        patch.object(db,'DB_PATH',Path(self.directory.name)/'mesh.sqlite').start();db.init_db()
        patch.object(er,'mininet_client',self.client).start()
        patch.object(er,'save_event_log').start();patch.object(er,'save_experiment',side_effect=db.save_experiment).start()
        patch.object(er.asyncio,'sleep',new_callable=AsyncMock).start()
        patch.object(er.controller_manager,'last_recovery_event',None).start()
        patch.object(er.controller_manager,'active_controller',None).start()
        patch.object(er.controller_manager,'status','STOPPED').start()
        patch.object(er.controller_manager,'generation',None).start()
        async def select(mode,**kwargs):
            er.controller_manager.active_controller=mode;er.controller_manager.status='READY'
            er.controller_manager.generation=uuid.uuid4().hex
            self.client.controller_type=mode;self.client.controller_generation=er.controller_manager.generation
        patch.object(er.controller_manager,'select_controller',AsyncMock(side_effect=select)).start()
        self.links={pair:'UP' for pair in TOPOLOGIES['multipath_mesh']['inter_switch_links']}
        original=self.command
        async def command(payload,**kwargs):
            if payload['command']=='get_topology':
                return {'status':'ok','topology_id':self.client.topology_id,'links':[{'src':a,'dst':b,'status':status} for (a,b),status in self.links.items()]}
            if payload['command']=='set_link_status': self.links[(payload['node1'],payload['node2'])]=payload['status'].upper()
            return await original(payload,**kwargs)
        self.client._send_command=AsyncMock(side_effect=command)
        self.runner=er.ExperimentRunner()
        self.bulk_restore=patch.object(self.client,'restore_all_links',
            AsyncMock(side_effect=AssertionError('Experiment cleanup must restore its owned target, not bulk links'))).start()

    async def test_all_modes_use_mesh_finite_counters_restore_and_persist_provenance(self):
        for mode in ('baseline','reactive','fast_failover'):
            result=await self.runner.run_experiment(mode,topology_id='multipath_mesh',failure_delay_sec=0,fail_src='s6',fail_dst='s9')
            self.assertEqual(result['status'],'COMPLETED')
            self.assertEqual((result['packets_transmitted'],result['packets_received']),(7,5))
            self.assertEqual(self.links[('s6','s9')],'UP')
            self.assertIsNone(self.client.experiment_id)
            saved=db.get_experiment_by_id(result['id'])
            self.assertEqual(saved['summary']['topology_id'],'multipath_mesh')
            self.assertIsNone(saved['recovery_duration_ms'])
            self.assertEqual(json.loads(report_generator.generate_json(saved))['topology_id'],'multipath_mesh')
            self.assertIn('multipath_mesh',report_generator.generate_csv([saved]))
            self.assertIn('Multi-Path Mesh',report_generator.generate_html_report(saved))
        self.bulk_restore.assert_not_awaited()
        restored=[call.args[0] for call in self.client._send_command.call_args_list
                  if call.args[0]['command']=='set_link_status' and call.args[0]['status']=='up']
        self.assertEqual(len(restored),3)
        self.assertTrue(all((r['node1'],r['node2'])==('s6','s9') for r in restored))

    async def test_missing_mesh_link_fails_without_fabricating_success_metrics(self):
        with self.assertRaises(OperationError):
            await self.runner.run_experiment('reactive',topology_id='multipath_mesh',failure_delay_sec=0,fail_src='s2',fail_dst='s9')
        saved=db.get_experiments()[0]
        self.assertEqual(saved['status'],'FAILED')
        self.assertEqual(saved['summary']['topology_id'],'multipath_mesh')
        self.assertIsNone(saved['packets_transmitted'])

    async def test_cancellation_restores_mesh_target_and_preserves_topology_owner(self):
        original=self.client._send_command.side_effect
        async def cancel_on_failure(payload,**kwargs):
            result=await original(payload,**kwargs)
            if payload['command']=='set_link_status' and payload['status']=='down': self.runner.cancel()
            return result
        self.client._send_command.side_effect=cancel_on_failure
        result=await self.runner.run_experiment('reactive',topology_id='multipath_mesh',failure_delay_sec=0,fail_src='s6',fail_dst='s9')
        self.assertEqual(result['status'],'CANCELLED')
        self.assertEqual(self.links[('s6','s9')],'UP')
        self.assertEqual(self.client.topology_id,'multipath_mesh')
        self.assertIsNone(self.client.experiment_id)
        self.assertIsNone(result['packets_transmitted'])
        self.bulk_restore.assert_not_awaited()
