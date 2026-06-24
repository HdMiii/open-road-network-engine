import { MinPriorityQueue } from "../../core/src/priority-queue.ts";
import type { CanonicalGraph } from "../../core/src/types.ts";

export interface SegmentCenterEdge {
  to: number;
  weight: number;
}

export interface SegmentCenterShortestPaths {
  distances: Float64Array;
  sigma: Float64Array;
  predecessors: number[][];
  stack: number[];
}

const EPSILON = 1e-9;

export function buildSegmentCenterAdjacency(graph: CanonicalGraph): SegmentCenterEdge[][] {
  const adjacency = Array.from({ length: graph.segments.length }, () => [] as SegmentCenterEdge[]);
  const segmentIndexesByNode = new Map<number, number[]>();
  graph.segments.forEach((segment, segmentIndex) => {
    addNodeSegment(segmentIndexesByNode, segment.source, segmentIndex);
    addNodeSegment(segmentIndexesByNode, segment.target, segmentIndex);
  });

  for (const segmentIndexes of segmentIndexesByNode.values()) {
    for (let i = 0; i < segmentIndexes.length; i += 1) {
      for (let j = i + 1; j < segmentIndexes.length; j += 1) {
        const a = segmentIndexes[i];
        const b = segmentIndexes[j];
        const weight = (graph.segments[a].length_m + graph.segments[b].length_m) / 2;
        adjacency[a].push({ to: b, weight });
        adjacency[b].push({ to: a, weight });
      }
    }
  }
  return adjacency;
}

export function buildSegmentCenterAngularAdjacency(graph: CanonicalGraph): SegmentCenterEdge[][] {
  const adjacency = Array.from({ length: graph.segments.length }, () => [] as SegmentCenterEdge[]);
  const segmentIndexesByNode = new Map<number, number[]>();
  graph.segments.forEach((segment, segmentIndex) => {
    addNodeSegment(segmentIndexesByNode, segment.source, segmentIndex);
    addNodeSegment(segmentIndexesByNode, segment.target, segmentIndex);
  });

  for (const [nodeId, segmentIndexes] of segmentIndexesByNode) {
    for (let i = 0; i < segmentIndexes.length; i += 1) {
      for (let j = i + 1; j < segmentIndexes.length; j += 1) {
        const a = segmentIndexes[i];
        const b = segmentIndexes[j];
        const weight = turnAngleAtNodeDegrees(graph, a, b, nodeId);
        adjacency[a].push({ to: b, weight });
        adjacency[b].push({ to: a, weight });
      }
    }
  }
  return adjacency;
}

export function segmentCenterDijkstra(
  adjacency: readonly SegmentCenterEdge[][],
  source: number,
  radius: number
): SegmentCenterShortestPaths {
  const distances = new Float64Array(adjacency.length);
  distances.fill(Number.POSITIVE_INFINITY);
  distances[source] = 0;
  const sigma = new Float64Array(adjacency.length);
  sigma[source] = 1;
  const predecessors = Array.from({ length: adjacency.length }, () => [] as number[]);
  const queue = new MinPriorityQueue();
  const settled = new Uint8Array(adjacency.length);
  const stack: number[] = [];
  queue.push(source, 0);

  while (queue.size > 0) {
    const item = queue.pop();
    if (!item) break;
    const current = item.id;
    if (settled[current]) continue;
    if (item.priority !== distances[current]) continue;
    if (item.priority > radius) break;
    settled[current] = 1;
    stack.push(current);

    for (const edge of adjacency[current]) {
      if (settled[edge.to]) continue;
      const candidateDistance = distances[current] + edge.weight;
      if (candidateDistance > radius) continue;
      if (candidateDistance < distances[edge.to] - EPSILON) {
        distances[edge.to] = candidateDistance;
        sigma[edge.to] = sigma[current];
        predecessors[edge.to] = [current];
        queue.push(edge.to, candidateDistance);
      } else if (Math.abs(candidateDistance - distances[edge.to]) <= EPSILON) {
        sigma[edge.to] += sigma[current];
        predecessors[edge.to].push(current);
      }
    }
  }

  return { distances, sigma, predecessors, stack };
}

export function weightsOrDefault(count: number, weights?: ArrayLike<number>): Float64Array {
  const values = new Float64Array(count);
  if (weights === undefined) {
    values.fill(1);
    return values;
  }
  if (weights.length !== count) throw new Error(`Expected ${count} weights, received ${weights.length}.`);
  for (let i = 0; i < count; i += 1) {
    if (!Number.isFinite(weights[i]) || weights[i] < 0) throw new Error(`Weight ${i} must be a non-negative number.`);
    values[i] = weights[i];
  }
  return values;
}

export function radiusLabel(radius: number): string {
  return radius === Number.POSITIVE_INFINITY ? "n" : String(radius);
}

function addNodeSegment(segmentIndexesByNode: Map<number, number[]>, nodeId: number, segmentIndex: number): void {
  const segmentIndexes = segmentIndexesByNode.get(nodeId);
  if (segmentIndexes) {
    segmentIndexes.push(segmentIndex);
  } else {
    segmentIndexesByNode.set(nodeId, [segmentIndex]);
  }
}

function turnAngleAtNodeDegrees(graph: CanonicalGraph, a: number, b: number, nodeId: number): number {
  const aFar = farEndpoint(graph, a, nodeId);
  const turn = sharedEndpoint(graph, a, nodeId);
  const bFar = farEndpoint(graph, b, nodeId);
  if (!aFar || !turn || !bFar) return 90;
  if (aFar[0] === bFar[0] && aFar[1] === bFar[1]) return 180;
  const v1x = aFar[0] - turn[0];
  const v1y = aFar[1] - turn[1];
  const v2x = bFar[0] - turn[0];
  const v2y = bFar[1] - turn[1];
  const len1 = Math.hypot(v1x, v1y);
  const len2 = Math.hypot(v2x, v2y);
  if (len1 === 0 || len2 === 0) return 90;
  const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (len1 * len2)));
  return 180 - Math.acos(cos) * 180 / Math.PI;
}

function sharedEndpoint(graph: CanonicalGraph, segmentIndex: number, nodeId: number): [number, number] | null {
  const segment = graph.segments[segmentIndex];
  if (segment.source === nodeId) return firstPoint(graph, segmentIndex);
  if (segment.target === nodeId) return lastPoint(graph, segmentIndex);
  return null;
}

function farEndpoint(graph: CanonicalGraph, segmentIndex: number, nodeId: number): [number, number] | null {
  const segment = graph.segments[segmentIndex];
  if (segment.source === nodeId) return lastPoint(graph, segmentIndex);
  if (segment.target === nodeId) return firstPoint(graph, segmentIndex);
  return null;
}

function firstPoint(graph: CanonicalGraph, segmentIndex: number): [number, number] | null {
  const segment = graph.segments[segmentIndex];
  if (Number.isFinite(segment.x0) && Number.isFinite(segment.y0)) return [segment.x0!, segment.y0!];
  const point = segment.geometry.coordinates[0];
  return point ? [point[0], point[1]] : null;
}

function lastPoint(graph: CanonicalGraph, segmentIndex: number): [number, number] | null {
  const segment = graph.segments[segmentIndex];
  if (Number.isFinite(segment.x1) && Number.isFinite(segment.y1)) return [segment.x1!, segment.y1!];
  const point = segment.geometry.coordinates[segment.geometry.coordinates.length - 1];
  return point ? [point[0], point[1]] : null;
}
