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
from backend.services.metrics import PERFORMANCE_FIELDS, TIMING_SCOPE
from backend.websocket.manager import ws_manager

logger = logging.getLogger("sdn.experiment")

class ExperimentCancelled(Exception):
    pass

class ExperimentRunner:
    def __init__(self):
        self.current_experiment: Optional[Dict[str, Any]] = None
        self.is_running: bool = False
        self._cancel_flag: bool = False
        self.current_run_id = None
        self._task = None
        self._cancel_event = asyncio.Event()
        self._terminal = {}
        self._comparison = False

    def _checkpoint(self):
        if self._cancel_flag:
            raise ExperimentCancelled("Experiment cancelled by user")

    async def _step(self, operation):
        # Complete acquisitions before observing cancellation. Interrupting IPC
        # would lose acknowledgement of resources that still require cleanup.
        if self._cancel_flag:
            operation.close()
            self._checkpoint()
        result = await operation
        self._checkpoint()
        return result

    async def _sleep(self, delay):
        self._checkpoint()
        sleeper = asyncio.create_task(asyncio.sleep(delay))
        cancelled = asyncio.create_task(self._cancel_event.wait())
        try:
            await asyncio.wait((sleeper, cancelled), return_when=asyncio.FIRST_COMPLETED)
        finally:
            for task in (sleeper, cancelled):
                if not task.done():
                    task.cancel()
            await asyncio.gather(sleeper, cancelled, return_exceptions=True)
        self._checkpoint()

    async def run_experiment(self, controller_type, **kwargs):
        if self.is_running:
            raise OperationError(409, "An experiment is already in progress")
        run_id = kwargs.pop("run_id", None) or uuid.uuid4().hex
        if run_id in self._terminal:
            raise OperationError(409, "Experiment run ID has already been used")
        self.is_running = True
        self.current_run_id = run_id
        self._cancel_flag = False
        self._cancel_event = asyncio.Event()
        self._comparison = controller_type == "comparison"

        async def execute():
            try:
                if controller_type == "comparison":
                    result = await self.run_comparison(run_id=run_id, **{
                        key: value for key, value in kwargs.items() if key != "repetitions"})
                else:
                    result = await self._run_single(controller_type, run_id=run_id, **kwargs)
                self._terminal[run_id] = result
                return result
            except Exception as exc:
                self._terminal[run_id] = exc
                if self._comparison:
                    await ws_manager.broadcast({"event_type": "EXPERIMENT_FINISHED", "run_id": run_id,
                                                "error": public_error(exc)})
                raise
            finally:
                self.is_running = False
                self.current_run_id = None
                self.current_experiment = None

        self._task = asyncio.create_task(execute(), name=f"experiment-{run_id}")
        task = self._task
        try:
            return await asyncio.shield(task)
        except asyncio.CancelledError:
            if self.current_run_id == run_id and self._task is task:
                self.cancel()
            await asyncio.shield(task)
            raise

    async def _run_single(
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
        traffic_job_id = None
        runtime_id = None
        link_dirty = False
        traffic_finalized = False
        failure = None
        started_monotonic = time.monotonic()
        try:
            save_event_log("INFO", "EXPERIMENT", f"Started experiment {exp_id} on {controller_type}")
            await self._broadcast(run_id, {
                "event_type": "EXPERIMENT_PROGRESS", "experiment_id": exp_id,
                "status": "PREPARING", "progress_percent": 10,
                "message": "Preparing network and controller..."
            })
            self._checkpoint()
            # Every run (including the same mode) starts with fresh Ryu memory
            # and the shared, checked dataplane boundary used by the dashboard.
            await self._step(controller_manager.select_controller(controller_type, force_restart=True))
            generation = controller_manager.generation
            if controller_manager.active_controller != controller_type or controller_manager.status != "READY":
                raise OperationError(409, "Experiment controller activation was not confirmed")
            await self._sleep(1.0)

            # 2. Ensure Mininet simulation is running
            if mininet_client.simulation_state != "RUNNING":
                await self._step(mininet_client.start_simulation())
                await self._sleep(1.5)

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

            # Preserve unrelated/pre-existing failures; only fail an observed UP target.
            topology = await self._step(mininet_client.get_topology())
            target = next((link for link in topology.get("links", [])
                           if {link.get("src"), link.get("dst")} == {fail_src, fail_dst}), None)
            if target is None:
                raise OperationError(404, "Experiment failure link was not found")
            if target.get("status", "").upper() != "UP":
                raise OperationError(409, "Experiment failure link must initially be UP")

            # 4. Warm-up ping to discover topology and prime flow tables
            await self._broadcast(run_id, {
                "event_type": "EXPERIMENT_PROGRESS",
                "experiment_id": exp_id,
                "status": "WARMUP",
                "progress_percent": 30,
                "message": "Warming up network flows (pingall)..."
            })
            await self._step(mininet_client.pingall())
            await self._sleep(1.0)

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
            record["summary"]["traffic_job_id"] = traffic_job_id
            await self._step(mininet_client.start_traffic("h1", "h2", traffic_interval, packet_count, traffic_job_id, experiment_id=exp_id))

            # 6. Wait for failure delay
            await self._sleep(failure_delay_sec)

            # 7. Inject Link Failure
            check_context()
            recovery_before_failure = controller_manager.last_recovery_event
            t_fail = time.time()
            record["failure_timestamp"] = t_fail
            # Retain intent even if a worker acknowledgement/topology broadcast fails.
            link_dirty = True
            await self._step(mininet_client.set_link_status(fail_src, fail_dst, "down", experiment_id=exp_id,
                                                          expected_runtime=runtime_id))
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
            t_start_wait = time.monotonic()
            final_stats = {}
            while time.monotonic() - t_start_wait < expected_duration + 5.0:
                check_context()
                stats = await self._step(mininet_client.get_traffic_stats(traffic_job_id))
                if stats.get("status") == "not_found" or not stats.get("active", True):
                    final_stats = stats
                    break
                await self._sleep(0.5)

            if not final_stats:
                final_stats = await self._step(mininet_client.get_traffic_stats(traffic_job_id))
                if final_stats.get("active", True):
                    raise OperationError(504, "Experiment traffic timed out")

            # Stop traffic explicitly if still active
            stopped_stats = await mininet_client.stop_traffic(traffic_job_id)
            traffic_finalized = not stopped_stats.get("active", True) and stopped_stats.get("accounting_complete", False)
            self._checkpoint()
            if "transmitted" in stopped_stats:
                final_stats = stopped_stats

            check_context()
            if (final_stats.get("job_id") != traffic_job_id or
                final_stats.get("runtime_id") != runtime_id or
                final_stats.get("experiment_id") != exp_id or
                final_stats.get("controller_generation") != generation or
                not final_stats.get("accounting_complete")):
                raise OperationError(502, "Experiment final telemetry ownership was not confirmed")
            tx, rx = final_stats.get("transmitted"), final_stats.get("received")
            if (type(tx) is not int or type(rx) is not int or not 0 <= rx <= tx or
                    not isinstance(final_stats.get("loss_percent"), (int, float))):
                raise OperationError(502, "Experiment final packet accounting was incomplete")

            # 9. Extract performance metrics
            record["end_time"] = datetime.datetime.now().isoformat()
            record["status"] = "COMPLETED"
            record["packets_transmitted"] = final_stats["transmitted"]
            record["packets_received"] = final_stats["received"]
            record["packet_loss_percent"] = final_stats["loss_percent"] if tx else None
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

            check_context()
        except (ExperimentCancelled, asyncio.CancelledError):
            record["status"] = "CANCELLED"
        except Exception as exc:
            failure = exc
            record["status"] = "FAILED"
            record["summary"]["error"] = public_error(exc)
        finally:
            cleanup_errors = []
            if traffic_job_id and not traffic_finalized:
                try:
                    final = await mininet_client.stop_experiment_traffic(traffic_job_id, exp_id, runtime_id)
                    if final is not None:
                        record["summary"]["final_traffic"] = final
                except Exception as exc:
                    cleanup_errors.append("Traffic cleanup: " + public_error(exc))
            if link_dirty:
                try:
                    await mininet_client.set_link_status(fail_src, fail_dst, "up", experiment_id=exp_id,
                                                         expected_runtime=runtime_id)
                except Exception as exc:
                    cleanup_errors.append("Link cleanup: " + public_error(exc))
            if mininet_client.experiment_id == exp_id:
                mininet_client.experiment_id = None
            if cleanup_errors:
                record["status"] = "FAILED"
                record["summary"]["cleanup_errors"] = cleanup_errors
                failure = OperationError(502, "Experiment cleanup failed", results=cleanup_errors)
            elif self._cancel_flag and failure is None:
                record["status"] = "CANCELLED"
            elif record["status"] == "COMPLETED":
                try:
                    check_context()
                except Exception as exc:
                    failure = exc
                    record["status"] = "FAILED"
                    record["summary"]["error"] = public_error(exc)
            record["end_time"] = datetime.datetime.now().isoformat()
            record["summary"]["duration_sec"] = time.monotonic() - started_monotonic
            record["summary"]["timing_scope"] = TIMING_SCOPE
            if record["status"] != "COMPLETED":
                for field in PERFORMANCE_FIELDS:
                    record[field] = None
                # Preserve any actual drained counters as diagnostic evidence,
                # but do not leave copied success metrics in failed summaries.
                for field in ("packets_transmitted", "packets_received", "loss_percent", "avg_rtt_ms", "recovery_duration_ms"):
                    if field in record["summary"]:
                        record["summary"][field] = None
            save_experiment(record)
            save_event_log("SUCCESS" if record["status"] == "COMPLETED" else "WARNING", "EXPERIMENT",
                           f"Experiment {exp_id}: {record['status']}", record["summary"])
            await self._broadcast(run_id, {"event_type": "EXPERIMENT_FINISHED", "experiment": record,
                                          "error": public_error(failure) if failure else None})
        if failure:
            raise failure
        return record

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
            res = await self._run_single(
                controller_type=ctrl,
                traffic_interval=traffic_interval,
                packet_count=packet_count,
                failure_delay_sec=failure_delay_sec,
                fail_src=fail_src,
                fail_dst=fail_dst, run_id=uuid.uuid4().hex
            )
            results.append(res)
            if res["status"] != "COMPLETED":
                break
            # Brief cooldown between controller runs
            if idx < len(controllers) - 1:
                try:
                    await self._sleep(2.0)
                except ExperimentCancelled:
                    break

        comparison_summary = {
            "id": comparison_id,
            "type": "COMPARISON",
            "status": "CANCELLED" if self._cancel_flag else "COMPLETED",
            "run_id": run_id,
            "results": results,
            "timestamp": datetime.datetime.now().isoformat()
        }

        save_event_log("INFO", "EXPERIMENT", f"Automated comparison {comparison_id}: {comparison_summary['status']}")
        await self._broadcast(run_id, {
            "event_type": "COMPARISON_FINISHED",
            "comparison": comparison_summary
        })
        return comparison_summary

    async def _broadcast(self, run_id, message):
        if self._comparison:
            if message.get("event_type") == "EXPERIMENT_FINISHED":
                return  # child finalization does not finish the parent workflow
            run_id = self.current_run_id
        await ws_manager.broadcast({**message, "run_id": run_id})

    def cancel(self):
        if self.is_running:
            self._cancel_flag = True
            self._cancel_event.set()

    async def cancel_and_wait(self, run_id=None):
        target = run_id or self.current_run_id
        if target in self._terminal:
            result = self._terminal[target]
            if isinstance(result, Exception):
                raise result
            return result
        if not self.is_running or target != self.current_run_id:
            raise OperationError(404, "Active experiment was not found")
        task = self._task
        self.cancel()
        return await asyncio.shield(task)

    async def shutdown(self):
        if self.is_running:
            await self.cancel_and_wait(self.current_run_id)

experiment_runner = ExperimentRunner()
