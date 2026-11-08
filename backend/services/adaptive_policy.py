"""Bounded deterministic project policy, not an SLA predictor or measured path."""
import math
from collections import deque


def edge(a, b):
    return tuple(sorted((a, b)))


def number(value):
    return value if type(value) in (int, float) and math.isfinite(value) and value >= 0 else None


def candidates(topology, health, src, dst, intent, limit=24):
    """BFS of simple paths, bounded in work and output, host endpoints included."""
    switches = set(topology.get('switches', []))
    graph = {}
    for link in topology.get('links', []):
        if link['status'] != 'UP':
            continue
        a, b = link['src'], link['dst']
        graph.setdefault(a, set()).add(b)
        graph.setdefault(b, set()).add(a)
    quality = {edge(r['src'], r['dst']): r for r in health.get('links', [])}
    queue, paths, work = deque([[src]]), [], 0
    while queue and len(paths) < limit and work < 4096:
        path = queue.popleft()
        work += 1
        if path[-1] == dst:
            paths.append(path)
            continue
        for node in sorted(graph.get(path[-1], [])):
            if node not in path and (node in switches or node == dst):
                queue.append(path + [node])
    result = []
    for path in paths:
        rows = [quality.get(edge(a, b), {}) for a, b in zip(path, path[1:]) if a in switches and b in switches]
        delays = [number(r.get('configured_additional_delay_ms')) for r in rows]
        losses = [number(r.get('configured_loss_percent')) for r in rows]
        observed = [number(r.get('observed_loss_percent')) for r in rows]
        # Sum of configured risks is an ordering heuristic, NOT end-to-end loss/RTT.
        delay = sum(delays) if all(v is not None for v in delays) else None
        loss = sum(losses) if all(v is not None for v in losses) else None
        measured = max((v for v in observed if v is not None), default=None)
        critical = sum(r.get('health_status') == 'CRITICAL' for r in rows)
        degraded = sum(r.get('health_status') == 'DEGRADED' for r in rows)
        unknown = sum(r.get('health_status', 'UNKNOWN') == 'UNKNOWN' for r in rows)
        missing = sum(v is None for v in delays + losses)
        delay_weight = 100 / max(intent.get('max_avg_rtt_ms') or 100, 1)
        loss_weight = 5 / max(intent.get('max_loss_percent') if intent.get('max_loss_percent') is not None else 5, .1)
        cost = ((delay or 0) * delay_weight + (loss or 0) * loss_weight * 10 +
                (measured or 0) * loss_weight * 10 + degraded * 100 + unknown * 5 + missing * 100 + len(rows))
        components = dict(critical_links=critical, degraded_links=degraded, unknown_links=unknown,
            missing_config_values=missing, configured_delay_sum_ms=delay, configured_loss_risk_sum_percent=loss,
            worst_observed_tc_loss_percent=measured, observed_path_rtt_ms=None,
            delay_weight=delay_weight, loss_weight=loss_weight, policy_cost=cost)
        result.append(dict(candidate_id='>'.join(path), path=path, components=components,
            rank_key=[critical, cost, len(path), '>'.join(path)],
            reason='Avoid CRITICAL first; threshold-weighted configured risks, measured TC loss, uncertainty and hop penalties. Not a service prediction.'))
    return sorted(result, key=lambda r: r['rank_key'])


def improves(candidate, previous, evaluation):
    """A retry needs supported, strictly better risk for an actually failed requirement."""
    a, b = candidate['components'], previous['components']
    if a['critical_links'] > b['critical_links'] or a['missing_config_values'] or b['missing_config_values']:
        return False
    keys = []
    reqs = evaluation.get('requirements', {})
    if reqs.get('average_rtt', {}).get('status') == 'FAIL':
        keys.append('configured_delay_sum_ms')
    if reqs.get('packet_loss', {}).get('status') == 'FAIL':
        keys.append('configured_loss_risk_sum_percent')
    comparable = ('configured_delay_sum_ms', 'configured_loss_risk_sum_percent')
    return bool(keys and all(a[k] <= b[k] for k in comparable) and any(a[k] < b[k] for k in keys))
