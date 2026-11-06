"""Controller intent must never be advertised as verified dataplane forwarding."""
import unittest
from unittest.mock import AsyncMock, patch

from backend.api import topology
from backend.services import controller_manager as cm
from backend.services.log_parser import RyuLogParser


class PathProvenanceTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.addCleanup(patch.stopall)
        self.manager = cm.ControllerManager()
        self.events = patch.object(cm, "save_event_log").start()
        self.broadcast = patch.object(cm.ws_manager, "broadcast", new_callable=AsyncMock).start()
        patch.object(topology, "controller_manager", self.manager).start()
        patch.object(cm.mininet_client, "simulation_state", "RUNNING").start()
        patch.object(cm.mininet_client, "get_topology", new_callable=AsyncMock,
                     return_value={"nodes": [], "links": []}).start()

    async def ingest(self, line):
        event = RyuLogParser.parse_line(line)
        self.assertIsNotNone(event)
        await self.manager._handle_parsed_event(event)
        return event

    async def test_exact_mesh_log_sequence_reverse_path_precedes_failure(self):
        self.manager.active_controller = "baseline"
        forward = await self.ingest("Path for 00:00:00:00:00:01 -> 00:00:00:00:00:02: ['s1', 's2', 's5', 's9']")
        reverse = await self.ingest("Path for 00:00:00:00:00:02 -> 00:00:00:00:00:01: ['s9', 's6', 's3', 's1']")
        self.assertEqual(forward['type'], 'PATH_COMPUTED')
        self.assertEqual(reverse['src'], forward['dst'])
        self.assertEqual(reverse['path'], ['s9', 's6', 's3', 's1'])
        await self.ingest("LINK DOWN s2 <-> s5 at t=1793870880.756 (baseline: no recovery action)")
        await self.ingest("LINK DOWN s5 <-> s2 at t=1793870880.757 (baseline: no recovery action)")
        snapshot = await topology.get_topology()
        self.assertEqual(snapshot['active_controller'], 'baseline')
        self.assertEqual(snapshot['active_paths'], [])
        self.assertEqual(self.manager.active_paths, [])
        self.assertIsNone(self.manager.last_recovery_event)
        self.assertFalse(any(c.args[0]['event_type'] == 'PATH_ACTIVE' for c in self.broadcast.call_args_list))
        self.assertIn('forwarding unverified', self.events.call_args_list[0].args[2])

    async def test_reactive_timing_preserved_without_claiming_forwarding(self):
        self.manager.active_controller = 'reactive'
        await self.ingest("HEALED dst=00:00:00:00:00:02 old=['s1', 's2', 's5', 's9'] new=['s1', 's3', 's6', 's9'] in 3.2 ms")
        self.assertEqual(self.manager.last_recovery_event['duration_ms'], 3.2)
        self.assertEqual(self.manager.last_recovery_event['type'], 'HEALED')
        self.assertEqual(self.manager.active_paths, [])
        self.assertEqual((await topology.get_topology())['active_paths'], [])
        self.assertEqual(self.broadcast.call_args.args[0]['event_type'], 'HEALED')

    async def test_ff_recomputation_does_not_claim_local_path_or_switching_time(self):
        self.manager.active_controller = 'fast_failover'
        await self.ingest('ROUTES RECOMPUTED in 12.2 ms (switches had already failed over locally)')
        self.assertEqual(self.manager.last_recovery_event['duration_ms'], 12.2)
        self.assertIn('local FF switching time not measured', self.manager.last_recovery_event['note'])
        self.assertEqual((await topology.get_topology())['active_paths'], [])

    async def test_rest_does_not_expose_a_stale_legacy_cache(self):
        self.manager.active_paths = [['s9', 's6', 's3', 's1']]
        for state in ('RUNNING', 'STOPPED'):
            with patch.object(cm.mininet_client, 'simulation_state', state):
                self.assertEqual((await topology.get_topology())['active_paths'], [])
