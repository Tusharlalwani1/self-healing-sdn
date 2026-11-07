"""Parse C-locale iputils statistics; reply sequence numbers never define Tx.

SIGQUIT produces an interim transmitted/received snapshot even with no replies.
SIGINT/natural completion produces the authoritative final summary.
"""
import re


class PingAccounting:
    interim = re.compile(r"(\d+)/(\d+) packets,.*?loss")
    final = re.compile(r"(\d+) packets transmitted,\s*(\d+)\s+(?:packets\s+)?received")
    live_rtt = re.compile(r"min/avg/ewma/max = ([\d.]+)/([\d.]+)/[\d.]+/([\d.]+)")
    final_rtt = re.compile(r"(?:rtt|round-trip) min/avg/max/(?:mdev|stddev) = ([\d.]+)/([\d.]+)/([\d.]+)")
    reply = re.compile(r"icmp_seq=(\d+).*?ttl=\d+.*?time([=<])([\d.]+)\s*ms")

    def __init__(self, stats):
        self.stats = stats
        self.final_seen = False
        self.verification_windows = {}

    def feed(self, line, elapsed):
        stats = self.stats
        stats["duration_sec"] = elapsed
        summary = self.final.search(line)
        snapshot = summary or self.interim.search(line)
        if snapshot:
            first, second = map(int, snapshot.groups())
            # iputils SIGQUIT is RECEIVED/TRANSMITTED; the final summary
            # explicitly lists transmitted first. Verified with 0/3 outage.
            tx, rx = (first, second) if summary else (second, first)
            if not 0 <= rx <= tx:
                raise ValueError("Invalid ping counters")
            stats["transmitted"], stats["received"] = tx, rx
            stats["loss_percent"] = round(100.0 * (tx - rx) / tx, 2) if tx else 0.0
            if summary:
                self.final_seen = True
        rtt = self.final_rtt.search(line) or self.live_rtt.search(line)
        if rtt:
            stats["min_rtt"], stats["avg_rtt"], stats["max_rtt"] = map(float, rtt.groups())
        reply = self.reply.search(line)
        if reply and "DUP!" not in line:
            seq, operator, value = reply.groups()
            # iputils time<1 reports an upper bound, not an exact sample.
            value = float(value) if operator == "=" else None
            stats["last_rtt"] = value
            if value is not None:
                stats["history"].append({"seq": int(seq), "rtt": value,
                                         "success": True, "t": round(elapsed, 2)})
                del stats["history"][:-200]
        for window in self.verification_windows.values():
            window.observe(line, elapsed, stats['transmitted'], bool(snapshot), bool(summary))
