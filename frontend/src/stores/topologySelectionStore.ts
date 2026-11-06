import { create } from "zustand";
import { api } from "../services/api";
import type { TopologyId, TopologyOption } from "../types";

export const topologyLabel = (id?: string | null) =>
  id === "diamond"
    ? "Diamond — Basic"
    : id === "multipath_mesh"
      ? "Multi-Path Mesh — Advanced"
      : "Not recorded";
export const isTopologyId = (id: unknown): id is TopologyId =>
  id === "diamond" || id === "multipath_mesh";

interface TopologySelection {
  selectedTopologyId: TopologyId;
  options: TopologyOption[];
  edited: boolean;
  error: string | null;
  selectTopology: (id: TopologyId) => void;
  followRuntime: (id: unknown, running: boolean) => void;
  fetchOptions: () => Promise<void>;
}
export const useTopologySelectionStore = create<TopologySelection>(
  (set, get) => ({
    selectedTopologyId: "diamond",
    options: [],
    edited: false,
    error: null,
    selectTopology: (id) => set({ selectedTopologyId: id, edited: true }),
    followRuntime: (id, running) => {
      if (isTopologyId(id) && (running || !get().edited))
        set({ selectedTopologyId: id, edited: false });
    },
    fetchOptions: async () => {
      try {
        set({ options: await api.getTopologyOptions(), error: null });
      } catch (error) {
        set({ error: error instanceof Error ? error.message : String(error) });
      }
    },
  }),
);
