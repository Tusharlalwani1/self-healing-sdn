"""Privileged TC operations. No controller actions; inventory comes from Mininet.

Only the simple netem layout created by this project's TCLink is supported.
Unknown qdisc options are rejected rather than silently erased.
"""
import json
import math
import subprocess
import time

if __package__:
    from .operation_error import OperationError
else:
    from operation_error import OperationError


class LinkQuality:
    def __init__(self, worker):
        self.worker = worker
        self.originals = {}
        self.revisions = {}

    def reset(self):
        self.originals.clear()
        self.revisions.clear()

    @staticmethod
    def tc(args):
        try:
            result = subprocess.run(['tc', *args], capture_output=True, text=True, timeout=5, check=True)
            return result.stdout
        except (OSError, subprocess.SubprocessError) as exc:
            raise OperationError(502, 'Traffic control operation failed; check worker logs') from exc

    def inventory(self, runtime_id):
        worker = self.worker
        if not worker.net:
            raise OperationError(409, 'Network is not running')
        if runtime_id != worker.runtime_id:
            raise OperationError(409, 'Link quality request belongs to a different runtime')
        switches = {node.name for node in worker.net.switches}
        return [(link, sorted((link.intf1.node.name, link.intf2.node.name)))
                for link in worker.net.links
                if link.intf1.node.name in switches and link.intf2.node.name in switches]

    def find(self, runtime_id, src, dst):
        inventory = self.inventory(runtime_id)
        for link, nodes in inventory:
            if nodes == sorted((src, dst)):
                return link, '-'.join(nodes)
        for link in self.worker.net.links:
            if {src, dst} == {link.intf1.node.name, link.intf2.node.name}:
                raise OperationError(400, 'Soft degradation supports inter-switch links only')
        raise OperationError(404, 'Link not found in the active runtime')

    def read(self, intf):
        try:
            qdiscs = json.loads(self.tc(['-j', '-s', 'qdisc', 'show', 'dev', intf.name]))
            netem = [q for q in qdiscs if q.get('kind') == 'netem']
            if len(netem) != 1:
                raise ValueError('Expected one netem qdisc')
            q = netem[0]
            options = q['options']
            if set(options) - {'limit', 'delay', 'loss-random', 'ecn', 'gap'}:
                raise ValueError('Unsupported netem options')
            delay = options.get('delay', {})
            loss = options.get('loss-random', {})
            if options.get('ecn') or options.get('gap') or delay.get('jitter') or delay.get('correlation') or loss.get('correlation'):
                raise ValueError('Unsupported netem model')
            values = [float(delay.get('delay', 0)) * 1000, float(loss.get('loss', 0)) * 100]
            if not all(math.isfinite(v) and v >= 0 for v in values) or values[1] > 100:
                raise ValueError('Invalid netem values')
            if any(not isinstance(q.get(k), int) or q[k] < 0 for k in ('packets', 'drops')):
                raise ValueError('Missing netem counters')
            return {'interface': intf.name, 'handle': q['handle'], 'parent': q['parent'],
                    'limit': int(options['limit']), 'delay_ms': values[0], 'loss_percent': values[1],
                    'packets': q['packets'], 'drops': q['drops']}
        except (ValueError, KeyError, TypeError) as exc:
            raise OperationError(502, 'Unsupported or invalid netem readback; no quality change applied') from exc

    def write(self, intf, config):
        self.tc(['qdisc', 'change', 'dev', intf.name, 'parent', config['parent'],
                 'handle', config['handle'], 'netem', 'limit', str(config['limit']),
                 'delay', f"{config['delay_ms']:.9f}ms", 'loss', f"{config['loss_percent']:.9f}%"])
        actual = self.read(intf)
        if any(abs(actual[k] - config[k]) > .001 for k in ('delay_ms', 'loss_percent')) or any(
                actual[k] != config[k] for k in ('handle', 'parent', 'limit')):
            raise OperationError(502, 'Traffic control readback did not confirm requested quality')
        return actual

    def record(self, link, key):
        endpoints = [self.read(intf) for intf in (link.intf1, link.intf2)]
        baseline = self.originals.get(key)
        # Initial TCLink parameters describe the topology baseline, not measurements.
        base_delay = []
        for intf in (link.intf1, link.intf2):
            value = str(intf.params.get('delay', '0ms'))
            if not value.endswith('ms'):
                raise OperationError(502, 'Unsupported topology baseline delay')
            base_delay.append(float(value[:-2]))
        return {'link_id': key, 'src': link.intf1.node.name, 'dst': link.intf2.node.name,
                'operational_status': 'UP' if link.intf1.isUp() and link.intf2.isUp() else 'DOWN',
                'quality_revision': self.revisions.get(key, 0), 'injected': baseline is not None,
                'configured_additional_delay_ms': max(max(0, e['delay_ms'] - base_delay[i]) for i, e in enumerate(endpoints)),
                'configured_loss_percent': max(e['loss_percent'] for e in endpoints),
                'endpoints': endpoints}

    def snapshot(self, runtime_id):
        return {'status': 'ok', 'runtime_id': self.worker.runtime_id, 'topology_id': self.worker.topology_id,
                'sampled_at': time.time(), 'links': [self.record(link, '-'.join(nodes))
                                                   for link, nodes in self.inventory(runtime_id)]}

    def change(self, runtime_id, src, dst, delay=0, loss=0, clear=False):
        link, key = self.find(runtime_id, src, dst)
        if not all(intf.isUp() for intf in (link.intf1, link.intf2)):
            raise OperationError(409, 'Link must be operationally UP for a quality change')
        if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in (delay, loss)) or not (0 <= delay <= 2000 and 0 <= loss <= 100):
            raise OperationError(400, 'Delay must be 0 to 2000 ms and loss 0 to 100 percent')
        if not clear and delay == 0 and loss == 0:
            raise OperationError(400, 'Select nonzero delay or loss')
        intfs = (link.intf1, link.intf2)
        before = [self.read(i) for i in intfs]
        if clear and key not in self.originals:
            return {'status': 'ok', 'link_id': key, 'changed': False}
        if key not in self.originals:
            self.originals[key] = before
        targets = [dict(base, delay_ms=base['delay_ms'] + (0 if clear else delay),
                        loss_percent=base['loss_percent'] if clear else 100 * (1 - (1-base['loss_percent']/100) * (1-loss/100)))
                   for base in self.originals[key]]
        try:
            for intf, target in zip(intfs, targets):
                self.write(intf, target)
        except OperationError as exc:
            rollback = []
            for intf, prior in zip(intfs, before):
                try:
                    self.write(intf, prior)
                except OperationError:
                    rollback.append(intf.name)
            self.revisions[key] = self.revisions.get(key, 0) + 1
            raise OperationError(502, 'Link quality change failed; rollback ' + ('incomplete' if rollback else 'confirmed'),
                                 results={'link_id': key, 'rollback_failed_interfaces': rollback}) from exc
        self.revisions[key] = self.revisions.get(key, 0) + 1
        if clear:
            del self.originals[key]
        return {'status': 'ok', 'link_id': key, 'changed': True}

    def clear_all(self, runtime_id):
        inventory = self.inventory(runtime_id)
        results = []
        for link, nodes in inventory:
            key = '-'.join(nodes)
            if key not in self.originals:
                results.append({'link_id': key, 'status': 'unchanged'})
                continue
            try:
                results.append(self.change(runtime_id, *nodes, clear=True))
            except OperationError as exc:
                results.append({'link_id': key, 'status': 'error', 'message': str(exc), 'details': exc.results})
        failures = [r for r in results if r.get('status') == 'error']
        if failures:
            raise OperationError(502, f'Quality restoration failed for {len(failures)} of {len(inventory)} inter-switch links', results=results)
        return {'status': 'ok', 'total_links': len(inventory), 'results': results}
