"""Measurement semantics shared by persisted results and exports; no invented values."""
PERFORMANCE_FIELDS = (
    "packets_transmitted", "packets_received", "packet_loss_percent", "avg_rtt_ms",
    "min_rtt_ms", "max_rtt_ms", "recovery_duration_ms",
)
TIMING_SCOPE = "Controller event handling/recomputation; not packet-level outage or local FF switching"


def experiment_metrics(record):
    result = dict(record)
    # Cancelled/failed runs retain diagnostic final_traffic in summary, rather
    # than masquerading as complete benchmark results. Also masks old DB defaults.
    for field in PERFORMANCE_FIELDS:
        if result.get("status") != "COMPLETED":
            result[field] = None
        else:
            result.setdefault(field, None)
    if result.get("controller") == "baseline":
        result["recovery_duration_ms"] = None
    if result.get("packets_transmitted") == 0:
        result["packet_loss_percent"] = None
    if result.get("packets_received") == 0:
        for field in ("avg_rtt_ms", "min_rtt_ms", "max_rtt_ms"):
            result[field] = None
    return result
