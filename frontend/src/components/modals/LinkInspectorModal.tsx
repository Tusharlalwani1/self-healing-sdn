import { InspectorDrawer } from '../ui/InspectorDrawer';
import { LinkHealthCard } from '../LinkHealthCard';
import React, { useState } from 'react';
import { X, ZapOff, CheckCircle2, ArrowRightLeft, Radio } from 'lucide-react';
import { TopologyLink } from '../../types';
import { useSDNStore } from '../../stores/sdnStore';

interface LinkInspectorModalProps {
  link: TopologyLink | null;
  onClose: () => void;
}

export const LinkInspectorModal: React.FC<LinkInspectorModalProps> = ({ link, onClose }) => {
  const { setLinkStatus, topology, simulationState } = useSDNStore();
  const [loading, setLoading] = useState(false);

  if (!link) return null;

  const currentLink = topology.links.find(item => item.id === link.id) ?? link;
  const isUp = currentLink.status === 'UP';

  const handleToggle = async () => {
    setLoading(true);
    try {
      await setLinkStatus(link.src, link.dst, isUp ? 'down' : 'up');
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <InspectorDrawer title="Link inspector" onClose={onClose}>
      <div className="flex flex-col min-h-full">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/50">
          <div className="flex items-center space-x-3">
            <div className={`w-10 h-10 rounded-md flex items-center justify-center border ${
              isUp ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-rose-500/20 text-rose-400 border-rose-500/30'
            }`}>
              <ArrowRightLeft className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-sm text-white uppercase tracking-wider flex items-center gap-2">
                Link: {link.src.toUpperCase()} ↔ {link.dst.toUpperCase()}
              </h2>
              <p className="text-xs text-slate-400 font-mono">Physical Link Control</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close inspector"
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Details */}
        <div className="p-6 space-y-4">
          <LinkHealthCard src={link.src} dst={link.dst}/>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="p-3 rounded-md bg-slate-950/60 border border-slate-800">
              <div className="text-xs text-slate-500 uppercase font-semibold">Current State</div>
              <div className={`text-sm font-bold mt-1 flex items-center gap-1.5 ${isUp ? 'text-emerald-400' : 'text-rose-400'}`}>
                <span className={`w-2 h-2 rounded-full ${isUp ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                {currentLink.status}
              </div>
            </div>

            <div className="p-3 rounded-md bg-slate-950/60 border border-slate-800">
              <div className="text-xs text-slate-500 uppercase font-semibold">Configured Bandwidth / Delay</div>
              <div className="text-sm font-bold text-slate-200 mt-1 font-mono">
                {link.bw != null ? `${link.bw} Mbps` : 'N/A'} / {link.delay ?? 'N/A'}
              </div>
            </div>
          </div>

          <div className="p-3 rounded-md bg-slate-950/60 border border-slate-800 text-xs font-mono space-y-1">
            <div className="flex justify-between text-slate-400">
              <span>{link.src} Interface:</span>
              <span className="text-accent font-semibold">{link.src_intf}</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>{link.dst} Interface:</span>
              <span className="text-accent font-semibold">{link.dst_intf}</span>
            </div>
          </div>

          {/* Action button */}
          <div className="pt-2">
            {isUp ? (
              <button
                onClick={handleToggle}
                disabled={loading || simulationState !== 'RUNNING'}
                className="w-full flex items-center justify-center space-x-2 py-3 px-4 rounded-md font-semibold text-xs bg-rose-600 hover:bg-rose-500 text-white  -600/30 transition disabled:opacity-50"
              >
                <ZapOff className="w-4 h-4" />
                <span>{loading ? 'Disconnecting...' : 'Disconnect Link (Inject Failure)'}</span>
              </button>
            ) : (
              <button
                onClick={handleToggle}
                disabled={loading || simulationState !== 'RUNNING'}
                className="w-full flex items-center justify-center space-x-2 py-3 px-4 rounded-md font-semibold text-xs bg-emerald-600 hover:bg-emerald-500 text-white  -600/30 transition disabled:opacity-50"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>{loading ? 'Restoring...' : 'Restore Link (Set Link UP)'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </InspectorDrawer>
  );
};
