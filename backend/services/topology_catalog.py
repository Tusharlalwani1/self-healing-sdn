"""Deterministic configuration, not discovered/live network state.

Pure Python so the privileged system-Python worker and CLI can share it without
importing FastAPI, Ryu, or Mininet until a network is actually constructed.
"""

TOPOLOGIES = {
    "diamond": {
        "id": "diamond", "label": "Diamond — Basic",
        "switches": tuple("s%d" % n for n in range(1, 5)),
        "inter_switch_links": (("s1", "s2"), ("s2", "s4"), ("s1", "s3"), ("s3", "s4")),
        "host_links": (("h1", "s1"), ("h2", "s4")),
    },
    "multipath_mesh": {
        "id": "multipath_mesh", "label": "Multi-Path Mesh — Advanced",
        "switches": tuple("s%d" % n for n in range(1, 10)),
        "inter_switch_links": (
            ("s1", "s2"), ("s1", "s3"), ("s1", "s4"),
            ("s2", "s3"), ("s2", "s5"), ("s3", "s4"), ("s3", "s6"),
            ("s4", "s7"), ("s5", "s6"), ("s5", "s9"),
            ("s6", "s7"), ("s6", "s9"), ("s7", "s8"), ("s8", "s9"),
        ),
        "host_links": (("h1", "s1"), ("h2", "s9")),
    },
}
HOSTS = (("h1", "10.0.0.1/24"), ("h2", "10.0.0.2/24"))


def topology_definition(topology_id):
    if topology_id not in TOPOLOGIES:
        raise ValueError("Unknown topology: choose diamond or multipath_mesh")
    return TOPOLOGIES[topology_id]


def topology_options():
    return [{**definition, "switch_count": len(definition["switches"]),
             "host_count": len(HOSTS)} for definition in TOPOLOGIES.values()]


def populate_network(net, topology_id):
    definition = topology_definition(topology_id)
    switches = {name: net.addSwitch(name, protocols="OpenFlow13") for name in definition["switches"]}
    hosts = {name: net.addHost(name, ip=ip) for name, ip in HOSTS}
    # Host links precede ISLs to preserve existing Diamond port numbers.
    for host, switch in definition["host_links"]:
        net.addLink(hosts[host], switches[switch])
    for src, dst in definition["inter_switch_links"]:
        net.addLink(switches[src], switches[dst], bw=10, delay="5ms")
    return definition
