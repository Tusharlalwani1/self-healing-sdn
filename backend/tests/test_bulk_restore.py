"""Bulk restoration uses fresh runtime links; fake IPC, no privileged IO/DB."""
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from backend.api import links
from backend.services import mininet_client as mc
from backend.services import experiment_runner as er
from backend.services.operation_error import OperationError
from backend.services.topology_catalog import TOPOLOGIES
from backend.tests.test_runtime_errors import request


class BulkRestoreTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.addCleanup(patch.stopall)
        self.client = mc.MininetClient()
        self.client.simulation_state = 'RUNNING'
        self.states = {}
        self.failures = set()
        self.use_topology('multipath_mesh')
        self.client._send_command = AsyncMock(side_effect=self.command)
        self.log = patch.object(mc, 'save_event_log').start()
        self.broadcast = patch.object(mc.ws_manager, 'broadcast', new_callable=AsyncMock).start()
        patch.object(links, 'mininet_client', self.client).start()
        patch.object(er.experiment_runner, 'is_running', False).start()
        self.app = FastAPI()
        self.app.include_router(links.router)

    def use_topology(self, topology_id):
        self.client.topology_id = topology_id
        self.client.runtime_id = topology_id + '-runtime'
        definition = TOPOLOGIES[topology_id]
        self.states = {pair: 'UP' for pair in definition['host_links'] + definition['inter_switch_links']}

    async def command(self, payload, **kwargs):
        if payload['command'] == 'get_topology':
            return {'status': 'ok', 'topology_id': self.client.topology_id,
                    'links': [{'src': a, 'dst': b, 'status': status} for (a, b), status in self.states.items()]}
        self.assertEqual(payload['command'], 'set_link_status')
        pair = (payload['node1'], payload['node2'])
        self.assertIn(pair, self.states)
        self.assertEqual(payload['status'], 'up')
        if pair in self.failures:
            raise OperationError(502, 'Both endpoints could not be confirmed')
        self.states[pair] = 'UP'
        return {'status': 'ok', 'link_status': 'UP'}

    def mutations(self):
        return [(c.args[0]['node1'], c.args[0]['node2']) for c in self.client._send_command.call_args_list
                if c.args[0]['command'] == 'set_link_status']

    async def restore(self):
        return await request(self.app, '/api/links/restore-all')

    async def test_diamond_all_failed_restores_six_runtime_links(self):
        self.use_topology('diamond')
        self.states = dict.fromkeys(self.states, 'DOWN')
        status, body = await self.restore()
        self.assertEqual((status, body['link_count'], body['restored_count']), (200, 6, 6))
        self.assertEqual(set(self.mutations()), set(self.states))
        self.assertTrue(all(v == 'UP' for v in self.states.values()))

    async def test_mesh_all_failed_restores_sixteen_including_correct_hosts(self):
        self.states = dict.fromkeys(self.states, 'DOWN')
        status, body = await self.restore()
        self.assertEqual((status, body['link_count'], body['restored_count']), (200, 16, 16))
        self.assertEqual(set(self.mutations()), set(self.states))
        self.assertIn(('h2', 's9'), self.mutations())
        self.assertNotIn(('h2', 's4'), self.mutations())
        self.assertNotIn(('s2', 's4'), self.mutations())
        self.assertEqual(len([p for p in self.mutations() if p[0].startswith('s')]), 14)

    async def test_single_mesh_failure_and_repeat_are_idempotent(self):
        self.states[('s2', 's5')] = 'DOWN'
        status, body = await self.restore()
        self.assertEqual((status, body['link_count'], body['restored_count'], body['already_up_count']), (200, 16, 1, 15))
        self.assertEqual(self.mutations(), [('s2', 's5')])
        status, body = await self.restore()
        self.assertEqual((status, body['restored_count'], body['already_up_count']), (200, 0, 16))
        self.assertEqual(self.mutations(), [('s2', 's5')])

    async def test_multiple_mesh_failures_include_host_link(self):
        failed = [('s2', 's5'), ('s6', 's9'), ('h2', 's9')]
        for pair in failed:
            self.states[pair] = 'DOWN'
        status, body = await self.restore()
        self.assertEqual((status, body['restored_count'], body['already_up_count']), (200, 3, 13))
        self.assertEqual(set(self.mutations()), set(failed))
        updates = [c.args[0] for c in self.broadcast.call_args_list if c.args[0]['event_type'] == 'TOPOLOGY_UPDATE']
        self.assertEqual(len(updates), 3)
        self.assertTrue(all(link['status'] == 'UP' for link in updates[-1]['topology']['links']))

    async def test_healthy_mesh_never_sends_mutation_or_fake_restored_event(self):
        status, body = await self.restore()
        self.assertEqual((status, body['link_count'], body['already_up_count']), (200, 16, 16))
        self.assertEqual(self.mutations(), [])
        self.log.assert_not_called()
        self.broadcast.assert_not_awaited()

    async def test_partial_worker_failure_is_502_names_exact_link_and_continues(self):
        for pair in [('s2', 's5'), ('s6', 's9')]:
            self.states[pair] = 'DOWN'
        self.failures.add(('s2', 's5'))
        status, body = await self.restore()
        self.assertEqual(status, 502)
        self.assertIn('1 of 16', body['detail']['message'])
        failed = [r for r in body['detail']['results'] if r['status'] == 'error']
        self.assertEqual([(r['node1'], r['node2']) for r in failed], [('s2', 's5')])
        self.assertEqual(self.states[('s2', 's5')], 'DOWN')
        self.assertEqual(self.states[('s6', 's9')], 'UP')
        restored_events = [c.args[0] for c in self.broadcast.call_args_list if c.args[0]['event_type'] == 'LINK_RESTORED']
        self.assertEqual([(e['src'], e['dst']) for e in restored_events], [('s6', 's9')])

    async def test_topology_switch_uses_new_inventory_both_directions(self):
        for topology_id, expected in [('diamond', 6), ('multipath_mesh', 16), ('diamond', 6)]:
            self.use_topology(topology_id)
            self.states = dict.fromkeys(self.states, 'DOWN')
            self.client._send_command.reset_mock()
            status, body = await self.restore()
            self.assertEqual((status, body['topology_id'], body['link_count']), (200, topology_id, expected))
            self.assertEqual(set(self.mutations()), set(self.states))

    async def test_inventory_is_live_not_a_topology_catalog_fallback(self):
        self.states = {('s2', 's5'): 'DOWN', ('h2', 's9'): 'UP'}
        status, body = await self.restore()
        self.assertEqual((status, body['link_count'], body['restored_count']), (200, 2, 1))
        self.assertEqual(self.mutations(), [('s2', 's5')])

    async def test_worker_topology_mismatch_aborts_before_mutation(self):
        self.client._send_command.return_value = {'status': 'ok', 'topology_id': 'diamond', 'links': []}
        self.client._send_command.side_effect = None
        status, _ = await self.restore()
        self.assertEqual(status, 409)
        self.assertEqual(self.mutations(), [])

    async def test_discovery_unavailable_is_not_success(self):
        self.client._send_command.side_effect = OperationError(503, 'Mininet worker unavailable')
        status, body = await self.restore()
        self.assertEqual(status, 503)
        self.assertIn('worker unavailable', body['detail']['message'])
        self.assertEqual(self.mutations(), [])

    async def test_invalid_or_empty_inventory_never_fabricates_success(self):
        for inventory in (None, [], [{'src': 's1', 'dst': 's2', 'status': 'UNKNOWN'}]):
            with patch.object(self.client, 'get_topology', AsyncMock(return_value={'links': inventory})):
                status, _ = await self.restore()
            self.assertEqual(status, 502)
        self.assertEqual(self.mutations(), [])

    async def test_stopped_and_experiment_owned_runtime_are_409(self):
        self.client.simulation_state = 'STOPPED'
        self.assertEqual((await self.restore())[0], 409)
        self.client.simulation_state = 'RUNNING'
        self.client.experiment_id = 'owned-experiment'
        self.assertEqual((await self.restore())[0], 409)
        self.client.experiment_id = None
        with patch.object(er.experiment_runner, 'is_running', True):
            self.assertEqual((await self.restore())[0], 409)
        self.client._send_command.assert_not_awaited()

    async def test_bulk_holds_runtime_lock_across_snapshot_and_mutations(self):
        self.states[('s2', 's5')] = 'DOWN'
        original = self.command
        async def checked(payload, **kwargs):
            self.assertTrue(self.client._runtime_lock.locked())
            return await original(payload, **kwargs)
        self.client._send_command.side_effect = checked
        self.assertEqual((await self.restore())[0], 200)
