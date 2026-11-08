"""Controller-independent service classification and owned observation lifecycle."""
import asyncio
import copy
import logging
import math
import json
import time
import uuid
from backend.models.verification import RecoveryVerification
from backend.services.service_intent import IntentEvaluationEngine
from backend.services.operation_error import OperationError, public_error
from backend.services.verification_config import VERIFICATION_CONFIG
from backend.websocket.manager import ws_manager

logger = logging.getLogger('sdn.verification')


def classify(evidence, config=VERIFICATION_CONFIG):
    tx, rx = evidence.get('post_recovery_tx'), evidence.get('post_recovery_rx')
    rtt = evidence.get('post_recovery_avg_rtt_ms')
    valid = (not evidence.get('invalid') and type(tx) is int and type(rx) is int and 0 <= rx <= tx and
             (rtt is None or (type(rtt) in (float, int) and math.isfinite(rtt) and rtt >= 0)))
    if not valid:
        return 'FAILED', 'EVIDENCE_UNAVAILABLE', 'Valid post-failure packet accounting is unavailable.', None, None
    if tx == 0:
        return 'FAILED', 'NO_ATTEMPTS', 'No packets were attempted in the verification window.', None, None
    if rx == 0:
        return 'FAILED', 'NO_RECEPTION', 'End-to-end traffic did not recover within the verification window.', False, False
    duration = evidence.get('observation_duration_sec')
    sufficient = (evidence.get('complete') is True and type(duration) in (float, int) and math.isfinite(duration) and duration >= config.observation_sec
                  and tx >= config.min_attempted and rx >= config.min_received)
    if not sufficient:
        return 'FAILED', 'INSUFFICIENT_EVIDENCE', 'Some replies arrived, but the bounded stability evidence was insufficient.', True, False
    bins = evidence.get('reply_bins_observed', 0)
    stable = type(bins) is int and bins >= 2
    if not stable:
        return 'DEGRADED', 'UNSTABLE_RECEPTION', 'Reachability returned, but replies did not span both halves of the observation window.', True, False
    if 100.0 * (tx - rx) / tx > config.max_loss_percent:
        return 'DEGRADED', 'EXCESSIVE_LOSS', 'Reachability restored, but post-failure packet loss exceeded the configured verification threshold.', True, True
    if rtt is not None and rtt > config.max_avg_rtt_ms:
        return 'DEGRADED', 'EXCESSIVE_RTT', 'Reachability restored, but successful-reply RTT exceeded the configured verification threshold.', True, True
    if rtt is None and config.require_rtt:
        return 'DEGRADED', 'RTT_UNAVAILABLE', 'Reachability restored, but the required RTT evidence is unavailable.', True, True
    return 'VERIFIED', 'STABLE_SERVICE', 'End-to-end service was observed and remained stable during the verification window.', True, True


class RecoveryVerificationEngine:
    def __init__(self, config=VERIFICATION_CONFIG, persist=None, broadcast=None):
        self.config, self.persist = config, persist
        self.broadcast = broadcast or ws_manager.broadcast
        self.intent_engine = IntentEvaluationEngine(self)
        self.health = None
        self.latest = None
        self.tasks = {}
        self.clients = {}
        self.started_clock = {}
        self._begin_lock = asyncio.Lock()

    def owns(self, record):
        client = self.clients.get(record['verification_id'])
        return bool(client and client.simulation_state == 'RUNNING' and
                    client.runtime_id == record['runtime_id'] and client.topology_id == record['topology_id'] and
                    client.runtime_revision == record['runtime_revision'] and
                    client.controller_generation == record['controller_generation'] and
                    (client.experiment_id == record['experiment_id'] or
                     (record['verification_status'] != 'VERIFYING' and client.experiment_id is None)) and
                    (not self.health or self.health(record)))

    def current(self):
        return copy.deepcopy(self.latest) if self.latest and self.owns(self.latest) else None

    async def publish(self, record):
        if self.persist:
            try:
                self.persist(copy.deepcopy(record))
            except Exception:
                logger.exception('Verification persistence failed')
                record['persistence_error'] = 'Verification persistence failed; check backend logs.'
        await self.broadcast({'event_type': 'RECOVERY_VERIFICATION', **{k: record[k] for k in
                              ('runtime_id', 'runtime_revision')}, 'verification': copy.deepcopy(record)})

        await self.intent_engine.update(copy.deepcopy(record))

    async def begin(self, client, job_id, failed_link, failure_timestamp, before=None, incident_id=None, failure_context=None):
        async with self._begin_lock:
            return await self._begin(client, job_id, failed_link, failure_timestamp, before, incident_id, failure_context)

    async def _begin(self, client, job_id, failed_link, failure_timestamp, before, incident_id, failure_context):
        current_context = {**client.runtime_context(), **client.controller_context()}
        if failure_context and any(current_context.get(key) != value for key, value in failure_context.items()):
            raise OperationError(409, 'Failure runtime changed; verification was not started for the replacement runtime')
        # A second failure owns a new incident; never combine two windows.
        if self.latest and self.latest['verification_status'] == 'VERIFYING':
            await self.finish(self.latest['verification_id'], 'SUPERSEDED', 'A newer failure superseded this verification.')
        if self.latest:
            old_id = self.latest['verification_id']
            self.tasks.pop(old_id, None)
            self.clients.pop(old_id, None)
            self.started_clock.pop(old_id, None)
        owner = client._traffic_owners.get(job_id, {})
        before_evidence = None
        if (before and before.get('job_id') == job_id and before.get('runtime_id') == client.runtime_id and
                owner.get('controller_generation') == client.controller_generation):
            tx, rx = before.get('transmitted'), before.get('received')
            valid = type(tx) is int and type(rx) is int and 0 <= rx <= tx
            before_evidence = {'measurement_source': 'Last accepted cumulative traffic snapshot before injection; not a dedicated pre-failure window',
                'job_id': job_id, 'transmitted': tx if valid else None, 'received': rx if valid else None,
                'loss_percent': 100.0 * (tx - rx) / tx if valid and tx else None,
                'avg_rtt_ms': before.get('avg_rtt') if valid and rx else None}
        record = RecoveryVerification(
            verification_id='verify_' + uuid.uuid4().hex, incident_id=incident_id,
            **{k: client.runtime_context()[k] for k in ('runtime_id', 'runtime_revision', 'topology_id')},
            controller_mode=client.controller_type, controller_generation=client.controller_generation,
            experiment_id=owner.get('experiment_id'), job_id=job_id,
            source_host=owner.get('src'), destination_host=owner.get('dst'),
            service_intent=copy.deepcopy(owner.get('service_intent')) if (
                owner.get('runtime_id') == client.runtime_id and owner.get('controller_generation') == client.controller_generation) else None,
            traffic_sequence=owner.get('traffic_sequence'),
            failed_link=list(failed_link), failure_timestamp=failure_timestamp,
            verification_status='NOT_STARTED', reason_code='NO_ACTIVE_TRAFFIC',
            reason='No active end-to-end traffic evidence is available for recovery verification.',
            before=before_evidence, during={'failure_requested_at': failure_timestamp, 'failure_acknowledged_at': time.time()},
            config=self.config.as_dict()).model_dump()
        self.latest = record
        self.clients[record['verification_id']] = client
        if not job_id or not owner or owner.get('runtime_id') != client.runtime_id or owner.get('controller_generation') != client.controller_generation:
            await self.publish(record)
            return copy.deepcopy(record)
        record.update(verification_status='VERIFYING', verification_started_at=time.time(),
                      reason_code='OBSERVING', reason='Collecting counter-bounded post-failure service evidence.')
        self.started_clock[record['verification_id']] = time.monotonic()
        await self.publish(record)
        try:
            await asyncio.wait_for(self.command(record, 'begin_verification'), self.config.timeout_sec)
        except Exception as exc:
            await self.complete(record, {}, 'MEASUREMENT_UNAVAILABLE', public_error(exc))
            return copy.deepcopy(record)
        # Registration has its own bounded setup wait above. Lock/socket queue
        # time before the worker creates the tap cannot consume the observation
        # budget needed for the unchanged collection window and reply grace.
        deadline = time.monotonic() + self.config.timeout_sec
        self.tasks[record['verification_id']] = asyncio.create_task(self.observe(record, deadline))
        return copy.deepcopy(record)

    async def command(self, record, command):
        client = self.clients[record['verification_id']]
        async with client._runtime_lock:
            if not self.owns(record):
                raise OperationError(409, 'Verification runtime or controller changed')
            result = await client._send_command({
                'command': command, 'job_id': record['job_id'], 'verification_id': record['verification_id'],
                **{k: record[k] for k in ('runtime_id', 'controller_generation', 'experiment_id')},
                'config': self.config.as_dict()})
            if not self.owns(record):
                raise OperationError(409, 'Verification runtime or controller changed')
            if any(result.get(k) != record.get(k) for k in
                   ('verification_id', 'job_id', 'runtime_id', 'controller_generation', 'experiment_id')) or not isinstance(result.get('evidence'), dict):
                raise OperationError(502, 'Worker did not confirm verification evidence ownership')
            return result['evidence']

    async def observe(self, record, deadline):
        evidence = {}
        try:
            while record['verification_status'] == 'VERIFYING':
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise asyncio.TimeoutError()
                evidence = await asyncio.wait_for(self.command(record, 'get_verification'), remaining)
                if evidence.get('complete'):
                    await self.complete(record, evidence)
                    return
                if time.monotonic() >= deadline:
                    await self.complete(record, evidence, 'VERIFICATION_TIMEOUT', 'Verification timed out without a complete bounded observation window.')
                    return
                await asyncio.sleep(self.config.poll_sec)
        except asyncio.CancelledError:
            raise
        except asyncio.TimeoutError:
            await self.complete(record, evidence, 'VERIFICATION_TIMEOUT', 'Verification timed out without a complete bounded observation window.')
        except Exception as exc:
            await self.complete(record, evidence, 'MEASUREMENT_UNAVAILABLE', public_error(exc))

    async def complete(self, record, evidence, code=None, reason=None):
        if record['verification_status'] != 'VERIFYING':
            return
        try:
            json.dumps(evidence, allow_nan=False)
        except (ValueError, TypeError):
            evidence = {'invalid': True}
        status, reason_code, explanation, reachability, stability = classify(evidence, self.config)
        record.update({k: evidence.get(k) for k in record if k.startswith('post_recovery_')})
        if reason_code == 'EVIDENCE_UNAVAILABLE':
            for key in record:
                if key.startswith('post_recovery_'):
                    record[key] = None
        # Loss is calculated from independent actual counters, never trusted
        # from a controller event or default 0% in another telemetry record.
        tx, rx = record['post_recovery_tx'], record['post_recovery_rx']
        record['post_recovery_loss_percent'] = 100.0 * (tx - rx) / tx if type(tx) is int and tx > 0 and type(rx) is int and 0 <= rx <= tx else None
        if not rx:
            for key in ('post_recovery_avg_rtt_ms', 'post_recovery_min_rtt_ms', 'post_recovery_max_rtt_ms'):
                record[key] = None
        record.update(verification_status='FAILED' if code else status, reason_code=code or reason_code,
                      reason=reason or explanation, reachability_restored=reachability, stability_passed=stability,
                      evidence=copy.deepcopy(evidence), verification_completed_at=time.time())
        record['verification_duration_sec'] = time.monotonic() - self.started_clock[record['verification_id']]
        await self.publish(record)

    async def finish(self, verification_id, code='INTERRUPTED', reason='Verification interrupted before completion.'):
        task = self.tasks.pop(verification_id, None)
        if task and not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        if self.latest and self.latest['verification_id'] == verification_id:
            await self.complete(self.latest, {}, code, reason)
            return copy.deepcopy(self.latest)

    async def wait(self, verification_id):
        task = self.tasks.get(verification_id)
        if task:
            await asyncio.shield(task)
            self.tasks.pop(verification_id, None)
        return copy.deepcopy(self.latest) if self.latest and self.latest['verification_id'] == verification_id else None

    async def shutdown(self):
        if self.latest:
            await self.finish(self.latest['verification_id'], 'SHUTDOWN', 'Backend stopped before verification completed.')


# Storage is bound after SQLite initialization in application startup. Importing
# this service (e.g. CLI/controller tools) does not touch the user's database.
verification_engine = RecoveryVerificationEngine()
