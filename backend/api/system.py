import os
import platform
import shutil
import socket
import subprocess
import time
from fastapi import APIRouter
from backend.config import CONTROLLER_PORT, CONTROLLER_IP, VENV_PYTHON

router = APIRouter(prefix="/api/system", tags=["System"])

@router.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "time": time.time(),
        "platform": platform.platform()
    }

@router.get("/status")
async def system_status():
    # Check OVS
    ovs_running = False
    try:
        cmd = ["sudo", "ovs-vsctl", "show"] if shutil.which("sudo") else ["ovs-vsctl", "show"]
        res = subprocess.run(cmd, capture_output=True, timeout=2, check=False)
        ovs_running = res.returncode == 0
    except Exception:
        pass

    # Check Mininet
    mn_installed = shutil.which("mn") is not None

    # Check Controller port
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        port_open = s.connect_ex((CONTROLLER_IP, CONTROLLER_PORT)) == 0

    return {
        "os": platform.system(),
        "python_version": platform.python_version(),
        "venv_python": str(VENV_PYTHON),
        "mininet_available": mn_installed,
        "ovs_service_running": ovs_running,
        "openflow_port_active": port_open,
        "controller_port": CONTROLLER_PORT
    }
