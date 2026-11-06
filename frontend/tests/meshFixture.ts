import type { TopologyOption, TopologyResponse } from "../src/types";
export const meshPairs: [string, string][] = [
  ["s1", "s2"],
  ["s1", "s3"],
  ["s1", "s4"],
  ["s2", "s3"],
  ["s2", "s5"],
  ["s3", "s4"],
  ["s3", "s6"],
  ["s4", "s7"],
  ["s5", "s6"],
  ["s5", "s9"],
  ["s6", "s7"],
  ["s6", "s9"],
  ["s7", "s8"],
  ["s8", "s9"],
];
export const meshOption: TopologyOption = {
  id: "multipath_mesh",
  label: "Multi-Path Mesh — Advanced",
  switch_count: 9,
  host_count: 2,
  switches: Array.from({ length: 9 }, (_, i) => `s${i + 1}`),
  inter_switch_links: meshPairs,
  host_links: [
    ["h1", "s1"],
    ["h2", "s9"],
  ],
};
export const diamondOption: TopologyOption = {
  id: "diamond",
  label: "Diamond — Basic",
  switch_count: 4,
  host_count: 2,
  switches: ["s1", "s2", "s3", "s4"],
  inter_switch_links: [
    ["s1", "s2"],
    ["s2", "s4"],
    ["s1", "s3"],
    ["s3", "s4"],
  ],
  host_links: [
    ["h1", "s1"],
    ["h2", "s4"],
  ],
};
export const meshSnapshot: TopologyResponse = {
  runtime_id: "mesh-runtime",
  runtime_revision: 2,
  topology_id: "multipath_mesh",
  topology_label: meshOption.label,
  active_topology_id: "multipath_mesh",
  simulation_state: "RUNNING",
  active_controller: "reactive",
  switches: meshOption.switches,
  hosts: ["h1", "h2"],
  nodes: [
    ...meshOption.switches.map((name, i) => ({
      id: name,
      name,
      type: "switch" as const,
      dpid: i + 1,
      ports: {},
    })),
    ...["h1", "h2"].map((name, i) => ({
      id: name,
      name,
      type: "host" as const,
      ip: `10.0.0.${i + 1}`,
      ports: {},
    })),
  ],
  links: [...meshOption.host_links, ...meshPairs].map(([src, dst]) => ({
    id: `${src}-${dst}`,
    src,
    dst,
    src_intf: `${src}-eth1`,
    dst_intf: `${dst}-eth1`,
    status: "UP" as const,
  })),
  active_paths: [["s1", "s2", "s5", "s9"]],
  backup_paths: [],
};
