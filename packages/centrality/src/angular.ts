import { MinPriorityQueue } from "../../core/src/priority-queue.ts";
import type { CanonicalGraph, CentralityResult } from "../../core/src/types.ts";
import { validateCanonicalGraph } from "../../core/src/validation.ts";
import { makeProgressTicker, type AnalysisProgressCallback } from "../../core/src/progress.ts";

const TULIP_BINS = 1024;
const TULIP_SEMICIRCLE_BINS = TULIP_BINS / 2 + 1;
const TULIP_DEPTH_SCALE = (TULIP_SEMICIRCLE_BINS - 1) * 0.5;

interface AngularEdge {
  toState: number;
  turnDegrees: number;
  stepLength: number;
}

interface AngularGraph {
  nSegments: number;
  nStates: number;
  edges: AngularEdge[][];
  valid: Uint8Array;
  half: Float64Array;
}

interface AngularSearchResult {
  stateMetric: Float64Array;
  stateKey: Int32Array;
  segmentKey: Int32Array;
  previousState: Int32Array;
  reachedSegments: number[];
}

export function angularIntegration(graph: CanonicalGraph, radius: number, totalDepthOffset = 0, onProgress?: AnalysisProgressCallback): CentralityResult {
  const angular = buildAngularGraph(graph);
  const values = new Float64Array(graph.segments.length);
  const tick = makeProgressTicker(angular.nSegments, onProgress);
  for (let root = 0; root < angular.nSegments; root += 1) {
    tick(root);
    if (!angular.valid[root]) {
      values[root] = Number.NaN;
      continue;
    }
    const result = searchAngularGraph(angular, root, radius);
    const totalDepth = totalAngularDepth(result);
    values[root] = result.reachedSegments.length > 1 && (totalDepthOffset > 0 || totalDepth > 1e-9)
      ? (result.reachedSegments.length * result.reachedSegments.length) / (totalDepth + totalDepthOffset)
      : Number.NaN;
  }
  return {
    values,
    status: "compatible",
    method: `angular_integration_r${radius}`,
    notes: `Angular segment integration N^2 / (TD + ${totalDepthOffset}) using directed endpoint states, turn-angle impedance, and metric radius gating.${totalDepthOffset > 0 ? " The positive denominator offset keeps low-angularity (near-straight) areas finite instead of NaN." : ""}`
  };
}

export function angularNain(graph: CanonicalGraph, radius: number, onProgress?: AnalysisProgressCallback): CentralityResult {
  const angular = buildAngularGraph(graph);
  const values = new Float64Array(graph.segments.length);
  const tick = makeProgressTicker(angular.nSegments, onProgress);
  for (let root = 0; root < angular.nSegments; root += 1) {
    tick(root);
    if (!angular.valid[root]) {
      values[root] = Number.NaN;
      continue;
    }
    const result = searchAngularGraph(angular, root, radius);
    const totalDepth = totalAngularDepth(result);
    values[root] = result.reachedSegments.length > 1
      ? Math.pow(result.reachedSegments.length, 1.2) / (totalDepth + 2)
      : Number.NaN;
  }
  return {
    values,
    status: "compatible",
    method: `angular_nain_r${radius}`,
    notes: "Normalised angular integration using the current website NAIN denominator."
  };
}

export function canonicalAngularChoice(graph: CanonicalGraph, radius: number, onProgress?: AnalysisProgressCallback): CentralityResult {
  const angular = buildAngularGraph(graph);
  const values = angularChoiceValues(angular, radius, onProgress);
  return {
    values,
    status: "compatible",
    method: `canonical_angular_choice_r${radius}`,
    notes: "Canonical engine angular choice: simple angular betweenness over one shortest angular path per unordered segment pair, crediting intermediate segments only (origin/target endpoint segments excluded, matching standard space-syntax choice)."
  };
}

export function angularChoice(graph: CanonicalGraph, radius: number, onProgress?: AnalysisProgressCallback): CentralityResult {
  const result = canonicalAngularChoice(graph, radius, onProgress);
  return {
    ...result,
    method: `angular_choice_r${radius}`,
    notes: `${result.notes} This backward-compatible alias is used by the current website angular_choice column.`
  };
}

export function depthmapXTulipAngularChoice(graph: CanonicalGraph, radius: number, onProgress?: AnalysisProgressCallback): CentralityResult {
  const angular = buildAngularGraph(graph);
  const values = angularAuditTrailChoiceValues(angular, radius, onProgress);
  return {
    values,
    status: "compatible",
    method: `depthmapx_tulip_angular_choice_r${radius}`,
    notes: "DepthmapX Tulip-style angular choice accumulator over directed segment states. This mirrors the leaf back-path audit-trail counting used by DepthmapX Tulip choice more closely than simple pairwise angularChoice()."
  };
}

export function angularNach(graph: CanonicalGraph, radius: number, onProgress?: AnalysisProgressCallback): CentralityResult {
  const angular = buildAngularGraph(graph);
  // NACH runs two O(segments) passes (choice, then total depth). Report progress
  // only on this second pass; the first pass falls under the host's indeterminate
  // bar, then the determinate bar takes over here — keeping progress monotonic.
  const choice = angularChoiceValues(angular, radius);
  const values = new Float64Array(graph.segments.length);
  const tick = makeProgressTicker(angular.nSegments, onProgress);
  for (let root = 0; root < angular.nSegments; root += 1) {
    tick(root);
    if (!angular.valid[root]) {
      values[root] = Number.NaN;
      continue;
    }
    const result = searchAngularGraph(angular, root, radius);
    const totalDepth = totalAngularDepth(result);
    values[root] = Number.isFinite(totalDepth)
      ? Math.log(choice[root] + 1) / Math.log(totalDepth + 3)
      : Number.NaN;
  }
  return {
    values,
    status: "compatible",
    method: `angular_nach_r${radius}`,
    notes: "Normalised angular choice using log(choice + 1) / log(totalDepth + 3)."
  };
}

export function onDemandAngularIntegration(graph: CanonicalGraph, segmentIndex: number, radius: number, totalDepthOffset = 0): number {
  const angular = buildAngularGraph(graph);
  if (!angular.valid[segmentIndex]) return Number.NaN;
  const result = searchAngularGraph(angular, segmentIndex, radius);
  const totalDepth = totalAngularDepth(result);
  return result.reachedSegments.length > 1 && (totalDepthOffset > 0 || totalDepth > 1e-9)
    ? (result.reachedSegments.length * result.reachedSegments.length) / (totalDepth + totalDepthOffset)
    : Number.NaN;
}

export function onDemandAngularNain(graph: CanonicalGraph, segmentIndex: number, radius: number): number {
  const angular = buildAngularGraph(graph);
  if (!angular.valid[segmentIndex]) return Number.NaN;
  const result = searchAngularGraph(angular, segmentIndex, radius);
  const totalDepth = totalAngularDepth(result);
  return result.reachedSegments.length > 1
    ? Math.pow(result.reachedSegments.length, 1.2) / (totalDepth + 2)
    : Number.NaN;
}

function buildAngularGraph(graph: CanonicalGraph): AngularGraph {
  validateCanonicalGraph(graph);
  const nSegments = graph.segments.length;
  const nStates = nSegments * 2;
  const edges = Array.from({ length: nStates }, () => [] as AngularEdge[]);
  const half = new Float64Array(nSegments);
  const valid = new Uint8Array(nSegments);
  const incident = new Map<number, { segment: number; atState: number; nextState: number; inBearing: number; outBearing: number }[]>();

  graph.segments.forEach((segment, segmentIndex) => {
    const start = endpoint(segmentIndex, graph, true);
    const end = endpoint(segmentIndex, graph, false);
    if (!start || !end || segment.source === segment.target || !(segment.length_m > 0)) return;
    valid[segmentIndex] = 1;
    half[segmentIndex] = segment.length_m / 2;
    const forward = bearingDeg(start[0], start[1], end[0], end[1]);
    const backward = bearingDeg(end[0], end[1], start[0], start[1]);
    appendIncident(incident, segment.source, {
      segment: segmentIndex,
      atState: segmentIndex * 2 + 1,
      nextState: segmentIndex * 2,
      inBearing: backward,
      outBearing: forward
    });
    appendIncident(incident, segment.target, {
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
          stepLength: half[from.segment] + half[to.segment]
        });
      }
    }
  }

  return { nSegments, nStates, edges, valid, half };
}

function searchAngularGraph(graph: AngularGraph, root: number, radius: number): AngularSearchResult {
  const stateMetric = new Float64Array(graph.nStates);
  const stateKey = new Int32Array(graph.nStates);
  const previousState = new Int32Array(graph.nStates);
  const segmentKey = new Int32Array(graph.nSegments);
  const settled = new Uint8Array(graph.nStates);
  const seen = new Uint8Array(graph.nStates);
  const reached = new Uint8Array(graph.nSegments);
  const reachedSegments: number[] = [];
  stateMetric.fill(Number.POSITIVE_INFINITY);
  stateKey.fill(2147483647);
  previousState.fill(-1);
  segmentKey.fill(2147483647);

  const queue = new MinPriorityQueue();
  for (const state of [root * 2, root * 2 + 1]) {
    stateMetric[state] = 0;
    stateKey[state] = 0;
    seen[state] = 1;
    queue.push(state, 0);
  }

  while (queue.size > 0) {
    const item = queue.pop();
    if (!item) break;
    const state = item.id;
    if (settled[state]) continue;
    settled[state] = 1;
    const segment = state >> 1;
    if (!reached[segment]) {
      reached[segment] = 1;
      reachedSegments.push(segment);
      segmentKey[segment] = stateKey[state];
    }
    for (const edge of graph.edges[state]) {
      if (settled[edge.toState]) continue;
      const metric = stateMetric[state] + edge.stepLength;
      if (radius > 0 && metric > radius) continue;
      const key = stateKey[state] + angularDepthKeyFromDegrees(edge.turnDegrees);
      if (!seen[edge.toState] || key < stateKey[edge.toState] || (key === stateKey[edge.toState] && metric < stateMetric[edge.toState])) {
        seen[edge.toState] = 1;
        stateKey[edge.toState] = key;
        stateMetric[edge.toState] = metric;
        previousState[edge.toState] = state;
        queue.push(edge.toState, key + metric / 1e9);
      }
    }
  }

  return { stateMetric, stateKey, segmentKey, previousState, reachedSegments };
}

function angularChoiceValues(graph: AngularGraph, radius: number, onProgress?: AnalysisProgressCallback): Float64Array {
  const values = new Float64Array(graph.nSegments);
  const tick = makeProgressTicker(graph.nSegments, onProgress);
  for (let root = 0; root < graph.nSegments; root += 1) {
    tick(root);
    if (!graph.valid[root]) continue;
    const result = searchAngularGraph(graph, root, radius);
    for (const target of result.reachedSegments) {
      if (target <= root) continue;
      const path = reconstructSegmentPath(result, root, target);
      // Standard betweenness: credit only intermediate segments, not the origin/target
      // endpoint segments (path[0] is root, path[last] is target).
      for (let k = 1; k < path.length - 1; k += 1) values[path[k]] += 1;
    }
  }
  for (let i = 0; i < graph.nSegments; i += 1) {
    if (!graph.valid[i]) values[i] = Number.NaN;
  }
  return values;
}

function angularAuditTrailChoiceValues(graph: AngularGraph, radius: number, onProgress?: AnalysisProgressCallback): Float64Array {
  const stateChoice = new Float64Array(graph.nStates);
  const tick = makeProgressTicker(graph.nSegments, onProgress);

  for (let root = 0; root < graph.nSegments; root += 1) {
    tick(root);
    if (!graph.valid[root]) continue;
    const result = searchAngularGraph(graph, root, radius);
    const chosenStateBySegment = new Int32Array(graph.nSegments);
    chosenStateBySegment.fill(-1);
    const hasChild = new Uint8Array(graph.nStates);
    const choiceCovered = new Uint8Array(graph.nStates);

    for (const segment of result.reachedSegments) {
      const chosen = chosenStateForSegment(result, segment);
      chosenStateBySegment[segment] = chosen;
    }
    for (let state = 0; state < result.previousState.length; state += 1) {
      const previous = result.previousState[state];
      if (previous >= 0) hasChild[previous] = 1;
    }

    for (const segment of result.reachedSegments) {
      if (segment === root) continue;
      let state = chosenStateBySegment[segment];
      if (state < 0 || hasChild[state]) continue;
      let choiceCount = 0;
      while (state >= 0 && (state >> 1) !== root) {
        stateChoice[state] += choiceCount;
        if (!choiceCovered[state]) {
          choiceCount += 1;
          choiceCovered[state] = 1;
        }
        state = result.previousState[state];
      }
    }
  }

  const values = new Float64Array(graph.nSegments);
  for (let segment = 0; segment < graph.nSegments; segment += 1) {
    values[segment] = graph.valid[segment]
      ? stateChoice[segment * 2] + stateChoice[segment * 2 + 1]
      : Number.NaN;
  }
  return values;
}

function reconstructSegmentPath(result: AngularSearchResult, root: number, target: number): number[] {
  let state = chosenStateForSegment(result, target);
  const reverse: number[] = [];
  while (state >= 0) {
    const segment = state >> 1;
    if (reverse[reverse.length - 1] !== segment) reverse.push(segment);
    if (segment === root) break;
    state = result.previousState[state];
  }
  return reverse.reverse();
}

function chosenStateForSegment(result: AngularSearchResult, segment: number): number {
  const a = segment * 2;
  const b = a + 1;
  return result.stateKey[a] < result.stateKey[b] || (result.stateKey[a] === result.stateKey[b] && result.stateMetric[a] < result.stateMetric[b])
    ? a
    : b;
}

function totalAngularDepth(result: AngularSearchResult): number {
  let totalKey = 0;
  for (const segment of result.reachedSegments) totalKey += result.segmentKey[segment];
  return syntaxAngleWeightFromKey(totalKey);
}

function endpoint(segmentIndex: number, graph: CanonicalGraph, first: boolean): [number, number] | null {
  const segment = graph.segments[segmentIndex];
  if (first && Number.isFinite(segment.x0) && Number.isFinite(segment.y0)) return [segment.x0!, segment.y0!];
  if (!first && Number.isFinite(segment.x1) && Number.isFinite(segment.y1)) return [segment.x1!, segment.y1!];
  const coordinates = segment.geometry.coordinates;
  const point = first ? coordinates[0] : coordinates[coordinates.length - 1];
  return Number.isFinite(point?.[0]) && Number.isFinite(point?.[1]) ? [point[0], point[1]] : null;
}

function appendIncident<T>(map: Map<number, T[]>, node: number, item: T): void {
  const list = map.get(node);
  if (list) list.push(item);
  else map.set(node, [item]);
}

function bearingDeg(x0: number, y0: number, x1: number, y1: number): number {
  let bearing = Math.atan2(y1 - y0, x1 - x0) * 180 / Math.PI;
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
