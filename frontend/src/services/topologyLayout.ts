import type { TopologyLink, TopologyNode } from "../types";

/** Deterministic BFS layers. Every reported node, including disconnected nodes,
 * gets its own slot. This only lays out the graph; it never invents links. */
export function layoutTopology(
  nodes: TopologyNode[],
  links: TopologyLink[],
): Record<string, { x: number; y: number }> {
  const ordered = [...nodes].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true }),
  );
  const adjacency = new Map(ordered.map((n) => [n.name, [] as string[]]));
  for (const link of links) {
    if (!adjacency.has(link.src) || !adjacency.has(link.dst)) continue;
    adjacency.get(link.src)!.push(link.dst);
    adjacency.get(link.dst)!.push(link.src);
  }
  const result: Record<string, { x: number; y: number }> = {};
  const seen = new Set<string>();
  let componentOffset = 0;
  const columnSpacing = nodes.length > 8 ? 170 : 205;
  const seeds = [
    ...ordered.filter((n) => n.type === "host"),
    ...ordered.filter((n) => n.type !== "host"),
  ];
  for (const seed of seeds) {
    if (seen.has(seed.name)) continue;
    const queue: [string, number][] = [[seed.name, 0]];
    const layers: string[][] = [];
    seen.add(seed.name);
    for (let i = 0; i < queue.length; i++) {
      const [name, depth] = queue[i];
      (layers[depth] ??= []).push(name);
      for (const neighbor of [...adjacency.get(name)!].sort())
        if (!seen.has(neighbor)) {
          seen.add(neighbor);
          queue.push([neighbor, depth + 1]);
        }
    }
    const height = Math.max(...layers.map((l) => l.length)) * 145;
    layers.forEach((layer, depth) =>
      layer.forEach((name, i) => {
        result[name] = {
          x: depth * columnSpacing,
          y: componentOffset + (height - layer.length * 145) / 2 + i * 145,
        };
      }),
    );
    componentOffset += height + 100;
  }
  return result;
}
