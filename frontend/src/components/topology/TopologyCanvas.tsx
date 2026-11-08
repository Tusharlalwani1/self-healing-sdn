import React, { useMemo } from "react";
import { useCurrentLinkHealth } from '../LinkHealthCard';
import { healthAppearance, linkKey } from '../../services/linkHealth';
import {
  ReactFlow,
  Controls,
  Background,
  BackgroundVariant,
  Node,
  Edge,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useSDNStore } from "../../stores/sdnStore";
import { SwitchNode } from "./SwitchNode";
import { HostNode } from "./HostNode";
import { TopologyLink, TopologyNode } from "../../types";
import { layoutTopology } from "../../services/topologyLayout";
import { EmptyState } from "../ui/Primitives";

const nodeTypes = {
  switchNode: SwitchNode,
  hostNode: HostNode,
};

interface TopologyCanvasProps {
  onSelectNode?: (node: TopologyNode) => void;
  onSelectLink?: (link: TopologyLink) => void;
}

export const TopologyCanvas: React.FC<TopologyCanvasProps> = ({
  onSelectNode,
  onSelectLink,
}) => {
  const health = useCurrentLinkHealth();
  const {
    topology,
    runtimeId,
    selectedNode,
    selectedLink,
    selectNode,
    selectLink,
  } = useSDNStore();

  const positions = useMemo(
    () => layoutTopology(topology.nodes, topology.links),
    [topology.nodes, topology.links],
  );

  // Convert store nodes to ReactFlow nodes
  const nodes: Node[] = useMemo(() => {
    const rawNodes = topology.nodes;

    return rawNodes.map((n) => {
      const pos = positions[n.name] || { x: 300, y: 250 };
      const isSwitch = n.type === "switch";
      return {
        id: n.name,
        type: isSwitch ? "switchNode" : "hostNode",
        position: pos,
        data: {
          label: n.name,
          dpid: n.dpid,
          ip: n.ip,
          mac: n.mac,
          ports: n.ports,
          isSelected: selectedNode?.name === n.name,
        },
      };
    });
  }, [topology.nodes, selectedNode, positions]);

  // Convert store links to ReactFlow edges with dynamic active-path & failure highlighting
  const edges: Edge[] = useMemo(() => {
    const activePaths = topology.active_paths || [];
    const isPairInActivePath = (a: string, b: string) => {
      for (const p of activePaths) {
        for (let i = 0; i < p.length - 1; i++) {
          if (
            (p[i] === a && p[i + 1] === b) ||
            (p[i] === b && p[i + 1] === a)
          ) {
            return true;
          }
        }
      }
      return false;
    };

    return topology.links.map((pair) => {
      const linkMatch = pair;

      const isDown = linkMatch ? linkMatch.status === "DOWN" : false;
      const isActive = !isDown && isPairInActivePath(pair.src, pair.dst);
      const isSelected =
        selectedLink?.id === pair.id ||
        selectedLink?.id === `${pair.dst}-${pair.src}`;

      let stroke = "#a8b09e";
      let strokeWidth = 2;
      let strokeDasharray = undefined;
      let animated = false;
      let label = undefined;

      if (isDown) {
        stroke = "#b64a41";
        strokeWidth = 3;
        strokeDasharray = "6 6";
        label = "FAIL (DOWN)";
      } else if (isActive) {
        stroke = "#52714c";
        strokeWidth = 3.5;
        animated = false;
      }

      if (isSelected) {
        stroke = isDown ? "#b64a41" : "#6b54a0";
        strokeWidth = 4;
      }

      const record = health?.links.find(l => l.link_id === linkKey(pair.src,pair.dst));
      const appearance = healthAppearance(pair.status,record?.health_status);
      if (!isDown && record) {
        label = appearance.label;
        if (record.health_status === 'DEGRADED' || record.health_status === 'CRITICAL') {
          stroke = appearance.color;
          strokeDasharray = appearance.dash;
          strokeWidth = 3;
        }
      }

      return {
        id: pair.id,
        source: pair.src,
        target: pair.dst,
        animated,
        label,
        ariaLabel: `${pair.src} to ${pair.dst}: ${appearance.label}`,
        labelStyle: { fill: appearance.color, fontWeight: 700, fontSize: 10 },
        labelBgStyle: { fill: "#fafbf7", fillOpacity: 0.95 },
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
  }, [topology.links, topology.active_paths, selectedLink, health]);

  return (
    <div className="topology-canvas">
      {!nodes.length && (
        <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
          <EmptyState title="No topology reported">
            Start a simulation to discover nodes and links.
          </EmptyState>
        </div>
      )}
      <ReactFlow
        key={runtimeId || "uninitialized"}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.06 }}
        onNodeClick={(_, node) => {
          const match = topology.nodes.find((n) => n.name === node.id);
          if (!match) return;
          selectNode(match as any);
          onSelectNode?.(match as any);
        }}
        onEdgeClick={(_, edge) => {
          const match = topology.links.find((link) => link.id === edge.id);
          if (!match) return;
          selectLink(match as any);
          onSelectLink?.(match as any);
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="#d2d8c7"
        />
        <Controls />
      </ReactFlow>

      {/* Floating legend */}
      <div className="topology-legend">
        <span>
          <i className="legend-line active" />
          Verified forwarding path
        </span>
        <span>
          <i className="legend-line" />
          Other reported link
        </span>
        <span>
          <i className="legend-line down" />
          DOWN
        </span>
      </div>
    </div>
  );
};
