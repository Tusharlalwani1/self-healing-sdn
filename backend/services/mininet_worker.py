#!/usr/bin/env python3
"""
Mininet Worker Daemon
Runs with elevated privileges (sudo) and manages the Mininet network object.
Communicates with FastAPI via a local Unix Domain Socket (/tmp/mininet_worker.sock).
"""

import argparse
import asyncio
import json
import logging
import os
import re
import signal
import subprocess
import sys
import threading
import time
from typing import Dict, Any, Optional

# Direct script execution uses system Python; package imports support tests.
if __package__:
    from .operation_error import OperationError, public_error, safe_message
else:
    from operation_error import OperationError, public_error, safe_message

# Mininet imports
try:
    from mininet.net import Mininet
    from mininet.node import RemoteController, OVSSwitch
    from mininet.link import TCLink
    from mininet.clean import cleanup
except ImportError:
    Mininet = None

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] (worker) %(message)s'
)
logger = logging.getLogger("mininet_worker")

SOCKET_PATH = "/tmp/mininet_worker.sock"

class MininetWorker:
    def __init__(self):
        self.net: Optional[Mininet] = None
        self.traffic_jobs: Dict[str, Dict[str, Any]] = {}
        self.traffic_lock = threading.Lock()
        self.running = True

    @staticmethod
    def _clean_simulation_resources():
        """Clean only simulation bridges and links without killing ryu-manager or other processes."""
        for sw in ['s1', 's2', 's3', 's4']:
            subprocess.run(["ovs-vsctl", "--if-exists", "del-br", sw], capture_output=True, check=True, timeout=5)

    def build_network(self, controller_ip="127.0.0.1", controller_port=6653):
        if Mininet is None:
            raise RuntimeError("Mininet library is not installed in current Python environment")

        if self.net is not None:
            self.stop_network()

        logger.info(f"Building diamond topology connecting to controller {controller_ip}:{controller_port}")
        self._clean_simulation_resources()

        net = Mininet(controller=None, switch=OVSSwitch, link=TCLink, autoSetMacs=True)
        net.addController('c0', controller=RemoteController, ip=controller_ip, port=controller_port)

        s1 = net.addSwitch('s1', protocols='OpenFlow13')
        s2 = net.addSwitch('s2', protocols='OpenFlow13')
        s3 = net.addSwitch('s3', protocols='OpenFlow13')
        s4 = net.addSwitch('s4', protocols='OpenFlow13')

        h1 = net.addHost('h1', ip='10.0.0.1/24')
        h2 = net.addHost('h2', ip='10.0.0.2/24')

        # Add physical links matching topo_diamond.py
        net.addLink(h1, s1)
        net.addLink(h2, s4)
        net.addLink(s1, s2, bw=10, delay='5ms')
        net.addLink(s2, s4, bw=10, delay='5ms')
        net.addLink(s1, s3, bw=10, delay='5ms')
        net.addLink(s3, s4, bw=10, delay='5ms')

        logger.info("Starting Mininet network...")
        net.start()
        self.net = net
        logger.info("Mininet network started successfully!")
        return {"status": "ok", "message": "Mininet network started"}

    def stop_network(self):
        logger.info("Stopping Mininet network...")
        with self.traffic_lock:
            for job_id, job in list(self.traffic_jobs.items()):
                self._stop_traffic_job(job_id)

        if self.net:
            try:
                self.net.stop()
            except Exception as e:
                logger.exception("Mininet stop failed")
                raise OperationError(502, "Mininet network stop failed; check worker logs") from e
            self.net = None

        self._clean_simulation_resources()
        logger.info("Mininet network stopped and cleaned up.")
        return {"status": "ok", "message": "Network stopped"}

    def get_topology(self) -> Dict[str, Any]:
        if not self.net:
            return {"status": "not_running", "nodes": [], "links": []}

        nodes = []
        for s in self.net.switches:
            dpid_int = int(s.dpid, 16) if isinstance(s.dpid, str) else int(s.dpid)
            ports = {}
            for intf_name, intf in s.intfs.items():
                ports[intf_name] = {
                    "port_no": s.ports.get(intf),
                    "up": intf.isUp(),
                    "ip": intf.IP(),
                    "mac": intf.MAC()
                }
            nodes.append({
                "id": s.name,
                "name": s.name,
                "type": "switch",
                "dpid": dpid_int,
                "ports": ports
            })

        for h in self.net.hosts:
            ports = {}
            for intf_name, intf in h.intfs.items():
                ports[intf_name] = {
                    "up": intf.isUp(),
                    "ip": intf.IP(),
                    "mac": intf.MAC()
                }
            nodes.append({
                "id": h.name,
                "name": h.name,
                "type": "host",
                "ip": h.IP(),
                "mac": h.MAC(),
                "ports": ports
            })

        links = []
        for l in self.net.links:
            intf1, intf2 = l.intf1, l.intf2
            node1, node2 = intf1.node.name, intf2.node.name
            is_up = intf1.isUp() and intf2.isUp()
            link_id = f"{node1}-{node2}" if node1 < node2 else f"{node2}-{node1}"
            
            # Port numbers if switch
            port1 = intf1.node.ports.get(intf1) if hasattr(intf1.node, 'ports') else None
            port2 = intf2.node.ports.get(intf2) if hasattr(intf2.node, 'ports') else None

            links.append({
                "id": link_id,
                "src": node1,
                "dst": node2,
                "src_intf": intf1.name,
                "dst_intf": intf2.name,
                "src_port": port1,
                "dst_port": port2,
                "status": "UP" if is_up else "DOWN",
                "bw": 10.0,
                "delay": "5ms"
            })

        return {
            "status": "ok",
            "switches": [s.name for s in self.net.switches],
            "hosts": [h.name for h in self.net.hosts],
            "nodes": nodes,
            "links": links
        }

    @staticmethod
    def _run_ovs(args):
        """Checked, bounded OVS commands; only called by the privileged worker."""
        try:
            return subprocess.run(
                args, capture_output=True, text=True, check=True, timeout=5
            ).stdout
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
            logger.exception("OVS command failed: %s", args)
            detail = safe_message(exc.stderr, "check worker logs")
            raise OperationError(502, f"Open vSwitch command failed during dataplane reset: {detail}") from exc

    def reset_dataplane(self) -> Dict[str, Any]:
        """Reset owned switches between Ryu processes without rebuilding Mininet.

        The manager must stop the old controller before this command and must
        not launch the new one until it succeeds. Drop old OpenFlow sessions
        before deleting rules on the separate management socket.
        """
        if not self.net:
            return {"status": "ok", "switches": [], "message": "No Mininet network"}

        switches = [sw.name for sw in self.net.switches]
        if not switches:
            raise OperationError(502, "Cannot reset dataplane: network has no switches")

        for name in switches:
            mode = self._run_ovs([
                "ovs-vsctl", "--timeout=3", "get-fail-mode", name
            ]).strip()
            if mode != "secure":
                raise OperationError(502, f"Cannot reset {name}: expected secure fail mode")
        for name in switches:
            # Drops old sessions without changing targets, Controller UUIDs,
            # Mininet's cached identifiers, or reconnect settings. Port 6653
            # is unoccupied until the manager starts the replacement Ryu.
            self._run_ovs([
                "ovs-appctl", "--timeout=3", "-t", "ovs-vswitchd", "bridge/reconnect", name
            ])
        for name in switches:
            # Remove references before removing their group definitions.
            for command in ("del-flows", "del-groups"):
                self._run_ovs([
                    "ovs-ofctl", "--timeout=3", "-O", "OpenFlow13", command, name
                ])
        for name in switches:
            flows = self._run_ovs([
                "ovs-ofctl", "--timeout=3", "-O", "OpenFlow13", "dump-flows", name
            ])
            groups = self._run_ovs([
                "ovs-ofctl", "--timeout=3", "-O", "OpenFlow13", "dump-groups", name
            ])
            if re.search(r"\bcookie=", flows) or re.search(r"\bgroup_id=", groups):
                raise OperationError(502, f"Dataplane reset verification failed on {name}")

        logger.info("Cleaned OpenFlow flows and groups on %s", ", ".join(switches))
        return {"status": "ok", "switches": switches}

    def set_link_status(self, node1: str, node2: str, status: str) -> Dict[str, Any]:
        if not self.net:
            raise OperationError(409, "Network is not running")
        if status not in ("up", "down"):
            raise OperationError(400, "Status must be up or down")
        links = [link for link in self.net.links
                 if {link.intf1.node.name, link.intf2.node.name} == {node1, node2}]
        if not links:
            raise OperationError(404, "Requested network link does not exist")
        try:
            self.net.configLinkStatus(node1, node2, status)
            for link in links:
                for intf in (link.intf1, link.intf2):
                    if isinstance(intf.node, OVSSwitch):
                        subprocess.run(["ip", "link", "set", intf.name, status],
                                       capture_output=True, check=True, timeout=5)
                    if bool(intf.isUp()) != (status == "up"):
                        raise RuntimeError("Interface state does not match requested state")
        except Exception as exc:
            logger.exception("Failed to set link %s to %s", (node1, node2), status)
            raise OperationError(502, "Link state change failed; both endpoints could not be confirmed") from exc
        return {"status": "ok", "node1": node1, "node2": node2,
                "link_status": status.upper(), "timestamp": time.time()}

    def pingall(self) -> Dict[str, Any]:
        if not self.net:
            raise OperationError(409, "Network is not running")
        
        loss = self.net.pingAll()
        return {"status": "ok", "loss_percent": loss}

    def start_traffic(self, src: str, dst: str, interval: float, count: int, job_id: str) -> Dict[str, Any]:
        if not self.net:
            raise OperationError(409, "Network is not running")

        if interval <= 0 or count <= 0:
            raise OperationError(400, "Traffic interval and packet count must be positive")
        hosts = {host.name: host for host in self.net.hosts}
        src_node = hosts.get(src)
        dst_node = hosts.get(dst)
        if not src_node or not dst_node:
            raise OperationError(404, "Source or destination host not found")

        dst_ip = dst_node.IP()
        with self.traffic_lock:
            # Stop existing job if any
            if job_id in self.traffic_jobs:
                self._stop_traffic_job(job_id)

            # Prime ARP / OpenFlow path discovery if needed
            src_node.cmd(f"ping -c 1 -W 1 {dst_ip}")

            cmd = ["stdbuf", "-oL", "-eL", "ping", "-i", str(interval), "-c", str(count), dst_ip]
            logger.info(f"Starting traffic job {job_id}: {' '.join(cmd)} on {src}")
            proc = src_node.popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)

            # Report process launch errors before claiming an active job.
            if proc.poll() is not None and proc.returncode not in (0, 1):
                raise OperationError(502, "Traffic process failed to start; check worker logs")

            job_data = {
                "job_id": job_id,
                "src": src,
                "dst": dst,
                "proc": proc,
                "active": True,
                "transmitted": 0,
                "received": 0,
                "loss_percent": 0.0,
                "min_rtt": None,
                "avg_rtt": None,
                "max_rtt": None,
                "last_rtt": None,
                "history": [],
                "start_time": time.time(),
                "duration_sec": 0.0
            }
            self.traffic_jobs[job_id] = job_data

            # Start thread to read output
            t = threading.Thread(target=self._monitor_traffic, args=(job_id, proc), daemon=True)
            t.start()

        return {"status": "ok", "job_id": job_id, "active": True}

    def _monitor_traffic(self, job_id: str, proc: subprocess.Popen):
        seq_pattern = re.compile(r"icmp_seq=(\d+)\s+ttl=\d+\s+time=([\d\.]+)\s*ms")
        stats_pattern = re.compile(r"(\d+)\s+packets transmitted,\s+(\d+)\s+(?:packets\s+)?received.*?([\d\.]+)%\s+packet loss")
        rtt_pattern = re.compile(r"rtt min/avg/max/mdev =\s+([\d\.]+)/([\d\.]+)/([\d\.]+)/([\d\.]+)\s*ms")

        expected_seq = 1
        for line in proc.stdout:
            line = line.strip()
            with self.traffic_lock:
                if job_id not in self.traffic_jobs:
                    break
                job = self.traffic_jobs[job_id]
                job["duration_sec"] = time.time() - job["start_time"]

                # Parse live ping responses
                m_seq = seq_pattern.search(line)
                if m_seq:
                    seq = int(m_seq.group(1))
                    rtt = float(m_seq.group(2))
                    job["transmitted"] = max(job["transmitted"], seq)
                    job["received"] += 1
                    job["last_rtt"] = rtt
                    job["loss_percent"] = max(0.0, round(((job["transmitted"] - job["received"]) / job["transmitted"]) * 100.0, 1))
                    job["history"].append({
                        "seq": seq,
                        "rtt": rtt,
                        "success": True,
                        "t": round(job["duration_sec"], 2)
                    })
                    if len(job["history"]) > 200:
                        job["history"].pop(0)

                # Parse final summary
                m_stats = stats_pattern.search(line)
                if m_stats:
                    job["transmitted"] = int(m_stats.group(1))
                    job["received"] = int(m_stats.group(2))
                    job["loss_percent"] = float(m_stats.group(3))

                m_rtt = rtt_pattern.search(line)
                if m_rtt:
                    job["min_rtt"] = float(m_rtt.group(1))
                    job["avg_rtt"] = float(m_rtt.group(2))
                    job["max_rtt"] = float(m_rtt.group(3))

        proc.wait()
        with self.traffic_lock:
            if job_id in self.traffic_jobs:
                self.traffic_jobs[job_id]["active"] = False

    def stop_traffic(self, job_id: str) -> Dict[str, Any]:
        with self.traffic_lock:
            return self._stop_traffic_job(job_id)

    def _stop_traffic_job(self, job_id: str) -> Dict[str, Any]:
        if job_id not in self.traffic_jobs:
            return {"status": "not_found", "job_id": job_id}
        job = self.traffic_jobs[job_id]
        proc = job.get("proc")
        if proc and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=1.0)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=1.0)
        job["active"] = False
        return {"status": "ok", "job_id": job_id, "active": False}

    def get_traffic_stats(self, job_id: str) -> Dict[str, Any]:
        with self.traffic_lock:
            if job_id not in self.traffic_jobs:
                return {"status": "not_found", "active": False}
            job = self.traffic_jobs[job_id]
            res = {k: v for k, v in job.items() if k != "proc"}
            return res

    def get_switch_info(self, dpid: int) -> Dict[str, Any]:
        if not self.net:
            raise OperationError(409, "Network is not running")
        sw_name = f"s{dpid}"
        if sw_name not in {sw.name for sw in self.net.switches}:
            raise OperationError(404, "Requested switch does not exist")
        flows_out = subprocess.run(
            ["ovs-ofctl", "-O", "OpenFlow13", "dump-flows", sw_name],
            capture_output=True, text=True, check=True, timeout=5
        ).stdout
        groups_out = subprocess.run(
            ["ovs-ofctl", "-O", "OpenFlow13", "dump-groups", sw_name],
            capture_output=True, text=True, check=True, timeout=5
        ).stdout
        ports_out = subprocess.run(
            ["ovs-ofctl", "-O", "OpenFlow13", "dump-ports", sw_name],
            capture_output=True, text=True, check=True, timeout=5
        ).stdout

        return {
            "dpid": dpid,
            "switch": sw_name,
            "flows": flows_out.strip().split("\n") if flows_out else [],
            "groups": groups_out.strip().split("\n") if groups_out else [],
            "ports": ports_out.strip().split("\n") if ports_out else []
        }

    async def handle_client(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        while self.running:
            line = await reader.readline()
            if not line:
                break
            try:
                req = json.loads(line.decode("utf-8"))
                if not isinstance(req, dict):
                    raise OperationError(400, "Worker request must be a JSON object")
                cmd = req.get("command")
                resp = {}
                if cmd == "start":
                    resp = self.build_network(
                        req.get("controller_ip", "127.0.0.1"),
                        req.get("controller_port", 6653)
                    )
                elif cmd == "stop":
                    resp = self.stop_network()
                elif cmd == "get_topology":
                    resp = self.get_topology()
                elif cmd == "reset_dataplane":
                    resp = self.reset_dataplane()
                elif cmd == "set_link_status":
                    resp = self.set_link_status(req["node1"], req["node2"], req["status"])
                elif cmd == "pingall":
                    resp = self.pingall()
                elif cmd == "start_traffic":
                    resp = self.start_traffic(
                        req["src"], req["dst"], req.get("interval", 0.1),
                        req.get("count", 100), req["job_id"]
                    )
                elif cmd == "stop_traffic":
                    resp = self.stop_traffic(req["job_id"])
                elif cmd == "get_traffic_stats":
                    resp = self.get_traffic_stats(req["job_id"])
                elif cmd == "get_switch_info":
                    resp = self.get_switch_info(int(req["dpid"]))
                elif cmd == "ping":
                    resp = {"status": "pong", "time": time.time()}
                else:
                    raise OperationError(400, "Unknown worker command")

                writer.write(json.dumps(resp).encode("utf-8") + b"\n")
                await writer.drain()
            except Exception as e:
                logger.error(f"Error handling request: {e}")
                code = "runtime_failure"
                if isinstance(e, OperationError):
                    code = {400: "invalid_request", 404: "not_found", 409: "not_running"}.get(e.status_code, code)
                elif isinstance(e, (KeyError, TypeError, ValueError, UnicodeError)):
                    e = OperationError(400, "Invalid worker request")
                    code = "invalid_request"
                err_resp = {"status": "error", "error_code": code, "message": public_error(e)}
                writer.write(json.dumps(err_resp).encode("utf-8") + b"\n")
                await writer.drain()

        writer.close()
        await writer.wait_closed()


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--socket", default=SOCKET_PATH, help="Unix domain socket path")
    args = parser.parse_args()

    sock_path = args.socket
    if os.path.exists(sock_path):
        os.remove(sock_path)

    worker = MininetWorker()
    server = await asyncio.start_unix_server(worker.handle_client, path=sock_path)
    
    # Make socket readable/writable by non-root processes (e.g. FastAPI)
    os.chmod(sock_path, 0o666)
    logger.info(f"Mininet worker server listening on Unix socket: {sock_path}")

    loop = asyncio.get_running_loop()
    stop_event = asyncio.Event()

    def _sig_handler():
        logger.info("Received termination signal, shutting down...")
        worker.stop_network()
        stop_event.set()

    for s in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(s, _sig_handler)

    try:
        await stop_event.wait()
    finally:
        server.close()
        await server.wait_closed()
        if os.path.exists(sock_path):
            os.remove(sock_path)
        logger.info("Mininet worker server terminated cleanly.")

if __name__ == "__main__":
    asyncio.run(main())
