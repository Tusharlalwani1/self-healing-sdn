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


class FastFailoverController(app_manager.RyuApp):
    OFP_VERSIONS = [ofproto_v1_3.OFP_VERSION]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.graph = nx.Graph()
        self.datapaths = {}
        self.switch_ports = {}
        self.link_ports = {}
        self.isl_ports = set()
        self.hosts = {}          # mac -> (dpid, port)
        self.gid = {}            # mac -> group id
        self.groups = set()      # (dpid, gid) already created
        self.next_hop_port = {}  # (dpid, mac) -> primary output port

    # ---------- switch setup ----------
    @set_ev_cls(ofp_event.EventOFPSwitchFeatures, CONFIG_DISPATCHER)
    def switch_features(self, ev):
        dp = ev.msg.datapath
        ofp, parser = dp.ofproto, dp.ofproto_parser
        self.datapaths[dp.id] = dp
        match = parser.OFPMatch()
        actions = [parser.OFPActionOutput(ofp.OFPP_CONTROLLER,
                                          ofp.OFPCML_NO_BUFFER)]
        self._add_flow(dp, 0, match, actions)

    def _add_flow(self, dp, priority, match, actions):
        ofp, parser = dp.ofproto, dp.ofproto_parser
        inst = [parser.OFPInstructionActions(ofp.OFPIT_APPLY_ACTIONS, actions)]
        dp.send_msg(parser.OFPFlowMod(datapath=dp, priority=priority,
                                      match=match, instructions=inst))

    def _set_group(self, dp, gid, ports):
        """Fast-failover group: first bucket whose watch_port is up wins."""
        ofp, parser = dp.ofproto, dp.ofproto_parser
        buckets = [parser.OFPBucket(watch_port=p, watch_group=ofp.OFPG_ANY,
                                    actions=[parser.OFPActionOutput(p)])
                   for p in ports]
        cmd = (ofp.OFPGC_MODIFY if (dp.id, gid) in self.groups
               else ofp.OFPGC_ADD)
        dp.send_msg(parser.OFPGroupMod(dp, cmd, ofp.OFPGT_FF, gid, buckets))
        self.groups.add((dp.id, gid))

    # ---------- topology ----------
    @set_ev_cls([event.EventSwitchEnter, event.EventSwitchLeave,
                 event.EventLinkAdd])
    def topology_change(self, ev):
        self._rebuild()
        self._install_all_routes()

    @set_ev_cls(event.EventLinkDelete)
    def link_delete(self, ev):
        t0 = time.time()
        a, b = ev.link.src.dpid, ev.link.dst.dpid
        self.logger.warning("LINK DOWN s%s <-> s%s at t=%.3f", a, b, t0)
        self._rebuild()
        self._install_all_routes()
        self.logger.warning("ROUTES RECOMPUTED in %.1f ms (switches had "
                            "already failed over locally)",
                            (time.time() - t0) * 1000)

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

    # ---------- routing with backup ports ----------
    def _install_all_routes(self):
        for mac in list(self.hosts):
            self._install_routes(mac)

    def _install_routes(self, mac):
        dst_dpid, dst_port = self.hosts[mac]
        if dst_dpid not in self.graph:
            return
        gid = self.gid.setdefault(mac, len(self.gid) + 1)
        dist = nx.single_source_shortest_path_length(self.graph, dst_dpid)
        summary = {}
        for dpid, dp in self.datapaths.items():
            if dpid not in dist:
                continue
            parser = dp.ofproto_parser
            if dpid == dst_dpid:
                actions = [parser.OFPActionOutput(dst_port)]
                self.next_hop_port[(dpid, mac)] = dst_port
                summary["s%s" % dpid] = [dst_port]
            else:
                # neighbours strictly closer to the destination = loop-free
                cands = sorted((n for n in self.graph.neighbors(dpid)
                                if n in dist and dist[n] < dist[dpid]),
                               key=lambda n: (dist[n], n))
                ports = [self.link_ports[(dpid, n)] for n in cands
                         if (dpid, n) in self.link_ports]
                if not ports:
                    continue
                self._set_group(dp, gid, ports)
                actions = [parser.OFPActionGroup(gid)]
                self.next_hop_port[(dpid, mac)] = ports[0]
                summary["s%s" % dpid] = ports
            self._add_flow(dp, 10, parser.OFPMatch(eth_dst=mac), actions)
        self.logger.info("Routes to %s (ports, primary first): %s",
                         mac, summary)

    # ---------- packet handling ----------
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

        self._install_routes(eth.dst)
        if eth.src in self.hosts:
            self._install_routes(eth.src)

        out = self.next_hop_port.get((dpid, eth.dst))
        if out is None:
            return
        parser, ofp = dp.ofproto_parser, dp.ofproto
        dp.send_msg(parser.OFPPacketOut(
            datapath=dp, buffer_id=ofp.OFP_NO_BUFFER, in_port=in_port,
            actions=[parser.OFPActionOutput(out)], data=msg.data))

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
