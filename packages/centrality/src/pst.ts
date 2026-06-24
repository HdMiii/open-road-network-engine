import type { CanonicalGraph, CentralityResult } from "../../core/src/types.ts";
import {
  buildSegmentCenterAngularAdjacency,
  buildSegmentCenterAdjacency,
  radiusLabel,
  segmentCenterDijkstra,
  type SegmentCenterEdge,
  weightsOrDefault
} from "./segment-center.ts";

export interface PstPlaceAccessibilityOptions {
  destinationWeights?: ArrayLike<number>;
  decayBeta?: number;
  selfDistance?: number;
}

export interface PstAngularRadii {
  straight?: number;
  walking?: number;
  angular?: number;
  steps?: number;
}

export interface PstAngularOptions {
  radii?: PstAngularRadii;
  weighByLength?: boolean;
  angleThresholdDegrees?: number;
  anglePrecisionDegrees?: number;
}

export interface PstAngularAnalysis {
  choice: Float64Array;
  nodeCounts: Uint32Array;
  totalDepths: Float64Array;
  totalWeights: Float64Array;
  totalDepthWeights: Float64Array;
}

interface PstSegment {
  index: number;
  source: number;
  target: number;
  first: readonly [number, number];
  last: readonly [number, number];
  center: readonly [number, number];
  length: number;
  orientation: number;
}

interface PstState {
  lowestAngle: number;
  outStates: number[];
  score: number;
  numShortestPaths: number;
  processed: boolean;
}

interface PstTraversalState {
  segmentIndex: number;
  forwards: boolean;
  accumulatedAngle: number;
  sourceStateIndex: number;
  accWalking: number;
  accAngle: number;
  accSteps: number;
}

const NO_SOURCE_STATE = -1;

export function pstAngularAnalysis(graph: CanonicalGraph, options: PstAngularOptions = {}): PstAngularAnalysis {
  const segments = buildPstSegments(graph);
  const intersections = buildPstIntersections(graph);
  const choice = new Float64Array(segments.length);
  const nodeCounts = new Uint32Array(segments.length);
  const totalDepths = new Float64Array(segments.length);
  const totalWeights = new Float64Array(segments.length);
  const totalDepthWeights = new Float64Array(segments.length);
  const radii = normalizePstAngularRadii(options.radii);
  const weighByLength = options.weighByLength ?? false;
  const angleThreshold = options.angleThresholdDegrees ?? 0;
  const anglePrecision = options.anglePrecisionDegrees ?? 1;
  if (!Number.isFinite(anglePrecision) || anglePrecision <= 0) {
    throw new Error("anglePrecisionDegrees must be a positive number.");
  }

  for (let origin = 0; origin < segments.length; origin += 1) {
    const states = Array.from({ length: segments.length * 2 }, createPstState);
    const root = processPstOrigin(
      origin,
      segments,
      intersections,
      states,
      radii,
      weighByLength,
      angleThreshold,
      anglePrecision
    );
    nodeCounts[origin] = root.nodeCount;
    totalDepths[origin] = syntaxAngleWeightFromDegrees(root.totalDepthDegrees);
    totalWeights[origin] = root.totalWeight;
    totalDepthWeights[origin] = syntaxAngleWeightFromDegrees(root.totalDepthWeightDegrees);
    collectPstChoiceScores(origin, segments, intersections, states, choice, weighByLength);
  }

  return { choice, nodeCounts, totalDepths, totalWeights, totalDepthWeights };
}

export function pstAngularNodeCount(graph: CanonicalGraph, options: PstAngularOptions = {}): CentralityResult {
  return {
    values: Float64Array.from(pstAngularAnalysis(graph, options).nodeCounts),
    status: "compatible",
    method: pstAngularMethod("pst_angular_node_count", options),
    notes: "PST Pstalgo-compatible angular node counts over directed segment states; count includes the origin segment."
  };
}

export function pstAngularTotalDepth(graph: CanonicalGraph, options: PstAngularOptions = {}): CentralityResult {
  return {
    values: pstAngularAnalysis(graph, options).totalDepths,
    status: "compatible",
    method: pstAngularMethod("pst_angular_total_depth", options),
    notes: "PST Pstalgo-compatible angular total depth, with accumulated degrees converted by degrees / 90."
  };
}

export function pstAngularIntegration(graph: CanonicalGraph, options: PstAngularOptions = {}): CentralityResult {
  const analysis = pstAngularAnalysis(graph, options);
  const values = new Float64Array(graph.segments.length);
  for (let i = 0; i < values.length; i += 1) values[i] = (analysis.nodeCounts[i] - 1) / (analysis.totalDepths[i] + 1);
  return {
    values,
    status: "compatible",
    method: pstAngularMethod("pst_angular_integration", options),
    notes: "PST Pstalgo AngularIntegration normal normalization: (N - 1) / (TD + 1)."
  };
}

export function pstAngularSyntaxIntegration(graph: CanonicalGraph, options: PstAngularOptions = {}): CentralityResult {
  const analysis = pstAngularAnalysis(graph, options);
  const values = new Float64Array(graph.segments.length);
  for (let i = 0; i < values.length; i += 1) values[i] = analysis.nodeCounts[i] ** 1.2 / (analysis.totalDepths[i] + 1);
  return {
    values,
    status: "compatible",
    method: pstAngularMethod("pst_angular_syntax_integration", options),
    notes: "PST Pstalgo AngularIntegration syntax normalization: N^1.2 / (TD + 1)."
  };
}

export function pstAngularHillierIntegration(graph: CanonicalGraph, options: PstAngularOptions = {}): CentralityResult {
  const analysis = pstAngularAnalysis(graph, options);
  const values = new Float64Array(graph.segments.length);
  for (let i = 0; i < values.length; i += 1) values[i] = analysis.nodeCounts[i] ** 2 / (analysis.totalDepths[i] + 1);
  return {
    values,
    status: "compatible",
    method: pstAngularMethod("pst_angular_hillier_integration", options),
    notes: "PST Pstalgo AngularIntegration Hillier normalization: N^2 / (TD + 1)."
  };
}

export function pstAngularChoice(graph: CanonicalGraph, options: PstAngularOptions = {}): CentralityResult {
  return {
    values: pstAngularAnalysis(graph, options).choice,
    status: "compatible",
    method: pstAngularMethod("pst_angular_choice", options),
    notes: "PST Pstalgo AngularChoice over directed segment states with equal shortest angular paths split across state counts."
  };
}

export function pstAngularChoiceNormalized(graph: CanonicalGraph, options: PstAngularOptions = {}): CentralityResult {
  const analysis = pstAngularAnalysis(graph, options);
  const values = new Float64Array(graph.segments.length);
  for (let i = 0; i < values.length; i += 1) {
    values[i] = analysis.nodeCounts[i] > 2
      ? analysis.choice[i] / ((analysis.nodeCounts[i] - 1) * (analysis.nodeCounts[i] - 2))
      : analysis.choice[i];
  }
  return {
    values,
    status: "compatible",
    method: pstAngularMethod("pst_angular_choice_normalized", options),
    notes: "PST Pstalgo AngularChoice normalization: C / ((N - 1)(N - 2)) for N > 2."
  };
}

export function pstAngularChoiceSyntaxNormalized(graph: CanonicalGraph, options: PstAngularOptions = {}): CentralityResult {
  const analysis = pstAngularAnalysis(graph, options);
  const values = new Float64Array(graph.segments.length);
  for (let i = 0; i < values.length; i += 1) values[i] = Math.log10(analysis.choice[i] + 1) / Math.log10(analysis.totalDepths[i] + 2);
  return {
    values,
    status: "compatible",
    method: pstAngularMethod("pst_angular_choice_syntax_normalized", options),
    notes: "PST Pstalgo AngularChoice syntax normalization: log10(C + 1) / log10(TD + 2)."
  };
}

export function pstPlaceReach(
  graph: CanonicalGraph,
  radius: number,
  options: Pick<PstPlaceAccessibilityOptions, "destinationWeights"> = {}
): CentralityResult {
  const destinationWeights = weightsOrDefault(graph.segments.length, options.destinationWeights);
  return pstDistanceAggregate(graph, radius, "pst_place_reach", destinationWeights, (_distance, weight) => weight);
}

export function pstPlaceAngularReach(
  graph: CanonicalGraph,
  radius: number,
  options: Pick<PstPlaceAccessibilityOptions, "destinationWeights"> = {}
): CentralityResult {
  const destinationWeights = weightsOrDefault(graph.segments.length, options.destinationWeights);
  return pstDistanceAggregate(
    graph,
    radius,
    "pst_place_angular_reach",
    destinationWeights,
    (_distance, weight) => weight,
    "",
    buildSegmentCenterAngularAdjacency(graph),
    "angular"
  );
}

export function pstPlaceGravity(
  graph: CanonicalGraph,
  radius: number,
  options: PstPlaceAccessibilityOptions = {}
): CentralityResult {
  const destinationWeights = weightsOrDefault(graph.segments.length, options.destinationWeights);
  const beta = options.decayBeta ?? 1;
  const selfDistance = options.selfDistance ?? 1;
  if (!Number.isFinite(beta) || beta < 0) throw new Error("decayBeta must be a non-negative number.");
  if (!Number.isFinite(selfDistance) || selfDistance <= 0) throw new Error("selfDistance must be a positive number.");

  return pstDistanceAggregate(graph, radius, "pst_place_gravity", destinationWeights, (distance, weight) => {
    const effectiveDistance = distance === 0 ? selfDistance : distance;
    return weight / effectiveDistance ** beta;
  }, `; beta=${beta}; selfDistance=${selfDistance}`);
}

export function pstPlaceAngularGravity(
  graph: CanonicalGraph,
  radius: number,
  options: PstPlaceAccessibilityOptions = {}
): CentralityResult {
  const destinationWeights = weightsOrDefault(graph.segments.length, options.destinationWeights);
  const beta = options.decayBeta ?? 1;
  const selfDistance = options.selfDistance ?? 1;
  if (!Number.isFinite(beta) || beta < 0) throw new Error("decayBeta must be a non-negative number.");
  if (!Number.isFinite(selfDistance) || selfDistance <= 0) throw new Error("selfDistance must be a positive number.");

  return pstDistanceAggregate(
    graph,
    radius,
    "pst_place_angular_gravity",
    destinationWeights,
    (distance, weight) => {
      const effectiveDistance = distance === 0 ? selfDistance : distance;
      return weight / effectiveDistance ** beta;
    },
    `; beta=${beta}; selfDistance=${selfDistance}`,
    buildSegmentCenterAngularAdjacency(graph),
    "angular"
  );
}

export function pstPlaceMeanDistance(
  graph: CanonicalGraph,
  radius: number,
  options: Pick<PstPlaceAccessibilityOptions, "destinationWeights"> = {}
): CentralityResult {
  const adjacency = buildSegmentCenterAdjacency(graph);
  const destinationWeights = weightsOrDefault(graph.segments.length, options.destinationWeights);
  const values = new Float64Array(graph.segments.length);

  for (let origin = 0; origin < graph.segments.length; origin += 1) {
    const distances = segmentCenterDijkstra(adjacency, origin, radius).distances;
    let weightedDistance = 0;
    let totalWeight = 0;
    for (let destination = 0; destination < graph.segments.length; destination += 1) {
      const distance = distances[destination];
      if (!Number.isFinite(distance) || distance > radius || destinationWeights[destination] === 0) continue;
      weightedDistance += distance * destinationWeights[destination];
      totalWeight += destinationWeights[destination];
    }
    values[origin] = totalWeight === 0 ? 0 : weightedDistance / totalWeight;
  }

  return {
    values,
    status: "experimental",
    method: `pst_place_mean_distance_r${radiusLabel(radius)}`,
    notes: "PST-style weighted mean network distance to destination-place weights over a segment-centre axial/line proxy graph."
  };
}

export function pstPlaceMeanAngularDistance(
  graph: CanonicalGraph,
  radius: number,
  options: Pick<PstPlaceAccessibilityOptions, "destinationWeights"> = {}
): CentralityResult {
  const adjacency = buildSegmentCenterAngularAdjacency(graph);
  const destinationWeights = weightsOrDefault(graph.segments.length, options.destinationWeights);
  const values = new Float64Array(graph.segments.length);

  for (let origin = 0; origin < graph.segments.length; origin += 1) {
    const distances = segmentCenterDijkstra(adjacency, origin, radius).distances;
    let weightedDistance = 0;
    let totalWeight = 0;
    for (let destination = 0; destination < graph.segments.length; destination += 1) {
      const distance = distances[destination];
      if (!Number.isFinite(distance) || distance > radius || destinationWeights[destination] === 0) continue;
      weightedDistance += distance * destinationWeights[destination];
      totalWeight += destinationWeights[destination];
    }
    values[origin] = totalWeight === 0 ? 0 : weightedDistance / totalWeight;
  }

  return {
    values,
    status: "experimental",
    method: `pst_place_mean_angular_distance_r${radiusLabel(radius)}`,
    notes: "PST-style weighted mean angular distance to destination-place weights over a segment-centre axial/line proxy graph. This is a place-accessibility helper, not Pstalgo AngularIntegration/AngularChoice."
  };
}

function pstDistanceAggregate(
  graph: CanonicalGraph,
  radius: number,
  baseMethod: string,
  destinationWeights: Float64Array,
  aggregate: (distance: number, weight: number) => number,
  extraNote = "",
  adjacency: readonly SegmentCenterEdge[][] = buildSegmentCenterAdjacency(graph),
  mode = "network"
): CentralityResult {
  const values = new Float64Array(graph.segments.length);

  for (let origin = 0; origin < graph.segments.length; origin += 1) {
    const distances = segmentCenterDijkstra(adjacency, origin, radius).distances;
    let total = 0;
    for (let destination = 0; destination < graph.segments.length; destination += 1) {
      const distance = distances[destination];
      const weight = destinationWeights[destination];
      if (!Number.isFinite(distance) || distance > radius || weight === 0) continue;
      total += aggregate(distance, weight);
    }
    values[origin] = total;
  }

  return {
    values,
    status: "experimental",
    method: `${baseMethod}_r${radiusLabel(radius)}`,
    notes: `PST-style place accessibility over a segment-centre axial/line proxy graph with explicit destination weights and ${mode} distance${extraNote}.`
  };
}

function processPstOrigin(
  origin: number,
  segments: readonly PstSegment[],
  intersections: ReadonlyMap<number, readonly number[]>,
  states: PstState[],
  radii: Required<PstAngularRadii>,
  weighByLength: boolean,
  angleThreshold: number,
  anglePrecision: number
): { nodeCount: number; totalDepthDegrees: number; totalWeight: number; totalDepthWeightDegrees: number } {
  let segmentsReached = 0;
  let totalDepthDegrees = 0;
  let totalWeight = 0;
  let totalDepthWeightDegrees = 0;
  const queue: PstTraversalState[] = [];
  const originCenter = segments[origin].center;

  const processState = (traversal: PstTraversalState): void => {
    const segment = segments[traversal.segmentIndex];
    const stateIndex = pstStateIndex(traversal.segmentIndex, traversal.forwards);
    const state = states[stateIndex];
    if (state.processed && traversal.accumulatedAngle > state.lowestAngle) return;

    if (traversal.sourceStateIndex !== NO_SOURCE_STATE) {
      const source = states[traversal.sourceStateIndex];
      if (!source.outStates.includes(stateIndex)) source.outStates.push(stateIndex);
    }

    if (state.processed) {
      state.numShortestPaths += 1;
      return;
    }

    if (traversal.sourceStateIndex !== NO_SOURCE_STATE && !states[pstStateIndex(traversal.segmentIndex, !traversal.forwards)].processed) {
      segmentsReached += 1;
      const weight = weighByLength ? segment.length : 1;
      totalDepthDegrees += traversal.accAngle;
      totalWeight += weight;
      totalDepthWeightDegrees += traversal.accAngle * weight;
    }

    state.processed = true;
    state.score = -1;
    state.numShortestPaths = 1;
    state.lowestAngle = traversal.accumulatedAngle;
    state.outStates = [];

    if (traversal.accSteps >= radii.steps) return;
    const exitNode = traversal.forwards ? segment.target : segment.source;
    const exitPoint = nodePoint(segments, segment, exitNode);
    if (!withinSquaredDistance(originCenter, exitPoint, radii.straight * radii.straight)) return;
    const orientation = traversal.forwards ? segment.orientation : reverseAngle(segment.orientation);

    for (const otherIndex of intersections.get(exitNode) ?? []) {
      if (otherIndex === traversal.segmentIndex) continue;
      const other = segments[otherIndex];
      if (!withinSquaredDistance(originCenter, other.center, radii.straight * radii.straight)) continue;
      const accWalking = traversal.accWalking + (segment.length + other.length) / 2;
      if (accWalking > radii.walking) continue;

      const otherForwards = other.source === exitNode;
      const otherOrientation = otherForwards ? other.orientation : reverseAngle(other.orientation);
      let deltaAngle = angleDiff(orientation, otherOrientation);
      if (deltaAngle < angleThreshold) deltaAngle = 0;
      const accAngle = traversal.accAngle + deltaAngle;
      if (accAngle > radii.angular) continue;
      const discrete = Math.floor(deltaAngle / anglePrecision + 0.5);
      queuePush(queue, {
        segmentIndex: otherIndex,
        forwards: otherForwards,
        accumulatedAngle: traversal.accumulatedAngle + discrete,
        sourceStateIndex: stateIndex,
        accWalking,
        accAngle,
        accSteps: traversal.accSteps + 1
      });
    }
  };

  processState({
    segmentIndex: origin,
    forwards: false,
    accumulatedAngle: 0,
    sourceStateIndex: NO_SOURCE_STATE,
    accWalking: 0,
    accAngle: 0,
    accSteps: 0
  });
  processState({
    segmentIndex: origin,
    forwards: true,
    accumulatedAngle: 0,
    sourceStateIndex: NO_SOURCE_STATE,
    accWalking: 0,
    accAngle: 0,
    accSteps: 0
  });

  while (queue.length > 0) processState(queue.shift()!);

  return {
    nodeCount: segmentsReached + 1,
    totalDepthDegrees,
    totalWeight,
    totalDepthWeightDegrees
  };
}

function collectPstChoiceScores(
  origin: number,
  segments: readonly PstSegment[],
  _intersections: ReadonlyMap<number, readonly number[]>,
  states: PstState[],
  choice: Float64Array,
  weighByLength: boolean
): void {
  const previousOriginScore = choice[origin];
  collectPstStateScore(origin, false, origin, segments, states, choice, weighByLength);
  collectPstStateScore(origin, true, origin, segments, states, choice, weighByLength);
  if (weighByLength) {
    choice[origin] = previousOriginScore + (choice[origin] - previousOriginScore) * 0.5;
  } else {
    choice[origin] = previousOriginScore;
  }
}

function collectPstStateScore(
  segmentIndex: number,
  forwards: boolean,
  origin: number,
  segments: readonly PstSegment[],
  states: PstState[],
  choice: Float64Array,
  weighByLength: boolean
): void {
  const state = states[pstStateIndex(segmentIndex, forwards)];
  const opposite = states[pstStateIndex(segmentIndex, !forwards)];
  if (!state.processed) return;
  state.score = 0;

  for (const childStateIndex of state.outStates) {
    const childSegmentIndex = childStateIndex >> 1;
    const childForwards = (childStateIndex & 1) === 0;
    const child = states[childStateIndex];
    if (child.score < 0) collectPstStateScore(childSegmentIndex, childForwards, origin, segments, states, choice, weighByLength);
    state.score += child.score / child.numShortestPaths;
  }

  choice[segmentIndex] += state.score;
  const oppositeLowest = opposite.processed ? opposite.lowestAngle : Number.POSITIVE_INFINITY;
  if (state.lowestAngle <= oppositeLowest) {
    let stateScore = weighByLength ? segments[segmentIndex].length * segments[origin].length : 1;
    if (state.lowestAngle === oppositeLowest) {
      stateScore *= state.numShortestPaths / (state.numShortestPaths + opposite.numShortestPaths);
    }
    state.score += stateScore;
    if (weighByLength && segmentIndex !== origin) choice[segmentIndex] += stateScore * 0.5;
  }
}

function buildPstSegments(graph: CanonicalGraph): PstSegment[] {
  return graph.segments.map((segment, index) => {
    const first = firstCoordinate(graph, index);
    const last = lastCoordinate(graph, index);
    return {
      index,
      source: segment.source,
      target: segment.target,
      first,
      last,
      center: [(first[0] + last[0]) / 2, (first[1] + last[1]) / 2],
      length: segment.length_m,
      orientation: orientationDegrees(first, last)
    };
  });
}

function buildPstIntersections(graph: CanonicalGraph): Map<number, number[]> {
  const intersections = new Map<number, number[]>();
  graph.segments.forEach((segment, index) => {
    appendIntersection(intersections, segment.source, index);
    appendIntersection(intersections, segment.target, index);
  });
  return intersections;
}

function appendIntersection(intersections: Map<number, number[]>, nodeId: number, segmentIndex: number): void {
  const segments = intersections.get(nodeId);
  if (segments) segments.push(segmentIndex);
  else intersections.set(nodeId, [segmentIndex]);
}

function createPstState(): PstState {
  return {
    lowestAngle: Number.POSITIVE_INFINITY,
    outStates: [],
    score: 0,
    numShortestPaths: 0,
    processed: false
  };
}

function normalizePstAngularRadii(radii: PstAngularRadii = {}): Required<PstAngularRadii> {
  return {
    straight: radii.straight ?? Number.POSITIVE_INFINITY,
    walking: radii.walking ?? Number.POSITIVE_INFINITY,
    angular: radii.angular ?? Number.POSITIVE_INFINITY,
    steps: radii.steps ?? Number.POSITIVE_INFINITY
  };
}

function pstAngularMethod(base: string, options: PstAngularOptions): string {
  const radii = options.radii ?? {};
  const labels = [
    radii.straight === undefined ? undefined : `s${radiusLabel(radii.straight)}`,
    radii.walking === undefined ? undefined : `w${radiusLabel(radii.walking)}`,
    radii.angular === undefined ? undefined : `a${radiusLabel(radii.angular)}`,
    radii.steps === undefined ? undefined : `st${radiusLabel(radii.steps)}`
  ].filter(Boolean);
  return labels.length === 0 ? `${base}_rn` : `${base}_${labels.join("_")}`;
}

function pstStateIndex(segmentIndex: number, forwards: boolean): number {
  return (segmentIndex << 1) + (forwards ? 0 : 1);
}

function queuePush(queue: PstTraversalState[], state: PstTraversalState): void {
  let index = queue.length;
  while (index > 0 && queue[index - 1].accumulatedAngle > state.accumulatedAngle) index -= 1;
  queue.splice(index, 0, state);
}

function syntaxAngleWeightFromDegrees(degrees: number): number {
  return degrees / 90;
}

function angleDiff(a: number, b: number): number {
  const diff = Math.abs(a - b);
  return diff > 180 ? 360 - diff : diff;
}

function reverseAngle(angle: number): number {
  return angle < 180 ? angle + 180 : angle - 180;
}

function orientationDegrees(first: readonly [number, number], last: readonly [number, number]): number {
  const angle = Math.atan2(last[1] - first[1], last[0] - first[0]) * 180 / Math.PI;
  return angle < 0 ? angle + 360 : angle;
}

function nodePoint(segments: readonly PstSegment[], segment: PstSegment, nodeId: number): readonly [number, number] {
  if (segment.source === nodeId) return endpointCoordinate(segments, segment.index, true);
  return endpointCoordinate(segments, segment.index, false);
}

function endpointCoordinate(segments: readonly PstSegment[], segmentIndex: number, first: boolean): readonly [number, number] {
  const segment = segments[segmentIndex];
  return first ? segment.first : segment.last;
}

function firstCoordinate(graph: CanonicalGraph, segmentIndex: number): readonly [number, number] {
  const segment = graph.segments[segmentIndex];
  if (Number.isFinite(segment.x0) && Number.isFinite(segment.y0)) return [segment.x0!, segment.y0!];
  const point = segment.geometry.coordinates[0];
  return [point[0], point[1]];
}

function lastCoordinate(graph: CanonicalGraph, segmentIndex: number): readonly [number, number] {
  const segment = graph.segments[segmentIndex];
  if (Number.isFinite(segment.x1) && Number.isFinite(segment.y1)) return [segment.x1!, segment.y1!];
  const point = segment.geometry.coordinates[segment.geometry.coordinates.length - 1];
  return [point[0], point[1]];
}

function withinSquaredDistance(a: readonly [number, number], b: readonly [number, number], maxSquared: number): boolean {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy <= maxSquared;
}
