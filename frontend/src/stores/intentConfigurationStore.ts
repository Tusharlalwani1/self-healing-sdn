import { create } from 'zustand';
import { api } from '../services/api';
import { customIntentError } from '../services/intent';
import type { IntentSelection, ServiceIntent } from '../services/intent';

export type IntentWorkflow = 'traffic' | 'experiment';
interface Draft { profile_id: ServiceIntent['profile_id']; custom: ServiceIntent }
const draft = (): Draft => ({profile_id:'standard', custom:{profile_id:'custom', name:'Custom', priority:'NORMAL',
  require_reachability:true, max_loss_percent:null, max_avg_rtt_ms:null}});
interface State {
  traffic: Draft;
  experiment: Draft;
  profiles: ServiceIntent[];
  error: string | null;
  loadProfiles: () => Promise<void>;
  update: (workflow: IntentWorkflow, changes: Partial<Draft>) => void;
  selection: (workflow: IntentWorkflow) => IntentSelection;
}
// Next-request drafts survive navigation and are never written by job telemetry.
export const useIntentConfigurationStore = create<State>((set, get) => ({
  traffic: draft(), experiment: draft(), profiles: [], error: null,
  loadProfiles: async () => {
    try { set({profiles: await api.getIntentProfiles(), error:null}); }
    catch (error) { set({error: error instanceof Error ? error.message : 'Unable to load intent profiles'}); }
  },
  update: (workflow, changes) => set(state => ({[workflow]:{...state[workflow], ...changes}})),
  selection: workflow => {
    const value = get()[workflow];
    if (value.profile_id !== 'custom') return {profile_id:value.profile_id};
    const error = customIntentError(value.custom);
    if (error) throw new Error(error);
    return {profile_id:'custom', custom:{...value.custom}};
  },
}));
