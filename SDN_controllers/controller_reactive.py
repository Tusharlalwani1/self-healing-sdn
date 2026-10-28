import time

import networkx as nx
from ryu.base import app_manager
from ryu.controller import ofp_event
from ryu.controller.handler import CONFIG_DISPATCHER, MAIN_DISPATCHER, set_ev_cls
from ryu.ofproto import ofproto_v1_3
from ryu.lib.packet import packet, ethernet, ether_types
from ryu.topology import event
from ryu.topology.api import get_switch, get_link

BROADCAST = 'ff:ff:ff:ff:ff:ff'
PORT_MAX = 0xffffff00


class ReactiveController(app_manager.RyuApp):
    OFP_VERSIONS = [ofproto_v1_3.OFP_VERSION]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.graph = nx.Graph()
        self.datapaths = {}
        self.switch_ports = {}
        self.link_ports = {}
        self.isl_ports = set()
        self.hosts = {}
        self.installed = {}   # dst_mac -> list of installed paths

    @set_ev_cls(ofp_event.EventOFPSwitchFeatures, CONFIG_DISPATCHER)
    def switch_features(self, ev):
        dp = ev.msg.datapath
        ofp, parser = dp.ofproto, dp.ofproto_parser
        self.datapaths[dp.id] = dp
        match = parser.OFPMatch()
        actions = [parser.OFPActionOutput(ofp.OFPP_CONTROLLER,
                                          ofp.OFPCML_NO_BUFFER)]
        self._add_flow(dp, 0, match, actions)

    def _add_flow(self, dp, priority, match, actions, idle=0):
        ofp, parser = dp.ofproto, dp.ofproto_parser
        inst = [parser.OFPInstructionActions(ofp.OFPIT_APPLY_ACTIONS, actions)]
        dp.send_msg(parser.OFPFlowMod(datapath=dp, priority=priority,
                                      match=match, instructions=inst,
                                      idle_timeout=idle))

    # ---------- topology ----------
    @set_ev_cls([event.EventSwitchEnter, event.EventSwitchLeave,
                 event.EventLinkAdd])
    def topology_change(self, ev):
        self._rebuild()

    @set_ev_cls(event.EventLinkDelete)
    def link_delete(self, ev):
        t0 = time.time()
        a, b = ev.link.src.dpid, ev.link.dst.dpid
        self.logger.warning("LINK DOWN s%s <-> s%s at t=%.3f", a, b, t0)
        self._rebuild()
        self._heal(a, b, t0)

    def _rebuild(self):
        self.graph.clear()
        self.link_ports.clear()
        self.isl_ports.clear()
        for sw in get_switch(self, None):
            self.graph.add_node(sw.dp.id)
            self.switch_ports[sw.dp.id] = [p.port_no for p in sw.ports
                                           if p.port_no < PORT_MAX]
        for l in get_link(self, None):
            self.graph.add_edge(l.src.dpid, l.dst.dpid)
            self.link_ports[(l.src.dpid, l.dst.dpid)] = l.src.port_no
            self.isl_ports.add((l.src.dpid, l.src.port_no))
            self.isl_ports.add((l.dst.dpid, l.dst.port_no))
        self.logger.info("Topology: switches=%s links=%s",
                         sorted(self.graph.nodes), sorted(self.graph.edges))

    # ---------- self-healing ----------
    @staticmethod
    def _uses_link(path, a, b):
        return any({path[i], path[i + 1]} == {a, b}
                   for i in range(len(path) - 1))

    def _heal(self, a, b, t0):
        for dst_mac, paths in list(self.installed.items()):
            broken = [p for p in paths if self._uses_link(p, a, b)]
            if not broken:
                continue
            self.installed[dst_mac] = [p for p in paths if p not in broken]
            for old in broken:
                self._delete_path_flows(old, dst_mac)
                dst_port = self.hosts[dst_mac][1]
                try:
                    new = nx.shortest_path(self.graph, old[0], old[-1])
                except (nx.NetworkXNoPath, nx.NodeNotFound):
                    self.logger.error("No alternative path for %s", dst_mac)
                    continue
                self._install_path(new, dst_mac, dst_port)
                self.logger.warning(
                    "HEALED dst=%s old=%s new=%s in %.1f ms", dst_mac,
                    ["s%s" % d for d in old], ["s%s" % d for d in new],
                    (time.time() - t0) * 1000)

    def _delete_path_flows(self, path, dst_mac):
        for dpid in path:
            dp = self.datapaths.get(dpid)
            if dp is None:
                continue
            ofp, parser = dp.ofproto, dp.ofproto_parser
            dp.send_msg(parser.OFPFlowMod(
                datapath=dp, command=ofp.OFPFC_DELETE,
                out_port=ofp.OFPP_ANY, out_group=ofp.OFPG_ANY,
                match=parser.OFPMatch(eth_dst=dst_mac)))

    # ---------- forwarding ----------
    @set_ev_cls(ofp_event.EventOFPPacketIn, MAIN_DISPATCHER)
    def packet_in(self, ev):
        msg = ev.msg
        dp = msg.datapath
        dpid = dp.id
        in_port = msg.match['in_port']

        pkt = packet.Packet(msg.data)
        eth = pkt.get_protocol(ethernet.ethernet)
        if eth is None or eth.ethertype in (ether_types.ETH_TYPE_LLDP,
                                            ether_types.ETH_TYPE_IPV6):
            return

        if (dpid, in_port) not in self.isl_ports:
            self.hosts[eth.src] = (dpid, in_port)

        if eth.dst == BROADCAST or eth.dst not in self.hosts:
            self._flood_edge_ports(msg, dpid, in_port)
            return

        dst_dpid, dst_port = self.hosts[eth.dst]
        try:
            path = nx.shortest_path(self.graph, dpid, dst_dpid)
        except (nx.NetworkXNoPath, nx.NodeNotFound):
            self.logger.warning("No path s%s -> s%s", dpid, dst_dpid)
            return

        self.logger.info("Path for %s -> %s: %s", eth.src, eth.dst,
                         ["s%s" % d for d in path])
        first_out = self._install_path(path, eth.dst, dst_port)

        parser, ofp = dp.ofproto_parser, dp.ofproto
        dp.send_msg(parser.OFPPacketOut(
            datapath=dp, buffer_id=ofp.OFP_NO_BUFFER, in_port=in_port,
            actions=[parser.OFPActionOutput(first_out)], data=msg.data))

    def _install_path(self, path, dst_mac, last_port):
        first_out = None
        for i, dpid in enumerate(path):
            if i < len(path) - 1:
                out = self.link_ports[(dpid, path[i + 1])]
            else:
                out = last_port
            if i == 0:
                first_out = out
            dp = self.datapaths[dpid]
            match = dp.ofproto_parser.OFPMatch(eth_dst=dst_mac)
            actions = [dp.ofproto_parser.OFPActionOutput(out)]
            self._add_flow(dp, 10, match, actions, idle=30)
        paths = self.installed.setdefault(dst_mac, [])
        if path not in paths:
            paths.append(path)
        return first_out

    def _flood_edge_ports(self, msg, src_dpid, in_port):
        for dpid, dp in self.datapaths.items():
            parser, ofp = dp.ofproto_parser, dp.ofproto
            actions = [parser.OFPActionOutput(p)
                       for p in self.switch_ports.get(dpid, [])
                       if (dpid, p) not in self.isl_ports
                       and not (dpid == src_dpid and p == in_port)]
            if actions:
                dp.send_msg(parser.OFPPacketOut(
                    datapath=dp, buffer_id=ofp.OFP_NO_BUFFER,
                    in_port=ofp.OFPP_CONTROLLER, actions=actions,
                    data=msg.data))
