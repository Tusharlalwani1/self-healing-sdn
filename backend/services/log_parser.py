import re
import time
from typing import Dict, Any, Optional

class RyuLogParser:
    """Robust regex-based parser for Ryu controller outputs."""

    # Matches: Topology: switches=[1, 2, 3, 4] links=[(1, 2), (1, 3), (2, 4), (3, 4)]
    TOPOLOGY_PATTERN = re.compile(r"Topology:\s*switches=\[(?P<switches>[^\]]*)\]\s*links=\[(?P<links>[^\]]*)\]")
    
    # Matches: Path for 00:00:00:00:00:01 -> 00:00:00:00:00:02: ['s1', 's2', 's4']
    PATH_PATTERN = re.compile(r"Path for\s+(?P<src>[0-9a-fA-F:]+)\s*->\s*(?P<dst>[0-9a-fA-F:]+):\s*\[(?P<path>[^\]]+)\]")
    
    # Matches: Routes to 00:00:00:00:00:02 (ports, primary first): {'s1': [2, 3], 's2': [2], ...}
    ROUTES_PATTERN = re.compile(r"Routes to\s+(?P<dst>[0-9a-fA-F:]+)\s*\(ports, primary first\):\s*(?P<routes>\{.*\})")
    
    # Matches: LINK DOWN s1 <-> s2 at t=1791868163.020
    LINK_DOWN_PATTERN = re.compile(r"LINK DOWN\s+(?P<src>s\w+)\s*<->\s*(?P<dst>s\w+)(?:\s*at t=(?P<time>[\d\.]+))?(?:\s*\((?P<note>[^\)]+)\))?")
    
    # Matches: HEALED dst=00:00:00:00:00:02 old=['s1', 's2', 's4'] new=['s1', 's3', 's4'] in 15.2 ms
    HEALED_PATTERN = re.compile(r"HEALED\s+dst=(?P<dst>[0-9a-fA-F:]+)\s+old=\[(?P<old>[^\]]+)\]\s+new=\[(?P<new>[^\]]+)\]\s+in\s+(?P<duration>[\d\.]+)\s*ms")
    
    # Matches: ROUTES RECOMPUTED in 3.4 ms (switches had already failed over locally)
    ROUTES_RECOMPUTED_PATTERN = re.compile(r"ROUTES RECOMPUTED in\s+(?P<duration>[\d\.]+)\s*ms")

    @classmethod
    def parse_line(cls, line: str) -> Optional[Dict[str, Any]]:
        line = line.strip()
        if not line:
            return None

        # Check HEALED (Reactive Controller)
        m = cls.HEALED_PATTERN.search(line)
        if m:
            old_path = [s.strip(" '\"") for s in m.group("old").split(",")]
            new_path = [s.strip(" '\"") for s in m.group("new").split(",")]
            return {
                "type": "HEALED",
                "dst": m.group("dst"),
                "old_path": old_path,
                "new_path": new_path,
                "duration_ms": float(m.group("duration")),
                "raw": line
            }

        # Check ROUTES RECOMPUTED (Fast Failover Controller)
        m = cls.ROUTES_RECOMPUTED_PATTERN.search(line)
        if m:
            return {
                "type": "ROUTE_RECOMPUTED",
                "duration_ms": float(m.group("duration")),
                "note": "Switches had already failed over locally via OpenFlow FF group table",
                "raw": line
            }

        # Check LINK DOWN
        m = cls.LINK_DOWN_PATTERN.search(line)
        if m:
            return {
                "type": "LINK_DOWN",
                "src": m.group("src"),
                "dst": m.group("dst"),
                "timestamp": float(m.group("time")) if m.group("time") else time.time(),
                "note": m.group("note") or "",
                "raw": line
            }

        # Check ACTIVE PATH
        m = cls.PATH_PATTERN.search(line)
        if m:
            path = [s.strip(" '\"") for s in m.group("path").split(",")]
            return {
                "type": "ACTIVE_PATH",
                "src": m.group("src"),
                "dst": m.group("dst"),
                "path": path,
                "raw": line
            }

        # Check ROUTES TABLE
        m = cls.ROUTES_PATTERN.search(line)
        if m:
            return {
                "type": "ROUTES_SUMMARY",
                "dst": m.group("dst"),
                "raw_routes": m.group("routes"),
                "raw": line
            }

        # Check TOPOLOGY
        m = cls.TOPOLOGY_PATTERN.search(line)
        if m:
            sw_str = m.group("switches").strip()
            switches = [int(s.strip()) for s in sw_str.split(",") if s.strip()] if sw_str else []
            return {
                "type": "TOPOLOGY_DISCOVERY",
                "switches": switches,
                "raw": line
            }

        return None
