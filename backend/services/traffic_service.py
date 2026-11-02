import asyncio
import copy
import logging
import time
import uuid
from typing import Dict, Any, Optional
from backend.services.mininet_client import mininet_client
from backend.services.operation_error import OperationError
from backend.websocket.manager import ws_manager

logger = logging.getLogger("sdn.traffic")

class TrafficService:
    def __init__(self):
        self.active_job_id: Optional[str] = None
        self.polling_task: Optional[asyncio.Task] = None
        self.latest_stats: Dict[str, Any] = {}
        self._action_lock = asyncio.Lock()
        self._bound_client = None

    def _bind(self):
        if self._bound_client is not mininet_client:
            if self._bound_client is not None:
                self._bound_client._runtime_listeners.remove(self._runtime_changed)
            self._bound_client = mininet_client
            mininet_client._runtime_listeners.append(self._runtime_changed)

    def _runtime_changed(self, finals):
        job_id = self.active_job_id or self.latest_stats.get("job_id")
        final = next((item for item in finals if item.get("job_id") == job_id), None)
        if (final is None and self.latest_stats.get("runtime_id") == mininet_client.runtime_id
            and not self.latest_stats.get("active", False)):
            final = self.latest_stats
        self.active_job_id = None
        if self.polling_task:
            self.polling_task.cancel()
            self.polling_task = None
        self.latest_stats = copy.deepcopy(final) if final else {}

    def _current(self):
        if self.latest_stats.get("runtime_id", mininet_client.runtime_id) != mininet_client.runtime_id:
            self._runtime_changed([])

    async def start(self, src="h1", dst="h2", interval=0.05, count=200, job_id=None) -> Dict[str, Any]:
        async with self._action_lock:
            self._bind()
            if self.active_job_id:
                await self._stop()
            job_id = job_id or f"traffic_{uuid.uuid4().hex}"
            runtime_id = mininet_client.runtime_id
            res = await mininet_client.start_traffic(src, dst, interval, count, job_id)
            if runtime_id != mininet_client.runtime_id or mininet_client.simulation_state != "RUNNING":
                raise OperationError(409, "Runtime changed while starting traffic")
            self.active_job_id = job_id
            self.latest_stats = {**res, "active": True, "transmitted": 0,
                                 "received": 0, "loss_percent": 0.0, "history": [],
                                 "min_rtt": None, "avg_rtt": None, "max_rtt": None,
                                 "last_rtt": None, "duration_sec": 0.0, "accounting_complete": False}
            await ws_manager.broadcast({"event_type": "TRAFFIC_STARTED", "stats": self.latest_stats,
                                        "timestamp": time.time()})
            self.polling_task = asyncio.create_task(self._poll_stats(job_id))
            return res

    async def stop(self) -> Dict[str, Any]:
        async with self._action_lock:
            return await self._stop()

    async def _stop(self):
        self._current()
        if not self.active_job_id:
            return {"status": "ok", **await self.get_stats()}
        job_id, runtime_id = self.active_job_id, mininet_client.runtime_id
        res = await mininet_client.stop_traffic(job_id)
        if self.active_job_id != job_id or mininet_client.runtime_id != runtime_id:
            raise OperationError(409, "Traffic owner changed while stopping")
        self.latest_stats = {k: copy.deepcopy(v) for k, v in res.items() if k != "status"}
        if self.polling_task:
            self.polling_task.cancel()
            self.polling_task = None
        self.active_job_id = None
        await ws_manager.broadcast({"event_type": "TRAFFIC_COMPLETED",
                                    "stats": self.latest_stats, "timestamp": time.time()})
        return res

    async def get_stats(self) -> Dict[str, Any]:
        self._current()
        job_id, runtime_id = self.active_job_id, mininet_client.runtime_id
        if job_id:
            stats = await mininet_client.get_traffic_stats(job_id)
            if self.active_job_id == job_id and mininet_client.runtime_id == runtime_id:
                self.latest_stats = stats
                if not stats.get("active", True):
                    self.active_job_id = None
        return self.snapshot()

    def snapshot(self):
        self._current()
        return copy.deepcopy(self.latest_stats) or {**mininet_client.runtime_context(), "job_id": None,
                 "active": False, "transmitted": 0, "received": 0, "loss_percent": 0.0,
                 "min_rtt": None, "avg_rtt": None, "max_rtt": None, "last_rtt": None,
                 "history": [], "duration_sec": 0.0}

    async def _poll_stats(self, job_id: str):
        runtime_id = mininet_client.runtime_id
        while self.active_job_id == job_id and mininet_client.runtime_id == runtime_id:
            try:
                stats = await mininet_client.get_traffic_stats(job_id)
                if self.active_job_id != job_id or mininet_client.runtime_id != runtime_id:
                    break
                self.latest_stats = stats
                if not stats.get("active", True):
                    self.active_job_id = None
                await ws_manager.broadcast({"event_type": "TRAFFIC_TICK" if stats.get("active") else "TRAFFIC_COMPLETED",
                                            "stats": stats, "timestamp": time.time()})
            except Exception as exc:
                logger.debug("Error polling traffic stats: %s", exc)
            await asyncio.sleep(0.3)

traffic_service = TrafficService()
