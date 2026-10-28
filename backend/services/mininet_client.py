import asyncio
import json
import logging
import os
import time
from typing import Dict, Any, Optional
from backend.config import MININET_SOCKET_PATH, VENV_PYTHON, BACKEND_DIR
from backend.websocket.manager import ws_manager
from backend.database.db import save_event_log

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
                pong = await self._send_command({"command": "ping"}, timeout=2.0)
                if pong.get("status") == "pong":
                    return
            except Exception:
                pass
            # Stale socket - clean it up
            try:
                import subprocess
                subprocess.run(["sudo", "rm", "-f", self.socket_path], check=False)
            except Exception:
                pass

        logger.info("Spawning Mininet worker process with sudo...")
        worker_script = BACKEND_DIR / "services" / "mininet_worker.py"
        
        # Execute using sudo with virtualenv python
        cmd = ["sudo", "-n", str(VENV_PYTHON), str(worker_script), "--socket", self.socket_path]
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
                        pong = await self._send_command({"command": "ping"}, timeout=1.0)
                        if pong.get("status") == "pong":
                            ready = True
                            break
                    except Exception:
                        pass

            if not ready:
                raise RuntimeError("Mininet worker socket was not ready within 15 seconds")
            logger.info("Mininet worker spawned and ready.")
        except Exception as e:
            logger.error(f"Failed to spawn mininet worker: {e}")
            raise

    async def _send_command(self, payload: Dict[str, Any], timeout: float = 15.0) -> Dict[str, Any]:
        async with self._lock:
            reader, writer = await asyncio.wait_for(
                asyncio.open_unix_connection(self.socket_path),
                timeout=timeout
            )
            try:
                line = json.dumps(payload) + "\n"
                writer.write(line.encode("utf-8"))
                await writer.drain()

                resp_line = await asyncio.wait_for(reader.readline(), timeout=timeout)
                if not resp_line:
                    raise RuntimeError("Received empty response from Mininet worker")
                return json.loads(resp_line.decode("utf-8"))
            finally:
                writer.close()
                await writer.wait_closed()

    async def start_simulation(self, controller_ip="127.0.0.1", controller_port=6653) -> Dict[str, Any]:
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
                save_event_log("SUCCESS", "MININET", "Mininet network started and connected to controller")
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
            return res
        except Exception as e:
            self.simulation_state = "ERROR"
            logger.error(f"Error starting Mininet: {e}")
            save_event_log("ERROR", "MININET", f"Failed to start Mininet: {e}")
            await ws_manager.broadcast({
                "event_type": "SIMULATION_STATUS",
                "state": "ERROR",
                "error": str(e),
                "timestamp": time.time()
            })
            raise

    async def stop_simulation(self) -> Dict[str, Any]:
        self.simulation_state = "STOPPING"
        await ws_manager.broadcast({
            "event_type": "SIMULATION_STATUS",
            "state": "STOPPING",
            "timestamp": time.time()
        })
        try:
            res = await self._send_command({"command": "stop"}, timeout=10.0)
            self.simulation_state = "STOPPED"
            save_event_log("INFO", "MININET", "Mininet simulation stopped cleanly")
            await ws_manager.broadcast({
                "event_type": "SIMULATION_STATUS",
                "state": "STOPPED",
                "timestamp": time.time()
            })
            return res
        except Exception as e:
            self.simulation_state = "STOPPED"
            logger.warning(f"Error stopping Mininet: {e}")
            return {"status": "ok", "message": "Simulation stopped"}

    async def get_topology(self) -> Dict[str, Any]:
        try:
            if not os.path.exists(self.socket_path):
                return {"status": "not_running", "nodes": [], "links": []}
            return await self._send_command({"command": "get_topology"}, timeout=5.0)
        except Exception as e:
            logger.debug(f"Topology query failed: {e}")
            return {"status": "not_running", "nodes": [], "links": []}

    async def set_link_status(self, node1: str, node2: str, status: str) -> Dict[str, Any]:
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
        action_type = "LINK_RESTORED" if status.lower() == "up" else "LINK_FAILURE"
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
        return await self._send_command({"command": "pingall"}, timeout=15.0)

    async def start_traffic(self, src: str, dst: str, interval: float, count: int, job_id: str) -> Dict[str, Any]:
        res = await self._send_command({
            "command": "start_traffic",
            "src": src,
            "dst": dst,
            "interval": interval,
            "count": count,
            "job_id": job_id
        })
        save_event_log("INFO", "TRAFFIC", f"Started traffic: {src} -> {dst} (interval={interval}s, count={count})")
        return res

    async def stop_traffic(self, job_id: str) -> Dict[str, Any]:
        res = await self._send_command({
            "command": "stop_traffic",
            "job_id": job_id
        })
        save_event_log("INFO", "TRAFFIC", f"Stopped traffic job {job_id}")
        return res

    async def get_traffic_stats(self, job_id: str) -> Dict[str, Any]:
        return await self._send_command({
            "command": "get_traffic_stats",
            "job_id": job_id
        }, timeout=3.0)

    async def get_switch_info(self, dpid: int) -> Dict[str, Any]:
        return await self._send_command({
            "command": "get_switch_info",
            "dpid": dpid
        }, timeout=5.0)

mininet_client = MininetClient()
