import assert from "node:assert/strict";
import test from "node:test";
import { buildPrimalAdjacency, getNodeIds, validateCanonicalGraph } from "../packages/core/src/index.ts";
import { dijkstra, breadthFirstDistances, reconstructPath } from "../packages/shortest-path/src/index.ts";
import { shortestRoute } from "../packages/shortest-path/src/route.ts";
import {
  farness,
  harmonicCloseness,
  meanDepth,
  nodeBetweenness,
  nodeComponentIds,
  nodeDegree,
  reachCount,
  segmentBetweenness,
  segmentComponentIds,
  segmentDegree,
  angularChoice,
  canonicalAngularChoice,
  angularIntegration,
  angularNach,
  angularNain,
  depthmapXMetricChoice,
  depthmapXMetricIntegration,
  cityseerSimplestBetweenness,
  cityseerSimplestHarmonic,
  primalChoice,
  primalIntegration,
  pstAngularAnalysis,
  pstAngularChoice,
  pstAngularChoiceNormalized,
  pstAngularChoiceSyntaxNormalized,
  pstAngularHillierIntegration,
  pstAngularIntegration,
  pstAngularNodeCount,
  pstAngularSyntaxIntegration,
  pstAngularTotalDepth,
  pstPlaceGravity,
  pstPlaceAngularGravity,
  pstPlaceAngularReach,
  pstPlaceMeanDistance,
  pstPlaceMeanAngularDistance,
  pstPlaceReach,
  sdnaMetricBetweenness,
  sdnaAngularBetweenness,
  sdnaAngularLineCurvature,
  sdnaAngularMeanDistance,
  sdnaMetricLength,
  sdnaMetricLinkCount,
  sdnaMetricMeanDistance,
  sdnaMetricWeight
} from "../packages/centrality/src/index.ts";
import { chainGraph, crossGraph, disconnectedGraph, rightAngleGraph, threeSegmentChainGraph } from "./fixtures/tiny-graphs.ts";

test("validates a canonical graph and builds sorted node ids", () => {
  validateCanonicalGraph(chainGraph);
  assert.deepEqual(getNodeIds(chainGraph), [0, 1, 2]);
});

test("computes metric and topological shortest paths", () => {
  const adjacency = buildPrimalAdjacency(chainGraph);
  const nodeIds = getNodeIds(chainGraph);

  const metric = dijkstra(adjacency, 0, { nodeIds });
  assert.deepEqual([...metric.distances], [0, 10, 20]);
  assert.deepEqual(reconstructPath(nodeIds, metric, 2), [0, 1, 2]);

  const topological = breadthFirstDistances(adjacency, 0, { nodeIds });
  assert.deepEqual([...topological.distances], [0, 1, 2]);
});

test("computes degree for nodes and segments", () => {
  assert.deepEqual([...nodeDegree(crossGraph).values], [1, 4, 1, 1, 1]);
  assert.deepEqual([...segmentDegree(crossGraph).values], [3, 3, 3, 3]);
});

test("computes connected components for nodes and segments", () => {
  assert.deepEqual([...nodeComponentIds(disconnectedGraph).values], [0, 0, 0, 1, 1]);
  assert.deepEqual([...segmentComponentIds(disconnectedGraph).values], [0, 0, 1]);
});

test("computes metric reach, farness, harmonic closeness, and mean depth", () => {
  assert.deepEqual([...reachCount(chainGraph).values], [2, 2, 2]);
  assert.deepEqual([...farness(chainGraph).values], [30, 20, 30]);
  assert.deepEqual([...meanDepth(chainGraph).values], [15, 10, 15]);
  assertFloatArrayClose([...harmonicCloseness(chainGraph).values], [0.15, 0.2, 0.15]);
});

test("respects radius-bounded metric centrality", () => {
  assert.deepEqual([...reachCount(chainGraph, { radius: 10 }).values], [1, 2, 1]);
  assert.deepEqual([...farness(chainGraph, { radius: 10 }).values], [10, 20, 10]);
});

test("computes exact node and segment betweenness on tiny fixtures", () => {
  assert.deepEqual([...nodeBetweenness(chainGraph, { mode: "topological" }).values], [0, 1, 0]);
  assert.deepEqual([...nodeBetweenness(crossGraph, { mode: "topological" }).values], [0, 6, 0, 0, 0]);
  assert.deepEqual([...segmentBetweenness(chainGraph, { mode: "topological" }).values], [2, 2]);
});

test("computes DepthmapX-style metric segment integration and choice", () => {
  assertFloatArrayClose([...depthmapXMetricIntegration(chainGraph, 100).values], [0.1, 0.1]);
  assert.deepEqual([...depthmapXMetricChoice(chainGraph, 100).values], [1, 1]);
  assertFloatArrayClose([...depthmapXMetricIntegration(threeSegmentChainGraph, 100).values], [2 / 30, 2 / 20, 2 / 30]);
  assert.deepEqual([...depthmapXMetricChoice(threeSegmentChainGraph, 100).values], [2, 3, 2]);
});

test("computes cityseer-inspired primal integration and choice", () => {
  assertFloatArrayClose([...primalIntegration(chainGraph, 100).values], [0.175, 0.175]);
  assert.deepEqual([...primalChoice(chainGraph, 100).values], [4, 4]);
  assert.deepEqual([...primalChoice(threeSegmentChainGraph, 100).values], [6, 8, 6]);

  const bounded = primalIntegration(chainGraph, 10);
  assertFloatArrayClose([...bounded.values], [0.15, 0.15]);
});

test("computes cityseer simplest angular harmonic and betweenness analogues", () => {
  const chainHarmonic = cityseerSimplestHarmonic(threeSegmentChainGraph, 400);
  assert.equal(chainHarmonic.status, "compatible");
  assertFloatArrayClose([...chainHarmonic.values], [2, 2, 2], 2e-7);

  const rightAngleHarmonic = cityseerSimplestHarmonic(rightAngleGraph, 400);
  assertFloatArrayClose([...rightAngleHarmonic.values], [2 / 3, 2 / 3], 3e-8);

  const scaledRightAngle = cityseerSimplestHarmonic(rightAngleGraph, 400, { angularScalingUnit: 90 });
  assertFloatArrayClose([...scaledRightAngle.values], [0.5, 0.5], 3e-8);

  const bounded = cityseerSimplestHarmonic(rightAngleGraph, 5);
  assert.deepEqual([...bounded.values], [0, 0]);

  const chainChoice = cityseerSimplestBetweenness(threeSegmentChainGraph, 400);
  assertFloatArrayClose([...chainChoice.values], [0, 1, 0], 1e-9);
});

test("computes experimental sDNA-style metric link centrality", () => {
  const meanDistance = sdnaMetricMeanDistance(threeSegmentChainGraph, 400);
  assert.equal(meanDistance.status, "experimental");
  assert.deepEqual([...meanDistance.values], [15, 10, 15]);

  const choice = sdnaMetricBetweenness(threeSegmentChainGraph, 400);
  assert.deepEqual([...choice.values], [0, 1, 0]);

  const links = sdnaMetricLinkCount(threeSegmentChainGraph, 15);
  assert.deepEqual([...links.values], [2, 3, 2]);

  const length = sdnaMetricLength(threeSegmentChainGraph, 15);
  assert.deepEqual([...length.values], [20, 30, 20]);

  const weight = sdnaMetricWeight(threeSegmentChainGraph, 15, {
    destinationWeights: new Float64Array([2, 3, 5])
  });
  assert.deepEqual([...weight.values], [5, 10, 8]);

  const localChoice = sdnaMetricBetweenness(threeSegmentChainGraph, 15);
  assert.deepEqual([...localChoice.values], [0, 0, 0]);
});

test("computes experimental sDNA-style angular link centrality", () => {
  const meanDistance = sdnaAngularMeanDistance(rightAngleGraph, 180);
  assert.equal(meanDistance.status, "experimental");
  assert.deepEqual([...meanDistance.values], [45, 45]);

  const choice = sdnaAngularBetweenness(rightAngleGraph, 180);
  assertFloatArrayClose([...choice.values], [4 / 3, 4 / 3]);

  const chainMeanDistance = sdnaAngularMeanDistance(threeSegmentChainGraph, 180);
  assert.deepEqual([...chainMeanDistance.values], [0, 0, 0]);

  const bounded = sdnaAngularMeanDistance(rightAngleGraph, 45);
  assert.deepEqual([...bounded.values], [0, 0]);

  const bentLineGraph = {
    segments: [
      {
        segment_id: 0,
        source: 0,
        target: 1,
        length_m: 20,
        geometry: { type: "LineString" as const, coordinates: [[0, 0], [10, 0], [10, 10]] }
      }
    ]
  };
  assert.deepEqual([...sdnaAngularLineCurvature(bentLineGraph).values], [90]);
  assert.deepEqual([...sdnaAngularMeanDistance(bentLineGraph, 180).values], [30]);
  assertFloatArrayClose([...sdnaAngularBetweenness(bentLineGraph, 180).values], [1 / 3]);
});

test("computes experimental PST-style weighted place accessibility", () => {
  const destinationWeights = new Float64Array([0, 10, 0]);

  const reach = pstPlaceReach(threeSegmentChainGraph, 400, { destinationWeights });
  assert.equal(reach.status, "experimental");
  assert.deepEqual([...reach.values], [10, 10, 10]);

  const gravity = pstPlaceGravity(threeSegmentChainGraph, 400, {
    destinationWeights,
    decayBeta: 1,
    selfDistance: 1
  });
  assert.deepEqual([...gravity.values], [1, 10, 1]);

  const meanDistance = pstPlaceMeanDistance(threeSegmentChainGraph, 400, { destinationWeights });
  assert.deepEqual([...meanDistance.values], [10, 0, 10]);

  const bounded = pstPlaceReach(threeSegmentChainGraph, 15, {
    destinationWeights: new Float64Array([2, 3, 5])
  });
  assert.deepEqual([...bounded.values], [5, 10, 8]);
});

test("computes experimental PST-style angular weighted place accessibility", () => {
  const destinationWeights = new Float64Array([0, 10]);

  const reach = pstPlaceAngularReach(rightAngleGraph, 180, { destinationWeights });
  assert.equal(reach.status, "experimental");
  assert.deepEqual([...reach.values], [10, 10]);

  const gravity = pstPlaceAngularGravity(rightAngleGraph, 180, {
    destinationWeights,
    decayBeta: 1,
    selfDistance: 1
  });
  assert.deepEqual([...gravity.values], [10 / 90, 10]);

  const meanDistance = pstPlaceMeanAngularDistance(rightAngleGraph, 180, { destinationWeights });
  assert.deepEqual([...meanDistance.values], [90, 0]);
});

test("matches PST Pstalgo angular integration fixture semantics", () => {
  const chain = pstSegmentChainGraph(5, 3);
  assert.deepEqual([...pstAngularNodeCount(chain).values], [5, 5, 5, 5, 5]);
  assert.deepEqual([...pstAngularTotalDepth(chain).values], [0, 0, 0, 0, 0]);
  assert.deepEqual([...pstAngularIntegration(chain).values], [4, 4, 4, 4, 4]);
  assertFloatArrayClose([...pstAngularSyntaxIntegration(chain).values], Array(5).fill(5 ** 1.2));
  assert.deepEqual([...pstAngularHillierIntegration(chain).values], [25, 25, 25, 25, 25]);

  const square = pstSegmentSquareGraph(3);
  assert.deepEqual([...pstAngularNodeCount(square).values], [4, 4, 4, 4]);
  assert.deepEqual([...pstAngularTotalDepth(square).values], [4, 4, 4, 4]);
  assert.deepEqual([...pstAngularIntegration(square).values], [3 / 5, 3 / 5, 3 / 5, 3 / 5]);
  assertFloatArrayClose([...pstAngularSyntaxIntegration(square).values], Array(4).fill(4 ** 1.2 / 5));

  assert.deepEqual([...pstAngularNodeCount(square, { radii: { angular: 80 } }).values], [1, 1, 1, 1]);
  assert.deepEqual([...pstAngularTotalDepth(square, { radii: { angular: 80 } }).values], [0, 0, 0, 0]);
  assert.deepEqual([...pstAngularNodeCount(square, { radii: { angular: 100 } }).values], [3, 3, 3, 3]);
  assert.deepEqual([...pstAngularTotalDepth(square, { radii: { angular: 100 } }).values], [2, 2, 2, 2]);
});

test("matches PST Pstalgo angular choice fixture semantics", () => {
  const chain = pstSegmentChainGraph(5, 3);
  const chainAnalysis = pstAngularAnalysis(chain);
  assert.deepEqual([...chainAnalysis.choice], [0, 6, 8, 6, 0]);
  assert.deepEqual([...pstAngularChoice(chain).values], [0, 6, 8, 6, 0]);

  const weightedChain = pstAngularAnalysis(chain, { weighByLength: true });
  assert.deepEqual([...weightedChain.choice], [36, 90, 108, 90, 36]);

  const square = pstSegmentSquareGraph(3);
  assert.deepEqual([...pstAngularChoice(square).values], [1, 1, 1, 1]);
  assert.deepEqual([...pstAngularAnalysis(square, { weighByLength: true }).choice], [36, 36, 36, 36]);
  assertFloatArrayClose([...pstAngularChoiceNormalized(square).values], [1 / 6, 1 / 6, 1 / 6, 1 / 6]);
  assertFloatArrayClose(
    [...pstAngularChoiceSyntaxNormalized(square).values],
    Array(4).fill(Math.log10(2) / Math.log10(6))
  );
});

test("computes angular segment integration, NAIN, choice, and NACH", () => {
  const integration = angularIntegration(rightAngleGraph, 100);
  assert.equal(integration.method, "angular_integration_r100");
  assert.equal(integration.status, "compatible");
  assert.ok(Number.isFinite(integration.values[0]));
  assert.ok(Number.isFinite(integration.values[1]));
  assertFloatArrayClose([...integration.values], [integration.values[1], integration.values[0]]);

  const nain = angularNain(rightAngleGraph, 100);
  assert.ok(Number.isFinite(nain.values[0]));
  assertFloatArrayClose([...nain.values], [nain.values[1], nain.values[0]]);

  // Choice credits intermediate segments only (endpoint segments excluded), matching standard
  // space-syntax betweenness. Adjacent-only pairs have no intermediate, so both segments score 0.
  assert.deepEqual([...angularChoice(rightAngleGraph, 100).values], [0, 0]);
  // On a three-segment chain only the middle segment is an intermediate (for the {0,2} pair).
  assert.deepEqual([...angularChoice(threeSegmentChainGraph, 100).values], [0, 1, 0]);
  const canonicalChoice = canonicalAngularChoice(rightAngleGraph, 100);
  assert.equal(canonicalChoice.method, "canonical_angular_choice_r100");
  assert.deepEqual([...canonicalChoice.values], [...angularChoice(rightAngleGraph, 100).values]);
  const nach = angularNach(rightAngleGraph, 100);
  assert.ok(Number.isFinite(nach.values[0]));
  assertFloatArrayClose([...nach.values], [nach.values[1], nach.values[0]]);

  // Direct API (offset 0, DepthmapX-style N^2/TD) is NaN on a zero-angular-depth straight chain,
  // but the website angular column (offset 1) stays finite there.
  assert.equal(Number.isNaN(angularIntegration(chainGraph, 100).values[0]), true);
  assert.equal(Number.isFinite(angularIntegration(chainGraph, 100, 1).values[0]), true);
});

test("computes metric, angular, and vector routes as segment id paths", () => {
  const metric = shortestRoute(threeSegmentChainGraph, "metric", 0, 2);
  assert.ok(metric);
  assert.deepEqual([...metric.segmentIndexes], [0, 1, 2]);
  assert.equal(metric.distanceM, 20);

  const angular = shortestRoute(threeSegmentChainGraph, "angular", 0, 2);
  assert.ok(angular);
  assert.deepEqual([...angular.segmentIndexes], [0, 1, 2]);
  assert.equal(angular.distanceM, 20);
  assert.equal(angular.angularCost, 0);

  const vector = shortestRoute(threeSegmentChainGraph, "vectorMetric", 0, 2);
  assert.ok(vector);
  assert.deepEqual([...vector.segmentIndexes], [0, 1, 2]);
  assert.equal(vector.distanceM, 20);
  assert.equal(vector.vectorCost, 0);

  const same = shortestRoute(threeSegmentChainGraph, "metric", 1, 1);
  assert.ok(same);
  assert.deepEqual([...same.segmentIndexes], [1]);
  assert.equal(same.distanceM, 0);
});

function assertFloatArrayClose(actual: readonly number[], expected: readonly number[], epsilon = 1e-12): void {
  assert.equal(actual.length, expected.length);
  for (let index = 0; index < actual.length; index += 1) {
    assert.ok(Math.abs(actual[index] - expected[index]) <= epsilon, `index ${index}: ${actual[index]} !== ${expected[index]}`);
  }
}

function pstSegmentChainGraph(lineCount: number, lineLength: number): typeof chainGraph {
  return {
    segments: Array.from({ length: lineCount }, (_, index) => ({
      segment_id: index,
      source: index,
      target: index + 1,
      length_m: lineLength,
      geometry: {
        type: "LineString" as const,
        coordinates: [[index * lineLength, 0], [(index + 1) * lineLength, 0]]
      }
    }))
  };
}

function pstSegmentSquareGraph(lineLength: number): typeof chainGraph {
  return {
    segments: [
      {
        segment_id: 0,
        source: 0,
        target: 1,
        length_m: lineLength,
        geometry: { type: "LineString", coordinates: [[0, 0], [lineLength, 0]] }
      },
      {
        segment_id: 1,
        source: 1,
        target: 2,
        length_m: lineLength,
        geometry: { type: "LineString", coordinates: [[lineLength, 0], [lineLength, lineLength]] }
      },
      {
        segment_id: 2,
        source: 2,
        target: 3,
        length_m: lineLength,
        geometry: { type: "LineString", coordinates: [[lineLength, lineLength], [0, lineLength]] }
      },
      {
        segment_id: 3,
        source: 3,
        target: 0,
        length_m: lineLength,
        geometry: { type: "LineString", coordinates: [[0, lineLength], [0, 0]] }
      }
    ]
  };
}
