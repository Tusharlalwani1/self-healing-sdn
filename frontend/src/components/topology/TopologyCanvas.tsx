import React, { useMemo } from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  BackgroundVariant,
  Node,
  Edge,
  MarkerType
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { useSDNStore } from '../../stores/sdnStore';
import { SwitchNode } from './SwitchNode';
import { HostNode } from './HostNode';
import { TopologyLink, TopologyNode } from '../../types';

const nodeTypes = {
  switchNode: SwitchNode,
  hostNode: HostNode,
};

interface TopologyCanvasProps {
  onSelectNode?: (node: TopologyNode) => void;
  onSelectLink?: (link: TopologyLink) => void;
}

export const TopologyCanvas: React.FC<TopologyCanvasProps> = ({ onSelectNode, onSelectLink }) => {
  const { topology, selectedNode, selectedLink, selectNode, selectLink } = useSDNStore();

  // Diamond layout coordinates
  const positions: Record<string, { x: number; y: number }> = {
    h1: { x: 340, y: 30 },
    s1: { x: 340, y: 150 },
    s2: { x: 150, y: 280 },
    s3: { x: 530, y: 280 },
    s4: { x: 340, y: 410 },
    h2: { x: 340, y: 530 },
  };

  // Convert store nodes to ReactFlow nodes
  const nodes: Node[] = useMemo(() => {
    const rawNodes = topology.nodes.length
      ? topology.nodes
      : [
          { id: 'h1', name: 'h1', type: 'host', ip: '10.0.0.1', mac: '00:00:00:00:00:01', ports: {} },
          { id: 's1', name: 's1', type: 'switch', dpid: 1, mac: '', ports: {} },
          { id: 's2', name: 's2', type: 'switch', dpid: 2, mac: '', ports: {} },
          { id: 's3', name: 's3', type: 'switch', dpid: 3, mac: '', ports: {} },
          { id: 's4', name: 's4', type: 'switch', dpid: 4, mac: '', ports: {} },
          { id: 'h2', name: 'h2', type: 'host', ip: '10.0.0.2', mac: '00:00:00:00:00:02', ports: {} },
        ];

    return rawNodes.map((n) => {
      const pos = positions[n.name] || { x: 300, y: 250 };
      const isSwitch = n.type === 'switch';
      return {
        id: n.name,
        type: isSwitch ? 'switchNode' : 'hostNode',
        position: pos,
        data: {
          label: n.name,
          dpid: n.dpid || (isSwitch ? parseInt(n.name.replace('s', '')) : undefined),
          ip: n.ip,
          mac: n.mac,
          ports: n.ports,
          isSelected: selectedNode?.name === n.name,
        },
      };
    });
  }, [topology.nodes, selectedNode]);

  // Convert store links to ReactFlow edges with dynamic active-path & failure highlighting
  const edges: Edge[] = useMemo(() => {
    // Standard diamond links
    const defaultPairs = [
      { id: 'h1-s1', src: 'h1', dst: 's1' },
      { id: 's1-s2', src: 's1', dst: 's2' },
      { id: 's1-s3', src: 's1', dst: 's3' },
      { id: 's2-s4', src: 's2', dst: 's4' },
      { id: 's3-s4', src: 's3', dst: 's4' },
      { id: 's4-h2', src: 's4', dst: 'h2' },
    ];

    const activePaths = topology.active_paths || [];
    const isPairInActivePath = (a: string, b: string) => {
      for (const p of activePaths) {
        for (let i = 0; i < p.length - 1; i++) {
          if ((p[i] === a && p[i + 1] === b) || (p[i] === b && p[i + 1] === a)) {
            return true;
          }
        }
      }
      return false;
    };

    return defaultPairs.map((pair) => {
      // Find actual status from backend topology
      const linkMatch = topology.links.find(
        (l) =>
          (l.src === pair.src && l.dst === pair.dst) ||
          (l.src === pair.dst && l.dst === pair.src)
      );

      const isDown = linkMatch ? linkMatch.status === 'DOWN' : false;
      const isActive = !isDown && (isPairInActivePath(pair.src, pair.dst) || pair.src.startsWith('h') || pair.dst.startsWith('h'));
      const isSelected = selectedLink?.id === pair.id || selectedLink?.id === `${pair.dst}-${pair.src}`;

      let stroke = '#475569'; // Muted standby link
      let strokeWidth = 2;
      let strokeDasharray = undefined;
      let animated = false;
      let label = undefined;

      if (isDown) {
        stroke = '#ef4444'; // Red failed link
        strokeWidth = 3;
        strokeDasharray = '6 6';
        label = 'FAIL (DOWN)';
      } else if (isActive) {
        stroke = '#38bdf8'; // Electric blue / cyan active path
        strokeWidth = 3.5;
        animated = true;
      }

      if (isSelected) {
        stroke = '#f59e0b'; // Amber selection highlight
        strokeWidth = 4;
      }

      return {
        id: pair.id,
        source: pair.src,
        target: pair.dst,
        animated,
        label,
        labelStyle: { fill: '#ef4444', fontWeight: 700, fontSize: 10 },
        labelBgStyle: { fill: '#0f172a', fillOpacity: 0.85 },
        style: {
          stroke,
          strokeWidth,
          strokeDasharray,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: stroke,
          width: 14,
          height: 14,
        },
      };
    });
  }, [topology.links, topology.active_paths, selectedLink]);

  return (
    <div className="w-full h-full bg-slate-950/80 rounded-2xl border border-slate-800/80 overflow-hidden relative shadow-2xl">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        onNodeClick={(_, node) => {
          const match = topology.nodes.find((n) => n.name === node.id) || {
            id: node.id,
            name: node.id,
            type: node.id.startsWith('h') ? 'host' : 'switch',
            ports: {},
          };
          selectNode(match as any);
          onSelectNode?.(match as any);
        }}
        onEdgeClick={(_, edge) => {
          const [src, dst] = edge.id.split('-');
          const match = topology.links.find(
            (l) => (l.src === src && l.dst === dst) || (l.src === dst && l.dst === src)
          ) || {
            id: edge.id,
            src,
            dst,
            src_intf: `${src}-eth1`,
            dst_intf: `${dst}-eth1`,
            status: edge.style?.stroke === '#ef4444' ? 'DOWN' : 'UP',
            bw: 10,
            delay: '5ms',
          };
          selectLink(match as any);
          onSelectLink?.(match as any);
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#1e293b" />
        <Controls className="!bg-slate-900 !border-slate-800 !text-slate-300" />
      </ReactFlow>

      {/* Floating legend */}
      <div className="absolute bottom-4 left-4 glass-panel px-3.5 py-2.5 rounded-xl text-[11px] space-y-1.5 shadow-lg border border-slate-800/80 pointer-events-none">
        <div className="font-semibold text-slate-300 uppercase tracking-wider text-[10px] pb-1 border-b border-slate-800">
          Path Topology Legend
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3.5 h-1 bg-cyan-400 rounded-full" />
          <span className="text-slate-300">Active Forwarding Route</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3.5 h-1 bg-slate-500 rounded-full" />
          <span className="text-slate-400">Standby / Alternative Route</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3.5 h-1 bg-rose-500 border border-dashed border-rose-400 rounded-full" />
          <span className="text-rose-400 font-medium">Disconnected Link</span>
        </div>
      </div>
    </div>
  );
};
