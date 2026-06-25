import assert from "node:assert/strict";
import test from "node:test";
import {
  EngineWorkerSession,
  allowedAnalysisColumns,
  analysisMethodCatalog,
  analysisColumn,
  computeAnalysisColumn,
  computeAnalysisColumnByName,
  type EngineWorkerProgressMessage,
  parseAnalysisColumn,
  supportsAnalysis,
  supportsOnDemand
} from "../packages/website-adapter/src/index.ts";
import { attachEngineWorker, createEngineWorkerMessageHandler, transferablesForResponse } from "../packages/website-adapter/src/worker.ts";
import type { CanonicalGraph } from "../packages/core/src/index.ts";
import { chainGraph, rightAngleGraph, threeSegmentChainGraph } from "./fixtures/tiny-graphs.ts";

test("parses and validates website analysis columns", () => {
  assert.equal(analysisColumn("dmx", "integration", 400), "dmx_integration_r400");
  assert.deepEqual(parseAnalysisColumn("dmx_choice_r1200"), {
    method: "dmx",
    measure: "choice",
    radius: 1200
  });
  assert.deepEqual(parseAnalysisColumn("dmx_angular_choice_r400"), {
    method: "dmx_angular",
    measure: "choice",
    radius: 400
  });
  assert.deepEqual(parseAnalysisColumn("pst_angular_integration_r400"), {
    method: "pst_angular",
    measure: "integration",
    radius: 400
  });
  assert.deepEqual(parseAnalysisColumn("angular_nain_r400"), {
    method: "angular",
    measure: "nain",
    radius: 400
  });
  assert.equal(parseAnalysisColumn("primal_integration_r400"), null);
  assert.equal(parseAnalysisColumn("graph_degree"), null);
  assert.equal(parseAnalysisColumn("sdna_mean_distance_r400"), null);
  assert.equal(parseAnalysisColumn("graph_choice_r400"), null);
  assert.equal(parseAnalysisColumn("dmx_choice_r123"), null);
  assert.equal(supportsAnalysis("dmx", "choice", 400), true);
  assert.equal(supportsAnalysis("dmx_angular", "choice", 400), true);
  assert.equal(supportsAnalysis("pst_angular", "choice", 400), true);
  assert.equal(supportsOnDemand("dmx", "integration"), true);
  assert.equal(supportsOnDemand("dmx_angular", "integration"), true);
  assert.equal(supportsOnDemand("pst_angular", "integration"), false);
  assert.equal(supportsOnDemand("dmx", "choice"), false);
  assert.equal(allowedAnalysisColumns().has("dmx_integration_r400"), true);
  assert.equal(allowedAnalysisColumns().has("dmx_angular_choice_r400"), true);
  assert.equal(allowedAnalysisColumns().has("pst_angular_integration_r400"), true);
  assert.equal(allowedAnalysisColumns().has("angular_nach_r400"), true);
  assert.equal(allowedAnalysisColumns().has("primal_choice_r400"), false);
  assert.equal(allowedAnalysisColumns().has("graph_degree"), false);
  assert.equal(allowedAnalysisColumns().has("sdna_mean_distance_r400"), false);
  assert.equal(allowedAnalysisColumns().has("graph_choice_r400"), false);
});

test("publishes a method catalog aligned with supported analysis columns", () => {
  const catalog = analysisMethodCatalog();
  const catalogColumns = new Set(catalog.map((entry) => entry.column));
  const allowedColumns = allowedAnalysisColumns();

  assert.equal(catalog.length, allowedColumns.size);
  for (const column of allowedColumns) {
    assert.equal(catalogColumns.has(column), true, `${column} missing from catalog`);
  }

  const finiteDmx = catalog.find((entry) => entry.column === "dmx_choice_r400");
  assert.ok(finiteDmx);
  assert.equal(finiteDmx.status, "compatible");
  assert.equal(finiteDmx.onDemand, false);
  assert.equal(finiteDmx.familyLabel, "DepthmapX-style metric");
  assert.equal(finiteDmx.measureLabel, "Metric choice");
  assert.equal(finiteDmx.displayName, "DepthmapX-style metric - Metric choice R400");

  const dmxAngularChoice = catalog.find((entry) => entry.column === "dmx_angular_choice_r400");
  assert.ok(dmxAngularChoice);
  assert.equal(dmxAngularChoice.familyLabel, "DepthmapX-style angular");
  assert.equal(dmxAngularChoice.measureLabel, "Angular choice");

  const pstAngularIntegration = catalog.find((entry) => entry.column === "pst_angular_integration_r400");
  assert.ok(pstAngularIntegration);
  assert.equal(pstAngularIntegration.familyLabel, "PST-style angular");
  assert.equal(pstAngularIntegration.measureLabel, "AngularIntegration");
  assert.equal(pstAngularIntegration.displayName, "PST-style angular - AngularIntegration R400");

  const angularChoice = catalog.find((entry) => entry.column === "angular_choice_r400");
  assert.ok(angularChoice);
  assert.equal(angularChoice.familyLabel, "Canonical engine angular");
  assert.equal(angularChoice.measureLabel, "Canonical angular choice");

  assert.equal(catalog.some((entry) => entry.column.startsWith("sdna_")), false);
  assert.equal(catalog.some((entry) => entry.column.startsWith("primal_")), false);
  assert.equal(catalog.some((entry) => entry.column.startsWith("graph_")), false);
});

test("computes selected website-aligned metric, DepthmapX angular, PST angular, and canonical angular columns", () => {
  const integration = computeAnalysisColumn(threeSegmentChainGraph, "dmx", "integration", 400);
  assert.equal(integration.column, "dmx_integration_r400");
  assert.equal(integration.values.length, threeSegmentChainGraph.segments.length);
  assert.equal(integration.methodMetadata.status, "compatible");
  assertFloat32Close([...integration.values], [2 / 30, 2 / 20, 2 / 30]);

  const choice = computeAnalysisColumnByName(threeSegmentChainGraph, "dmx_choice_r400");
  assert.deepEqual([...choice.values], [2, 3, 2]);

  const dmxAngular = computeAnalysisColumn(rightAngleGraph, "dmx_angular", "choice", 400);
  assert.equal(dmxAngular.column, "dmx_angular_choice_r400");
  assert.equal(dmxAngular.methodMetadata.status, "compatible");
  assert.ok(Number.isFinite(dmxAngular.values[0]));

  const pstAngular = computeAnalysisColumn(rightAngleGraph, "pst_angular", "integration", 400);
  assert.equal(pstAngular.column, "pst_angular_integration_r400");
  assert.equal(pstAngular.methodMetadata.status, "compatible");
  assert.ok(Number.isFinite(pstAngular.values[0]));

  const angular = computeAnalysisColumn(rightAngleGraph, "angular", "nain", 400);
  assert.equal(angular.column, "angular_nain_r400");
  assert.equal(angular.methodMetadata.status, "compatible");
  assert.ok(Number.isFinite(angular.values[0]));

  assert.throws(() => computeAnalysisColumnByName(threeSegmentChainGraph, "sdna_mean_distance_r400"), /Unsupported analysis column/);
  assert.throws(() => computeAnalysisColumnByName(threeSegmentChainGraph, "primal_integration_r400"), /Unsupported analysis column/);
  assert.throws(() => computeAnalysisColumnByName(threeSegmentChainGraph, "graph_degree"), /Unsupported analysis column/);
  assert.throws(() => computeAnalysisColumnByName(threeSegmentChainGraph, "graph_choice_r400"), /Unsupported analysis column/);
});

test("simulates worker init, fullmap, and ondemand messages", () => {
  const session = new EngineWorkerSession();
  const ready = session.handle({
    type: "init",
    source: new Float64Array([0, 1]),
    target: new Float64Array([1, 2]),
    length: new Float64Array([10, 10])
  });
  assert.equal(ready.type, "ready");
  if (ready.type === "ready") {
    assert.equal(ready.nSegments, 2);
    assert.match(ready.rowHash, /^[0-9a-f]{16}$/);
  }

  const fullmap = session.handle({
    type: "fullmap",
    method: "dmx",
    measure: "integration",
    radius: 400,
    reqId: 7
  });
  assert.equal(fullmap.type, "fullmap");
  if (fullmap.type === "fullmap") {
    assert.equal(fullmap.reqId, 7);
    assertFloat32Close([...fullmap.values], [0.1, 0.1]);
    assert.equal(fullmap.column, "dmx_integration_r400");
  }

  const ondemand = session.handle({
    type: "ondemand",
    method: "dmx",
    measure: "integration",
    segIndex: 1,
    radius: 400,
    reqId: 8
  });
  assert.equal(ondemand.type, "ondemand");
  if (ondemand.type === "ondemand") {
    assert.ok(Number.isFinite(ondemand.value));
  }
});

test("session emits progress around fullmap and route jobs", () => {
  const session = new EngineWorkerSession();
  const progress: EngineWorkerProgressMessage[] = [];
  session.handle({
    type: "init",
    source: new Float64Array([0, 1, 2]),
    target: new Float64Array([1, 2, 3]),
    length: new Float64Array([10, 10, 10])
  });

  const fullmap = session.handleWithProgress({
    type: "fullmap",
    method: "dmx_angular",
    measure: "choice",
    radius: 400,
    reqId: 31
  }, (message) => progress.push(message));

  assert.equal(fullmap.type, "fullmap");
  // A full map now reports granular per-root progress: a "started" event, one or
  // more "running" events as roots complete, then a final "completed" event.
  assert.ok(progress.every((message) => message.operation === "fullmap"));
  assert.ok(progress.every((message) => message.column === "dmx_angular_choice_r400"));
  const first = progress[0];
  const last = progress[progress.length - 1];
  assert.equal(first.phase, "started");
  assert.equal(first.completed, 0);
  assert.equal(first.total, 3);
  assert.equal(last.phase, "completed");
  assert.equal(last.completed, 3);
  assert.equal(last.total, 3);
  const running = progress.slice(1, -1);
  assert.ok(running.length > 0, "expected at least one running progress event");
  assert.ok(running.every((message) => message.phase === "running"));
  // Running progress is strictly monotonic and bounded within (0, total).
  let previous = 0;
  for (const message of running) {
    assert.ok(message.completed > previous && message.completed < message.total);
    previous = message.completed;
  }

  progress.length = 0;
  const route = session.handleWithProgress({
    type: "route",
    mode: "metric",
    fromSeg: 0,
    toSeg: 2,
    reqId: 32
  }, (message) => progress.push(message));

  assert.equal(route.type, "route");
  assert.deepEqual(progress.map((message) => `${message.operation}:${message.phase}`), ["route:started", "route:completed"]);
  assert.equal(progress[0].mode, "metric");
});

test("worker session returns explicit errors before init and computes routes after init", () => {
  const session = new EngineWorkerSession();
  const beforeInit = session.handle({
    type: "fullmap",
    method: "dmx",
    measure: "integration",
    radius: 400,
    reqId: 1
  });
  assert.equal(beforeInit.type, "error");

  session.handle({
    type: "init",
    source: new Float64Array([0, 1, 2]),
    target: new Float64Array([1, 2, 3]),
    length: new Float64Array([10, 10, 10]),
    x0: new Float64Array([0, 10, 20]),
    y0: new Float64Array([0, 0, 0]),
    x1: new Float64Array([10, 20, 30]),
    y1: new Float64Array([0, 0, 0])
  });

  const angular = session.handle({
    type: "fullmap",
    method: "angular",
    measure: "nain",
    radius: 400,
    reqId: 2
  });
  assert.equal(angular.type, "fullmap");

  const route = session.handle({
    type: "route",
    mode: "metric",
    fromSeg: 0,
    toSeg: 2,
    reqId: 3
  });
  assert.equal(route.type, "route");
  if (route.type === "route") {
    assert.deepEqual([...route.segmentIndexes], [0, 1, 2]);
    assert.equal(route.distanceM, 20);
  }

  const noRoute = session.handle({
    type: "route",
    mode: "angular",
    fromSeg: 0,
    toSeg: 99,
    reqId: 4
  });
  assert.equal(noRoute.type, "error");
  if (noRoute.type === "error") {
    assert.match(noRoute.message, /No route found/);
  }
});

test("browser worker wrapper posts responses with transferable output buffers", () => {
  const posted: Array<{ message: ReturnType<EngineWorkerSession["handle"]>; transfer?: ArrayBuffer[] }> = [];
  const handler = createEngineWorkerMessageHandler(new EngineWorkerSession(), {
    postMessage(message, transfer) {
      posted.push({ message, transfer });
    }
  });

  handler({
    type: "init",
    source: new Float64Array([0, 1]),
    target: new Float64Array([1, 2]),
    length: new Float64Array([10, 10])
  });
  assert.equal(posted[0].message.type, "ready");
  assert.deepEqual(posted[0].transfer, []);

  handler({
    type: "fullmap",
    method: "pst_angular",
    measure: "integration",
    radius: 400,
    reqId: 12
  });
  // After "ready": a run of "progress" messages (started → running… → completed),
  // then the transferable "fullmap" response posted last.
  const afterReady = posted.slice(1);
  const fullmapPost = afterReady[afterReady.length - 1];
  const progressPosts = afterReady.slice(0, -1);
  assert.ok(progressPosts.length >= 2);
  assert.ok(progressPosts.every((item) => item.message.type === "progress"));
  assert.ok(progressPosts.every((item) => item.transfer.length === 0));
  assert.equal(fullmapPost.message.type, "fullmap");
  if (fullmapPost.message.type === "fullmap") {
    assert.deepEqual(fullmapPost.transfer, [fullmapPost.message.values.buffer]);
    assert.deepEqual(transferablesForResponse(fullmapPost.message), [fullmapPost.message.values.buffer]);
  }
});

test("worker attachment registers exactly one message handler", () => {
  let listenerCount = 0;
  const posted: unknown[] = [];
  const scope = {
    onmessage: null,
    postMessage(message: unknown) {
      posted.push(message);
    },
    addEventListener(type: "message") {
      if (type === "message") listenerCount += 1;
    }
  };

  const handler = attachEngineWorker(scope);
  assert.equal(scope.onmessage, handler);
  assert.equal(listenerCount, 0);
});

function assertFloat32Close(actual: readonly number[], expected: readonly number[], epsilon = 1e-6): void {
  assert.equal(actual.length, expected.length);
  for (let index = 0; index < actual.length; index += 1) {
    assert.ok(Math.abs(actual[index] - expected[index]) <= epsilon, `index ${index}: ${actual[index]} !== ${expected[index]}`);
  }
}

function straightChainGraph(segmentCount: number): CanonicalGraph {
  const segments = [];
  for (let index = 0; index < segmentCount; index += 1) {
    const x = index * 10;
    segments.push({
      segment_id: index,
      source: index,
      target: index + 1,
      length_m: 10,
      geometry: { type: "LineString" as const, coordinates: [[x, 0], [x + 10, 0]] }
    });
  }
  return { segments };
}

test("granular progress is monotonic and never changes analysis values", () => {
  // Large enough that the ~100-step ticker fires several intermediate events.
  const graph = straightChainGraph(20);
  const columns = [
    "dmx_integration_r400",
    "dmx_choice_r400",
    "dmx_angular_integration_r400",
    "dmx_angular_choice_r400",
    "pst_angular_integration_r400",
    "pst_angular_choice_r400",
    "angular_integration_r400",
    "angular_nain_r400",
    "angular_choice_r400",
    "angular_nach_r400"
  ];

  for (const column of columns) {
    const parsed = parseAnalysisColumn(column);
    assert.ok(parsed, `expected ${column} to parse`);
    if (!parsed) continue;

    const baseline = computeAnalysisColumn(graph, parsed.method, parsed.measure, parsed.radius);
    const events: Array<{ completed: number; total: number }> = [];
    const reported = computeAnalysisColumn(graph, parsed.method, parsed.measure, parsed.radius, (completed, total) => {
      events.push({ completed, total });
    });

    // Parity: the progress callback is purely additive — values are byte-identical.
    assert.deepEqual([...reported.values], [...baseline.values], `${column} values changed under progress reporting`);

    // At least one intermediate event, strictly increasing and bounded within (0, total).
    assert.ok(events.length > 0, `${column} reported no progress`);
    let previous = 0;
    for (const { completed, total } of events) {
      assert.ok(completed > previous && completed < total, `${column} progress not monotonic in-range`);
      previous = completed;
    }
  }
});
