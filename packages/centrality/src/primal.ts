import { buildPrimalAdjacency, getNodeIds } from "../../core/src/graph.ts";
import { MinPriorityQueue } from "../../core/src/priority-queue.ts";
import type { Adjacency, CanonicalGraph, CentralityResult, GraphEdge } from "../../core/src/types.ts";
import { dijkstra } from "../../shortest-path/src/index.ts";

export function primalIntegration(graph: CanonicalGraph, radius: number): CentralityResult {
  const adjacency = buildPrimalAdjacency(graph);
  const nodeIds = getNodeIds(graph);
  const harmonicByNode = new Float64Array(nodeIds.length);

  for (let i = 0; i < nodeIds.length; i += 1) {
    const distances = dijkstra(adjacency, nodeIds[i], { nodeIds, radius }).distances;
    let harmonic = 0;
    for (const distance of distances) {
      if (distance > 0 && Number.isFinite(distance)) harmonic += 1 / distance;
    }
    harmonicByNode[i] = harmonic;
  }

  const indexByNode = new Map(nodeIds.map((id, index) => [id, index]));
  const values = new Float64Array(graph.segments.length);
  for (let segmentIndex = 0; segmentIndex < graph.segments.length; segmentIndex += 1) {
    const segment = graph.segments[segmentIndex];
    values[segmentIndex] =
      (harmonicByNode[indexByNode.get(segment.source)!] + harmonicByNode[indexByNode.get(segment.target)!]) / 2;
  }

  return {
    values,
    status: "compatible",
    method: `primal_integration_r${radius}`,
    notes: "cityseer-inspired primal harmonic closeness projected to segment rows by averaging endpoint node values."
  };
}

export function onDemandPrimalIntegration(graph: CanonicalGraph, radius: number, segmentIndex: number): number {
  return primalIntegration(graph, radius).values[segmentIndex];
}

export function primalChoice(graph: CanonicalGraph, radius: number): CentralityResult {
  const adjacency = buildPrimalAdjacency(graph);
  const nodeIds = getNodeIds(graph);
  const values = rawDirectedEdgeBetweenness(adjacency, nodeIds, graph.segments.length, radius);

  return {
    values,
    status: "compatible",
    method: `primal_choice_r${radius}`,
    notes: "cityseer-inspired weighted primal edge betweenness, accumulated as directed source-target path flow on segment rows."
  };
}

function rawDirectedEdgeBetweenness(
  adjacency: Adjacency,
  nodeIds: readonly number[],
  segmentCount: number,
  radius: number
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

    traverseWeightedShortestPaths(adjacency, source, indexByNode, radius, distances, sigma, predecessors, predecessorSegments, stack);

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

function traverseWeightedShortestPaths(
  adjacency: Adjacency,
  source: number,
  indexByNode: ReadonlyMap<number, number>,
  radius: number,
  distances: Float64Array,
  sigma: Float64Array,
  predecessors: number[][],
  predecessorSegments: number[][],
  stack: number[]
): void {
  const queue = new MinPriorityQueue();
  const settled = new Uint8Array(indexByNode.size);
  queue.push(source, 0);

  while (queue.size > 0) {
    const item = queue.pop();
    if (!item) break;
    const v = item.id;
    const vIndex = indexByNode.get(v);
    if (vIndex === undefined || settled[vIndex]) continue;
    if (item.priority !== distances[vIndex]) continue;
    if (item.priority > radius) break;
    settled[vIndex] = 1;
    stack.push(v);

    for (const edge of adjacency.get(v) ?? []) {
      relaxWeightedEdge(edge);
    }
  }

  function relaxWeightedEdge(edge: GraphEdge): void {
    const vIndex = indexByNode.get(edge.from)!;
    const wIndex = indexByNode.get(edge.to)!;
    const candidateDistance = distances[vIndex] + edge.weight;
    if (candidateDistance > radius) return;
    if (candidateDistance < distances[wIndex]) {
      distances[wIndex] = candidateDistance;
      sigma[wIndex] = sigma[vIndex];
      predecessors[wIndex] = [edge.from];
      predecessorSegments[wIndex] = [edge.segmentIndex];
      queue.push(edge.to, candidateDistance);
    } else if (candidateDistance === distances[wIndex]) {
      sigma[wIndex] += sigma[vIndex];
      predecessors[wIndex].push(edge.from);
      predecessorSegments[wIndex].push(edge.segmentIndex);
    }
  }
}
