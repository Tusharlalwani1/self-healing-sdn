import os
from pathlib import Path

# Paths
BASE_DIR = Path(__file__).resolve().parent.parent
BACKEND_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
LOGS_DIR = BASE_DIR / "logs"
REPORTS_DIR = BASE_DIR / "reports"
FRONTEND_DIST = BASE_DIR / "frontend" / "dist"

DATA_DIR.mkdir(parents=True, exist_ok=True)
LOGS_DIR.mkdir(parents=True, exist_ok=True)
REPORTS_DIR.mkdir(parents=True, exist_ok=True)

# Database
DB_PATH = DATA_DIR / "sdn_dashboard.db"

# OpenFlow / Controller
CONTROLLER_IP = "127.0.0.1"
CONTROLLER_PORT = 6653
RYU_APPS = {
    "baseline": BASE_DIR / "controller_baseline.py",
    "reactive": BASE_DIR / "controller_reactive.py",
    "fast_failover": BASE_DIR / "controller_ff.py"
}

# Mininet Worker IPC
MININET_SOCKET_PATH = "/tmp/mininet_worker.sock"

# Host & API configuration
HOST = os.getenv("SDN_HOST", "0.0.0.0")
PORT = int(os.getenv("SDN_PORT", 8000))
WSL_DISTRO = os.getenv("WSL_DISTRO", "Ubuntu-22.04")
VENV_PYTHON = BASE_DIR / "sdn-env" / "bin" / "python3"
