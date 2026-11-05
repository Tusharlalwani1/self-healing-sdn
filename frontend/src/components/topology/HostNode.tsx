import { Handle, Position } from '@xyflow/react';
import { Monitor } from 'lucide-react';
export function HostNode({ data }: { data: { label: string; ip?: string; isSelected?: boolean } }) {
  return <div className={`network-node host ${data.isSelected ? 'selected' : ''}`}><Handle type="target" position={Position.Left}/><Handle type="source" position={Position.Right}/><Monitor size={23} strokeWidth={1.5}/><div><strong>{data.label}</strong><small>{data.ip || 'IP N/A'}</small></div></div>;
}
