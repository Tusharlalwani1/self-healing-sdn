import json
import sqlite3
import time
from typing import Any, Dict, List, Optional
from pathlib import Path
from backend.config import DB_PATH

def get_db_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS experiments (
            id TEXT PRIMARY KEY,
            controller TEXT NOT NULL,
            start_time TEXT NOT NULL,
            end_time TEXT,
            status TEXT NOT NULL,
            packets_transmitted INTEGER DEFAULT 0,
            packets_received INTEGER DEFAULT 0,
            packet_loss_percent REAL DEFAULT 0.0,
            avg_rtt_ms REAL,
            min_rtt_ms REAL,
            max_rtt_ms REAL,
            failure_link TEXT,
            failure_timestamp REAL,
            recovery_event TEXT,
            recovery_duration_ms REAL,
            summary_json TEXT
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS event_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp REAL NOT NULL,
            level TEXT NOT NULL,
            source TEXT NOT NULL,
            message TEXT NOT NULL,
            details_json TEXT
        )
    """)
    conn.commit()
    conn.close()

def save_experiment(record: Dict[str, Any]):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT OR REPLACE INTO experiments (
            id, controller, start_time, end_time, status,
            packets_transmitted, packets_received, packet_loss_percent,
            avg_rtt_ms, min_rtt_ms, max_rtt_ms,
            failure_link, failure_timestamp, recovery_event, recovery_duration_ms,
            summary_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        record["id"],
        record["controller"],
        record["start_time"],
        record.get("end_time"),
        record["status"],
        record.get("packets_transmitted", 0),
        record.get("packets_received", 0),
        record.get("packet_loss_percent", 0.0),
        record.get("avg_rtt_ms"),
        record.get("min_rtt_ms"),
        record.get("max_rtt_ms"),
        record.get("failure_link"),
        record.get("failure_timestamp"),
        record.get("recovery_event"),
        record.get("recovery_duration_ms"),
        json.dumps(record.get("summary", {}))
    ))
    conn.commit()
    conn.close()

def get_experiments(limit: int = 50) -> List[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM experiments ORDER BY start_time DESC LIMIT ?", (limit,))
    rows = cursor.fetchall()
    results = []
    for row in rows:
        d = dict(row)
        if d.get("summary_json"):
            try:
                d["summary"] = json.loads(d["summary_json"])
            except Exception:
                d["summary"] = {}
        else:
            d["summary"] = {}
        results.append(d)
    conn.close()
    return results

def get_experiment_by_id(exp_id: str) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM experiments WHERE id = ?", (exp_id,))
    row = cursor.fetchone()
    conn.close()
    if not row:
        return None
    d = dict(row)
    if d.get("summary_json"):
        try:
            d["summary"] = json.loads(d["summary_json"])
        except Exception:
            d["summary"] = {}
    return d

def delete_experiment_by_id(exp_id: str) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM experiments WHERE id = ?", (exp_id,))
    conn.commit()
    deleted = cursor.rowcount > 0
    conn.close()
    return deleted

def save_event_log(level: str, source: str, message: str, details: Optional[Dict[str, Any]] = None):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO event_logs (timestamp, level, source, message, details_json)
        VALUES (?, ?, ?, ?, ?)
    """, (
        time.time(),
        level,
        source,
        message,
        json.dumps(details or {})
    ))
    conn.commit()
    conn.close()

def get_event_logs(limit: int = 100) -> List[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM event_logs ORDER BY id DESC LIMIT ?", (limit,))
    rows = cursor.fetchall()
    results = []
    for row in rows:
        d = dict(row)
        if d.get("details_json"):
            try:
                d["details"] = json.loads(d["details_json"])
            except Exception:
                d["details"] = {}
        results.append(d)
    conn.close()
    return results
