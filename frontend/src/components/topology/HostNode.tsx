import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { Server } from 'lucide-react';

interface HostNodeProps {
  data: {
    label: string;
    ip?: string;
    mac?: string;
    isSelected?: boolean;
  };
}

export const HostNode: React.FC<HostNodeProps> = ({ data }) => {
  return (
    <div
      className={`px-4 py-2.5 rounded-xl bg-slate-900/95 border transition-all cursor-pointer min-w-[130px] shadow-xl ${
        data.isSelected
          ? 'border-cyan-500 shadow-cyan-500/30 ring-2 ring-cyan-500/20'
          : 'border-slate-700/80 hover:border-slate-500'
      }`}
    >
      <Handle type="target" position={Position.Top} className="!bg-cyan-400 !w-2.5 !h-2.5 !border-slate-950" />
      <Handle type="source" position={Position.Bottom} className="!bg-cyan-400 !w-2.5 !h-2.5 !border-slate-950" />

      <div className="flex items-center space-x-2.5">
        <div className="w-8 h-8 rounded-lg bg-cyan-500/20 text-cyan-400 flex items-center justify-center border border-cyan-500/30">
          <Server className="w-4 h-4" />
        </div>
        <div>
          <div className="font-bold text-xs text-white uppercase tracking-wider">{data.label}</div>
          <div className="text-[10px] text-cyan-300 font-mono font-medium">{data.ip || '10.0.0.?'}</div>
        </div>
      </div>
    </div>
  );
};
