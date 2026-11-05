import { Handle, Position } from '@xyflow/react';
import { Network } from 'lucide-react';
export function SwitchNode({ data }: { data: { label: string; dpid?: number; isSelected?: boolean; ports?: Record<string, unknown> } }) {
  return <div className={`network-node ${data.isSelected ? 'selected' : ''}`}><Handle type="target" position={Position.Left}/><Handle type="source" position={Position.Right}/><Network size={23} strokeWidth={1.5}/><div><strong>{data.label}</strong><small>DPID {data.dpid ?? 'N/A'}</small><small>{data.ports ? Object.keys(data.ports).length : 'N/A'} ports · OF 1.3</small></div></div>;
}
