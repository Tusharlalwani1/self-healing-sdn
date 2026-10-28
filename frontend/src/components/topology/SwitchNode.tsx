import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { Network } from 'lucide-react';

interface SwitchNodeProps {
  data: {
    label: string;
    dpid: number;
    isSelected?: boolean;
    ports?: Record<string, any>;
    activeController?: string;
  };
}

export const SwitchNode: React.FC<SwitchNodeProps> = ({ data }) => {
  return (
    <div
      className={`px-4 py-3 rounded-xl bg-slate-900/95 border transition-all cursor-pointer min-w-[130px] shadow-xl ${
        data.isSelected
          ? 'border-blue-500 shadow-blue-500/30 ring-2 ring-blue-500/20'
          : 'border-slate-700/80 hover:border-slate-500 hover:shadow-cyan-500/10'
      }`}
    >
      <Handle type="target" position={Position.Top} className="!bg-blue-400 !w-2.5 !h-2.5 !border-slate-950" />
      <Handle type="source" position={Position.Bottom} className="!bg-blue-400 !w-2.5 !h-2.5 !border-slate-950" />
      <Handle type="target" position={Position.Left} className="!bg-blue-400 !w-2.5 !h-2.5 !border-slate-950" />
      <Handle type="source" position={Position.Right} className="!bg-blue-400 !w-2.5 !h-2.5 !border-slate-950" />

      <div className="flex items-center space-x-2.5">
        <div className="w-8 h-8 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center border border-blue-500/30">
          <Network className="w-4 h-4" />
        </div>
        <div>
          <div className="font-bold text-xs text-white uppercase tracking-wider">{data.label}</div>
          <div className="text-[10px] text-slate-400 font-mono">DPID: {data.dpid}</div>
        </div>
      </div>

      <div className="mt-2 pt-1.5 border-t border-slate-800 flex items-center justify-between text-[9px] text-slate-400">
        <span className="font-medium text-emerald-400">OVS 1.3</span>
        <span>{Object.keys(data.ports || {}).length} ports</span>
      </div>
    </div>
  );
};
