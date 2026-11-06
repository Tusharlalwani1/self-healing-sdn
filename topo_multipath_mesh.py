#!/usr/bin/env python3
"""Interactive mesh CLI; dashboard startup uses the shared privileged worker."""
from mininet.net import Mininet
from mininet.node import RemoteController, OVSSwitch
from mininet.link import TCLink
from mininet.cli import CLI
from mininet.log import setLogLevel
from backend.services.topology_catalog import populate_network


def build():
    net = Mininet(controller=None, switch=OVSSwitch, link=TCLink, autoSetMacs=True)
    net.addController("c0", controller=RemoteController, ip="127.0.0.1", port=6653)
    populate_network(net, "multipath_mesh")
    try:
        net.start()
        CLI(net)
    finally:
        net.stop()


if __name__ == "__main__":
    setLogLevel("info")
    build()
