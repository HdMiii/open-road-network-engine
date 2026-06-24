import type { Adjacency, CanonicalGraph, DualAdjacency, GraphEdge } from "./types.ts";
import { validateCanonicalGraph } from "./validation.ts";

export function getNodeIds(graph: CanonicalGraph): number[] {
  const ids = new Set<number>();
  for (const segment of graph.segments) {
    ids.add(segment.source);
    ids.add(segment.target);
  }
  return [...ids].sort((a, b) => a - b);
}

export function buildPrimalAdjacency(graph: CanonicalGraph): Adjacency {
  validateCanonicalGraph(graph);
  const adjacency: Adjacency = new Map();

  for (let segmentIndex = 0; segmentIndex < graph.segments.length; segmentIndex += 1) {
    const segment = graph.segments[segmentIndex];
    addEdge(adjacency, {
      from: segment.source,
      to: segment.target,
      segmentIndex,
      segmentId: segment.segment_id,
      weight: segment.length_m
    });
    addEdge(adjacency, {
      from: segment.target,
      to: segment.source,
      segmentIndex,
      segmentId: segment.segment_id,
      weight: segment.length_m
    });
  }

  return adjacency;
}

export function buildDualAdjacency(graph: CanonicalGraph): DualAdjacency {
  validateCanonicalGraph(graph);
  const byNode = new Map<number, number[]>();
  graph.segments.forEach((segment, segmentIndex) => {
    append(byNode, segment.source, segmentIndex);
    append(byNode, segment.target, segmentIndex);
  });

  const adjacency: DualAdjacency = new Map();
  for (const [viaNode, segmentIndexes] of byNode) {
    for (const fromSegmentIndex of segmentIndexes) {
      for (const toSegmentIndex of segmentIndexes) {
        if (fromSegmentIndex === toSegmentIndex) continue;
        append(adjacency, fromSegmentIndex, {
          fromSegmentIndex,
          toSegmentIndex,
          viaNode,
          weight: graph.segments[toSegmentIndex].length_m
        });
      }
    }
  }
  return adjacency;
}

export function nodeIndexMap(graph: CanonicalGraph): Map<number, number> {
  const ids = getNodeIds(graph);
  return new Map(ids.map((id, index) => [id, index]));
}

function addEdge(adjacency: Adjacency, edge: GraphEdge): void {
  append(adjacency, edge.from, edge);
}

function append<T>(map: Map<number, T[]>, key: number, value: T): void {
  const values = map.get(key);
  if (values) {
    values.push(value);
  } else {
    map.set(key, [value]);
  }
}

