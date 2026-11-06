import React from "react";
import assert from "node:assert/strict";
import { beforeEach, afterEach, test, mock } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { useSDNStore } from "../src/stores/sdnStore";
import { useTopologySelectionStore } from "../src/stores/topologySelectionStore";
import { useTrafficConfigurationStore } from "../src/stores/trafficConfigurationStore";
import { emptyTopology } from "../src/services/topology";
import { layoutTopology } from "../src/services/topologyLayout";
import { experimentLinks } from "../src/services/experimentLinks";
import { TopologySelector } from "../src/components/TopologySelector";
import { FailureSimulatorView } from "../src/pages/FailureSimulatorView";
import { ExperimentLabView } from "../src/pages/ExperimentLabView";
import { meshSnapshot, meshOption, diamondOption } from "./meshFixture";

const originalFetch = globalThis.fetch;
beforeEach(() => {
  useTopologySelectionStore.setState({
    ...useTopologySelectionStore.getInitialState(),
    options: [diamondOption, meshOption],
  });
  useSDNStore.setState({
    topology: emptyTopology(),
    simulationState: "STOPPED",
    runtimeId: null,
    runtimeRevision: 0,
    loading: false,
    error: null,
    experimentRunning: false,
  });
  globalThis.fetch = (() => new Promise(() => {})) as typeof fetch;
  mock.method(
    React,
    "useSyncExternalStore",
    (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
  );
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  mock.restoreAll();
});

test("topology selection survives tabs and stopped-state hydration", async () => {
  useTopologySelectionStore.getState().selectTopology("multipath_mesh");
  useSDNStore.getState().setTab("topology");
  useSDNStore.getState().setTab("overview");
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ ...emptyTopology(), topology_id: "diamond" }),
    )) as typeof fetch;
  await useSDNStore.getState().fetchTopology();
  assert.equal(
    useTopologySelectionStore.getState().selectedTopologyId,
    "multipath_mesh",
  );
  assert.match(
    renderToStaticMarkup(<TopologySelector />),
    /value="multipath_mesh" selected/,
  );
});

test("mesh plus selected controller is explicit in start request; no missing confirmation fallback", async () => {
  useTopologySelectionStore.getState().selectTopology("multipath_mesh");
  let posted: any;
  globalThis.fetch = (async (url, options) => {
    if (String(url).endsWith("/start")) {
      posted = JSON.parse(String(options?.body));
      return new Response(JSON.stringify({ status: "ok", ...meshSnapshot }));
    }
    return new Response(
      JSON.stringify(String(url).includes("/controllers") ? [] : meshSnapshot),
    );
  }) as typeof fetch;
  await useSDNStore.getState().startSimulation("reactive");
  assert.deepEqual(posted, {
    controller_type: "reactive",
    topology_id: "multipath_mesh",
  });
  assert.equal(useSDNStore.getState().topology.switches.length, 9);
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ status: "ok" }))) as typeof fetch;
  await assert.rejects(
    useSDNStore.getState().startSimulation("reactive"),
    /did not confirm/,
  );
  assert.equal(useSDNStore.getState().simulationState, "ERROR");
});

test("mesh initial snapshot and sparse updates preserve identity; stale Diamond runtime cannot replace it", () => {
  useSDNStore
    .getState()
    .handleWebSocketMessage({
      event_type: "INITIAL_STATE",
      ...meshSnapshot,
      controller: "reactive",
    });
  useSDNStore
    .getState()
    .handleWebSocketMessage({
      event_type: "TOPOLOGY_UPDATE",
      topology: meshSnapshot,
    });
  useSDNStore
    .getState()
    .handleWebSocketMessage({
      event_type: "TOPOLOGY_UPDATE",
      topology: {
        ...emptyTopology(),
        topology_id: "diamond",
        runtime_id: "old",
        runtime_revision: 1,
      },
    });
  assert.equal(useSDNStore.getState().topology.topology_id, "multipath_mesh");
  assert.equal(useSDNStore.getState().topology.nodes.length, 11);
  useSDNStore
    .getState()
    .handleWebSocketMessage({
      event_type: "TOPOLOGY_UPDATE",
      topology: {
        links: meshSnapshot.links.map((link) =>
          link.id === "s6-s9" ? { ...link, status: "DOWN" } : link,
        ),
      },
    });
  assert.equal(useSDNStore.getState().topology.topology_id, "multipath_mesh");
  assert.equal(
    useSDNStore.getState().topology.links.find((l) => l.id === "s6-s9")?.status,
    "DOWN",
  );
});

test("mesh layout and failure controls cover real 9-switch / 16-link graph without Diamond inventory", () => {
  const layout = layoutTopology(meshSnapshot.nodes, meshSnapshot.links);
  assert.equal(Object.keys(layout).length, 11);
  assert.equal(
    new Set(Object.values(layout).map((p) => `${p.x},${p.y}`)).size,
    11,
  );
  useSDNStore.setState({ topology: meshSnapshot, simulationState: "RUNNING" });
  const html = renderToStaticMarkup(<FailureSimulatorView />);
  assert.match(html, /Physical links \/ 16/);
  for (const [a, b] of meshOption.inter_switch_links)
    assert.ok(html.includes(`${a} ↔ ${b}`));
  assert.ok(!html.includes("s2 ↔ s4"));
  const links = experimentLinks(
    meshSnapshot,
    [diamondOption, meshOption],
    "multipath_mesh",
  );
  assert.equal(links.length, 14);
  assert.ok(links.some((l) => l.src === "s8" && l.dst === "s9"));
  assert.ok(!links.some((l) => l.src === "h1" || l.dst === "h2"));
  assert.match(renderToStaticMarkup(<ExperimentLabView />), /s8 ↔ s9/);
});

test("configured experiment choices follow selected topology without fabricating a running graph", () => {
  const links = experimentLinks(
    emptyTopology(),
    [diamondOption, meshOption],
    "multipath_mesh",
  );
  assert.equal(links.length, 14);
  assert.equal(links[0].status, "CONFIGURED");
  assert.equal(useSDNStore.getState().topology.nodes.length, 0);
});

test("topology selection and runtime changes do not reset traffic request draft", () => {
  const configuration = { src: "h2", dst: "h1", interval: 0.1, count: 500 };
  useTrafficConfigurationStore.getState().setConfiguration(configuration);
  useTopologySelectionStore.getState().selectTopology("multipath_mesh");
  useSDNStore
    .getState()
    .handleWebSocketMessage({
      event_type: "INITIAL_STATE",
      ...meshSnapshot,
      controller: "reactive",
    });
  assert.deepEqual(
    useTrafficConfigurationStore.getState().configuration,
    configuration,
  );
});
