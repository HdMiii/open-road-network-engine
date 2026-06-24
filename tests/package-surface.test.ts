import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalizeLineNetwork,
  computeAnalysisColumn,
  pstPlaceAngularReach,
  pstPlaceReach,
  sdnaAngularMeanDistance,
  sdnaMetricMeanDistance,
  shortestRoute
} from "open-road-network-engine";
import { depthmapXMetricChoice } from "open-road-network-engine/centrality";
import { readFlatGeobufCanonicalGraph, writeFlatGeobufCanonicalGraph } from "open-road-network-engine/io";
import { shortestRoute as shortestRouteFromSubpath } from "open-road-network-engine/shortest-path/route";
import { parseAnalysisColumn } from "open-road-network-engine/website-adapter";
import { chainGraph, threeSegmentChainGraph } from "./fixtures/tiny-graphs.ts";

test("exposes the public package API from the root export", () => {
  const canonical = canonicalizeLineNetwork([
    {
      id: "a",
      properties: {},
      geometry: { type: "LineString", coordinates: [[0, 0], [10, 0]] }
    }
  ]);
  assert.equal(canonical.graph.segments.length, 1);

  const sdna = sdnaMetricMeanDistance(threeSegmentChainGraph, 400);
  assert.deepEqual([...sdna.values], [15, 10, 15]);

  const sdnaAngular = sdnaAngularMeanDistance(threeSegmentChainGraph, 180);
  assert.deepEqual([...sdnaAngular.values], [0, 0, 0]);

  const pst = pstPlaceReach(threeSegmentChainGraph, 400, {
    destinationWeights: new Float64Array([0, 10, 0])
  });
  assert.deepEqual([...pst.values], [10, 10, 10]);

  const pstAngular = pstPlaceAngularReach(threeSegmentChainGraph, 180, {
    destinationWeights: new Float64Array([0, 10, 0])
  });
  assert.deepEqual([...pstAngular.values], [10, 10, 10]);

  const column = computeAnalysisColumn(chainGraph, "pst_angular", "integration", 400);
  assert.equal(column.column, "pst_angular_integration_r400");

  const route = shortestRoute(threeSegmentChainGraph, "metric", 0, 2);
  assert.ok(route);
  assert.deepEqual([...route.segmentIndexes], [0, 1, 2]);
});

test("exposes documented package subpaths", async () => {
  assert.deepEqual([...depthmapXMetricChoice(threeSegmentChainGraph, 400).values], [2, 3, 2]);
  assert.equal(parseAnalysisColumn("sdna_mean_distance_r400"), null);

  const route = shortestRouteFromSubpath(threeSegmentChainGraph, "metric", 0, 2);
  assert.ok(route);
  assert.deepEqual([...route.segmentIndexes], [0, 1, 2]);

  const bytes = writeFlatGeobufCanonicalGraph(chainGraph);
  const roundTrip = await readFlatGeobufCanonicalGraph(bytes);
  assert.equal(roundTrip.graph.segments.length, 2);
});
