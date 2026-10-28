import asyncio
import logging
import os
import signal
import socket
import time
from typing import Optional, Dict, Any, List
import psutil

from backend.config import RYU_APPS, CONTROLLER_IP, CONTROLLER_PORT, VENV_PYTHON, LOGS_DIR
from backend.services.log_parser import RyuLogParser
from backend.websocket.manager import ws_manager
from backend.database.db import save_event_log

logger = logging.getLogger("sdn.controller")

class ControllerManager:
    def __init__(self):
        self.active_controller: Optional[str] = None
        self.status: str = "NOT_SELECTED"  # NOT_SELECTED, STARTING, READY, FAILED, STOPPED
        self.process: Optional[asyncio.subprocess.Process] = None
        self.log_task: Optional[asyncio.Task] = None
        self.recent_logs: List[str] = []
        self.active_paths: List[List[str]] = []
        self.routes_summary: Dict[str, Any] = {}
        self.last_recovery_event: Optional[Dict[str, Any]] = None
        self.started_at: Optional[float] = None

    def is_port_in_use(self, port: int = CONTROLLER_PORT) -> bool:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            return s.connect_ex(("127.0.0.1", port)) == 0

    async def get_controller_info(self) -> List[Dict[str, Any]]:
        return [
            {
                "id": "baseline",
                "name": "Baseline Controller",
                "description": "Shortest-path forwarding without automatic recovery on link failures. Drops packets until flow timeout.",
                "features": ["OpenFlow 1.3", "Topology Discovery", "Shortest Path (NetworkX)", "No Recovery Actions"],
                "status": self.status if self.active_controller == "baseline" else "STOPPED",
                "is_active": self.active_controller == "baseline"
            },
            {
                "id": "reactive",
                "name": "Reactive Self-Healing Controller",
                "description": "Detects link failure events, recalculates shortest alternative paths in controller, and updates OpenFlow tables in milliseconds.",
                "features": ["OpenFlow 1.3", "Link Delete Detection", "Real-Time Path Rerouting", "Automated Flow Flushes"],
                "status": self.status if self.active_controller == "reactive" else "STOPPED",
                "is_active": self.active_controller == "reactive"
            },
            {
                "id": "fast_failover",
                "name": "Fast Failover (OpenFlow 1.3 Group Table)",
                "description": "Installs pre-configured primary & backup buckets into switch group tables. Data plane switches locally with sub-millisecond failover.",
                "features": ["OpenFlow 1.3 Group Tables", "OFPGT_FF (Fast Failover)", "Local Datapath Failover", "Global Route Reconciliation"],
                "status": self.status if self.active_controller == "fast_failover" else "STOPPED",
                "is_active": self.active_controller == "fast_failover"
            }
        ]

    async def select_controller(self, controller_type: str) -> Dict[str, Any]:
        if controller_type not in RYU_APPS:
            raise ValueError(f"Unknown controller type: {controller_type}. Must be one of: {list(RYU_APPS.keys())}")

        if self.active_controller == controller_type and self.status == "READY":
            if self.process and self.process.returncode is None and self.is_port_in_use(CONTROLLER_PORT):
                return {"status": "ok", "message": f"{controller_type} already active and ready"}

        # Stop existing controller if running
        if self.process:
            await self.stop_controller()

        self.active_controller = controller_type
        self.status = "STARTING"
        self.active_paths = []
        self.routes_summary = {}
        self.last_recovery_event = None

        await ws_manager.broadcast({
            "event_type": "CONTROLLER_STATUS",
            "controller": controller_type,
            "status": "STARTING",
            "timestamp": time.time()
        })

        return await self.start_controller(controller_type)

    async def start_controller(self, controller_type: str) -> Dict[str, Any]:
        app_path = RYU_APPS.get(controller_type)
        if not app_path or not app_path.exists():
            self.status = "FAILED"
            raise FileNotFoundError(f"Controller script not found at {app_path}")

        # Kill any orphan process listening on port 6653
        self._kill_process_on_port(CONTROLLER_PORT)
        await asyncio.sleep(0.5)

        # Locate ryu-manager executable in sdn-env
        ryu_bin = VENV_PYTHON.parent / "ryu-manager"
        cmd = [
            str(ryu_bin),
            "--observe-links",
            "--ofp-tcp-listen-port", str(CONTROLLER_PORT),
            str(app_path)
        ]

        logger.info(f"Starting Ryu controller: {' '.join(cmd)}")
        save_event_log("INFO", "CONTROLLER", f"Starting {controller_type} controller: {' '.join(cmd)}")

        try:
            self.process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                preexec_fn=os.setsid
            )
            self.started_at = time.time()
            self.log_task = asyncio.create_task(self._stream_logs())

            # Wait up to 10 seconds for controller process and OpenFlow port
            port_ready = False
            for _ in range(20):
                await asyncio.sleep(0.5)
                if self.process.returncode is not None:
                    break
                if self.is_port_in_use(CONTROLLER_PORT):
                    port_ready = True
                    break

            if self.process.returncode is not None:
                self.status = "FAILED"
                raise RuntimeError(f"Ryu controller exited immediately with code {self.process.returncode}")

            self.status = "READY"
            save_event_log("SUCCESS", "CONTROLLER", f"Ryu {controller_type} controller is READY on port {CONTROLLER_PORT} (listening={port_ready})")
            await ws_manager.broadcast({
                "event_type": "CONTROLLER_STATUS",
                "controller": controller_type,
                "status": "READY",
                "timestamp": time.time()
            })
            return {"status": "ok", "controller": controller_type, "state": "READY", "port_ready": port_ready}

        except Exception as e:
            self.status = "FAILED"
            logger.error(f"Failed to start controller: {e}")
            save_event_log("ERROR", "CONTROLLER", f"Failed to start controller: {e}")
            await ws_manager.broadcast({
                "event_type": "CONTROLLER_STATUS",
                "controller": controller_type,
                "status": "FAILED",
                "error": str(e),
                "timestamp": time.time()
            })
            raise

    async def stop_controller(self):
        if not self.process:
            self.status = "STOPPED"
            return

        logger.info(f"Stopping controller {self.active_controller}...")
        save_event_log("INFO", "CONTROLLER", f"Stopping controller {self.active_controller}")
        
        try:
            os.killpg(os.getpgid(self.process.pid), signal.SIGTERM)
            try:
                await asyncio.wait_for(self.process.wait(), timeout=3.0)
            except asyncio.TimeoutError:
                os.killpg(os.getpgid(self.process.pid), signal.SIGKILL)
        except ProcessLookupError:
            pass
        except Exception as e:
            logger.warning(f"Error terminating controller: {e}")

        if self.log_task:
            self.log_task.cancel()
            self.log_task = None

        self.process = None
        self.status = "STOPPED"
        await ws_manager.broadcast({
            "event_type": "CONTROLLER_STATUS",
            "controller": self.active_controller,
            "status": "STOPPED",
            "timestamp": time.time()
        })

    def _kill_process_on_port(self, port: int):
        for proc in psutil.process_iter(['pid', 'name']):
            try:
                for conn in proc.connections(kind='inet'):
                    if conn.laddr.port == port:
                        logger.info(f"Killing process {proc.pid} on port {port}")
                        proc.terminate()
                        proc.wait(timeout=2)
            except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.TimeoutExpired):
                pass

    async def _stream_logs(self):
        """Asynchronously read and parse Ryu stdout/stderr logs."""
        log_file_path = LOGS_DIR / f"controller_{self.active_controller}.log"
        with open(log_file_path, "a", encoding="utf-8") as f:
            while self.process and self.process.stdout:
                line = await self.process.stdout.readline()
                if not line:
                    break
                decoded = line.decode("utf-8", errors="replace").rstrip()
                f.write(decoded + "\n")
                f.flush()

                self.recent_logs.append(decoded)
                if len(self.recent_logs) > 300:
                    self.recent_logs.pop(0)

                # Send log line over WebSocket
                await ws_manager.broadcast({
                    "event_type": "LOG_LINE",
                    "source": "CONTROLLER",
                    "line": decoded,
                    "timestamp": time.time()
                })

                # Parse event
                parsed = RyuLogParser.parse_line(decoded)
                if parsed:
                    await self._handle_parsed_event(parsed)

    async def _handle_parsed_event(self, event: Dict[str, Any]):
        ev_type = event.get("type")
        if ev_type == "ACTIVE_PATH":
            self.active_paths = [event["path"]]
            save_event_log("INFO", "CONTROLLER", f"Active forwarding path: {' -> '.join(event['path'])}", event)
            await ws_manager.broadcast({
                "event_type": "PATH_ACTIVE",
                "path": event["path"],
                "src": event["src"],
                "dst": event["dst"],
                "timestamp": time.time()
            })
        elif ev_type == "HEALED":
            self.last_recovery_event = event
            self.active_paths = [event["new_path"]]
            save_event_log("SUCCESS", "CONTROLLER", f"Reactive healing complete in {event['duration_ms']:.1f}ms: {' -> '.join(event['old_path'])} to {' -> '.join(event['new_path'])}", event)
            await ws_manager.broadcast({
                "event_type": "HEALED",
                "old_path": event["old_path"],
                "new_path": event["new_path"],
                "duration_ms": event["duration_ms"],
                "timestamp": time.time()
            })
        elif ev_type == "ROUTE_RECOMPUTED":
            self.last_recovery_event = event
            save_event_log("SUCCESS", "CONTROLLER", f"Fast Failover route recomputed in {event['duration_ms']:.1f}ms (switches failed over locally)", event)
            await ws_manager.broadcast({
                "event_type": "ROUTE_RECOMPUTED",
                "duration_ms": event["duration_ms"],
                "timestamp": time.time()
            })
        elif ev_type == "LINK_DOWN":
            save_event_log("WARNING", "CONTROLLER", f"Link down: {event['src']} <-> {event['dst']}", event)
            await ws_manager.broadcast({
                "event_type": "LINK_FAILURE",
                "src": event["src"],
                "dst": event["dst"],
                "timestamp": event.get("timestamp", time.time())
            })

controller_manager = ControllerManager()
