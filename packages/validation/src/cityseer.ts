import type { CanonicalGraph } from "../../core/src/index.ts";
import { harmonicCloseness } from "../../centrality/src/index.ts";
import { primalIntegration } from "../../centrality/src/primal.ts";

export interface CityseerFixtureComparison {
  radius: number;
  nodeHarmonic: {
    expected: number[];
    engine: number[];
    maxAbsoluteDifference: number;
  };
  projectedSegmentHarmonic: {
    expected: number[];
    engine: number[];
    maxAbsoluteDifference: number;
  };
}

export interface CityseerValidationReport {
  fixture: string;
  reference: {
    repository: string;
    file: string;
    test: string;
    note: string;
  };
  runtime: {
    liveCityseerAvailable: boolean;
    reason: string;
  };
  comparisons: CityseerFixtureComparison[];
  status: "pass" | "review";
  notes: string[];
}

const DIAMOND_EXPECTED_NODE_HARMONIC = new Map<number, number[]>([
  [50, [0, 0, 0, 0]],
  [150, [0.02, 0.03, 0.03, 0.02]],
  [250, [0.025, 0.03, 0.03, 0.025]]
]);

export function cityseerDiamondGraph(): CanonicalGraph {
  const coords = [
    [0, -86.60254],
    [-50, 0],
    [50, 0],
    [0, 86.60254]
  ] as const;
  const edges = [
    [0, 1],
    [0, 2],
    [1, 2],
    [1, 3],
    [2, 3]
  ] as const;
  return {
    segments: edges.map(([source, target], segmentId) => {
      const a = coords[source];
      const b = coords[target];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      return {
        segment_id: segmentId,
        source,
        target,
        length_m: length,
        geometry: { type: "LineString", coordinates: [a, b] },
        x0: a[0],
        y0: a[1],
        x1: b[0],
        y1: b[1]
      };
    })
  };
}

export function validateCityseerDiamondFixture(): CityseerValidationReport {
  const graph = cityseerDiamondGraph();
  const comparisons: CityseerFixtureComparison[] = [];
  const notes: string[] = [];

  for (const [radius, expectedNodeHarmonic] of DIAMOND_EXPECTED_NODE_HARMONIC) {
    const engineNodeHarmonic = [...harmonicCloseness(graph, { radius }).values];
    const expectedProjected = projectNodeValuesToSegments(graph, expectedNodeHarmonic);
    const engineProjected = [...primalIntegration(graph, radius).values];
    comparisons.push({
      radius,
      nodeHarmonic: {
        expected: expectedNodeHarmonic,
        engine: engineNodeHarmonic,
        maxAbsoluteDifference: maxAbsoluteDifference(expectedNodeHarmonic, engineNodeHarmonic)
      },
      projectedSegmentHarmonic: {
        expected: expectedProjected,
        engine: engineProjected,
        maxAbsoluteDifference: maxAbsoluteDifference(expectedProjected, engineProjected)
      }
    });
  }

  if (comparisons.some((comparison) =>
    comparison.nodeHarmonic.maxAbsoluteDifference > 1e-7 ||
    comparison.projectedSegmentHarmonic.maxAbsoluteDifference > 1e-7
  )) {
    notes.push("Engine values differ from the cityseer diamond fixture expected values.");
  }
  notes.push("This validates the node-harmonic subset and the segment projection used by the API-only primal_integration helper; it does not validate cityseer segment_centrality or betweenness semantics.");

  return {
    fixture: "cityseer diamond graph",
    reference: {
      repository: "https://github.com/benchmark-urbanism/cityseer-api",
      file: "tests/rustalgos/test_centrality.py",
      test: "test_local_centrality_all",
      note: "Expected node_harmonic values for distances 50, 150, and 250 are taken from cityseer's own test fixture."
    },
    runtime: {
      liveCityseerAvailable: false,
      reason: "The local validation environment does not currently have the cityseer Python package/Rust extension installed."
    },
    comparisons,
    status: notes.length === 1 ? "pass" : "review",
    notes
  };
}

function projectNodeValuesToSegments(graph: CanonicalGraph, nodeValues: readonly number[]): number[] {
  return graph.segments.map((segment) => (nodeValues[segment.source] + nodeValues[segment.target]) / 2);
}

function maxAbsoluteDifference(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) throw new Error(`Length mismatch: ${a.length} !== ${b.length}`);
  let max = 0;
  for (let i = 0; i < a.length; i += 1) {
    max = Math.max(max, Math.abs(a[i] - b[i]));
  }
  return max;
}
