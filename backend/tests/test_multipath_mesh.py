"""Phase 2: real catalog/controller algorithms, fake Mininet/OVS/process IO.

These tests never contact or clean the live network and never use the user DB.
"""
import asyncio
import json
import time
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import networkx as nx
from fastapi import FastAPI
from backend.services.topology_catalog import TOPOLOGIES, HOSTS, populate_network, topology_definition
from backend.services import mininet_worker as mw, mininet_client as mc
from backend.services.operation_error import OperationError
from backend.api import simulation, topology, controllers, experiments
from backend.services import experiment_runner as er
from backend.services.runtime_control import runtime_transition_lock
from backend.tests.test_runtime_errors import request


class ConstructionNet:
    def __init__(self, **kwargs):
        self.switches = []
        self.hosts = []
        self.links = []
        self.start = Mock()
        self.stop = Mock()
        self.addController = Mock()

    def addSwitch(self, name, **kwargs):
        switch = SimpleNamespace(name=name, protocols=kwargs['protocols'])
        self.switches.append(switch)
        return switch

    def addHost(self, name, **kwargs):
        host = SimpleNamespace(name=name, ip=kwargs['ip'])
        self.hosts.append(host)
        return host

    def addLink(self, src, dst, **kwargs):
        self.links.append((src.name, dst.name, kwargs))


class DefinitionTests(unittest.TestCase):
    def setUp(self):
        self.addCleanup(patch.stopall)
        for name in ('OVSSwitch','RemoteController','TCLink'):
            patch.object(mw,name,object,create=True).start()

    def test_exact_mesh_and_multiple_remaining_paths(self):
        net = ConstructionNet()
        definition = populate_network(net, 'multipath_mesh')
        self.assertEqual([s.name for s in net.switches], ['s%d' % n for n in range(1, 10)])
        self.assertTrue(all(s.protocols == 'OpenFlow13' for s in net.switches))
        self.assertEqual([(h.name, h.ip) for h in net.hosts], list(HOSTS))
        expected = {(1,2),(1,3),(1,4),(2,3),(2,5),(3,4),(3,6),(4,7),(5,6),(5,9),(6,7),(6,9),(7,8),(8,9)}
        actual = {tuple(int(name[1:]) for name in pair) for pair in definition['inter_switch_links']}
        self.assertEqual(actual, expected)
        self.assertEqual(len(actual), 14)
        self.assertEqual(net.links[:2], [('h1','s1',{}),('h2','s9',{})])
        self.assertTrue(all(options == {'bw':10, 'delay':'5ms'} for _,_,options in net.links[2:]))
        graph = nx.Graph(actual)
        graph.remove_edge(1,2)
        self.assertGreater(len(list(nx.all_simple_paths(graph,1,9))),1)

    def test_diamond_port_order_is_preserved(self):
        net = ConstructionNet()
        populate_network(net, 'diamond')
        self.assertEqual([(a,b) for a,b,_ in net.links], [('h1','s1'),('h2','s4'),('s1','s2'),('s2','s4'),('s1','s3'),('s3','s4')])
        self.assertEqual(len(net.switches),4)

    def test_unknown_definition_does_not_construct_any_nodes(self):
        net = ConstructionNet()
        with self.assertRaises(ValueError): populate_network(net,'invalid')
        self.assertEqual(net.switches,[])

    def test_worker_builds_selected_network_and_cleans_mesh_before_diamond(self):
        worker = mw.MininetWorker()
        networks = []
        def create(**kwargs):
            net = ConstructionNet(**kwargs)
            networks.append(net)
            return net
        with patch.object(mw,'Mininet',side_effect=create), patch.object(mw.subprocess,'run') as run:
            self.assertEqual(worker.build_network(runtime_id='mesh',topology_id='multipath_mesh')['topology_id'],'multipath_mesh')
            self.assertEqual(len(worker.net.switches),9)
            worker.build_network(runtime_id='diamond',topology_id='diamond')
            networks[0].stop.assert_called_once()
            self.assertEqual(len(worker.net.switches),4)
            cleaned={call.args[0][-1] for call in run.call_args_list}
            self.assertEqual(cleaned, {'s%d' % n for n in range(1,10)})
            self.assertTrue(all('mn' not in call.args[0] for call in run.call_args_list))

    def test_worker_start_failure_cleans_partial_mesh_without_fallback(self):
        worker = mw.MininetWorker()
        net = ConstructionNet()
        net.start.side_effect=RuntimeError('startup failed')
        with patch.object(mw,'Mininet',return_value=net) as create, patch.object(mw.subprocess,'run'):
            with self.assertRaisesRegex(RuntimeError,'startup failed'):
                worker.build_network(topology_id='multipath_mesh')
            self.assertEqual(len(net.switches),9)
            self.assertEqual(create.call_count,1)
            net.stop.assert_called_once()
            self.assertIsNone(worker.net)

    def test_checked_dataplane_reset_covers_all_nine_switches(self):
        worker = mw.MininetWorker()
        worker.net=SimpleNamespace(switches=[SimpleNamespace(name='s%d'%n) for n in range(1,10)])
        worker._run_ovs=Mock(side_effect=lambda args: 'secure' if 'get-fail-mode' in args else '')
        self.assertEqual(len(worker.reset_dataplane()['switches']),9)
        for name in ['s%d'%n for n in range(1,10)]:
            commands=[c.args[0] for c in worker._run_ovs.call_args_list if c.args[0][-1] == name]
            deletes=[c[-2] for c in commands if c[-2] in ('del-flows','del-groups')]
            self.assertEqual(deletes,['del-flows','del-groups'])

    def test_mesh_link_failure_and_restore_confirm_both_actual_endpoints(self):
        class Switch:
            def __init__(self,name): self.name=name
        class Interface:
            def __init__(self,node): self.node=node;self.name=node.name+'-eth1';self.up=True
            def isUp(self): return self.up
        link=SimpleNamespace(intf1=Interface(Switch('s6')),intf2=Interface(Switch('s9')))
        untouched=SimpleNamespace(intf1=Interface(Switch('s5')),intf2=Interface(Switch('s9')))
        def config(a,b,status):
            for item in (link,untouched):
                if {item.intf1.node.name,item.intf2.node.name} == {a,b}:
                    item.intf1.up=item.intf2.up=status=='up'
        worker=mw.MininetWorker();worker.net=SimpleNamespace(links=[link,untouched],configLinkStatus=config)
        with patch.object(mw,'OVSSwitch',Switch),patch.object(mw.subprocess,'run') as run:
            for state in ('down','up'):
                result=worker.set_link_status('s6','s9',state)
                self.assertEqual(result['link_status'],state.upper())
                self.assertEqual(link.intf1.isUp(),state=='up');self.assertEqual(link.intf2.isUp(),state=='up')
            self.assertEqual(run.call_count,4)
            self.assertTrue(untouched.intf1.isUp() and untouched.intf2.isUp())
            with self.assertRaises(OperationError): worker.set_link_status('s2','s9','down')


class RuntimeTests(unittest.IsolatedAsyncioTestCase):
    async def test_no_silent_fallback_and_mesh_error_state(self):
        client=mc.MininetClient()
        client.ensure_worker=AsyncMock()
        client._send_command=AsyncMock(return_value={'status':'ok','topology_id':'diamond'})
        with patch.object(mc.ws_manager,'broadcast',new_callable=AsyncMock) as broadcast, patch.object(mc,'save_event_log'):
            with self.assertRaises(OperationError) as error:
                await client.start_simulation(topology_id='multipath_mesh')
            self.assertEqual(error.exception.status_code,502)
            self.assertEqual(client.topology_id,'multipath_mesh')
            self.assertEqual(client.simulation_state,'ERROR')
            self.assertIsNone(client.runtime_context()['active_topology_id'])
            self.assertFalse(any(call.args[0].get('state') == 'RUNNING' for call in broadcast.call_args_list))
            self.assertEqual(client._send_command.await_args_list[0].args[0]['topology_id'],'multipath_mesh')
            self.assertEqual(client._send_command.await_args_list[1].args[0],{'command':'stop'})

    async def test_success_identity_matches_rest_and_websocket(self):
        client=mc.MininetClient()
        client.ensure_worker=AsyncMock()
        client._send_command=AsyncMock(return_value={'status':'ok','topology_id':'multipath_mesh','nodes':[],'links':[],'switches':['s%d'%n for n in range(1,10)],'hosts':['h1','h2']})
        with patch.object(mc.ws_manager,'broadcast',new_callable=AsyncMock) as broadcast, patch.object(mc,'save_event_log'),patch.object(mc.os.path,'exists',return_value=True):
            started=await client.start_simulation(topology_id='multipath_mesh')
            app=FastAPI();app.include_router(topology.router)
            with patch.object(topology,'mininet_client',client):
                status,body=await request(app,'/api/topology',method='GET')
            self.assertEqual(status,200)
            self.assertEqual(len(body['switches']),9)
            snapshot=next(call.args[0]['topology'] for call in broadcast.call_args_list if call.args[0].get('event_type') == 'TOPOLOGY_UPDATE')
            for item in (started,body,snapshot):
                self.assertEqual(item['topology_id'],'multipath_mesh')
                self.assertEqual(item['active_topology_id'],'multipath_mesh')
                self.assertEqual(item['runtime_id'],client.runtime_id)

    async def test_all_six_combinations_replace_in_order_and_preserve_request(self):
        for topology_id in TOPOLOGIES:
            for controller in ('baseline','reactive','fast_failover'):
                calls=[]
                client=mc.MininetClient();client.simulation_state='RUNNING'
                manager=SimpleNamespace(active_controller='reactive',status='READY')
                async def stop_controller(): calls.append('controller-stop')
                async def stop_network(): calls.append('network-stop');client.simulation_state='STOPPED'
                async def select(ctrl,force_restart=False): calls.append(('controller-start',ctrl,force_restart))
                async def start(ip,port,topology_id):
                    calls.append(('network-start',topology_id,port));client.topology_id=topology_id;client.simulation_state='RUNNING'
                    return {'status':'ok',**client.runtime_context()}
                manager.stop_controller=AsyncMock(side_effect=stop_controller);manager.select_controller=AsyncMock(side_effect=select)
                client.stop_simulation=AsyncMock(side_effect=stop_network);client.start_simulation=AsyncMock(side_effect=start)
                app=FastAPI();app.include_router(simulation.router)
                with patch.object(simulation,'mininet_client',client),patch.object(simulation,'controller_manager',manager),patch.object(er.experiment_runner,'is_running',False):
                    status,body=await request(app,'/api/simulation/start',{'controller_type':controller,'topology_id':topology_id})
                self.assertEqual(status,200,body)
                self.assertEqual(body['topology_id'],topology_id)
                self.assertEqual(calls,['controller-stop','network-stop',('controller-start',controller,True),('network-start',topology_id,6653)])

    async def test_invalid_topology_is_422_and_does_not_stop_running_network(self):
        app=FastAPI();app.include_router(simulation.router)
        with patch.object(simulation.controller_manager,'stop_controller',new_callable=AsyncMock) as stop:
            status,_=await request(app,'/api/simulation/start',{'topology_id':'missing'})
            self.assertEqual(status,422);stop.assert_not_awaited()

    async def test_experiment_ownership_blocks_manual_replacement(self):
        app=FastAPI();app.include_router(simulation.router)
        with patch.object(er.experiment_runner,'is_running',True),patch.object(simulation.controller_manager,'stop_controller',new_callable=AsyncMock) as stop:
            status,_=await request(app,'/api/simulation/start',{'topology_id':'multipath_mesh'})
            self.assertEqual(status,409);stop.assert_not_awaited()

    async def test_experiment_cannot_start_mid_transition(self):
        app=FastAPI();app.include_router(experiments.router)
        async with runtime_transition_lock:
            status,_=await request(app,'/api/experiments/run',{'topology_id':'multipath_mesh'})
        self.assertEqual(status,409)


class ControllerGraphTests(unittest.TestCase):
    def setUp(self):
        # Import actual configured controller files, not copies or rewritten policy.
        import controller_baseline, controller_reactive, controller_ff
        self.baseline=controller_baseline.BaselineController
        self.reactive=controller_reactive.ReactiveController
        self.ff=controller_ff.FastFailoverController

    def graph(self):
        return nx.Graph((int(a[1:]),int(b[1:])) for a,b in TOPOLOGIES['multipath_mesh']['inter_switch_links'])

    def prepare(self,app):
        from ryu.ofproto import ofproto_v1_3
        app.graph=self.graph();app.logger=Mock()
        app.link_ports={(a,b):i+1 for a in app.graph for i,b in enumerate(sorted(app.graph.neighbors(a)))}
        parser=SimpleNamespace(OFPMatch=lambda **kw:kw,OFPActionOutput=lambda p:('output',p),OFPActionGroup=lambda gid:('group',gid),OFPBucket=lambda **kw:SimpleNamespace(**kw),OFPGroupMod=lambda *args:SimpleNamespace(command=args[1],group_type=args[2],group_id=args[3],buckets=args[4]))
        app.datapaths={n:SimpleNamespace(id=n,ofproto=ofproto_v1_3,ofproto_parser=parser,send_msg=Mock()) for n in app.graph}
        app._add_flow=Mock()
        app.hosts={'dst':(9,99)}
        return app

    def test_baseline_link_delete_has_no_flow_replacement(self):
        app=self.prepare(self.baseline());app._rebuild=Mock()
        app.link_delete(SimpleNamespace(link=SimpleNamespace(src=SimpleNamespace(dpid=1),dst=SimpleNamespace(dpid=2))))
        app._rebuild.assert_called_once();app._add_flow.assert_not_called()
        self.assertIn('no recovery action',app.logger.warning.call_args.args[0])

    def test_reactive_installs_graph_computed_route_after_active_edge_failure(self):
        app=self.prepare(self.reactive())
        old=nx.shortest_path(app.graph,1,9)
        app.installed={'dst':[old]};app._delete_path_flows=Mock()
        edge=tuple(old[:2]);app.graph.remove_edge(*edge)
        del app.link_ports[edge];del app.link_ports[edge[::-1]]
        app._heal(*edge,time.perf_counter())
        new=app.installed['dst'][0]
        self.assertNotEqual(old,new);self.assertEqual((new[0],new[-1]),(1,9))
        self.assertTrue(all(app.graph.has_edge(a,b) for a,b in zip(new,new[1:])))
        self.assertGreater(len(list(nx.all_simple_paths(app.graph,1,9))),1)
        self.assertEqual(app._add_flow.call_count,len(new))
        for index,call in enumerate(app._add_flow.call_args_list):
            output=app.link_ports[(new[index],new[index+1])] if index<len(new)-1 else 99
            self.assertEqual(call.args[3],[('output',output)])

    def test_ff_real_groups_watch_actual_strictly_closer_ports(self):
        app=self.prepare(self.ff());app._install_routes('dst')
        dist=nx.single_source_shortest_path_length(app.graph,9)
        protected=[]
        for node,dp in app.datapaths.items():
            for call in dp.send_msg.call_args_list:
                group=call.args[0]
                self.assertEqual(group.group_type,dp.ofproto.OFPGT_FF)
                ports={port:neighbor for (src,neighbor),port in app.link_ports.items() if src==node}
                self.assertTrue(all(bucket.watch_port in ports for bucket in group.buckets))
                self.assertTrue(all(dist[ports[bucket.watch_port]]<dist[node] for bucket in group.buckets))
                self.assertTrue(all(bucket.actions==[('output',bucket.watch_port)] for bucket in group.buckets))
                if len(group.buckets)>1: protected.append(node)
        self.assertIn(1,protected)
        # s2 initially has only one distance-decreasing output (to s5).
        self.assertEqual(len(app.datapaths[2].send_msg.call_args.args[0].buckets),1)
        app.graph.remove_edge(2,5)
        del app.link_ports[(2,5)];del app.link_ports[(5,2)]
        app._install_routes('dst')
        group=app.datapaths[2].send_msg.call_args.args[0]
        self.assertEqual(group.command,app.datapaths[2].ofproto.OFPGC_MODIFY)
        valid_ports={p for (src,_),p in app.link_ports.items() if src==2}
        self.assertTrue(all(bucket.watch_port in valid_ports for bucket in group.buckets))
