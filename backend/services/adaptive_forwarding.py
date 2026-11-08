"""Privileged, checked job-specific flow application. No inferred dataplane path."""
import re

try:
    from .operation_error import OperationError, public_error
except ImportError:
    from operation_error import OperationError, public_error

COOKIE = '0xad060001'


def apply_path(worker, request):
    job = worker.traffic_jobs.get(request.get('job_id'), {})
    if (not worker.net or request.get('runtime_id') != worker.runtime_id or
        job.get('controller') != 'adaptive' or not job.get('active') or job['proc'].poll() is not None or
        any(job.get(k) != request.get(k) for k in ('runtime_id', 'controller_generation', 'experiment_id'))):
        raise OperationError(409, 'Adaptive forwarding owner is no longer active')
    path = request.get('path', [])
    topo = worker.get_topology()
    if (len(path) < 3 or len(set(path)) != len(path) or path[0] != job['src'] or path[-1] != job['dst'] or
        any(node not in topo['switches'] for node in path[1:-1])):
        raise OperationError(422, 'Adaptive path must be a simple path between the job hosts')
    ports = {}
    for link in topo['links']:
        if link['status'] == 'UP':
            ports[link['src'], link['dst']] = link['src_port']
            ports[link['dst'], link['src']] = link['dst_port']
    if any((a, b) not in ports for a, b in zip(path, path[1:])):
        raise OperationError(409, 'Adaptive candidate contains an unavailable runtime link')
    rules = []
    for direction in (path, list(reversed(path))):
        mac = worker.net.get(direction[-1]).MAC()
        if not re.fullmatch(r'[0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){5}', mac):
            raise OperationError(502, 'Runtime host MAC unavailable')
        for i in range(len(direction)-2, 0, -1):
            sw, out = direction[i], ports[direction[i], direction[i+1]]
            if type(out) is not int or out <= 0:
                raise OperationError(502, 'Runtime switch output port unavailable')
            rules.append((sw, mac.lower(), out))
    run = worker._run_ovs
    try:
        for sw in topo['switches']:
            run(['ovs-ofctl', '-O', 'OpenFlow13', 'del-flows', sw, f'cookie={COOKIE}/-1'])
        for sw, mac, out in rules:
            run(['ovs-ofctl', '-O', 'OpenFlow13', 'add-flow', sw,
                 f'cookie={COOKIE},priority=200,dl_dst={mac},actions=output:{out}'])
        confirmations = []
        for sw, mac, out in rules:
            dump = run(['ovs-ofctl', '-O', 'OpenFlow13', 'dump-flows', sw, f'cookie={COOKIE}/-1,dl_dst={mac}'])
            if not any('priority=200' in line and f'dl_dst={mac}' in line and
                       re.search(rf'actions=output:{out}(?:\s|$)', line) for line in dump.splitlines()):
                raise OperationError(502, f'Adaptive flow readback failed on {sw} for {mac}')
            confirmations.append({'switch': sw, 'destination_mac': mac, 'output_port': out})
    except Exception as exc:
        cleanup_errors = []
        for sw in topo['switches']:
            try:
                run(['ovs-ofctl', '-O', 'OpenFlow13', 'del-flows', sw, f'cookie={COOKIE}/-1'])
            except Exception:
                cleanup_errors.append(sw)
        raise OperationError(502, 'Adaptive apply failed; installed path unavailable',
                             results={'failure': public_error(exc), 'cleanup_failed_switches': cleanup_errors}) from exc
    return {'status': 'ok', **{k: request[k] for k in ('runtime_id', 'controller_generation', 'experiment_id', 'job_id', 'cycle_id', 'attempt')},
            'installed_path': path, 'observed_path': None, 'source': 'OVS_OPENFLOW13_FLOW_READBACK', 'flows': confirmations}
