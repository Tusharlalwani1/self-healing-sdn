#!/usr/bin/env bash
set -e

echo "=========================================================="
echo "  Self-Healing SDN Control Center — Setup & Verification  "
echo "=========================================================="

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$BASE_DIR"

echo "[1/5] Checking Open vSwitch (OVS)..."
if ! command -v ovs-vsctl &> /dev/null; then
    echo "Installing openvswitch-switch..."
    sudo apt-get update && sudo apt-get install -y openvswitch-switch
fi
sudo service openvswitch-switch start
echo "  ✓ Open vSwitch service is active."

echo "[2/5] Checking Mininet..."
if ! command -v mn &> /dev/null; then
    echo "Installing Mininet..."
    sudo apt-get update && sudo apt-get install -y mininet
fi
echo "  ✓ Mininet is installed ($(which mn))."

echo "[3/5] Checking Python 3.10 & sdn-env..."
if [ ! -d "$BASE_DIR/sdn-env" ]; then
    echo "Creating Python 3.10 virtual environment..."
    python3.10 -m venv "$BASE_DIR/sdn-env"
fi
source "$BASE_DIR/sdn-env/bin/activate"
echo "  ✓ Virtual environment active: $(python3 --version)"

echo "[4/5] Verifying Python dependencies..."
pip install --upgrade pip setuptools wheel
pip install ryu networkx fastapi "uvicorn[standard]" websockets pydantic psutil

echo "[5/5] Checking passwordless sudo permissions..."
if ! sudo -n true 2>/dev/null; then
    echo "Configuring passwordless sudo for SDN operations..."
    echo "$USER ALL=(ALL) NOPASSWD: ALL" | sudo tee /etc/sudoers.d/sdn-dashboard > /dev/null
    sudo chmod 0440 /etc/sudoers.d/sdn-dashboard
fi
echo "  ✓ Passwordless sudo verified."

echo "Cleaning previous Mininet state..."
sudo mn -c 2>/dev/null || true

echo "=========================================================="
echo "  ✓ Environment setup complete! Ready to start dashboard. "
echo "=========================================================="
