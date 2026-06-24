import { MinPriorityQueue } from "../../core/src/priority-queue.ts";
import type { CanonicalGraph, Coordinate } from "../../core/src/types.ts";
import { validateCanonicalGraph } from "../../core/src/validation.ts";

const TULIP_BINS = 1024;
const TULIP_SEMICIRCLE_BINS = TULIP_BINS / 2 + 1;
const TULIP_DEPTH_SCALE = (TULIP_SEMICIRCLE_BINS - 1) * 0.5;

export const ROUTE_MODES = ["metric", "angular", "vectorAngle", "vectorMetric"] as const;

export type RouteMode = (typeof ROUTE_MODES)[number];

export interface RouteResult {
  // Feature-order (0-based) indexes into graph.segments, NOT canonical segment_id values.
  segmentIndexes: Int32Array;
  distanceM: number;
  angularCost: number;
  vectorCost: number;
}

interface RouteEdge {
  to: number;
  segmentIndex: number;
  length: number;
  bearing: number;
}

interface RouteNodeGraph {
  adjacency: RouteEdge[][];
  sourceNode: Int32Array;
  targetNode: Int32Array;
  half: Float64Array;
  valid: Uint8Array;
  nodeCoordinates: Coordinate[];
}

interface AngularRouteEdge {
  toState: number;
  turnDegrees: number;
  stepLength: number;
}

interface AngularRouteGraph {
  edges: AngularRouteEdge[][];
  valid: Uint8Array;
  nSegments: number;
}

export function shortestRoute(graph: CanonicalGraph, mode: RouteMode, fromSegment: number, toSegment: number): RouteResult | null {
  if (!(ROUTE_MODES as readonly string[]).includes(mode)) {
    throw new Error(`Unknown route mode: ${mode}`);
  }
  if (mode === "angular") {
    return shortestAngularRoute(buildAngularRouteGraph(graph), fromSegment, toSegment);
  }
  return shortestNodeRoute(buildRouteNodeGraph(graph), mode, fromSegment, toSegment);
}

function buildRouteNodeGraph(graph: CanonicalGraph): RouteNodeGraph {
  validateCanonicalGraph(graph);
  const nodeIds = [...new Set(graph.segments.flatMap((segment) => [segment.source, segment.target]))].sort((a, b) => a - b);
  const indexByNode = new Map(nodeIds.map((id, index) => [id, index]));
  const adjacency = Array.from({ length: nodeIds.length }, () => [] as RouteEdge[]);
  const sourceNode = new Int32Array(graph.segments.length).fill(-1);
  const targetNode = new Int32Array(graph.segments.length).fill(-1);
  const half = new Float64Array(graph.segments.length);
  const valid = new Uint8Array(graph.segments.length);
  const nodeCoordinates: Coordinate[] = Array.from({ length: nodeIds.length }, () => [Number.NaN, Number.NaN] as Coordinate);

  graph.segments.forEach((segment, segmentIndex) => {
    const start = segmentEndpoint(graph, segmentIndex, true);
    const end = segmentEndpoint(graph, segmentIndex, false);
    if (!start || !end || segment.source === segment.target || !(segment.length_m > 0)) return;
    const source = indexByNode.get(segment.source)!;
    const target = indexByNode.get(segment.target)!;
    sourceNode[segmentIndex] = source;
    targetNode[segmentIndex] = target;
    half[segmentIndex] = segment.length_m / 2;
    valid[segmentIndex] = 1;
    nodeCoordinates[source] = start;
    nodeCoordinates[target] = end;
    adjacency[source].push({
      to: target,
      segmentIndex,
      length: segment.length_m,
      bearing: bearingDeg(start, end)
    });
    adjacency[target].push({
      to: source,
      segmentIndex,
      length: segment.length_m,
      bearing: bearingDeg(end, start)
    });
  });

  return { adjacency, sourceNode, targetNode, half, valid, nodeCoordinates };
}

function shortestNodeRoute(
  graph: RouteNodeGraph,
  mode: Exclude<RouteMode, "angular">,
  fromSegment: number,
  toSegment: number
): RouteResult | null {
  const fromNodes = endpointNodes(graph, fromSegment);
  const toNodes = endpointNodes(graph, toSegment);
  if (!fromNodes || !toNodes) return null;
  if (fromSegment === toSegment) return routeResult([fromSegment], 0, 0, 0);

  let best: RouteResult | null = null;
  let bestPrimary = Number.POSITIVE_INFINITY;
  let bestSecondary = Number.POSITIVE_INFINITY;

  for (const start of fromNodes) {
    for (const end of toNodes) {
      const result = nodeDijkstra(graph, mode, start, end, fromSegment, toSegment);
      if (!result) continue;
      const distanceM = result.distance + graph.half[fromSegment] + graph.half[toSegment];
      const primary = mode === "metric" ? distanceM : result.cost;
      const secondary = mode === "vectorMetric" ? distanceM : 0;
      if (primary < bestPrimary || (primary === bestPrimary && secondary < bestSecondary)) {
        bestPrimary = primary;
        bestSecondary = secondary;
        best = routeResult(result.segmentIndexes, distanceM, Number.NaN, mode === "metric" ? Number.NaN : result.cost);
      }
    }
  }

  return best;
}

function nodeDijkstra(
  graph: RouteNodeGraph,
  mode: Exclude<RouteMode, "angular">,
  start: number,
  end: number,
  fromSegment: number,
  toSegment: number
): { distance: number; cost: number; segmentIndexes: number[] } | null {
  const distances = new Float64Array(graph.adjacency.length);
  const costs = new Float64Array(graph.adjacency.length);
  const previousNode = new Int32Array(graph.adjacency.length);
  const previousSegment = new Int32Array(graph.adjacency.length);
  const settled = new Uint8Array(graph.adjacency.length);
  distances.fill(Number.POSITIVE_INFINITY);
  costs.fill(Number.POSITIVE_INFINITY);
  previousNode.fill(-1);
  previousSegment.fill(-1);

  const queue = new MinPriorityQueue();
  distances[start] = 0;
  costs[start] = 0;
  queue.push(start, 0);

  while (queue.size > 0) {
    const item = queue.pop();
    if (!item) break;
    const current = item.id;
    if (settled[current]) continue;
    settled[current] = 1;
    if (current === end) break;

    for (const edge of graph.adjacency[current]) {
      if (edge.segmentIndex === fromSegment || edge.segmentIndex === toSegment) continue;
      if (settled[edge.to]) continue;
      const nextDistance = distances[current] + edge.length;
      let nextCost = nextDistance;
      let priority = nextDistance;
      let secondary = 0;
      if (mode !== "metric") {
        const goalBearing = bearingDeg(graph.nodeCoordinates[current], graph.nodeCoordinates[end]);
        nextCost = costs[current] + angleDiffDeg(goalBearing, edge.bearing);
        priority = nextCost;
        secondary = mode === "vectorMetric" ? nextDistance : 0;
      }
      const oldPriority = mode === "metric" ? distances[edge.to] : costs[edge.to];
      const oldSecondary = mode === "vectorMetric" ? distances[edge.to] : 0;
      if (priority < oldPriority || (priority === oldPriority && secondary < oldSecondary)) {
        distances[edge.to] = nextDistance;
        costs[edge.to] = nextCost;
        previousNode[edge.to] = current;
        previousSegment[edge.to] = edge.segmentIndex;
        queue.push(edge.to, priority + secondary / 1e9);
      }
    }
  }

  if (!Number.isFinite(distances[end])) return null;
  const body = reconstructNodeRoute(previousNode, previousSegment, start, end, fromSegment, toSegment);
  if (!body) return null;
  return { distance: distances[end], cost: costs[end], segmentIndexes: body };
}

function reconstructNodeRoute(
  previousNode: Int32Array,
  previousSegment: Int32Array,
  start: number,
  end: number,
  fromSegment: number,
  toSegment: number
): number[] | null {
  const reverse: number[] = [];
  for (let node = end; node !== start;) {
    const segment = previousSegment[node];
    const previous = previousNode[node];
    if (segment < 0 || previous < 0) return null;
    reverse.push(segment);
    node = previous;
  }
  reverse.reverse();
  const out = [fromSegment];
  for (const segment of reverse) {
    if (segment !== fromSegment && segment !== toSegment && out[out.length - 1] !== segment) {
      out.push(segment);
    }
  }
  if (out[out.length - 1] !== toSegment) out.push(toSegment);
  return out;
}

function buildAngularRouteGraph(graph: CanonicalGraph): AngularRouteGraph {
  validateCanonicalGraph(graph);
  const edges = Array.from({ length: graph.segments.length * 2 }, () => [] as AngularRouteEdge[]);
  const valid = new Uint8Array(graph.segments.length);
  const incident = new Map<number, { segment: number; atState: number; nextState: number; inBearing: number; outBearing: number }[]>();

  graph.segments.forEach((segment, segmentIndex) => {
    const start = segmentEndpoint(graph, segmentIndex, true);
    const end = segmentEndpoint(graph, segmentIndex, false);
    if (!start || !end || segment.source === segment.target || !(segment.length_m > 0)) return;
    valid[segmentIndex] = 1;
    const forward = bearingDeg(start, end);
    const backward = bearingDeg(end, start);
    append(incident, segment.source, {
      segment: segmentIndex,
      atState: segmentIndex * 2 + 1,
      nextState: segmentIndex * 2,
      inBearing: backward,
      outBearing: forward
    });
    append(incident, segment.target, {
      segment: segmentIndex,
      atState: segmentIndex * 2,
      nextState: segmentIndex * 2 + 1,
      inBearing: forward,
      outBearing: backward
    });
  });

  for (const list of incident.values()) {
    for (const from of list) {
      for (const to of list) {
        if (from.segment === to.segment) continue;
        edges[from.atState].push({
          toState: to.nextState,
          turnDegrees: angleDiffDeg(from.inBearing, to.outBearing),
          stepLength: (graph.segments[from.segment].length_m + graph.segments[to.segment].length_m) / 2
        });
      }
    }
  }

  return { edges, valid, nSegments: graph.segments.length };
}

function shortestAngularRoute(graph: AngularRouteGraph, fromSegment: number, toSegment: number): RouteResult | null {
  if (
    fromSegment < 0 ||
    fromSegment >= graph.nSegments ||
    toSegment < 0 ||
    toSegment >= graph.nSegments ||
    !graph.valid[fromSegment] ||
    !graph.valid[toSegment]
  ) {
    return null;
  }
  if (fromSegment === toSegment) return routeResult([fromSegment], 0, 0, Number.NaN);

  let best: RouteResult | null = null;
  let bestKey = Number.POSITIVE_INFINITY;
  let bestMetric = Number.POSITIVE_INFINITY;

  for (const start of [fromSegment * 2, fromSegment * 2 + 1]) {
    const result = angularDijkstra(graph, start, fromSegment, toSegment);
    if (!result) continue;
    if (result.key < bestKey || (result.key === bestKey && result.metric < bestMetric)) {
      bestKey = result.key;
      bestMetric = result.metric;
      best = routeResult(result.segmentIndexes, result.metric, syntaxAngleWeightFromKey(result.key), Number.NaN);
    }
  }

  return best;
}

function angularDijkstra(
  graph: AngularRouteGraph,
  startState: number,
  fromSegment: number,
  toSegment: number
): { key: number; metric: number; segmentIndexes: number[] } | null {
  const nStates = graph.nSegments * 2;
  const keys = new Int32Array(nStates);
  const metrics = new Float64Array(nStates);
  const previous = new Int32Array(nStates);
  const settled = new Uint8Array(nStates);
  keys.fill(2147483647);
  metrics.fill(Number.POSITIVE_INFINITY);
  previous.fill(-1);

  const queue = new MinPriorityQueue();
  keys[startState] = 0;
  metrics[startState] = 0;
  queue.push(startState, 0);

  while (queue.size > 0) {
    const item = queue.pop();
    if (!item) break;
    const state = item.id;
    if (settled[state]) continue;
    settled[state] = 1;
    if ((state >> 1) === toSegment) continue;

    for (const edge of graph.edges[state]) {
      const segment = edge.toState >> 1;
      if (segment === fromSegment || settled[edge.toState]) continue;
      const nextKey = keys[state] + angularDepthKeyFromDegrees(edge.turnDegrees);
      const nextMetric = metrics[state] + edge.stepLength;
      if (nextKey < keys[edge.toState] || (nextKey === keys[edge.toState] && nextMetric < metrics[edge.toState])) {
        keys[edge.toState] = nextKey;
        metrics[edge.toState] = nextMetric;
        previous[edge.toState] = state;
        queue.push(edge.toState, nextKey + nextMetric / 1e9);
      }
    }
  }

  const endA = toSegment * 2;
  const endB = endA + 1;
  const end = keys[endA] < keys[endB] || (keys[endA] === keys[endB] && metrics[endA] <= metrics[endB]) ? endA : endB;
  if (!Number.isFinite(metrics[end])) return null;
  const segmentIndexes = reconstructAngularRoute(previous, startState, end, fromSegment, toSegment);
  if (!segmentIndexes) return null;
  return { key: keys[end], metric: metrics[end], segmentIndexes };
}

function reconstructAngularRoute(previous: Int32Array, start: number, end: number, fromSegment: number, toSegment: number): number[] | null {
  const reverse: number[] = [];
  for (let state = end; state !== start;) {
    if (state < 0) return null;
    const segment = state >> 1;
    if (reverse[reverse.length - 1] !== segment) reverse.push(segment);
    state = previous[state];
  }
  reverse.reverse();
  const out = [fromSegment];
  for (const segment of reverse) {
    if (segment !== fromSegment && out[out.length - 1] !== segment) out.push(segment);
  }
  if (out[out.length - 1] !== toSegment) out.push(toSegment);
  return out;
}

function endpointNodes(graph: RouteNodeGraph, segment: number): [number, number] | null {
  if (segment < 0 || segment >= graph.valid.length || !graph.valid[segment]) return null;
  return [graph.sourceNode[segment], graph.targetNode[segment]];
}

function routeResult(segmentIndexes: number[], distanceM: number, angularCost: number, vectorCost: number): RouteResult {
  return {
    segmentIndexes: Int32Array.from(segmentIndexes),
    distanceM,
    angularCost,
    vectorCost
  };
}

function segmentEndpoint(graph: CanonicalGraph, segmentIndex: number, first: boolean): Coordinate | null {
  const segment = graph.segments[segmentIndex];
  if (first && Number.isFinite(segment.x0) && Number.isFinite(segment.y0)) return [segment.x0!, segment.y0!];
  if (!first && Number.isFinite(segment.x1) && Number.isFinite(segment.y1)) return [segment.x1!, segment.y1!];
  const coordinates = segment.geometry.coordinates;
  const point = first ? coordinates[0] : coordinates[coordinates.length - 1];
  return Number.isFinite(point?.[0]) && Number.isFinite(point?.[1]) ? [point[0], point[1]] : null;
}

function bearingDeg(a: Coordinate, b: Coordinate): number {
  let bearing = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
  if (bearing < 0) bearing += 360;
  return bearing;
}

function angleDiffDeg(a: number, b: number): number {
  return Math.abs((((b - a) % 360) + 540) % 360 - 180);
}

function angularDepthKeyFromDegrees(degrees: number): number {
  return Math.floor((degrees / 90) * TULIP_SEMICIRCLE_BINS * 0.5);
}

function syntaxAngleWeightFromKey(key: number): number {
  return key / TULIP_DEPTH_SCALE;
}

function append<T>(map: Map<number, T[]>, key: number, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

