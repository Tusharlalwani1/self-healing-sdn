#!/usr/bin/env bash

echo "Stopping Self-Healing SDN Control Center..."

# Kill backend
pkill -f "uvicorn.*backend.main:app" 2>/dev/null || true

# Kill mininet worker
sudo pkill -f "mininet_worker.py" 2>/dev/null || true

# Kill ryu-manager
pkill -f "ryu-manager" 2>/dev/null || true

# Clean Mininet
sudo mn -c > /dev/null 2>&1 || true

# Remove socket
rm -f /tmp/mininet_worker.sock

echo "All SDN dashboard processes stopped cleanly."
