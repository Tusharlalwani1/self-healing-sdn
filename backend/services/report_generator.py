import csv
import io
import json
from html import escape
from typing import Dict, Any, List
from backend.services.metrics import experiment_metrics, TIMING_SCOPE


def export_record(record):
    return {**experiment_metrics(record), "topology_id": record.get("summary", {}).get("topology_id"),
            "verification": record.get('summary', {}).get('verification'),
            "service_intent": record.get('summary', {}).get('service_intent'),
            "intent_evaluation": record.get('summary', {}).get('intent_evaluation'),
            "topology_label": record.get("summary", {}).get("topology_label"),
            "metric_semantics": {"recovery_duration_ms": TIMING_SCOPE,
            "packet_level_outage": "Not measured", "local_ff_switching_time": "Not measured"}}


def display(value, unit=""):
    return "N/A" if value is None else f"{value}{unit}"

class ReportGenerator:
    @staticmethod
    def generate_json(experiment: Dict[str, Any]) -> str:
        records = [export_record(record) for record in experiment] if isinstance(experiment, list) else export_record(experiment)
        return json.dumps(records, indent=2)

    @staticmethod
    def generate_csv(experiments: List[Dict[str, Any]]) -> str:
        output = io.StringIO()
        fieldnames = [
            "id", "controller", "topology_id", "topology_label", "status", "start_time", "end_time",
            "packets_transmitted", "packets_received", "packet_loss_percent",
            "avg_rtt_ms", "min_rtt_ms", "max_rtt_ms", "failure_link",
            "recovery_event", "controller_processing_ms", "timing_scope",
            "verification_status", "verification_reason", "post_recovery_tx", "post_recovery_rx",
            "post_recovery_loss_percent", "post_recovery_avg_rtt_ms", "post_recovery_min_rtt_ms", "post_recovery_max_rtt_ms",
            "path_verification_status", "verification_started_at", "verification_completed_at", "verification_duration_sec",
            "intent_evaluation_status", "intent_reason_code", "intent_profile", "intent_snapshot_json", "intent_requirements_json", "intent_evaluation_id", "intent_verification_id", "intent_measurement_source"
        ]
        writer = csv.DictWriter(output, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for exp in experiments:
            row = experiment_metrics(exp)
            row["topology_id"] = exp.get("summary", {}).get("topology_id")
            row["topology_label"] = exp.get("summary", {}).get("topology_label")
            row["controller_processing_ms"] = row.get("recovery_duration_ms")
            row["timing_scope"] = TIMING_SCOPE
            verification = exp.get('summary', {}).get('verification') or {}
            row.update({key: verification.get(key) for key in fieldnames if key.startswith(('post_recovery_', 'path_verification_', 'verification_'))})
            row['verification_reason'] = verification.get('reason')
            intent = exp.get('summary', {}).get('intent_evaluation') or {}
            snapshot = exp.get('summary', {}).get('service_intent')
            row.update(intent_evaluation_status=intent.get('evaluation_status'), intent_reason_code=intent.get('reason_code'),
                intent_profile=(snapshot or {}).get('name'), intent_snapshot_json=json.dumps(snapshot) if snapshot else None,
                intent_requirements_json=json.dumps(intent['requirements']) if intent else None,
                intent_evaluation_id=intent.get('evaluation_id'), intent_verification_id=intent.get('verification_id'),
                intent_measurement_source=intent.get('measurement_source'))
            writer.writerow({key: "N/A" if row.get(key) is None else row[key] for key in fieldnames})
        return output.getvalue()

    @staticmethod
    def generate_html_report(experiment: Dict[str, Any]) -> str:
        experiment = experiment_metrics(experiment)
        ctrl = experiment.get("controller", "Unknown").upper()
        loss = experiment.get("packet_loss_percent")
        rec_ms = experiment.get("recovery_duration_ms")
        rec_str = f"{rec_ms:.1f} ms" if rec_ms is not None else "N/A"
        avg_rtt = experiment.get("avg_rtt_ms")
        avg_rtt_str = f"{avg_rtt:.2f} ms" if avg_rtt is not None else "N/A"
        verification = experiment.get('summary', {}).get('verification') or {}
        verification_rows = ''.join(f'<tr><td>{escape(key)}</td><td>{escape(str(display(verification.get(key))))}</td></tr>' for key in (
            'verification_status', 'reason', 'controller_mode', 'topology_id', 'failed_link', 'failure_timestamp',
            'post_recovery_tx', 'post_recovery_rx', 'post_recovery_loss_percent', 'post_recovery_avg_rtt_ms',
            'post_recovery_min_rtt_ms', 'post_recovery_max_rtt_ms', 'reachability_restored', 'stability_passed',
            'path_verification_status', 'path_verification_reason', 'verification_started_at',
            'verification_completed_at', 'verification_duration_sec', 'evidence_scope'))

        intent = experiment.get('summary', {}).get('intent_evaluation') or {}
        intent_rows = ''.join('<tr>' + ''.join('<td>' + escape(str(display(value))) + '</td>' for value in (
            name, item['target'], item['actual'], item['unit'], item['status'])) + '</tr>'
            for name, item in intent.get('requirements', {}).items())
        snapshot = experiment.get('summary', {}).get('service_intent') or {}

        return f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>SDN Experiment Report - {experiment.get('id')}</title>
    <style>
        body {{ font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #0b1120; color: #f8fafc; padding: 40px; margin: 0; }}
        .header {{ border-bottom: 2px solid #3b82f6; padding-bottom: 20px; margin-bottom: 30px; }}
        h1 {{ color: #60a5fa; margin: 0 0 10px 0; }}
        .meta {{ color: #94a3b8; font-size: 0.9em; }}
        .grid {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; margin-bottom: 30px; }}
        .card {{ background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 20px; }}
        .card-label {{ color: #94a3b8; font-size: 0.85em; text-transform: uppercase; margin-bottom: 8px; }}
        .card-val {{ font-size: 1.8em; font-weight: bold; color: #38bdf8; }}
        .card-val.danger {{ color: #f87171; }}
        .card-val.success {{ color: #4ade80; }}
        table {{ width: 100%; border-collapse: collapse; margin-top: 20px; background: #1e293b; border-radius: 8px; overflow: hidden; }}
        th, td {{ padding: 12px 16px; text-align: left; border-bottom: 1px solid #334155; }}
        th {{ background: #0f172a; color: #94a3b8; font-weight: 600; }}
        .footer {{ margin-top: 40px; border-top: 1px solid #334155; padding-top: 20px; color: #64748b; font-size: 0.85em; text-align: center; }}
    </style>
</head>
<body>
    <div class="header">
        <h1>Self-Healing SDN Performance Report</h1>
        <div class="meta">Experiment ID: <strong>{experiment.get('id')}</strong> | Date: {experiment.get('start_time')} | Topology: {escape(experiment.get('summary', {}).get('topology_label') or 'Not recorded')}</div>
    </div>

    <div class="grid">
        <div class="card">
            <div class="card-label">Experiment Controller</div>
            <div class="card-val">{ctrl}</div>
        </div>
        <div class="card">
            <div class="card-label">Packet Loss</div>
            <div class="card-val {'danger' if loss is not None and loss > 5 else 'success'}">{display(loss, '%')}</div>
        </div>
        <div class="card">
            <div class="card-label">Controller Processing / Recomputation</div>
            <div class="card-val">{rec_str}</div>
        </div>
        <div class="card">
            <div class="card-label">Average RTT</div>
            <div class="card-val">{avg_rtt_str}</div>
        </div>
    </div>

    <h2>Detailed Telemetry Metrics</h2>
    <h2>Independent Recovery Verification</h2>
    <table>{verification_rows}</table>
    <h2>Service Intent Evaluation</h2>
    <p>{escape(str(intent.get('evaluation_status') or 'N/A'))}: {escape(str(intent.get('reason') or 'Not recorded'))}</p>
    <p>Profile: {escape(str(snapshot.get('name') or 'N/A'))}; Priority (metadata): {escape(str(snapshot.get('priority') or 'N/A'))}</p>
    <p>Verification ID: {escape(str(intent.get('verification_id') or 'N/A'))}. Intent evaluation uses measured post-failure evidence produced by the Recovery Verification Engine.</p>
    <table><tr><th>Requirement</th><th>Target</th><th>Actual</th><th>Unit</th><th>Result</th></tr>{intent_rows}</table>
    <p>Recovery VERIFIED does not necessarily mean Service Intent SATISFIED. Project demonstration defaults are not universal SLA standards. No QoS enforcement or routing changes.</p>
    <p>{TIMING_SCOPE}. Packet-level outage and local FF switching time: not measured.</p>
    <table>
        <tr><th>Parameter</th><th>Value</th></tr>
        <tr><td>Controller Architecture</td><td>{ctrl}</td></tr>
        <tr><td>Execution Status</td><td>{experiment.get('status')}</td></tr>
        <tr><td>Packets Transmitted</td><td>{display(experiment.get('packets_transmitted'))}</td></tr>
        <tr><td>Packets Received</td><td>{display(experiment.get('packets_received'))}</td></tr>
        <tr><td>Simulated Link Failure</td><td>{experiment.get('failure_link')}</td></tr>
        <tr><td>Controller Processing Event</td><td>{experiment.get('recovery_event') or 'N/A'}</td></tr>
        <tr><td>Min / Avg / Max RTT</td><td>{display(experiment.get('min_rtt_ms'), ' ms')} / {avg_rtt_str} / {display(experiment.get('max_rtt_ms'), ' ms')}</td></tr>
    </table>

    <div class="footer">
        Generated by Self-Healing SDN Web Control Center (OpenFlow 1.3 / Mininet / Ryu)
    </div>
</body>
</html>
"""

report_generator = ReportGenerator()
