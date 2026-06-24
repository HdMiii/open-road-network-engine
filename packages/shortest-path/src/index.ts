import { MinPriorityQueue } from "../../core/src/priority-queue.ts";
import type { Adjacency, DistanceResult, GraphEdge } from "../../core/src/types.ts";

export interface ShortestPathOptions {
  nodeIds?: readonly number[];
  radius?: number;
  weight?: (edge: GraphEdge) => number;
}

export function dijkstra(adjacency: Adjacency, source: number, options: ShortestPathOptions = {}): DistanceResult {
  const nodeIds = options.nodeIds ?? [...adjacency.keys()].sort((a, b) => a - b);
  const indexByNode = new Map(nodeIds.map((id, index) => [id, index]));
  const distances = new Float64Array(nodeIds.length);
  const predecessors = new Int32Array(nodeIds.length);
  distances.fill(Number.POSITIVE_INFINITY);
  predecessors.fill(-1);

  const sourceIndex = indexByNode.get(source);
  if (sourceIndex === undefined) return { distances, predecessors };

  const queue = new MinPriorityQueue();
  distances[sourceIndex] = 0;
  queue.push(source, 0);
  const radius = options.radius ?? Number.POSITIVE_INFINITY;
  const weight = options.weight ?? ((edge: GraphEdge) => edge.weight);

  while (queue.size > 0) {
    const item = queue.pop();
    if (!item) break;
    const currentIndex = indexByNode.get(item.id);
    if (currentIndex === undefined || item.priority !== distances[currentIndex]) continue;
    if (item.priority > radius) continue;

    for (const edge of adjacency.get(item.id) ?? []) {
      const nextIndex = indexByNode.get(edge.to);
      if (nextIndex === undefined) continue;
      const edgeWeight = weight(edge);
      if (!Number.isFinite(edgeWeight) || edgeWeight < 0) {
        throw new Error(`Invalid edge weight from ${edge.from} to ${edge.to}: ${edgeWeight}`);
      }
      const nextDistance = item.priority + edgeWeight;
      if (nextDistance <= radius && nextDistance < distances[nextIndex]) {
        distances[nextIndex] = nextDistance;
        predecessors[nextIndex] = currentIndex;
        queue.push(edge.to, nextDistance);
      }
    }
  }

  return { distances, predecessors };
}

export function breadthFirstDistances(
  adjacency: Adjacency,
  source: number,
  options: Omit<ShortestPathOptions, "weight"> = {}
): DistanceResult {
  const nodeIds = options.nodeIds ?? [...adjacency.keys()].sort((a, b) => a - b);
  const indexByNode = new Map(nodeIds.map((id, index) => [id, index]));
  const distances = new Float64Array(nodeIds.length);
  const predecessors = new Int32Array(nodeIds.length);
  distances.fill(Number.POSITIVE_INFINITY);
  predecessors.fill(-1);

  const sourceIndex = indexByNode.get(source);
  if (sourceIndex === undefined) return { distances, predecessors };

  const radius = options.radius ?? Number.POSITIVE_INFINITY;
  const queue: number[] = [source];
  distances[sourceIndex] = 0;

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    const currentIndex = indexByNode.get(current);
    if (currentIndex === undefined) continue;
    const currentDistance = distances[currentIndex];
    if (currentDistance >= radius) continue;

    for (const edge of adjacency.get(current) ?? []) {
      const nextIndex = indexByNode.get(edge.to);
      if (nextIndex === undefined || distances[nextIndex] !== Number.POSITIVE_INFINITY) continue;
      distances[nextIndex] = currentDistance + 1;
      predecessors[nextIndex] = currentIndex;
      queue.push(edge.to);
    }
  }

  return { distances, predecessors };
}

export function reconstructPath(nodeIds: readonly number[], result: DistanceResult, target: number): number[] {
  const indexByNode = new Map(nodeIds.map((id, index) => [id, index]));
  const targetIndex = indexByNode.get(target);
  if (targetIndex === undefined || result.distances[targetIndex] === Number.POSITIVE_INFINITY) return [];

  const pathIndexes: number[] = [];
  for (let index = targetIndex; index !== -1; index = result.predecessors[index]) {
    pathIndexes.push(index);
  }
  pathIndexes.reverse();
  return pathIndexes.map((index) => nodeIds[index]);
}

export * from "./route.ts";
