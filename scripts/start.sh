#!/usr/bin/env bash
set -e

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$BASE_DIR"

echo "=========================================================="
echo "  Self-Healing SDN Control Center — Starting Backend Server "
echo "=========================================================="

# 1. Ensure Open vSwitch is running
sudo service openvswitch-switch start > /dev/null 2>&1 || true

# 2. Cleanup stale Mininet artifacts if any
sudo mn -c > /dev/null 2>&1 || true

# 3. Activate Python virtual environment
source "$BASE_DIR/sdn-env/bin/activate"

# 4. Export PYTHONPATH so backend package is resolved
export PYTHONPATH="$BASE_DIR"

# 5. Start Uvicorn / FastAPI server
echo "Starting FastAPI server on http://0.0.0.0:8000..."
exec "$BASE_DIR/sdn-env/bin/uvicorn" backend.main:app --host 0.0.0.0 --port 8000 --reload
