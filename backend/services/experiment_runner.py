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
        self.current_run_id = None

    async def run_experiment(
        self,
        controller_type: str,
        traffic_interval: float = 0.02,
        packet_count: int = 300,
        failure_delay_sec: float = 2.0,
        fail_src: str = "s1",
        fail_dst: str = "s2",
        repetitions: int = 1,
        run_id: Optional[str] = None
    ) -> Dict[str, Any]:
        if self.is_running:
            raise OperationError(409, "An experiment is already in progress")

        run_id = run_id or uuid.uuid4().hex
        if controller_type == "comparison":
            return await self.run_comparison(
                traffic_interval=traffic_interval,
                packet_count=packet_count,
                failure_delay_sec=failure_delay_sec,
                fail_src=fail_src,
                fail_dst=fail_dst, run_id=run_id
            )

        self.is_running = True
        self.current_run_id = run_id
        self._cancel_flag = False
        exp_id = f"exp_{uuid.uuid4().hex}_{controller_type}"

        record: Dict[str, Any] = {
            "id": exp_id,
            "controller": controller_type,
            "run_id": run_id,
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

        self.current_experiment = record
        save_event_log("INFO", "EXPERIMENT", f"Started experiment {exp_id} on {controller_type}")
        await self._broadcast(run_id, {
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
            generation = controller_manager.generation
            if controller_manager.active_controller != controller_type or controller_manager.status != "READY":
                raise OperationError(409, "Experiment controller activation was not confirmed")
            await asyncio.sleep(1.0)

            # 2. Ensure Mininet simulation is running
            if mininet_client.simulation_state != "RUNNING":
                await mininet_client.start_simulation()
                await asyncio.sleep(1.5)

            runtime_id = mininet_client.runtime_id
            def check_context():
                if (controller_manager.generation != generation or
                    controller_manager.active_controller != controller_type or
                    controller_manager.status != "READY" or mininet_client.runtime_id != runtime_id or
                    mininet_client.simulation_state != "RUNNING"):
                    raise OperationError(409, "Experiment runtime or controller changed")
            check_context()
            if mininet_client.experiment_id not in (None, exp_id):
                raise OperationError(409, "Runtime is owned by another experiment")
            mininet_client.experiment_id = exp_id
            record["summary"].update(runtime_id=runtime_id, controller_generation=generation,
                                     experiment_id=exp_id, run_id=run_id)

            # 3. Restore all links to baseline state
            await self._broadcast(run_id, {
                "event_type": "EXPERIMENT_PROGRESS",
                "experiment_id": exp_id,
                "status": "RESTORING_LINKS",
                "progress_percent": 20,
                "message": "Ensuring all physical links are UP..."
            })
            await mininet_client.set_link_status(fail_src, fail_dst, "up", experiment_id=exp_id)
            await asyncio.sleep(1.0)

            # 4. Warm-up ping to discover topology and prime flow tables
            await self._broadcast(run_id, {
                "event_type": "EXPERIMENT_PROGRESS",
                "experiment_id": exp_id,
                "status": "WARMUP",
                "progress_percent": 30,
                "message": "Warming up network flows (pingall)..."
            })
            await mininet_client.pingall()
            await asyncio.sleep(1.0)

            # 5. Start high-frequency traffic
            await self._broadcast(run_id, {
                "event_type": "EXPERIMENT_PROGRESS",
                "experiment_id": exp_id,
                "status": "TRAFFIC_ACTIVE",
                "progress_percent": 40,
                "message": f"Generating ICMP traffic: {packet_count} packets @ {traffic_interval}s interval..."
            })
            traffic_job_id = f"exp_traffic_{uuid.uuid4().hex}"
            check_context()
            await mininet_client.start_traffic("h1", "h2", traffic_interval, packet_count, traffic_job_id, experiment_id=exp_id)
            record["summary"]["traffic_job_id"] = traffic_job_id

            # 6. Wait for failure delay
            await asyncio.sleep(failure_delay_sec)
            if self._cancel_flag:
                raise asyncio.CancelledError("Experiment cancelled by user")

            # 7. Inject Link Failure
            check_context()
            recovery_before_failure = controller_manager.last_recovery_event
            t_fail = time.time()
            record["failure_timestamp"] = t_fail
            await mininet_client.set_link_status(fail_src, fail_dst, "down", experiment_id=exp_id)
            save_event_log("WARNING", "EXPERIMENT", f"Injecting failure: disconnecting {fail_src} <-> {fail_dst}")
            await self._broadcast(run_id, {
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
                check_context()
                stats = await mininet_client.get_traffic_stats(traffic_job_id)
                if stats.get("status") == "not_found" or not stats.get("active", True):
                    final_stats = stats
                    break
                await asyncio.sleep(0.5)

            if not final_stats:
                final_stats = await mininet_client.get_traffic_stats(traffic_job_id)

            # Stop traffic explicitly if still active
            stopped_stats = await mininet_client.stop_traffic(traffic_job_id)
            if "transmitted" in stopped_stats:
                final_stats = stopped_stats

            check_context()
            if (final_stats.get("job_id") != traffic_job_id or
                final_stats.get("runtime_id") != runtime_id or
                final_stats.get("experiment_id") != exp_id or
                final_stats.get("controller_generation") != generation or
                not final_stats.get("accounting_complete")):
                raise OperationError(502, "Experiment final telemetry ownership was not confirmed")

            # 9. Extract performance metrics
            record["end_time"] = datetime.datetime.now().isoformat()
            record["status"] = "COMPLETED"
            record["packets_transmitted"] = final_stats["transmitted"]
            record["packets_received"] = final_stats.get("received", 0)
            record["packet_loss_percent"] = final_stats.get("loss_percent", 0.0)
            record["min_rtt_ms"] = final_stats.get("min_rtt")
            record["avg_rtt_ms"] = final_stats.get("avg_rtt")
            record["max_rtt_ms"] = final_stats.get("max_rtt")

            # Check recovery event from controller
            rec_event = controller_manager.last_recovery_event
            if (rec_event and rec_event is not recovery_before_failure and
                rec_event.get("controller_generation") == generation and
                rec_event.get("runtime_id") == runtime_id and rec_event.get("experiment_id") == exp_id and
                set(rec_event.get("failure_link", [])) == {fail_src, fail_dst} and
                rec_event.get("event_received_at", 0) >= t_fail):
                record["recovery_event"] = rec_event.get("type")
                record["recovery_duration_ms"] = rec_event.get("duration_ms")
            elif controller_type == "baseline":
                record["recovery_event"] = "NONE (Baseline Controller does not recover)"
                record["recovery_duration_ms"] = None

            record["summary"] = {
                **record["summary"],
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
            await mininet_client.set_link_status(fail_src, fail_dst, "up", experiment_id=exp_id)

            check_context()

            # Save to SQLite
            save_experiment(record)
            save_event_log("SUCCESS", "EXPERIMENT", f"Experiment {exp_id} completed successfully!", record["summary"])

            await self._broadcast(run_id, {
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
            await self._broadcast(run_id, {
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
            await self._broadcast(run_id, {
                "event_type": "EXPERIMENT_FINISHED",
                "experiment": record,
                "error": public_error(e)
            })
            raise
        finally:
            if mininet_client.experiment_id == exp_id:
                mininet_client.experiment_id = None
            self.is_running = False
            self.current_run_id = None
            self.current_experiment = None

    async def run_comparison(
        self,
        traffic_interval: float = 0.02,
        packet_count: int = 200,
        failure_delay_sec: float = 1.5,
        fail_src: str = "s1",
        fail_dst: str = "s2",
        run_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """Runs Baseline, Reactive, and Fast Failover under identical conditions."""
        run_id = run_id or uuid.uuid4().hex
        controllers = ["baseline", "reactive", "fast_failover"]
        results = []
        comparison_id = f"cmp_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}"

        save_event_log("INFO", "EXPERIMENT", f"Starting 3-way automated comparison {comparison_id}")

        for idx, ctrl in enumerate(controllers):
            await self._broadcast(run_id, {
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
        await self._broadcast(run_id, {
            "event_type": "COMPARISON_FINISHED",
            "comparison": comparison_summary
        })
        return comparison_summary

    async def _broadcast(self, run_id, message):
        await ws_manager.broadcast({**message, "run_id": run_id})

    def cancel(self):
        if self.is_running:
            self._cancel_flag = True

experiment_runner = ExperimentRunner()
