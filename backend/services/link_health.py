"""Runtime-owned bounded TC egress evidence. Never infers a forwarding path/RTT.

Classification uses kernel-read configured impairment and bounded counter deltas.
HEALTHY additionally requires a complete window with sufficient real packets.
This is not end-to-end service verification, and initiates no recovery actions.
"""
import asyncio
import copy
import logging
import time
import uuid

from backend.models.link_health import HealthConfig
from backend.services.operation_error import OperationError

logger = logging.getLogger('sdn.link_health')
SCOPE = 'Inter-switch TC egress only. Observed loss is the worst adequately sampled direction; HEALTHY requires both directions. Not end-to-end ICMP loss, RTT, forwarding path, or recovery verification.'


class LinkHealthService:
    def __init__(self, client, broadcast=None, persist=None, clock=time.time):
        self.client, self.broadcast, self.persist, self.clock = client, broadcast, persist, clock
        self.config = HealthConfig()
        self.records = {}
        self.windows = {}
        self.owner = None
        self.sequence = 0
        self.task = None
        self.lock = asyncio.Lock()
        client._runtime_listeners.append(self.reset)

    def context(self):
        return {**self.client.runtime_context(), **self.client.controller_context()}

    def identity(self):
        c = self.context()
        return tuple(c.get(k) for k in ('runtime_id', 'runtime_revision', 'topology_id', 'controller_generation'))

    def reset(self, *_):
        self.records.clear()
        self.windows.clear()
        self.owner = None

    def current(self):
        if self.owner != self.identity() or self.client.simulation_state != 'RUNNING':
            self.reset()
        return {**self.context(), 'simulation_state': self.client.simulation_state, 'sequence': self.sequence,
                'links': copy.deepcopy(list(self.records.values())), 'config': self.config.model_dump(),
                'threshold_label': 'Project demonstration thresholds', 'evidence_scope': SCOPE}

    def check(self, runtime_id, revision):
        if self.client.simulation_state != 'RUNNING':
            raise OperationError(409, 'Network is not running')
        if runtime_id != self.client.runtime_id or revision != self.client.runtime_revision:
            raise OperationError(409, 'Link health request belongs to a different runtime')

    async def sample(self, expected_owner=None):
        async with self.lock:
            async with self.client._runtime_lock:
                self.check(self.client.runtime_id, self.client.runtime_revision)
                owner = self.identity()
                if expected_owner is not None and owner != expected_owner:
                    raise OperationError(409, 'Runtime changed before quality readback')
                try:
                    result = await self.client._send_command({'command': 'get_link_quality', 'runtime_id': self.client.runtime_id}, timeout=30)
                except Exception:
                    self.reset()
                    raise
                if owner != self.identity() or self.client.simulation_state != 'RUNNING':
                    raise OperationError(409, 'Runtime changed during health sampling')
                if result.get('runtime_id') != self.client.runtime_id or result.get('topology_id') != self.client.topology_id or not isinstance(result.get('links'), list):
                    raise OperationError(502, 'Worker link quality ownership or inventory is invalid')
                return await self.consume(result, owner)

    async def consume(self, result, owner):
        if owner != self.identity():
            raise OperationError(409, 'Stale link health evidence')
        if self.owner != owner:
            self.reset()
            self.owner = owner
        now = self.clock()
        records = {}
        transitions = []
        for raw in result['links']:
            key = raw['link_id']
            if key in records:
                raise OperationError(502, 'Duplicate worker link health record')
            previous = self.records.get(key)
            observed, samples, window = None, None, None
            both_directions = False
            signature = (raw['quality_revision'], raw['operational_status'],
                         raw['configured_additional_delay_ms'], raw['configured_loss_percent'])
            anchor = self.windows.get(key)
            if raw['operational_status'] == 'DOWN':
                self.windows.pop(key, None)
            elif anchor and anchor[0] == signature:
                elapsed = now - anchor[1]
                if elapsed >= self.config.observation_window_sec:
                    deltas = [(e['packets']-p['packets'], e['drops']-p['drops'])
                              for e, p in zip(raw['endpoints'], anchor[2])]
                    # netem packets count dequeued packets; attempts include drops.
                    if (elapsed <= self.config.observation_window_sec * 2 and len(deltas) == 2 and
                            all(tx >= 0 and drop >= 0 for tx, drop in deltas) and
                            all(e['interface'] == p['interface'] for e,p in zip(raw['endpoints'],anchor[2]))):
                        samples = sum(tx+drop for tx, drop in deltas)
                        window = elapsed
                        ratios = [drop/(tx+drop)*100 for tx,drop in deltas if tx+drop >= self.config.min_packets]
                        both_directions = len(ratios) == 2
                        if ratios:
                            observed = max(ratios)
                    self.windows[key] = (signature, now, copy.deepcopy(raw['endpoints']))
                elif previous:
                    observed = previous['observed_loss_percent']
                    samples, window = previous['sample_count'], previous['observation_window_sec']
                    both_directions = previous['both_directions_sampled']
            else:
                self.windows[key] = (signature, now, copy.deepcopy(raw['endpoints']))
            delay, loss = raw['configured_additional_delay_ms'], raw['configured_loss_percent']
            if raw['operational_status'] == 'DOWN':
                health, code, reason = 'UNKNOWN', 'LINK_DOWN', 'Operational link is DOWN; quality evidence is unavailable.'
            elif delay >= self.config.critical_additional_delay_ms or max(loss, observed or 0) >= self.config.critical_loss_percent:
                health, code, reason = 'CRITICAL', 'CRITICAL_QUALITY', 'Kernel-read impairment or measured TC egress loss meets a critical threshold.'
            elif delay > self.config.healthy_additional_delay_ms or max(loss, observed or 0) > self.config.healthy_loss_percent:
                health, code, reason = 'DEGRADED', 'DEGRADED_QUALITY', 'Kernel-read impairment or measured TC egress loss exceeds a healthy threshold.'
            elif observed is not None and both_directions:
                health, code, reason = 'HEALTHY', 'BOUNDED_TC_EVIDENCE', 'A complete TC egress observation window meets project thresholds.'
            else:
                health, code, reason = 'UNKNOWN', 'NO_TRAFFIC_OR_INSUFFICIENT_EVIDENCE', 'Insufficient bounded TC egress traffic evidence; healthy service is not assumed.'
            record = {**self.context(), **raw, 'health_status': health, 'reason_code': code, 'reason': reason,
                      'observed_avg_rtt_ms': None, 'observed_loss_percent': observed,
                      'sample_count': samples, 'observation_window_sec': window, 'sampled_at': now,
                      'both_directions_sampled': both_directions,
                      'measurement_source': 'LINUX_TC_NETEM_READBACK_AND_COUNTERS', 'evidence_scope': SCOPE,
                      'thresholds': self.config.model_dump(),
                      'detected_at': previous['detected_at'] if previous and (previous['health_status'],previous['operational_status']) == (health,raw['operational_status']) else now}
            records[key] = record
            if (previous and (previous['health_status'], previous['operational_status']) != (health, raw['operational_status'])) or (not previous and health in ('DEGRADED', 'CRITICAL')):
                transitions.append({**record, 'incident_id': uuid.uuid4().hex, 'incident_type': 'SOFT_DEGRADATION',
                                    'previous_health': previous['health_status'] if previous else 'UNKNOWN',
                                    'current_health': health})
        # Commit persistence before publishing a transition; DB errors are not hidden.
        for incident in transitions:
            if self.persist:
                self.persist(incident)
        self.records = records
        self.sequence += 1
        snapshot = self.current()
        if self.broadcast:
            await self.broadcast({'event_type': 'LINK_HEALTH', 'health': snapshot})
        return snapshot

    async def mutate(self, command, request):
        async with self.lock:
            async with self.client._runtime_lock:
                self.check(request['runtime_id'], request['runtime_revision'])
                owner = self.identity()
                try:
                    result = await self.client._send_command({'command': command, **request}, timeout=60)
                except Exception:
                    # A partial TC write must never leave cached HEALTHY evidence.
                    self.reset()
                    raise
                if owner != self.identity():
                    raise OperationError(409, 'Runtime changed during quality operation')
        # Sampling uses fresh readback, not values copied from the request.
        await self.sample(expected_owner=owner)
        return result

    async def update_config(self, config):
        async with self.lock:
            self.config = config
            self.windows.clear()
        if self.client.simulation_state == 'RUNNING':
            return await self.sample()
        return self.current()

    async def monitor(self):
        while True:
            try:
                if self.client.simulation_state == 'RUNNING':
                    await self.sample()
                else:
                    self.reset()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception('Link health sampling failed; current evidence invalidated')
                self.reset()
                self.sequence += 1
                if self.broadcast:
                    await self.broadcast({'event_type': 'LINK_HEALTH', 'health': self.current(),
                                          'error': 'Link quality sampling unavailable; check backend logs'})
            await asyncio.sleep(1)

    def start(self):
        if self.task is None or self.task.done():
            self.task = asyncio.create_task(self.monitor())

    async def shutdown(self):
        if self.task:
            self.task.cancel()
            await asyncio.gather(self.task, return_exceptions=True)
            self.task = None
        self.reset()


from backend.services.mininet_client import mininet_client
from backend.websocket.manager import ws_manager

link_health = LinkHealthService(mininet_client, ws_manager.broadcast)
