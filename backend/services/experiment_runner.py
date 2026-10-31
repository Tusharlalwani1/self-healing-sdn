import asyncio
import datetime
import logging
import time
import uuid
from typing import Dict, Any, Optional, List

from backend.database.db import save_experiment, save_event_log
from backend.services.controller_manager import controller_manager
from backend.services.mininet_client import mininet_client
from backend.services.operation_error import OperationError, public_error
from backend.websocket.manager import ws_manager

logger = logging.getLogger("sdn.experiment")

class ExperimentRunner:
    def __init__(self):
        self.current_experiment: Optional[Dict[str, Any]] = None
        self.is_running: bool = False
        self._cancel_flag: bool = False

    async def run_experiment(
        self,
        controller_type: str,
        traffic_interval: float = 0.02,
        packet_count: int = 300,
        failure_delay_sec: float = 2.0,
        fail_src: str = "s1",
        fail_dst: str = "s2",
        repetitions: int = 1
    ) -> Dict[str, Any]:
        if self.is_running:
            raise OperationError(409, "An experiment is already in progress")

        if controller_type == "comparison":
            return await self.run_comparison(
                traffic_interval=traffic_interval,
                packet_count=packet_count,
                failure_delay_sec=failure_delay_sec,
                fail_src=fail_src,
                fail_dst=fail_dst
            )

        self.is_running = True
        self._cancel_flag = False
        exp_id = f"exp_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}_{controller_type}"

        record: Dict[str, Any] = {
            "id": exp_id,
            "controller": controller_type,
            "start_time": datetime.datetime.now().isoformat(),
            "status": "RUNNING",
            "traffic_params": {
                "interval": traffic_interval,
                "count": packet_count,
                "failure_delay": failure_delay_sec
            },
            "failure_link": f"{fail_src}-{fail_dst}",
            "summary": {}
        }

        save_event_log("INFO", "EXPERIMENT", f"Started experiment {exp_id} on {controller_type}")
        await ws_manager.broadcast({
            "event_type": "EXPERIMENT_PROGRESS",
            "experiment_id": exp_id,
            "status": "PREPARING",
            "progress_percent": 10,
            "message": "Preparing network and controller..."
        })

        try:
            # Every run (including the same mode) starts with fresh Ryu memory
            # and the shared, checked dataplane boundary used by the dashboard.
            await controller_manager.select_controller(controller_type, force_restart=True)
            await asyncio.sleep(1.0)

            # 2. Ensure Mininet simulation is running
            if mininet_client.simulation_state != "RUNNING":
                await mininet_client.start_simulation()
                await asyncio.sleep(1.5)

            # 3. Restore all links to baseline state
            await ws_manager.broadcast({
                "event_type": "EXPERIMENT_PROGRESS",
                "experiment_id": exp_id,
                "status": "RESTORING_LINKS",
                "progress_percent": 20,
                "message": "Ensuring all physical links are UP..."
            })
            await mininet_client.set_link_status(fail_src, fail_dst, "up")
            await asyncio.sleep(1.0)

            # 4. Warm-up ping to discover topology and prime flow tables
            await ws_manager.broadcast({
                "event_type": "EXPERIMENT_PROGRESS",
                "experiment_id": exp_id,
                "status": "WARMUP",
                "progress_percent": 30,
                "message": "Warming up network flows (pingall)..."
            })
            await mininet_client.pingall()
            await asyncio.sleep(1.0)

            # 5. Start high-frequency traffic
            await ws_manager.broadcast({
                "event_type": "EXPERIMENT_PROGRESS",
                "experiment_id": exp_id,
                "status": "TRAFFIC_ACTIVE",
                "progress_percent": 40,
                "message": f"Generating ICMP traffic: {packet_count} packets @ {traffic_interval}s interval..."
            })
            traffic_job_id = f"exp_traffic_{uuid.uuid4().hex[:6]}"
            await mininet_client.start_traffic("h1", "h2", traffic_interval, packet_count, traffic_job_id)

            # 6. Wait for failure delay
            await asyncio.sleep(failure_delay_sec)
            if self._cancel_flag:
                raise asyncio.CancelledError("Experiment cancelled by user")

            # 7. Inject Link Failure
            t_fail = time.time()
            record["failure_timestamp"] = t_fail
            await mininet_client.set_link_status(fail_src, fail_dst, "down")
            save_event_log("WARNING", "EXPERIMENT", f"Injecting failure: disconnecting {fail_src} <-> {fail_dst}")
            await ws_manager.broadcast({
                "event_type": "EXPERIMENT_PROGRESS",
                "experiment_id": exp_id,
                "status": "FAILURE_INJECTED",
                "progress_percent": 60,
                "message": f"Link failure injected: {fail_src} <-> {fail_dst} DOWN"
            })

            # 8. Wait for traffic completion or timeout
            expected_duration = (packet_count * traffic_interval) + 3.0
            t_start_wait = time.time()
            final_stats = {}
            while time.time() - t_start_wait < expected_duration + 5.0:
                stats = await mininet_client.get_traffic_stats(traffic_job_id)
                if stats.get("status") == "not_found" or not stats.get("active", True):
                    final_stats = stats
                    break
                await asyncio.sleep(0.5)

            if not final_stats:
                final_stats = await mininet_client.get_traffic_stats(traffic_job_id)

            # Stop traffic explicitly if still active
            await mininet_client.stop_traffic(traffic_job_id)

            # 9. Extract performance metrics
            record["end_time"] = datetime.datetime.now().isoformat()
            record["status"] = "COMPLETED"
            record["packets_transmitted"] = final_stats.get("transmitted", packet_count)
            record["packets_received"] = final_stats.get("received", 0)
            record["packet_loss_percent"] = final_stats.get("loss_percent", 0.0)
            record["min_rtt_ms"] = final_stats.get("min_rtt")
            record["avg_rtt_ms"] = final_stats.get("avg_rtt")
            record["max_rtt_ms"] = final_stats.get("max_rtt")

            # Check recovery event from controller
            rec_event = controller_manager.last_recovery_event
            if rec_event:
                record["recovery_event"] = rec_event.get("type")
                record["recovery_duration_ms"] = rec_event.get("duration_ms")
            elif controller_type == "baseline":
                record["recovery_event"] = "NONE (Baseline Controller does not recover)"
                record["recovery_duration_ms"] = None

            record["summary"] = {
                "controller": controller_type,
                "failure_link": f"{fail_src}-{fail_dst}",
                "loss_percent": record["packet_loss_percent"],
                "avg_rtt_ms": record["avg_rtt_ms"],
                "recovery_duration_ms": record.get("recovery_duration_ms"),
                "packets_transmitted": record["packets_transmitted"],
                "packets_received": record["packets_received"]
            }

            # Restoration is part of the requested run. Confirm it before
            # persisting/broadcasting successful completion.
            await mininet_client.set_link_status(fail_src, fail_dst, "up")

            # Save to SQLite
            save_experiment(record)
            save_event_log("SUCCESS", "EXPERIMENT", f"Experiment {exp_id} completed successfully!", record["summary"])

            await ws_manager.broadcast({
                "event_type": "EXPERIMENT_FINISHED",
                "experiment": record,
                "progress_percent": 100,
                "message": "Experiment completed successfully"
            })

            return record

        except asyncio.CancelledError:
            record["status"] = "CANCELLED"
            record["end_time"] = datetime.datetime.now().isoformat()
            save_experiment(record)
            await ws_manager.broadcast({
                "event_type": "EXPERIMENT_PROGRESS",
                "experiment_id": exp_id,
                "status": "CANCELLED",
                "message": "Experiment was cancelled"
            })
            return record
        except Exception as e:
            logger.error(f"Experiment {exp_id} failed: {e}")
            record["status"] = "FAILED"
            record["end_time"] = datetime.datetime.now().isoformat()
            record["summary"]["error"] = public_error(e)
            save_experiment(record)
            save_event_log("ERROR", "EXPERIMENT", f"Experiment {exp_id} failed: {e}")
            await ws_manager.broadcast({
                "event_type": "EXPERIMENT_FINISHED",
                "experiment": record,
                "error": public_error(e)
            })
            raise
        finally:
            self.is_running = False

    async def run_comparison(
        self,
        traffic_interval: float = 0.02,
        packet_count: int = 200,
        failure_delay_sec: float = 1.5,
        fail_src: str = "s1",
        fail_dst: str = "s2"
    ) -> Dict[str, Any]:
        """Runs Baseline, Reactive, and Fast Failover under identical conditions."""
        controllers = ["baseline", "reactive", "fast_failover"]
        results = []
        comparison_id = f"cmp_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}"

        save_event_log("INFO", "EXPERIMENT", f"Starting 3-way automated comparison {comparison_id}")

        for idx, ctrl in enumerate(controllers):
            await ws_manager.broadcast({
                "event_type": "EXPERIMENT_PROGRESS",
                "comparison_id": comparison_id,
                "stage": f"Running {ctrl} ({idx+1}/3)",
                "progress_percent": int((idx / 3.0) * 100)
            })
            res = await self.run_experiment(
                controller_type=ctrl,
                traffic_interval=traffic_interval,
                packet_count=packet_count,
                failure_delay_sec=failure_delay_sec,
                fail_src=fail_src,
                fail_dst=fail_dst
            )
            results.append(res)
            # Brief cooldown between controller runs
            await asyncio.sleep(2.0)

        comparison_summary = {
            "id": comparison_id,
            "type": "COMPARISON",
            "results": results,
            "timestamp": datetime.datetime.now().isoformat()
        }

        save_event_log("SUCCESS", "EXPERIMENT", f"Automated comparison {comparison_id} complete!")
        await ws_manager.broadcast({
            "event_type": "COMPARISON_FINISHED",
            "comparison": comparison_summary
        })
        return comparison_summary

    def cancel(self):
        if self.is_running:
            self._cancel_flag = True

experiment_runner = ExperimentRunner()
