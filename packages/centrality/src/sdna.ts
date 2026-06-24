import type { CanonicalGraph, CentralityResult } from "../../core/src/types.ts";
import {
  buildSegmentCenterAdjacency,
  radiusLabel,
  segmentCenterDijkstra,
  weightsOrDefault,
  type SegmentCenterEdge
} from "./segment-center.ts";

export interface SdnaMetricOptions {
  originWeights?: ArrayLike<number>;
  destinationWeights?: ArrayLike<number>;
}

interface SdnaAngularEdge extends SegmentCenterEdge {
  viaNode: number;
}

export function sdnaMetricMeanDistance(
  graph: CanonicalGraph,
  radius: number,
  options: SdnaMetricOptions = {}
): CentralityResult {
  const adjacency = buildSegmentCenterAdjacency(graph);
  const destinationWeights = weightsOrDefault(graph.segments.length, options.destinationWeights);
  const values = new Float64Array(graph.segments.length);

  for (let origin = 0; origin < graph.segments.length; origin += 1) {
    const distances = segmentCenterDijkstra(adjacency, origin, radius).distances;
    let weightedDistance = 0;
    let totalWeight = 0;
    for (let destination = 0; destination < distances.length; destination += 1) {
      const distance = distances[destination];
      if (destination === origin || !Number.isFinite(distance) || distance > radius) continue;
      const weight = destinationWeights[destination];
      weightedDistance += distance * weight;
      totalWeight += weight;
    }
    values[origin] = totalWeight === 0 ? 0 : weightedDistance / totalWeight;
  }

  return {
    values,
    status: "experimental",
    method: `sdna_med_r${radiusLabel(radius)}`,
    notes: "sDNA-style metric Mean Euclidean Distance over segment-centre link origins/destinations. This excludes continuous-space partial-link handling."
  };
}

export function sdnaMetricBetweenness(
  graph: CanonicalGraph,
  radius: number,
  options: SdnaMetricOptions = {}
): CentralityResult {
  const adjacency = buildSegmentCenterAdjacency(graph);
  const originWeights = weightsOrDefault(graph.segments.length, options.originWeights);
  const destinationWeights = weightsOrDefault(graph.segments.length, options.destinationWeights);
  const values = weightedSegmentNodeBetweenness(adjacency, originWeights, destinationWeights, radius);
  for (let i = 0; i < values.length; i += 1) values[i] /= 2;

  return {
    values,
    status: "experimental",
    method: `sdna_bte_r${radiusLabel(radius)}`,
    notes: "sDNA-style metric betweenness over segment-centre link origins/destinations with origin*destination weighting. This is not full sDNA Integral continuous-space betweenness."
  };
}

export function sdnaAngularMeanDistance(
  graph: CanonicalGraph,
  radius: number,
  options: SdnaMetricOptions = {}
): CentralityResult {
  const adjacency = buildSdnaAngularAdjacency(graph);
  const lineAngularCurvature = graph.segments.map((_segment, index) => sdnaLineAngularCurvature(graph, index));
  const destinationWeights = weightsOrDefault(graph.segments.length, options.destinationWeights);
  const values = new Float64Array(graph.segments.length);

  for (let origin = 0; origin < graph.segments.length; origin += 1) {
    const distances = segmentCenterDijkstra(adjacency, origin, radius).distances;
    let weightedDistance = destinationWeights[origin] * lineAngularCurvature[origin] / 3;
    let totalWeight = destinationWeights[origin];
    for (let destination = 0; destination < distances.length; destination += 1) {
      const distance = distances[destination];
      if (destination === origin || !Number.isFinite(distance) || distance > radius) continue;
      const weight = destinationWeights[destination];
      weightedDistance += distance * weight;
      totalWeight += weight;
    }
    values[origin] = totalWeight === 0 ? 0 : weightedDistance / totalWeight;
  }

  return {
    values,
    status: "experimental",
    method: `sdna_mad_r${radiusLabel(radius)}`,
    notes: "sDNA-style Mean Angular Distance over discrete segment-centre origins/destinations. Includes angular line curvature, junction turn cost, and the origin-link one-third self-distance term, but omits continuous-space partial-link destinations."
  };
}

export function sdnaAngularBetweenness(
  graph: CanonicalGraph,
  radius: number,
  options: SdnaMetricOptions = {}
): CentralityResult {
  const adjacency = buildSdnaAngularAdjacency(graph);
  const originWeights = weightsOrDefault(graph.segments.length, options.originWeights);
  const destinationWeights = weightsOrDefault(graph.segments.length, options.destinationWeights);
  const values = sdnaFirstGeodesicBetweenness(adjacency, originWeights, destinationWeights, radius);

  return {
    values,
    status: "experimental",
    method: `sdna_bta_r${radiusLabel(radius)}`,
    notes: "sDNA-style angular betweenness over discrete segment-centre origins/destinations using first-geodesic routing, half endpoint credit, and one-third self credit. This is not full sDNA Integral continuous-space betweenness."
  };
}

export function sdnaAngularLineCurvature(graph: CanonicalGraph): CentralityResult {
  const values = new Float64Array(graph.segments.length);
  for (let i = 0; i < values.length; i += 1) values[i] = sdnaLineAngularCurvature(graph, i);
  return {
    values,
    status: "compatible",
    method: "sdna_lac",
    notes: "sDNA Line Angular Curvature equivalent for canonical segment geometries: sum of internal polyline turn costs in degrees."
  };
}

export function sdnaMetricLinkCount(graph: CanonicalGraph, radius: number): CentralityResult {
  return sdnaReachAggregate(graph, radius, "sdna_links", () => 1);
}

export function sdnaMetricLength(graph: CanonicalGraph, radius: number): CentralityResult {
  return sdnaReachAggregate(graph, radius, "sdna_length", (destination) => graph.segments[destination].length_m);
}

export function sdnaMetricWeight(
  graph: CanonicalGraph,
  radius: number,
  options: Pick<SdnaMetricOptions, "destinationWeights"> = {}
): CentralityResult {
  const weights = weightsOrDefault(graph.segments.length, options.destinationWeights);
  return sdnaReachAggregate(graph, radius, "sdna_weight", (destination) => weights[destination]);
}

function sdnaReachAggregate(
  graph: CanonicalGraph,
  radius: number,
  baseMethod: string,
  aggregate: (destination: number) => number
): CentralityResult {
  const adjacency = buildSegmentCenterAdjacency(graph);
  const values = new Float64Array(graph.segments.length);
  for (let origin = 0; origin < graph.segments.length; origin += 1) {
    const distances = segmentCenterDijkstra(adjacency, origin, radius).distances;
    let total = 0;
    for (let destination = 0; destination < distances.length; destination += 1) {
      const distance = distances[destination];
      if (Number.isFinite(distance) && distance <= radius) total += aggregate(destination);
    }
    values[origin] = total;
  }

  return {
    values,
    status: "experimental",
    method: `${baseMethod}_r${radiusLabel(radius)}`,
    notes: "sDNA-style discrete metric radius aggregate over segment-centre link origins/destinations."
  };
}

function weightedSegmentNodeBetweenness(
  adjacency: readonly SegmentCenterEdge[][],
  originWeights: Float64Array,
  destinationWeights: Float64Array,
  radius: number
): Float64Array {
  const centrality = new Float64Array(adjacency.length);

  for (let source = 0; source < adjacency.length; source += 1) {
    const { distances, sigma, predecessors, stack } = segmentCenterDijkstra(adjacency, source, radius);
    const dependency = new Float64Array(adjacency.length);
    while (stack.length > 0) {
      const w = stack.pop()!;
      if (w !== source && Number.isFinite(distances[w]) && distances[w] <= radius) {
        centrality[w] += originWeights[source] * dependency[w];
      }
      for (const v of predecessors[w]) {
        dependency[v] += (sigma[v] / sigma[w]) * (destinationWeights[w] + dependency[w]);
      }
    }
  }

  return centrality;
}

function sdnaFirstGeodesicBetweenness(
  adjacency: readonly SegmentCenterEdge[][],
  originWeights: Float64Array,
  destinationWeights: Float64Array,
  radius: number
): Float64Array {
  const values = new Float64Array(adjacency.length);
  for (let origin = 0; origin < adjacency.length; origin += 1) {
    const { distances, predecessors } = segmentCenterDijkstra(adjacency, origin, radius);
    for (let destination = 0; destination < adjacency.length; destination += 1) {
      const weight = originWeights[origin] * destinationWeights[destination];
      if (weight === 0) continue;
      if (destination === origin) {
        values[origin] += weight / 3;
        continue;
      }
      if (!Number.isFinite(distances[destination]) || distances[destination] > radius) continue;
      const path = reconstructFirstSegmentPath(predecessors, origin, destination);
      if (path.length === 0) continue;
      for (const segmentIndex of path) {
        if (segmentIndex === origin || segmentIndex === destination) values[segmentIndex] += weight / 2;
        else values[segmentIndex] += weight;
      }
    }
  }
  return values;
}

function reconstructFirstSegmentPath(predecessors: readonly number[][], origin: number, destination: number): number[] {
  const path = [destination];
  let current = destination;
  const seen = new Set<number>([destination]);
  while (current !== origin) {
    const previous = predecessors[current][0];
    if (previous === undefined || seen.has(previous)) return [];
    current = previous;
    seen.add(current);
    path.push(current);
  }
  path.reverse();
  return path;
}

function buildSdnaAngularAdjacency(graph: CanonicalGraph): SdnaAngularEdge[][] {
  const adjacency = Array.from({ length: graph.segments.length }, () => [] as SdnaAngularEdge[]);
  const segmentsByNode = new Map<number, number[]>();
  const lineAngularCurvature = graph.segments.map((_segment, index) => sdnaLineAngularCurvature(graph, index));
  graph.segments.forEach((segment, segmentIndex) => {
    addNodeSegment(segmentsByNode, segment.source, segmentIndex);
    addNodeSegment(segmentsByNode, segment.target, segmentIndex);
  });

  for (const [nodeId, segmentIndexes] of segmentsByNode) {
    for (let i = 0; i < segmentIndexes.length; i += 1) {
      for (let j = i + 1; j < segmentIndexes.length; j += 1) {
        const a = segmentIndexes[i];
        const b = segmentIndexes[j];
        const turn = sdnaTurnAngleAtNodeDegrees(graph, a, b, nodeId);
        const weight = lineAngularCurvature[a] / 2 + turn + lineAngularCurvature[b] / 2;
        adjacency[a].push({ to: b, weight, viaNode: nodeId });
        adjacency[b].push({ to: a, weight, viaNode: nodeId });
      }
    }
  }
  return adjacency;
}

function sdnaLineAngularCurvature(graph: CanonicalGraph, segmentIndex: number): number {
  const coordinates = graph.segments[segmentIndex].geometry.coordinates;
  let total = 0;
  for (let i = 1; i < coordinates.length - 1; i += 1) {
    total += sdnaTurnAngleDegrees(coordinates[i - 1], coordinates[i], coordinates[i + 1]);
  }
  return total;
}

function sdnaTurnAngleAtNodeDegrees(graph: CanonicalGraph, a: number, b: number, nodeId: number): number {
  const aFar = farEndpoint(graph, a, nodeId);
  const turn = sharedEndpoint(graph, a, nodeId);
  const bFar = farEndpoint(graph, b, nodeId);
  if (!aFar || !turn || !bFar) return 90;
  return sdnaTurnAngleDegrees(aFar, turn, bFar);
}

function sdnaTurnAngleDegrees(
  previous: readonly [number, number],
  turn: readonly [number, number],
  next: readonly [number, number]
): number {
  if (previous[0] === next[0] && previous[1] === next[1]) return 180;
  const v1x = previous[0] - turn[0];
  const v1y = previous[1] - turn[1];
  const v2x = next[0] - turn[0];
  const v2y = next[1] - turn[1];
  const len1 = Math.hypot(v1x, v1y);
  const len2 = Math.hypot(v2x, v2y);
  if (len1 === 0 || len2 === 0) return 90;
  const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (len1 * len2)));
  return 180 - Math.acos(cos) * 180 / Math.PI;
}

function addNodeSegment(segmentIndexesByNode: Map<number, number[]>, nodeId: number, segmentIndex: number): void {
  const segmentIndexes = segmentIndexesByNode.get(nodeId);
  if (segmentIndexes) segmentIndexes.push(segmentIndex);
  else segmentIndexesByNode.set(nodeId, [segmentIndex]);
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

function firstPoint(graph: CanonicalGraph, segmentIndex: number): [number, number] {
  const segment = graph.segments[segmentIndex];
  if (Number.isFinite(segment.x0) && Number.isFinite(segment.y0)) return [segment.x0!, segment.y0!];
  const point = segment.geometry.coordinates[0];
  return [point[0], point[1]];
}

function lastPoint(graph: CanonicalGraph, segmentIndex: number): [number, number] {
  const segment = graph.segments[segmentIndex];
  if (Number.isFinite(segment.x1) && Number.isFinite(segment.y1)) return [segment.x1!, segment.y1!];
  const point = segment.geometry.coordinates[segment.geometry.coordinates.length - 1];
  return [point[0], point[1]];
}
