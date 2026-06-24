import { MinPriorityQueue } from "../../core/src/priority-queue.ts";
import type { CanonicalGraph, CentralityResult } from "../../core/src/types.ts";
import { validateCanonicalGraph } from "../../core/src/validation.ts";
import { radiusLabel } from "./segment-center.ts";

const ANGULAR_ROUTE_TIE_BREAK_FACTOR = 1e-6;
const EPSILON = 1e-9;

export interface CityseerSimplestOptions {
  angularScalingUnit?: number;
  tolerance?: number;
}

interface CityseerSimplestEdge {
  toState: number;
  toSegment: number;
  angleCost: number;
  walkDistance: number;
}

interface CityseerSimplestGraph {
  segmentCount: number;
  stateCount: number;
  edges: CityseerSimplestEdge[][];
}

interface CityseerState {
  routeCost: number;
  walkDistance: number;
  sigma: number;
  predecessors: number[];
}

interface CityseerTraversal {
  states: CityseerState[];
  visitedStates: number[];
  bestRouteCost: Float64Array;
  bestWalkDistance: Float64Array;
  reachedSegments: number[];
}

export function cityseerSimplestHarmonic(
  graph: CanonicalGraph,
  radius: number,
  options: CityseerSimplestOptions = {}
): CentralityResult {
  const simplest = buildCityseerSimplestGraph(graph);
  const scalingUnit = options.angularScalingUnit ?? 180;
  if (!Number.isFinite(scalingUnit) || scalingUnit <= 0) throw new Error("angularScalingUnit must be positive.");
  const values = new Float64Array(graph.segments.length);

  for (let origin = 0; origin < graph.segments.length; origin += 1) {
    const traversal = traverseCityseerSimplest(simplest, origin, radius, options.tolerance ?? 0);
    let harmonic = 0;
    for (const destination of traversal.reachedSegments) {
      if (destination === origin) continue;
      if (traversal.bestWalkDistance[destination] > radius) continue;
      harmonic += 1 / (1 + traversal.bestRouteCost[destination] / scalingUnit);
    }
    values[origin] = harmonic;
  }

  return {
    values,
    status: "compatible",
    method: `cityseer_simplest_harmonic_r${radiusLabel(radius)}`,
    notes: "cityseer node_centrality_simplest node_harmonic analogue on canonical segments as dual nodes; angular route cost is scaled by angularScalingUnit, default 180."
  };
}

export function cityseerSimplestBetweenness(
  graph: CanonicalGraph,
  radius: number,
  options: CityseerSimplestOptions = {}
): CentralityResult {
  const simplest = buildCityseerSimplestGraph(graph);
  const values = new Float64Array(graph.segments.length);

  for (let origin = 0; origin < graph.segments.length; origin += 1) {
    const traversal = traverseCityseerSimplest(simplest, origin, radius, options.tolerance ?? 0);
    const dependency = new Float64Array(simplest.stateCount);
    const targetSeed = new Float64Array(simplest.stateCount);

    for (const destination of traversal.reachedSegments) {
      if (destination === origin) continue;
      if (traversal.bestWalkDistance[destination] > radius) continue;
      const terminalStates = bestTerminalStates(traversal, destination, options.tolerance ?? 0);
      let sigmaTotal = 0;
      for (const state of terminalStates) sigmaTotal += traversal.states[state].sigma;
      if (sigmaTotal === 0) continue;
      for (const state of terminalStates) targetSeed[state] += 0.5 * traversal.states[state].sigma / sigmaTotal;
    }

    const sortedStates = [...traversal.visitedStates].sort((a, b) => traversal.states[b].routeCost - traversal.states[a].routeCost);
    for (const stateIndex of sortedStates) {
      const state = traversal.states[stateIndex];
      const credit = targetSeed[stateIndex] + dependency[stateIndex];
      const emittedCredit = credit - targetSeed[stateIndex];
      if (emittedCredit > 0 && (stateIndex >> 1) !== origin) values[stateIndex >> 1] += emittedCredit;
      for (const predecessor of state.predecessors) {
        const predecessorSigma = traversal.states[predecessor].sigma;
        if (state.sigma > 0 && predecessorSigma > 0) dependency[predecessor] += predecessorSigma / state.sigma * credit;
      }
    }
  }

  return {
    values,
    status: "compatible",
    method: `cityseer_simplest_betweenness_r${radiusLabel(radius)}`,
    notes: "cityseer node_centrality_simplest node_betweenness analogue on canonical segments as dual nodes; all source-eligible segment pairs use cityseer's 0.5 pair weighting."
  };
}

function traverseCityseerSimplest(
  graph: CityseerSimplestGraph,
  origin: number,
  radius: number,
  tolerance: number
): CityseerTraversal {
  const states = Array.from({ length: graph.stateCount }, () => ({
    routeCost: Number.POSITIVE_INFINITY,
    walkDistance: Number.POSITIVE_INFINITY,
    sigma: 0,
    predecessors: [] as number[]
  }));
  const visited = new Uint8Array(graph.stateCount);
  const visitedStates: number[] = [];
  const bestRouteCost = new Float64Array(graph.segmentCount);
  const bestWalkDistance = new Float64Array(graph.segmentCount);
  bestRouteCost.fill(Number.POSITIVE_INFINITY);
  bestWalkDistance.fill(Number.POSITIVE_INFINITY);
  const queue = new MinPriorityQueue();

  bestRouteCost[origin] = 0;
  bestWalkDistance[origin] = 0;
  for (const stateIndex of [origin * 2, origin * 2 + 1]) {
    states[stateIndex].routeCost = 0;
    states[stateIndex].walkDistance = 0;
    states[stateIndex].sigma = 1;
    queue.push(stateIndex, 0);
  }

  while (queue.size > 0) {
    const item = queue.pop();
    if (!item) break;
    const stateIndex = item.id;
    if (visited[stateIndex]) continue;
    visited[stateIndex] = 1;
    visitedStates.push(stateIndex);

    for (const edge of graph.edges[stateIndex]) {
      const next = states[edge.toState];
      const candidateWalk = states[stateIndex].walkDistance + edge.walkDistance;
      if (candidateWalk > radius) continue;
      if (visited[edge.toState]) continue;
      const candidateRoute = states[stateIndex].routeCost + edge.angleCost + ANGULAR_ROUTE_TIE_BREAK_FACTOR * edge.walkDistance;
      const improved = candidateRoute < next.routeCost - EPSILON;
      const tied = candidateRoute <= next.routeCost * (1 + Math.max(tolerance, 0)) + EPSILON;
      if (improved) {
        next.routeCost = candidateRoute;
        next.walkDistance = candidateWalk;
        next.sigma = states[stateIndex].sigma;
        next.predecessors = [stateIndex];
        queue.push(edge.toState, candidateRoute);
      } else if (tied && !next.predecessors.includes(stateIndex)) {
        next.walkDistance = Math.min(next.walkDistance, candidateWalk);
        next.sigma += states[stateIndex].sigma;
        next.predecessors.push(stateIndex);
      }

      if (candidateRoute < bestRouteCost[edge.toSegment] - EPSILON) {
        bestRouteCost[edge.toSegment] = candidateRoute;
        bestWalkDistance[edge.toSegment] = candidateWalk;
      } else if (Math.abs(candidateRoute - bestRouteCost[edge.toSegment]) <= EPSILON) {
        bestWalkDistance[edge.toSegment] = Math.min(bestWalkDistance[edge.toSegment], candidateWalk);
      }
    }
  }

  const reachedSegments: number[] = [];
  for (let segment = 0; segment < graph.segmentCount; segment += 1) {
    if (Number.isFinite(bestRouteCost[segment])) reachedSegments.push(segment);
  }

  return { states, visitedStates, bestRouteCost, bestWalkDistance, reachedSegments };
}

function bestTerminalStates(traversal: CityseerTraversal, segment: number, tolerance: number): number[] {
  const best = traversal.bestRouteCost[segment];
  const states = [segment * 2, segment * 2 + 1];
  return states.filter((stateIndex) => {
    const state = traversal.states[stateIndex];
    return state.sigma > 0 && state.routeCost <= best * (1 + Math.max(tolerance, 0)) + EPSILON;
  });
}

function buildCityseerSimplestGraph(graph: CanonicalGraph): CityseerSimplestGraph {
  validateCanonicalGraph(graph);
  const edges = Array.from({ length: graph.segments.length * 2 }, () => [] as CityseerSimplestEdge[]);
  const segmentIndexesByNode = new Map<number, number[]>();
  const lineCurvature = graph.segments.map((_segment, index) => lineAngularCurvature(graph, index));
  graph.segments.forEach((segment, index) => {
    appendSegment(segmentIndexesByNode, segment.source, index);
    appendSegment(segmentIndexesByNode, segment.target, index);
  });

  for (const [nodeId, segmentIndexes] of segmentIndexesByNode) {
    for (const from of segmentIndexes) {
      const fromExitSlot = graph.segments[from].source === nodeId ? 0 : 1;
      const fromEntrySlot = 1 - fromExitSlot;
      for (const to of segmentIndexes) {
        if (from === to) continue;
        const toEntrySlot = graph.segments[to].source === nodeId ? 0 : 1;
        const angleCost = lineCurvature[from] / 2 + turnAngleAtNodeDegrees(graph, from, to, nodeId) + lineCurvature[to] / 2;
        const walkDistance = (graph.segments[from].length_m + graph.segments[to].length_m) / 2;
        edges[from * 2 + fromEntrySlot].push({
          toState: to * 2 + toEntrySlot,
          toSegment: to,
          angleCost,
          walkDistance
        });
      }
    }
  }

  return { segmentCount: graph.segments.length, stateCount: graph.segments.length * 2, edges };
}

function appendSegment(segmentIndexesByNode: Map<number, number[]>, nodeId: number, segmentIndex: number): void {
  const segmentIndexes = segmentIndexesByNode.get(nodeId);
  if (segmentIndexes) segmentIndexes.push(segmentIndex);
  else segmentIndexesByNode.set(nodeId, [segmentIndex]);
}

function lineAngularCurvature(graph: CanonicalGraph, segmentIndex: number): number {
  const coordinates = graph.segments[segmentIndex].geometry.coordinates;
  let total = 0;
  for (let i = 1; i < coordinates.length - 1; i += 1) {
    total += turnAngleDegrees(coordinates[i - 1], coordinates[i], coordinates[i + 1]);
  }
  return total;
}

function turnAngleAtNodeDegrees(graph: CanonicalGraph, a: number, b: number, nodeId: number): number {
  const aFar = farEndpoint(graph, a, nodeId);
  const turn = sharedEndpoint(graph, a, nodeId);
  const bFar = farEndpoint(graph, b, nodeId);
  if (!aFar || !turn || !bFar) return 90;
  return turnAngleDegrees(aFar, turn, bFar);
}

function turnAngleDegrees(
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
