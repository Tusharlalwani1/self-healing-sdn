import type { ControllerType, SimulationState, TopologyResponse } from '../types';

export function emptyTopology(): TopologyResponse {
  return {
    nodes: [], links: [], switches: [], hosts: [],
    active_controller: null,
    simulation_state: 'STOPPED',
    active_paths: [], backup_paths: [],
  };
}

function arrayOrPrevious<T>(value: unknown, previous: T[]): T[] {
  return Array.isArray(value) ? value : (Array.isArray(previous) ? previous : []);
}

function isPaths(value: unknown): value is string[][] {
  return Array.isArray(value) && value.every(
    (path) => Array.isArray(path) && path.every((node) => typeof node === 'string'),
  );
}

function pathsOrPrevious(value: unknown, previous: string[][]): string[][] {
  return isPaths(value) ? value : (isPaths(previous) ? previous : []);
}

/** REST snapshots and worker WS patches share this normalized store contract.
 * Missing/null arrays preserve prior data; explicit [] clears it.
 * A worker's status is not a simulation lifecycle state.
 */
export function mergeTopology(previous: TopologyResponse, update: unknown): TopologyResponse {
  const patch = update && typeof update === 'object'
    ? update as Partial<TopologyResponse> : {};
  const states: SimulationState[] = ['STOPPED', 'STARTING', 'RUNNING', 'STOPPING', 'ERROR'];
  const controllers: ControllerType[] = ['baseline', 'reactive', 'fast_failover'];

  return {
    nodes: arrayOrPrevious(patch.nodes, previous.nodes),
    links: arrayOrPrevious(patch.links, previous.links),
    switches: arrayOrPrevious(patch.switches, previous.switches),
    hosts: arrayOrPrevious(patch.hosts, previous.hosts),
    active_paths: pathsOrPrevious(patch.active_paths, previous.active_paths),
    backup_paths: pathsOrPrevious(patch.backup_paths, previous.backup_paths),
    simulation_state: patch.simulation_state !== undefined && states.includes(patch.simulation_state)
      ? patch.simulation_state : previous.simulation_state,
    active_controller: patch.active_controller === null || (
      patch.active_controller !== undefined && controllers.includes(patch.active_controller)
    )
      ? patch.active_controller : previous.active_controller,
  };
}

/** Hydrate fields not superseded by an event while this REST request awaited IO. */
export function mergeTopologySnapshot(
  current: TopologyResponse,
  requested: TopologyResponse,
  response: Partial<TopologyResponse>,
): TopologyResponse {
  const patch = { ...response };
  for (const key of Object.keys(current) as (keyof TopologyResponse)[]) {
    if (current[key] !== requested[key]) delete patch[key];
  }
  return mergeTopology(current, patch);
}
