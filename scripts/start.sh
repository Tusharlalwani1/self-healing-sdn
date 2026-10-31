#!/usr/bin/env bash
set -e

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$BASE_DIR"

echo "=========================================================="
echo "  Self-Healing SDN Control Center — Starting Backend Server"
echo "=========================================================="

# 1. Ensure Open vSwitch is running
sudo service openvswitch-switch start > /dev/null 2>&1 || true

# 2. Cleanup stale Mininet artifacts BEFORE any Ryu controller starts
sudo mn -c > /dev/null 2>&1 || true

# 3. Locate the SDN Python virtual environment
SDN_VENV="${SDN_VENV:-$HOME/sdn-env}"

if [ ! -f "$SDN_VENV/bin/activate" ]; then
    echo "ERROR: SDN virtual environment not found at:"
    echo "  $SDN_VENV"
    exit 1
fi

# 4. Activate virtual environment
source "$SDN_VENV/bin/activate"

# Tell the backend exactly which Python environment to use
export SDN_VENV_PYTHON="$SDN_VENV/bin/python3"

# 5. Export PYTHONPATH so backend package is resolved
export PYTHONPATH="$BASE_DIR"

# 6. Verify Uvicorn exists
if [ ! -x "$SDN_VENV/bin/uvicorn" ]; then
    echo "ERROR: uvicorn not found at:"
    echo "  $SDN_VENV/bin/uvicorn"
    exit 1
fi

# 7. Start FastAPI
echo "Using SDN environment: $SDN_VENV"
echo "Starting FastAPI server on http://0.0.0.0:8000..."

exec "$SDN_VENV/bin/uvicorn" \
    backend.main:app \
    --host 0.0.0.0 \
    --port 8000