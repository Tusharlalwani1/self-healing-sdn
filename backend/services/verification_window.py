"""Passive per-job evidence tap; no probes, no changes to job Tx/Rx.

Bounds attempts using actual iputils summary counters. Replies to sequences at
or below the baseline are excluded, including delayed pre-window replies.
"""
import re


class VerificationWindow:
    reply = re.compile(r'icmp_seq=(\d+).*?ttl=\d+.*?time([=<])([\d.]+)\s*ms')

    def __init__(self, config):
        self.config = config
        self.start = self.end = self.first_tx = self.last_tx = None
        self.replies = {}
        self.final_seen = False
        self.invalid = False

    def observe(self, line, elapsed, tx, is_counter, is_final):
        if self.start is not None and elapsed - self.start > self.config['timeout_sec']:
            return
        if is_counter:
            if self.first_tx is None:
                self.first_tx = self.last_tx = tx
                self.start = elapsed
                if is_final:
                    self.end = elapsed
            elif tx < self.last_tx:
                self.invalid = True
            elif self.end is None:
                self.last_tx = tx
                if elapsed - self.start >= self.config['observation_sec'] or is_final:
                    self.end = elapsed
            self.final_seen |= bool(is_final)
        match = self.reply.search(line)
        if match and 'DUP!' not in line and self.first_tx is not None:
            seq, operator, value = match.groups()
            seq = int(seq)
            if seq > self.first_tx and (self.end is None or
                    (seq <= self.last_tx and elapsed <= self.end + self.config['reply_grace_sec'])):
                self.replies.setdefault(seq, (elapsed, float(value) if operator == '=' else None))

    def snapshot(self, elapsed):
        duration = self.end - self.start if self.end is not None else None
        replies = [item for seq, item in self.replies.items() if self.last_tx is not None and seq <= self.last_tx]
        rtts = [rtt for _, rtt in replies if rtt is not None]
        bins = {int((t - self.start) >= duration / 2) for t, _ in replies
                if duration is not None and self.start <= t <= self.end}
        tx = self.last_tx - self.first_tx if self.first_tx is not None else None
        rx = len(replies) if tx is not None else None
        complete = self.end is not None and (self.final_seen or elapsed >= self.end + self.config['reply_grace_sec'])
        return {'complete': complete, 'invalid': self.invalid,
                'post_recovery_tx': tx, 'post_recovery_rx': rx,
                'post_recovery_loss_percent': 100.0 * (tx - rx) / tx if tx else None,
                'post_recovery_avg_rtt_ms': sum(rtts) / len(rtts) if rtts else None,
                'post_recovery_min_rtt_ms': min(rtts) if rtts else None,
                'post_recovery_max_rtt_ms': max(rtts) if rtts else None,
                'observation_duration_sec': duration, 'reply_bins_observed': len(bins),
                'observation_started_elapsed_sec': self.start, 'observation_ended_elapsed_sec': self.end,
                'rtt_sample_count': len(rtts), 'baseline_tx': self.first_tx, 'end_tx': self.last_tx,
                'measurement_source': 'iputils counter-bounded attempts and sequence-filtered replies'}
