"""Independent policy evaluation. Never measures traffic or changes recovery rules."""
import copy
import logging
import math
import time
from backend.models.intent import ServiceIntent, IntentSelection, IntentEvaluation
from backend.websocket.manager import ws_manager

logger = logging.getLogger('sdn.intent')

# Project demonstration defaults, not universal SLA standards. Priority is metadata.
PROFILES = tuple(ServiceIntent(profile_id=key, name=name, priority=priority,
    require_reachability=True, max_loss_percent=loss, max_avg_rtt_ms=rtt)
    for key, name, priority, loss, rtt in (
        ('standard', 'Standard', 'NORMAL', 5, 100),
        ('interactive', 'Interactive / Low Latency', 'HIGH', 1, 25),
        ('reliable', 'Reliable', 'CRITICAL', 0, 100),
        ('bulk', 'Bulk / Throughput-Tolerant', 'LOW', 10, 250)))


def resolve_intent(selection=None):
    selection = IntentSelection.model_validate(selection or {'profile_id': 'standard'})
    profile = selection.custom if selection.profile_id == 'custom' else next(
        p for p in PROFILES if p.profile_id == selection.profile_id)
    return profile.model_dump()


def evaluate(verification, snapshot):
    """Known failures win over unavailable evidence; otherwise every requirement must pass."""
    v = verification
    intent = ServiceIntent.model_validate(snapshot) if snapshot else None
    state = v['verification_status']
    requirements = {}
    pending = state in ('VERIFYING', 'NOT_STARTED')
    for key, target, actual, unit in (
        ('reachability', True if intent and intent.require_reachability else None, v.get('reachability_restored'), ''),
        ('packet_loss', intent.max_loss_percent if intent else None, v.get('post_recovery_loss_percent'), '%'),
        ('average_rtt', intent.max_avg_rtt_ms if intent else None, v.get('post_recovery_avg_rtt_ms'), 'ms')):
        if target is None:
            continue
        valid = type(actual) is bool if key == 'reachability' else (
            type(actual) in (int, float) and math.isfinite(actual) and actual >= 0 and
            (key != 'packet_loss' or actual <= 100))
        actual = actual if valid and not pending else None
        result = 'UNAVAILABLE' if actual is None else 'PASS' if (
            actual is True if key == 'reachability' else actual <= target) else 'FAIL'
        requirements[key] = {'target': target, 'actual': actual, 'unit': unit, 'status': result}
    failures = [key for key, result in requirements.items() if result['status'] == 'FAIL']
    if state == 'VERIFYING':
        status, code, reason = 'EVALUATING', 'VERIFICATION_PENDING', 'Waiting for bounded recovery evidence.'
    elif state == 'NOT_STARTED':
        status, code, reason = 'UNAVAILABLE', v.get('reason_code', 'NO_ACTIVE_TRAFFIC'), v['reason']
    elif not intent:
        status, code, reason = 'UNAVAILABLE', 'INTENT_UNAVAILABLE', 'No job-bound service intent was recorded.'
    elif failures:
        code = 'MULTIPLE_REQUIREMENTS_FAILED' if len(failures) > 1 else {
            'reachability': 'REACHABILITY_REQUIREMENT_FAILED', 'packet_loss': 'LOSS_THRESHOLD_EXCEEDED',
            'average_rtt': 'RTT_THRESHOLD_EXCEEDED'}[failures[0]]
        status, reason = 'VIOLATED', 'Measured requirements failed: ' + ', '.join(failures) + '.'
    elif any(r['status'] == 'UNAVAILABLE' for r in requirements.values()):
        status, code, reason = 'UNAVAILABLE', 'EVIDENCE_UNAVAILABLE', 'Required post-failure evidence is unavailable.'
    else:
        status, code, reason = 'SATISFIED', 'INTENT_SATISFIED', 'All configured requirements passed on measured evidence.'
    now = time.time()
    return IntentEvaluation(
        evaluation_id='intent_' + v['verification_id'],
        **{key: v.get(key) for key in ('verification_id', 'verification_status', 'runtime_id', 'runtime_revision',
            'topology_id', 'controller_mode', 'controller_generation', 'experiment_id', 'job_id', 'traffic_sequence',
            'source_host', 'destination_host', 'failed_link', 'failure_timestamp')},
        intent_snapshot=intent, evaluation_status=status, requirements=requirements,
        reason_code=code, reason=reason, created_at=now,
        completed_at=None if status == 'EVALUATING' else now,
        evidence={key: copy.deepcopy(v.get(key)) for key in ('post_recovery_tx', 'post_recovery_rx',
            'post_recovery_loss_percent', 'post_recovery_avg_rtt_ms', 'reachability_restored',
            'verification_started_at', 'verification_completed_at', 'evidence_scope')}).model_dump()


class IntentEvaluationEngine:
    def __init__(self, verification_engine, persist=None, broadcast=None):
        self.verification_engine = verification_engine
        self.persist = persist
        self.broadcast = broadcast or ws_manager.broadcast
        self.latest = None

    def current(self):
        v = self.verification_engine.current()
        value = self.latest
        if not v or not value or any(v.get(k) != value.get(k) for k in (
            'verification_id', 'runtime_id', 'runtime_revision', 'controller_generation', 'job_id')):
            return None
        # Starting another job invalidates "current", but history remains intact.
        client = self.verification_engine.clients.get(v['verification_id'])
        owner = client._traffic_owners.get(value['job_id'], {}) if client else {}
        if owner and (owner.get('traffic_sequence') != client._traffic_sequence or
                      owner.get('runtime_id') != value['runtime_id'] or
                      owner.get('controller_generation') != value['controller_generation']):
            return None
        return copy.deepcopy(value)

    async def update(self, verification):
        record = evaluate(verification, verification.get('service_intent'))
        if self.latest and self.latest['evaluation_id'] == record['evaluation_id']:
            record['created_at'] = self.latest['created_at']
        if self.persist:
            try:
                self.persist(copy.deepcopy(record))
            except Exception:
                logger.exception('Intent evaluation persistence failed')
                record['persistence_error'] = 'Intent evaluation persistence failed; check backend logs.'
        self.latest = record
        await self.broadcast({'event_type': 'INTENT_EVALUATION', 'evaluation': copy.deepcopy(record),
                              'runtime_id': record['runtime_id'], 'runtime_revision': record['runtime_revision']})
        return copy.deepcopy(record)
