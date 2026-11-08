"""Owned, bounded adaptive service cycles. No worker lock spans observation waits."""
import asyncio
import copy
import logging
import time
import uuid

from backend.services.adaptive_policy import candidates, edge, improves
from backend.services.operation_error import OperationError, public_error
from backend.services.service_intent import evaluate

logger = logging.getLogger('sdn.adaptive')
OWNER_KEYS = ('runtime_id', 'runtime_revision', 'topology_id', 'controller_generation', 'experiment_id', 'job_id', 'traffic_sequence')


class AdaptiveHealing:
    def __init__(self, client, verification, health, traffic, ready, broadcast=None, persist=None):
        self.client, self.verification, self.health, self.traffic = client, verification, health, traffic
        self.ready, self.broadcast, self.persist = ready, broadcast, persist
        self.config = {'max_attempts': 3, 'cooldown_sec': 2.0, 'candidate_limit': 24, 'enabled': True}
        self.latest = None
        self.cycle_task = None
        self.monitor_task = None
        self.seen = set()
        self.last_owner = None
        self.last_started = 0
        self.pending = None
        self.installed = None
        self.external_job = None
        self.trigger_lock = asyncio.Lock()

    def job(self):
        if self.external_job and self.external_job.get('experiment_id') == self.client.experiment_id:
            return copy.deepcopy(self.external_job)
        return self.traffic()

    def context(self, job=None):
        job = job or self.job()
        return {**self.client.runtime_context(), **self.client.controller_context(),
                'experiment_id': job.get('experiment_id'), 'job_id': job.get('job_id'),
                'traffic_sequence': job.get('traffic_sequence')}

    def owns(self, record, active=False):
        now = self.context()
        return (self.client.simulation_state == 'RUNNING' and self.client.controller_type == 'adaptive' and self.ready() and
                all(record.get(k) == now.get(k) for k in OWNER_KEYS) and
                (not active or self.job().get('active') is True))

    def current(self):
        return copy.deepcopy(self.latest) if self.latest and self.owns(self.latest) else None

    async def publish(self, record):
        record['updated_at'] = time.time()
        record['sequence'] = record.get('sequence', 0) + 1
        if self.persist:
            self.persist(copy.deepcopy(record))
        if self.broadcast:
            await self.broadcast({'event_type': 'ADAPTIVE_HEALING', 'adaptive': copy.deepcopy(record)})

    def check(self, record):
        if self.latest is not record or not self.owns(record, active=True):
            raise OperationError(409, 'Adaptive runtime/controller/traffic owner changed or traffic ended')

    async def inventory(self, record):
        async with self.client._runtime_lock:
            self.check(record)
            topo = await self.client.get_topology()
            self.check(record)
        quality = self.health.current()
        if any(quality.get(k) != record.get(k) for k in ('runtime_id', 'runtime_revision', 'topology_id', 'controller_generation')):
            quality = {'links': []}
        return topo, quality

    async def apply(self, record, candidate, attempt):
        async with self.client._runtime_lock:
            self.check(record)
            request = {'command': 'apply_adaptive_path', **{k: record[k] for k in OWNER_KEYS},
                       'cycle_id': record['cycle_id'], 'attempt': attempt, 'path': candidate['path']}
            result = await self.client._send_command(request, timeout=60)
            self.check(record)
            if (any(result.get(k) != request.get(k) for k in ('runtime_id', 'controller_generation', 'experiment_id', 'job_id', 'cycle_id', 'attempt')) or
                result.get('installed_path') != candidate['path'] or result.get('source') != 'OVS_OPENFLOW13_FLOW_READBACK'):
                raise OperationError(502, 'Adaptive forwarding acknowledgement ownership/readback mismatch')
            self.installed = {**{k: record[k] for k in OWNER_KEYS}, 'path': candidate['path']}
            return result

    async def trigger(self, kind, link=None, evidence=None):
        async with self.trigger_lock:
            return await self._trigger(kind, link, evidence)

    async def _trigger(self, kind, link=None, evidence=None):
        if not self.config['enabled'] or self.client.controller_type != 'adaptive' or not self.ready():
            return None
        job = self.job()
        if not job.get('active') or not job.get('job_id'):
            return None
        owner = self.client._traffic_owners.get(job['job_id'], {})
        context = self.context(job)
        if any(owner.get(k) != context.get(k) for k in OWNER_KEYS):
            return None
        identity = tuple(context.get(k) for k in OWNER_KEYS)
        if identity != self.last_owner:
            await self.cancel('OWNER_CHANGED', 'New traffic/runtime owner.')
            self.last_owner, self.seen, self.installed, self.pending = identity, set(), None, None
            self.last_started = 0
        if (kind in ('HARD_FAILURE', 'SOFT_DEGRADATION') and link and self.installed and self.owns(self.installed) and
            edge(*link) not in {edge(a, b) for a, b in zip(self.installed['path'], self.installed['path'][1:])}):
            return self.current()
        # An active cycle is invalidated by a new incident. Its task is cancelled
        # before another cycle may apply; a short poll will admit the pending one.
        if self.cycle_task and not self.cycle_task.done():
            if kind == 'SOFT_DEGRADATION':
                # Preserve this observation so fresh quality can justify a
                # closed-loop retry instead of preempting it with a new cycle.
                self.latest.setdefault('additional_incidents', []).append({
                    'trigger': kind, 'link': copy.deepcopy(link), 'evidence': copy.deepcopy(evidence),
                    'received_at': time.time()})
                await self.publish(self.latest)
                return self.current()
            self.pending = (kind, link, evidence)
            await self.cancel('SUPERSEDED', 'A newer network incident superseded this cycle.')
        if time.monotonic() - self.last_started < self.config['cooldown_sec']:
            self.pending = (kind, link, evidence)
            return None
        record = {**{k: context.get(k) for k in OWNER_KEYS}, 'controller_mode': 'adaptive',
                  'cycle_id': 'adaptive_' + uuid.uuid4().hex, 'created_at': time.time(), 'sequence': 0,
                  'trigger': kind, 'trigger_link': link, 'trigger_evidence': copy.deepcopy(evidence),
                  'intent_snapshot': copy.deepcopy(owner.get('service_intent')), 'source_host': owner.get('src'),
                  'destination_host': owner.get('dst'), 'config': copy.deepcopy(self.config),
                  'status': 'EVALUATING', 'outcome': None, 'reason': 'Ranking runtime candidates.',
                  'attempts': [], 'candidates': [], 'installed_path': None, 'observed_path': None,
                  'path_scope': 'Computed candidates and checked installed rules are not observed dataplane paths.'}
        self.latest = record
        if kind == 'HARD_FAILURE' and link:
            self.seen.add(('HARD_FAILURE', edge(*link)))
        self.last_started = time.monotonic()
        self.pending = None
        await self.publish(record)
        self.cycle_task = asyncio.create_task(self.run(record))
        return copy.deepcopy(record)

    async def run(self, record):
        verification_id = None
        try:
            if not record['intent_snapshot']:
                raise OperationError(409, 'No job-bound intent snapshot is available for adaptive ranking')
            attempted = set()
            previous, evaluation = None, None
            for attempt in range(1, record['config']['max_attempts'] + 1):
                self.check(record)
                topo, quality = await self.inventory(record)
                ranked = candidates(topo, quality, record['source_host'], record['destination_host'],
                                    record['intent_snapshot'], record['config']['candidate_limit'])
                record['candidates'] = ranked
                options = [p for p in ranked if p['candidate_id'] not in attempted]
                if previous:
                    # Compare both paths against the SAME fresh evidence snapshot.
                    old = next((p for p in ranked if p['candidate_id'] == previous['candidate_id']), previous)
                    options = [p for p in options if improves(p, old, evaluation)]
                if not options:
                    supported = bool(ranked and all(not p['components']['missing_config_values'] for p in ranked))
                    record.update(outcome='BEST_ACHIEVABLE' if previous and supported else 'ESCALATED',
                                  reason='No untried candidate has a supported improvement for the failed requirement.' if previous else 'No eligible runtime candidate.')
                    break
                selected = options[0]
                attempted.add(selected['candidate_id'])
                item = {'attempt': attempt, 'candidate': copy.deepcopy(selected), 'candidate_snapshot': copy.deepcopy(ranked),
                        'health_snapshot': copy.deepcopy(quality), 'intent_snapshot': copy.deepcopy(record['intent_snapshot']),
                        'status': 'APPLYING', 'action': None, 'verification': None, 'intent_evaluation': None}
                record['attempts'].append(item)
                record.update(selected_candidate=selected, status='APPLYING', reason=selected['reason'])
                await self.publish(record)
                item['action'] = await self.apply(record, selected, attempt)
                record['installed_path'] = selected['path']
                item['status'] = record['status'] = 'VERIFYING'
                await self.publish(record)
                self.check(record)
                v = await self.verification.begin(self.client, record['job_id'], record['trigger_link'] or [],
                    record['created_at'], incident_id=record['cycle_id'], failure_context={k: record[k] for k in
                    ('runtime_id', 'runtime_revision', 'topology_id', 'controller_generation')})
                verification_id = v['verification_id']
                item['verification_id'] = verification_id
                await self.publish(record)
                v = await self.verification.wait(verification_id)
                # Completed traffic can finish its final observation; it cannot admit another apply.
                if self.latest is not record or not self.owns(record) or not v or v.get('incident_id') != record['cycle_id'] or v.get('verification_id') != verification_id or any(v.get(k) != record.get(k) for k in OWNER_KEYS):
                    raise OperationError(409, 'Adaptive verification result owner changed')
                item['verification'] = v
                evaluation = evaluate(v, record['intent_snapshot'])
                item['intent_evaluation'] = evaluation
                item['status'] = 'COMPLETED'
                if v['verification_status'] != 'VERIFIED':
                    record.update(outcome='FAILED', reason='Bounded recovery verification did not pass: ' + v['reason_code'])
                    break
                if evaluation['evaluation_status'] == 'SATISFIED':
                    record.update(outcome='SATISFIED', reason='Recovery VERIFIED and service intent SATISFIED.')
                    break
                if evaluation['evaluation_status'] != 'VIOLATED':
                    record.update(outcome='ESCALATED', reason='Intent evidence unavailable; no justified retry.')
                    break
                previous = selected
                if attempt == record['config']['max_attempts']:
                    record.update(outcome='ESCALATED', reason='Maximum attempts reached; no further forwarding action.')
                    break
                record.update(status='RE_EVALUATING', reason='Intent violated; checking fresh evidence for a justified untried candidate.')
                await self.publish(record)
                await asyncio.sleep(record['config']['cooldown_sec'])
        except asyncio.CancelledError:
            # Admission can be cancelled while the worker registers its tap,
            # before begin() returns its ID. Finalize only this cycle's record.
            admitted = getattr(self.verification, 'latest', None)
            if verification_id is None and admitted and admitted.get('incident_id') == record['cycle_id']:
                verification_id = admitted['verification_id']
            if verification_id:
                finished = await self.verification.finish(verification_id, 'ADAPTIVE_CANCELLED', 'Adaptive cycle cancelled.')
                if record['attempts']:
                    record['attempts'][-1]['verification'] = finished
            if record['attempts']:
                record['attempts'][-1]['status'] = 'CANCELLED'
            if record['status'] == 'APPLYING':
                self.installed = None
                record['installed_path'] = None
            raise
        except Exception as exc:
            record.update(outcome='ESCALATED', reason=public_error(exc), error=public_error(exc))
            if isinstance(exc, OperationError) and exc.results is not None:
                record['error_details'] = copy.deepcopy(exc.results)
            # Readback/apply failure makes any prior installed-path assertion unsafe.
            if record['status'] == 'APPLYING':
                self.installed = None
                record['installed_path'] = None
        record['status'] = 'COMPLETED'
        await self.publish(record)

    async def cancel(self, code='OPERATOR_CANCELLED', reason='Operator cancelled adaptive healing.'):
        task = self.cycle_task
        if task and not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            if self.latest:
                self.latest.update(status='COMPLETED', outcome='ESCALATED', reason=reason, reason_code=code)
                await self.publish(self.latest)

    async def wait(self):
        if self.cycle_task:
            await asyncio.shield(self.cycle_task)
        return self.current()

    async def tick(self):
        job = self.job()
        if not self.config['enabled']:
            self.last_owner = None
            return
        if self.client.controller_type != 'adaptive' or not self.ready() or not job.get('active'):
            if self.cycle_task and not self.cycle_task.done() and not self.owns(self.latest):
                await self.cancel('OWNER_CHANGED', 'Runtime/controller/traffic owner changed.')
            return
        owner = tuple(self.context().get(k) for k in OWNER_KEYS)
        if owner != self.last_owner:
            await self.trigger('SERVICE_START')
            return
        if self.pending and (not self.cycle_task or self.cycle_task.done()) and time.monotonic()-self.last_started >= self.config['cooldown_sec']:
            pending, self.pending = self.pending, None
            await self.trigger(*pending)
            return
        topo = await self.client.get_topology()
        if owner != tuple(self.context().get(k) for k in OWNER_KEYS):
            return
        route = self.installed['path'] if self.installed and self.owns(self.installed) else []
        route_edges = {edge(a, b) for a, b in zip(route, route[1:])}
        current = set()
        incidents = []
        for link in topo.get('links', []):
            key = edge(link['src'], link['dst'])
            if link['status'] == 'DOWN':
                signature = ('HARD_FAILURE', key)
                current.add(signature)
                if signature not in self.seen and (not route or key in route_edges):
                    incidents.append((signature[0], list(key), link))
        for row in self.health.current().get('links', []):
            key = edge(row['src'], row['dst'])
            if row['operational_status'] == 'UP' and row['health_status'] in ('DEGRADED', 'CRITICAL'):
                signature = ('SOFT_DEGRADATION', key, row['health_status'], row.get('quality_revision'))
                current.add(signature)
                if signature not in self.seen and key in route_edges:
                    incidents.append((signature[0], list(key), row))
        self.seen = current
        if incidents:
            await self.trigger(*incidents[0])

    async def monitor(self):
        while True:
            try:
                await self.tick()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception('Adaptive monitoring failed; no success inferred')
            await asyncio.sleep(1)

    def start(self):
        if not self.monitor_task or self.monitor_task.done():
            self.monitor_task = asyncio.create_task(self.monitor())

    async def shutdown(self):
        if self.monitor_task:
            self.monitor_task.cancel()
            await asyncio.gather(self.monitor_task, return_exceptions=True)
        await self.cancel('SHUTDOWN', 'Backend shutdown interrupted adaptive cycle.')


def build_service():
    from backend.services.mininet_client import mininet_client
    from backend.services.recovery_verification import verification_engine
    from backend.services.link_health import link_health
    from backend.services.traffic_service import traffic_service
    from backend.services.controller_manager import controller_manager
    from backend.websocket.manager import ws_manager
    return AdaptiveHealing(mininet_client, verification_engine, link_health, traffic_service.snapshot,
        lambda: controller_manager.status == 'READY', ws_manager.broadcast)


adaptive_healing = build_service()
