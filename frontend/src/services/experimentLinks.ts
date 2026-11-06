import type { TopologyId, TopologyOption, TopologyResponse } from "../types";

export function experimentLinks(
  topology: TopologyResponse,
  options: TopologyOption[],
  selected: TopologyId,
) {
  if (topology.simulation_state === "RUNNING") {
    const switches = new Set(topology.switches);
    return topology.links.filter(
      (link) => switches.has(link.src) && switches.has(link.dst),
    );
  }
  // Configuration choices for the explicitly selected network, never live graph data.
  return (
    options.find((option) => option.id === selected)?.inter_switch_links || []
  ).map(([src, dst]) => ({
    id: `${src}-${dst}`,
    src,
    dst,
    status: "CONFIGURED",
  }));
}
