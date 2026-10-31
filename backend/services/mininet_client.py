import asyncio
import json
import logging
import os
import time
from typing import Dict, Any, Optional

from backend.config import MININET_SOCKET_PATH, BACKEND_DIR
from backend.websocket.manager import ws_manager
from backend.database.db import save_event_log
from backend.services.operation_error import OperationError, public_error, validate_worker_result


logger = logging.getLogger("sdn.mininet_client")


class MininetClient:
    def __init__(self, socket_path: str = MININET_SOCKET_PATH):
        self.socket_path = socket_path
        self.worker_proc: Optional[asyncio.subprocess.Process] = None
        self._lock = asyncio.Lock()
        self.simulation_state: str = "STOPPED"  # STOPPED, STARTING, RUNNING, STOPPING, ERROR

    async def ensure_worker(self):
        """Ensure the privileged Mininet worker daemon is running."""
        if os.path.exists(self.socket_path):
            try:
                pong = await self._send_command(
                    {"command": "ping"},
                    timeout=2.0
                )
                if pong.get("status") == "pong":
                    return
            except Exception:
                pass

            # Stale socket - clean it up
            try:
                import subprocess

                subprocess.run(
                    ["sudo", "rm", "-f", self.socket_path],
                    check=False
                )
            except Exception:
                pass

        logger.info("Spawning Mininet worker process with sudo...")

        worker_script = BACKEND_DIR / "services" / "mininet_worker.py"

        # Mininet is installed system-wide on Ubuntu, so the privileged
        # Mininet worker must use the system Python interpreter.
        #
        # FastAPI and Ryu continue to use the ~/sdn-env virtual environment.
        MININET_PYTHON = "/usr/bin/python3"

        cmd = [
            "sudo",
            "-n",
            MININET_PYTHON,
            str(worker_script),
            "--socket",
            self.socket_path,
        ]

        try:
            self.worker_proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT
            )

            # Wait up to 15 seconds for worker to respond to ping
            ready = False

            for _ in range(30):
                await asyncio.sleep(0.5)

                if os.path.exists(self.socket_path):
                    try:
                        pong = await self._send_command(
                            {"command": "ping"},
                            timeout=1.0
                        )

                        if pong.get("status") == "pong":
                            ready = True
                            break

                    except Exception:
                        pass

            if not ready:
                raise OperationError(503,
                    "Mininet worker was not ready within 15 seconds"
                )

            logger.info("Mininet worker spawned and ready.")

        except Exception as e:
            logger.error(f"Failed to spawn mininet worker: {e}")
            if isinstance(e, OperationError):
                raise
            raise OperationError(503, "Unable to start Mininet worker; check backend logs") from e

    async def _send_command(
        self,
        payload: Dict[str, Any],
        timeout: float = 15.0
    ) -> Dict[str, Any]:

        async with self._lock:
            writer = None
            try:
                reader, writer = await asyncio.wait_for(
                    asyncio.open_unix_connection(self.socket_path), timeout=timeout
                )
                writer.write((json.dumps(payload) + "\n").encode("utf-8"))
                await asyncio.wait_for(writer.drain(), timeout=timeout)
                resp_line = await asyncio.wait_for(reader.readline(), timeout=timeout)
                if not resp_line:
                    raise OperationError(502, "Empty response from Mininet worker")
                return validate_worker_result(json.loads(resp_line), payload.get("command"))
            except OperationError:
                raise
            except asyncio.TimeoutError as exc:
                raise OperationError(504, "Mininet worker request timed out; operation outcome is unconfirmed") from exc
            except (FileNotFoundError, ConnectionRefusedError) as exc:
                raise OperationError(503, "Mininet worker unavailable") from exc
            except (OSError, ValueError, UnicodeError) as exc:
                raise OperationError(502, "Mininet worker communication failed") from exc
            finally:
                if writer is not None:
                    writer.close()
                    try:
                        await writer.wait_closed()
                    except OSError:
                        pass

    async def start_simulation(
        self,
        controller_ip="127.0.0.1",
        controller_port=6653
    ) -> Dict[str, Any]:

        self.simulation_state = "STARTING"

        await ws_manager.broadcast({
            "event_type": "SIMULATION_STATUS",
            "state": "STARTING",
            "timestamp": time.time()
        })

        try:
            await self.ensure_worker()

            res = await self._send_command({
                "command": "start",
                "controller_ip": controller_ip,
                "controller_port": controller_port
            }, timeout=20.0)

            if res.get("status") == "ok":
                self.simulation_state = "RUNNING"

                save_event_log(
                    "SUCCESS",
                    "MININET",
                    "Mininet network started and connected to controller"
                )

                await ws_manager.broadcast({
                    "event_type": "SIMULATION_STATUS",
                    "state": "RUNNING",
                    "timestamp": time.time()
                })

                # Broadcast fresh topology
                topo = await self.get_topology()

                await ws_manager.broadcast({
                    "event_type": "TOPOLOGY_UPDATE",
                    "topology": topo,
                    "timestamp": time.time()
                })

            else:
                self.simulation_state = "ERROR"
                raise OperationError(502, "Mininet network start was not confirmed")

            return res

        except Exception as e:
            self.simulation_state = "ERROR"

            logger.error(f"Error starting Mininet: {e}")

            save_event_log(
                "ERROR",
                "MININET",
                f"Failed to start Mininet: {e}"
            )

            await ws_manager.broadcast({
                "event_type": "SIMULATION_STATUS",
                "state": "ERROR",
                "error": public_error(e),
                "timestamp": time.time()
            })

            raise

    async def stop_simulation(self) -> Dict[str, Any]:
        if self.simulation_state == "STOPPED" and not os.path.exists(self.socket_path):
            return {"status": "ok", "message": "Simulation already stopped"}
        self.simulation_state = "STOPPING"

        await ws_manager.broadcast({
            "event_type": "SIMULATION_STATUS",
            "state": "STOPPING",
            "timestamp": time.time()
        })

        try:
            res = await self._send_command(
                {"command": "stop"},
                timeout=10.0
            )

            self.simulation_state = "STOPPED"

            save_event_log(
                "INFO",
                "MININET",
                "Mininet simulation stopped cleanly"
            )

            await ws_manager.broadcast({
                "event_type": "SIMULATION_STATUS",
                "state": "STOPPED",
                "timestamp": time.time()
            })

            return res

        except Exception as e:
            self.simulation_state = "ERROR"
            logger.warning("Error stopping Mininet: %s", e)
            await ws_manager.broadcast({
                "event_type": "SIMULATION_STATUS", "state": "ERROR",
                "error": public_error(e), "timestamp": time.time()
            })
            raise

    async def get_topology(self) -> Dict[str, Any]:
        if not os.path.exists(self.socket_path) and self.simulation_state == "STOPPED":
            return {"status": "not_running", "nodes": [], "links": []}
        result = await self._send_command({"command": "get_topology"}, timeout=5.0)
        if result.get("status") == "not_running" and self.simulation_state == "RUNNING":
            raise OperationError(409, "Mininet network is not running; runtime state is inconsistent")
        return result

    async def reset_dataplane(self) -> Dict[str, Any]:
        """Require a confirmed worker reset before a replacement Ryu starts."""
        if not os.path.exists(self.socket_path):
            if self.simulation_state == "STOPPED":
                return {"status": "ok", "switches": [], "message": "No active simulation"}
            raise OperationError(503, "Cannot reset dataplane: Mininet worker unavailable")

        try:
            res = await self._send_command({"command": "reset_dataplane"}, timeout=90.0)
        except OperationError:
            raise
        except Exception as exc:
            raise RuntimeError(f"Dataplane reset request failed ({type(exc).__name__}): {exc}") from exc
        if not isinstance(res, dict) or res.get("status") != "ok":
            detail = res.get("message", res) if isinstance(res, dict) else res
            raise RuntimeError(f"Dataplane reset failed: {detail}")
        if not isinstance(res.get("switches"), list):
            raise OperationError(502, "Dataplane reset failed: invalid worker confirmation")
        if self.simulation_state != "STOPPED" and not res.get("switches"):
            raise OperationError(502, "Dataplane reset failed: worker has no active switches")
        return res

    async def set_link_status(
        self,
        node1: str,
        node2: str,
        status: str
    ) -> Dict[str, Any]:

        if self.simulation_state == "STOPPED":
            raise OperationError(409, "Network is not running")

        res = await self._send_command({
            "command": "set_link_status",
            "node1": node1,
            "node2": node2,
            "status": status
        })

        # Broadcast topology update
        topo = await self.get_topology()

        await ws_manager.broadcast({
            "event_type": "TOPOLOGY_UPDATE",
            "topology": topo,
            "timestamp": time.time()
        })

        action_type = (
            "LINK_RESTORED"
            if status.lower() == "up"
            else "LINK_FAILURE"
        )

        save_event_log(
            "INFO" if status.lower() == "up" else "WARNING",
            "MININET",
            f"Link {node1} <-> {node2} set to {status.upper()}"
        )

        await ws_manager.broadcast({
            "event_type": action_type,
            "src": node1,
            "dst": node2,
            "status": status.upper(),
            "timestamp": time.time()
        })

        return res

    async def pingall(self) -> Dict[str, Any]:
        if self.simulation_state == "STOPPED":
            raise OperationError(409, "Network is not running")

        return await self._send_command(
            {"command": "pingall"},
            timeout=15.0
        )

    async def start_traffic(
        self,
        src: str,
        dst: str,
        interval: float,
        count: int,
        job_id: str
    ) -> Dict[str, Any]:

        if self.simulation_state == "STOPPED":
            raise OperationError(409, "Network is not running")

        res = await self._send_command({
            "command": "start_traffic",
            "src": src,
            "dst": dst,
            "interval": interval,
            "count": count,
            "job_id": job_id
        })

        save_event_log(
            "INFO",
            "TRAFFIC",
            f"Started traffic: {src} -> {dst} "
            f"(interval={interval}s, count={count})"
        )

        return res

    async def stop_traffic(
        self,
        job_id: str
    ) -> Dict[str, Any]:

        res = await self._send_command({
            "command": "stop_traffic",
            "job_id": job_id
        })

        save_event_log(
            "INFO",
            "TRAFFIC",
            f"Stopped traffic job {job_id}"
        )

        return res

    async def get_traffic_stats(
        self,
        job_id: str
    ) -> Dict[str, Any]:

        return await self._send_command({
            "command": "get_traffic_stats",
            "job_id": job_id
        }, timeout=3.0)

    async def get_switch_info(
        self,
        dpid: int
    ) -> Dict[str, Any]:

        if self.simulation_state == "STOPPED":
            raise OperationError(409, "Network is not running")

        return await self._send_command({
            "command": "get_switch_info",
            "dpid": dpid
        }, timeout=5.0)


mininet_client = MininetClient()
