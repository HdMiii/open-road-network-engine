import { buildDualAdjacency, buildPrimalAdjacency, getNodeIds } from "../../core/src/graph.ts";
import { MinPriorityQueue } from "../../core/src/priority-queue.ts";
import type { Adjacency, CanonicalGraph, CentralityResult, GraphEdge } from "../../core/src/types.ts";
import { dijkstra, breadthFirstDistances } from "../../shortest-path/src/index.ts";
export * from "./depthmapx.ts";
export * from "./angular.ts";
export * from "./primal.ts";
export * from "./cityseer.ts";
export * from "./sdna.ts";
export * from "./pst.ts";

export type DistanceMode = "metric" | "topological";

export interface CentralityOptions {
  mode?: DistanceMode;
  radius?: number;
}

export function nodeDegree(graph: CanonicalGraph): CentralityResult {
  const nodeIds = getNodeIds(graph);
  const indexByNode = new Map(nodeIds.map((id, index) => [id, index]));
  const values = new Float64Array(nodeIds.length);
  for (const segment of graph.segments) {
    values[indexByNode.get(segment.source)!] += 1;
    values[indexByNode.get(segment.target)!] += 1;
  }
  return { values, status: "validated", method: "graph_degree_node" };
}

export function segmentDegree(graph: CanonicalGraph): CentralityResult {
  const dual = buildDualAdjacency(graph);
  const values = new Float64Array(graph.segments.length);
  for (let segmentIndex = 0; segmentIndex < graph.segments.length; segmentIndex += 1) {
    const neighbors = new Set((dual.get(segmentIndex) ?? []).map((edge) => edge.toSegmentIndex));
    values[segmentIndex] = neighbors.size;
  }
  return { values, status: "validated", method: "graph_degree_segment" };
}

export function nodeComponentIds(graph: CanonicalGraph): CentralityResult {
  const adjacency = buildPrimalAdjacency(graph);
  const nodeIds = getNodeIds(graph);
  const indexByNode = new Map(nodeIds.map((id, index) => [id, index]));
  const values = new Float64Array(nodeIds.length);
  values.fill(-1);
  let componentId = 0;

  for (const nodeId of nodeIds) {
    const startIndex = indexByNode.get(nodeId)!;
    if (values[startIndex] !== -1) continue;
    const queue = [nodeId];
    values[startIndex] = componentId;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor];
      for (const edge of adjacency.get(current) ?? []) {
        const nextIndex = indexByNode.get(edge.to)!;
        if (values[nextIndex] !== -1) continue;
        values[nextIndex] = componentId;
        queue.push(edge.to);
      }
    }
    componentId += 1;
  }

  return { values, status: "validated", method: "graph_component_node" };
}

export function segmentComponentIds(graph: CanonicalGraph): CentralityResult {
  const nodeComponents = nodeComponentIds(graph).values;
  const nodeIds = getNodeIds(graph);
  const indexByNode = new Map(nodeIds.map((id, index) => [id, index]));
  const values = new Float64Array(graph.segments.length);
  graph.segments.forEach((segment, segmentIndex) => {
    values[segmentIndex] = nodeComponents[indexByNode.get(segment.source)!];
  });
  return { values, status: "validated", method: "graph_component_segment" };
}

export function reachCount(graph: CanonicalGraph, options: CentralityOptions = {}): CentralityResult {
  return distanceAggregate(graph, options, "graph_reach", (distances) => {
    let count = 0;
    for (const distance of distances) {
      if (distance > 0 && Number.isFinite(distance)) count += 1;
    }
    return count;
  });
}

export function farness(graph: CanonicalGraph, options: CentralityOptions = {}): CentralityResult {
  return distanceAggregate(graph, options, "graph_farness", (distances) => {
    let total = 0;
    for (const distance of distances) {
      if (distance > 0 && Number.isFinite(distance)) total += distance;
    }
    return total;
  });
}

export function harmonicCloseness(graph: CanonicalGraph, options: CentralityOptions = {}): CentralityResult {
  return distanceAggregate(graph, options, "graph_harmonic", (distances) => {
    let total = 0;
    for (const distance of distances) {
      if (distance > 0 && Number.isFinite(distance)) total += 1 / distance;
    }
    return total;
  });
}

export function meanDepth(graph: CanonicalGraph, options: CentralityOptions = {}): CentralityResult {
  return distanceAggregate(graph, options, "graph_mean_depth", (distances) => {
    let total = 0;
    let count = 0;
    for (const distance of distances) {
      if (distance > 0 && Number.isFinite(distance)) {
        total += distance;
        count += 1;
      }
    }
    return count === 0 ? 0 : total / count;
  });
}

export function nodeBetweenness(graph: CanonicalGraph, options: CentralityOptions = {}): CentralityResult {
  const adjacency = buildPrimalAdjacency(graph);
  const nodeIds = getNodeIds(graph);
  const values = brandesNodeBetweenness(adjacency, nodeIds, options);
  for (let i = 0; i < values.length; i += 1) values[i] /= 2;
  return {
    values,
    status: "validated",
    method: methodName("graph_choice_node", options),
    notes: "Exact undirected Brandes betweenness over the canonical primal graph."
  };
}

export function segmentBetweenness(graph: CanonicalGraph, options: CentralityOptions = {}): CentralityResult {
  const adjacency = buildPrimalAdjacency(graph);
  const nodeIds = getNodeIds(graph);
  const edgeValues = brandesEdgeBetweenness(adjacency, nodeIds, graph.segments.length, options);
  for (let i = 0; i < edgeValues.length; i += 1) edgeValues[i] /= 2;
  return {
    values: edgeValues,
    status: "validated",
    method: methodName("graph_choice_segment", options),
    notes: "Exact undirected edge betweenness accumulated onto canonical segment rows."
  };
}

function distanceAggregate(
  graph: CanonicalGraph,
  options: CentralityOptions,
  baseMethod: string,
  aggregate: (distances: Float64Array) => number
): CentralityResult {
  const adjacency = buildPrimalAdjacency(graph);
  const nodeIds = getNodeIds(graph);
  const values = new Float64Array(nodeIds.length);
  for (let index = 0; index < nodeIds.length; index += 1) {
    const result = options.mode === "topological"
      ? breadthFirstDistances(adjacency, nodeIds[index], { nodeIds, radius: options.radius })
      : dijkstra(adjacency, nodeIds[index], { nodeIds, radius: options.radius });
    values[index] = aggregate(result.distances);
  }
  return { values, status: "validated", method: methodName(baseMethod, options) };
}

function brandesNodeBetweenness(adjacency: Adjacency, nodeIds: readonly number[], options: CentralityOptions): Float64Array {
  const indexByNode = new Map(nodeIds.map((id, index) => [id, index]));
  const centrality = new Float64Array(nodeIds.length);
  const radius = options.radius ?? Number.POSITIVE_INFINITY;

  for (const source of nodeIds) {
    const stack: number[] = [];
    const predecessors = Array.from({ length: nodeIds.length }, () => [] as number[]);
    const sigma = new Float64Array(nodeIds.length);
    const distances = new Float64Array(nodeIds.length);
    distances.fill(Number.POSITIVE_INFINITY);
    sigma[indexByNode.get(source)!] = 1;
    distances[indexByNode.get(source)!] = 0;

    traverseShortestPaths(adjacency, source, nodeIds, indexByNode, options, distances, sigma, predecessors, stack);

    const dependency = new Float64Array(nodeIds.length);
    while (stack.length > 0) {
      const w = stack.pop()!;
      const wIndex = indexByNode.get(w)!;
      for (const v of predecessors[wIndex]) {
        const vIndex = indexByNode.get(v)!;
        dependency[vIndex] += (sigma[vIndex] / sigma[wIndex]) * (1 + dependency[wIndex]);
      }
      if (w !== source && distances[wIndex] <= radius) {
        centrality[wIndex] += dependency[wIndex];
      }
    }
  }

  return centrality;
}

function brandesEdgeBetweenness(
  adjacency: Adjacency,
  nodeIds: readonly number[],
  segmentCount: number,
  options: CentralityOptions
): Float64Array {
  const indexByNode = new Map(nodeIds.map((id, index) => [id, index]));
  const centrality = new Float64Array(segmentCount);

  for (const source of nodeIds) {
    const stack: number[] = [];
    const predecessors = Array.from({ length: nodeIds.length }, () => [] as number[]);
    const predecessorSegments = Array.from({ length: nodeIds.length }, () => [] as number[]);
    const sigma = new Float64Array(nodeIds.length);
    const distances = new Float64Array(nodeIds.length);
    distances.fill(Number.POSITIVE_INFINITY);
    sigma[indexByNode.get(source)!] = 1;
    distances[indexByNode.get(source)!] = 0;

    traverseShortestPaths(adjacency, source, nodeIds, indexByNode, options, distances, sigma, predecessors, stack, predecessorSegments);

    const dependency = new Float64Array(nodeIds.length);
    while (stack.length > 0) {
      const w = stack.pop()!;
      const wIndex = indexByNode.get(w)!;
      for (let i = 0; i < predecessors[wIndex].length; i += 1) {
        const v = predecessors[wIndex][i];
        const vIndex = indexByNode.get(v)!;
        const contribution = (sigma[vIndex] / sigma[wIndex]) * (1 + dependency[wIndex]);
        dependency[vIndex] += contribution;
        centrality[predecessorSegments[wIndex][i]] += contribution;
      }
    }
  }

  return centrality;
}

function traverseShortestPaths(
  adjacency: Adjacency,
  source: number,
  nodeIds: readonly number[],
  indexByNode: ReadonlyMap<number, number>,
  options: CentralityOptions,
  distances: Float64Array,
  sigma: Float64Array,
  predecessors: number[][],
  stack: number[],
  predecessorSegments?: number[][]
): void {
  const radius = options.radius ?? Number.POSITIVE_INFINITY;

  if (options.mode === "topological") {
    const bfsQueue = [source];
    for (let cursor = 0; cursor < bfsQueue.length; cursor += 1) {
      const v = bfsQueue[cursor];
      stack.push(v);
      const vIndex = indexByNode.get(v)!;
      if (distances[vIndex] >= radius) continue;
      for (const edge of adjacency.get(v) ?? []) relaxEdge(edge, 1, bfsQueue);
    }
    return;
  }

  const priorityQueue = new MinPriorityQueue();
  const settled = new Uint8Array(nodeIds.length);
  priorityQueue.push(source, 0);
  while (priorityQueue.size > 0) {
    const item = priorityQueue.pop();
    if (!item) break;
    const v = item.id;
    const vIndex = indexByNode.get(v);
    if (vIndex === undefined || settled[vIndex]) continue;
    if (item.priority !== distances[vIndex]) continue;
    if (item.priority > radius) break;
    settled[vIndex] = 1;
    stack.push(v);
    for (const edge of adjacency.get(v) ?? []) relaxEdge(edge, edge.weight);
  }

  function relaxEdge(edge: GraphEdge, weight: number, queue?: number[]): void {
    const vIndex = indexByNode.get(edge.from)!;
    const wIndex = indexByNode.get(edge.to)!;
    const candidateDistance = distances[vIndex] + weight;
    if (candidateDistance > radius) return;
    if (candidateDistance < distances[wIndex]) {
      distances[wIndex] = candidateDistance;
      sigma[wIndex] = sigma[vIndex];
      predecessors[wIndex] = [edge.from];
      if (predecessorSegments) predecessorSegments[wIndex] = [edge.segmentIndex];
      if (queue) queue.push(edge.to);
      else priorityQueue.push(edge.to, candidateDistance);
    } else if (candidateDistance === distances[wIndex]) {
      sigma[wIndex] += sigma[vIndex];
      predecessors[wIndex].push(edge.from);
      predecessorSegments?.[wIndex].push(edge.segmentIndex);
    }
  }
}

function methodName(base: string, options: CentralityOptions): string {
  const mode = options.mode ?? "metric";
  const radius = options.radius === undefined ? "rn" : `r${options.radius}`;
  return `${base}_${mode}_${radius}`;
}
