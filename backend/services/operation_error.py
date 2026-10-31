"""Small, public runtime error contract shared by worker and backend.

The worker runs as a script under system Python, so this module has no
FastAPI or third-party dependencies. Raw exception details belong in logs.
"""
import re


class OperationError(RuntimeError):
    def __init__(self, status_code, message, *, results=None):
        super().__init__(message)
        self.status_code = status_code
        self.results = results


def safe_message(message, fallback="Runtime operation failed; check backend logs"):
    if not isinstance(message, str) or not message.strip():
        return fallback
    if re.search(r"Traceback|File \"|[/\\]|[\r\n]", message):
        return fallback
    return message[:300]


def public_error(exc):
    return safe_message(str(exc)) if isinstance(exc, OperationError) else "Runtime operation failed; check backend logs"


def validate_worker_result(result, command):
    if not isinstance(result, dict):
        raise OperationError(502, "Invalid response from Mininet worker")
    status = result.get("status")
    if status == "error":
        code = result.get("error_code")
        http_status = {"invalid_request": 400, "not_running": 409, "not_found": 404}.get(code, 502)
        # Compatibility with an already-running worker from before C05.
        if result.get("message") == "Network is not running":
            http_status = 409
        raise OperationError(http_status, safe_message(result.get("message"), "Mininet operation failed; check worker logs"))
    if status == "not_found":
        raise OperationError(404, "Traffic job not found")
    if status == "not_running" and command != "get_topology":
        raise OperationError(409, "Network is not running")
    allowed = {"pong"} if command == "ping" else {"ok"}
    if command == "get_topology":
        allowed.add("not_running")
    # These two existing replies are data records, without a status field.
    if command == "get_traffic_stats" and status is None and isinstance(result.get("active"), bool):
        return result
    if command == "get_switch_info" and status is None and "flows" in result and "dpid" in result:
        return result
    if status not in allowed:
        raise OperationError(502, "Invalid response from Mininet worker")
    return result
