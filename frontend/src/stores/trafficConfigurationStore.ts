import { create } from 'zustand';

export interface TrafficConfiguration {
  src: string;
  dst: string;
  interval: number;
  count: number;
}

interface TrafficConfigurationState {
  configuration: TrafficConfiguration;
  setConfiguration: (changes: Partial<TrafficConfiguration>) => void;
}

// The user's next-request draft belongs to the browser session, not to a page
// mount or a traffic job. Telemetry and quick actions must never overwrite it.
export const useTrafficConfigurationStore = create<TrafficConfigurationState>((set) => ({
  configuration: { src: 'h1', dst: 'h2', interval: 0.05, count: 300 },
  setConfiguration: (changes) => set((state) => ({
    configuration: { ...state.configuration, ...changes },
  })),
}));
