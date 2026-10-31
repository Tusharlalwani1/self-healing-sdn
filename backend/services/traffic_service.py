import asyncio
import logging
import time
import uuid
from typing import Dict, Any, Optional
from backend.services.mininet_client import mininet_client
from backend.websocket.manager import ws_manager

logger = logging.getLogger("sdn.traffic")

class TrafficService:
    def __init__(self):
        self.active_job_id: Optional[str] = None
        self.polling_task: Optional[asyncio.Task] = None
        self.latest_stats: Dict[str, Any] = {}

    async def start(self, src="h1", dst="h2", interval=0.05, count=200, job_id=None) -> Dict[str, Any]:
        if self.active_job_id:
            await self.stop()

        job_id = job_id or f"traffic_{uuid.uuid4().hex[:8]}"
        res = await mininet_client.start_traffic(src, dst, interval, count, job_id)
        self.active_job_id = job_id

        self.polling_task = asyncio.create_task(self._poll_stats(job_id))
        return res

    async def stop(self) -> Dict[str, Any]:
        if not self.active_job_id:
            return {"status": "ok", "message": "No active traffic job"}

        job_id = self.active_job_id
        res = await mininet_client.stop_traffic(job_id)
        if self.polling_task:
            self.polling_task.cancel()
            self.polling_task = None
        self.active_job_id = None
        return res

    async def get_stats(self) -> Dict[str, Any]:
        if not self.active_job_id:
            return self.latest_stats or {"active": False, "transmitted": 0, "received": 0, "loss_percent": 0.0}
        stats = await mininet_client.get_traffic_stats(self.active_job_id)
        if stats.get("status") != "not_found":
            self.latest_stats = stats
        return self.latest_stats

    async def _poll_stats(self, job_id: str):
        while self.active_job_id == job_id:
            try:
                stats = await mininet_client.get_traffic_stats(job_id)
                if stats.get("status") == "not_found":
                    break
                self.latest_stats = stats
                await ws_manager.broadcast({
                    "event_type": "TRAFFIC_TICK",
                    "stats": stats,
                    "timestamp": time.time()
                })
                if not stats.get("active", True):
                    await ws_manager.broadcast({
                        "event_type": "TRAFFIC_COMPLETED",
                        "stats": stats,
                        "timestamp": time.time()
                    })
                    self.active_job_id = None
                    break
            except Exception as e:
                logger.debug(f"Error polling traffic stats: {e}")
            await asyncio.sleep(0.3)

traffic_service = TrafficService()
