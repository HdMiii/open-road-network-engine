import type { CanonicalGraph, CentralityResult } from "../../core/src/types.ts";
import { validateCanonicalGraph } from "../../core/src/validation.ts";
import { makeProgressTicker, type AnalysisProgressCallback } from "../../core/src/progress.ts";

interface DepthmapXDual {
  back: number[][];
  forward: number[][];
  half: Float64Array;
  length: Float64Array;
  maxLength: number;
  valid: Uint8Array;
}

interface DualSearchResult {
  depths: Float64Array;
  previous: Int32Array;
  order: number[];
}

export function depthmapXMetricIntegration(graph: CanonicalGraph, radius: number, onProgress?: AnalysisProgressCallback): CentralityResult {
  const dual = buildDepthmapXDual(graph);
  const values = new Float64Array(graph.segments.length);
  const tick = makeProgressTicker(graph.segments.length, onProgress);

  for (let root = 0; root < graph.segments.length; root += 1) {
    tick(root);
    if (!dual.valid[root]) {
      values[root] = Number.NaN;
      continue;
    }
    const result = searchDepthmapXMetricBuckets(dual, root, radius);
    let totalDepth = 0;
    for (const segmentIndex of result.order) totalDepth += result.depths[segmentIndex];
    values[root] = result.order.length > 1 && totalDepth > 0
      ? (result.order.length - 1) / totalDepth
      : Number.NaN;
  }

  return {
    values,
    status: "compatible",
    method: `dmx_integration_r${radius}`,
    notes: "DepthmapX-style metric segment integration: reciprocal mean midpoint depth on the dual segment graph."
  };
}

export function onDemandDepthmapXMetricIntegration(graph: CanonicalGraph, segmentIndex: number, radius: number): number {
  const dual = buildDepthmapXDual(graph);
  if (!dual.valid[segmentIndex]) return Number.NaN;
  const result = searchDepthmapXMetricBuckets(dual, segmentIndex, radius);
  let totalDepth = 0;
  for (const reachedSegment of result.order) totalDepth += result.depths[reachedSegment];
  return result.order.length > 1 && totalDepth > 0
    ? (result.order.length - 1) / totalDepth
    : Number.NaN;
}

export function depthmapXMetricChoice(graph: CanonicalGraph, radius: number, onProgress?: AnalysisProgressCallback): CentralityResult {
  const dual = buildDepthmapXDual(graph);
  const values = new Float64Array(graph.segments.length);
  const tick = makeProgressTicker(graph.segments.length, onProgress);

  for (let root = 0; root < graph.segments.length; root += 1) {
    tick(root);
    if (!dual.valid[root]) continue;
    searchDepthmapXMetricBuckets(dual, root, radius, values);
  }

  for (let i = 0; i < dual.valid.length; i += 1) {
    if (!dual.valid[i]) values[i] = Number.NaN;
  }

  return {
    values,
    status: "compatible",
    method: `dmx_choice_r${radius}`,
    notes: "DepthmapX-style metric choice: cyclic bucket traversal, unordered pairs once, path endpoints included."
  };
}

export function buildDepthmapXDual(graph: CanonicalGraph): DepthmapXDual {
  validateCanonicalGraph(graph);
  const back = Array.from({ length: graph.segments.length }, () => [] as number[]);
  const forward = Array.from({ length: graph.segments.length }, () => [] as number[]);
  const half = new Float64Array(graph.segments.length);
  const length = new Float64Array(graph.segments.length);
  const valid = new Uint8Array(graph.segments.length);
  const incident = new Map<number, number[]>();
  let maxLength = 0;

  graph.segments.forEach((segment, segmentIndex) => {
    valid[segmentIndex] = 1;
    length[segmentIndex] = segment.length_m;
    half[segmentIndex] = length[segmentIndex] / 2;
    maxLength = Math.max(maxLength, length[segmentIndex]);
    appendIncident(incident, segment.source, segmentIndex);
    if (segment.target !== segment.source) appendIncident(incident, segment.target, segmentIndex);
  });

  for (let segmentIndex = 0; segmentIndex < graph.segments.length; segmentIndex += 1) {
    const segment = graph.segments[segmentIndex];
    back[segmentIndex] = sortedIncidentNeighbors(incident, segment.source, segmentIndex);
    forward[segmentIndex] = sortedIncidentNeighbors(incident, segment.target, segmentIndex);
  }

  return { back, forward, half, length, maxLength, valid };
}

function searchDepthmapXMetricBuckets(
  dual: DepthmapXDual,
  root: number,
  radius: number,
  choiceValues?: Float64Array
): DualSearchResult {
  const depths = new Float64Array(dual.length.length);
  const previous = new Int32Array(dual.length.length);
  const done = new Uint8Array(dual.length.length);
  const seen = new Uint32Array(dual.length.length);
  const order: number[] = [];
  const lists = Array.from({ length: 512 }, () => [] as number[]);
  const boundedRadius = Number.isFinite(radius) && radius > 0;
  let bin = 0;
  let open = 1;
  let segmentDepth = 0;

  previous.fill(-1);
  seen.fill(0xffffffff);
  depths[root] = dual.half[root];
  lists[0].push(root);

  while (open !== 0) {
    while (lists[bin].length === 0) {
      bin += 1;
      segmentDepth += 1;
      if (bin === lists.length) bin = 0;
    }
    const current = lists[bin].pop()!;
    open -= 1;
    if (done[current]) continue;
    done[current] = 1;
    order.push(current);

    for (const next of depthmapXNeighborOrder(dual, current)) {
      if (next === root || seen[next] <= segmentDepth) continue;
      const seenAlready = seen[next] !== 0xffffffff;
      depths[next] = depths[current] + dual.length[next];
      previous[next] = current;
      seen[next] = segmentDepth;
      if (!boundedRadius || depths[current] + dual.length[next] < radius) {
        open += 1;
        lists[(bin + bucketOffset(dual, next)) % lists.length].push(next);
      }
      if (choiceValues && next > root && !seenAlready) {
        for (let cursor = next; cursor !== -1; cursor = previous[cursor]) {
          choiceValues[cursor] += 1;
        }
      }
    }
  }

  for (let i = 0; i < depths.length; i += 1) {
    if (!done[i]) depths[i] = Number.POSITIVE_INFINITY;
    else depths[i] -= dual.half[i];
  }

  return { depths, previous, order };
}

function depthmapXNeighborOrder(dual: DepthmapXDual, segmentIndex: number): number[] {
  return [...dual.back[segmentIndex], ...dual.forward[segmentIndex]];
}

function sortedIncidentNeighbors(incident: Map<number, number[]>, node: number, segmentIndex: number): number[] {
  return (incident.get(node) ?? []).filter((candidate) => candidate !== segmentIndex).sort((a, b) => a - b);
}

function bucketOffset(dual: DepthmapXDual, segmentIndex: number): number {
  return dual.maxLength > 0 ? Math.floor(0.5 + 511 * dual.length[segmentIndex] / dual.maxLength) : 0;
}

function appendIncident(incident: Map<number, number[]>, node: number, segmentIndex: number): void {
  const list = incident.get(node);
  if (list) {
    list.push(segmentIndex);
  } else {
    incident.set(node, [segmentIndex]);
  }
}
