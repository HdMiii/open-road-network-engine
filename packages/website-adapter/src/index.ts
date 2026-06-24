import type { CanonicalGraph, CanonicalSegment, CentralityResult } from "../../core/src/index.ts";
import {
  depthmapXMetricChoice,
  depthmapXMetricIntegration,
  onDemandDepthmapXMetricIntegration
} from "../../centrality/src/depthmapx.ts";
import {
  angularChoice,
  angularIntegration,
  angularNach,
  angularNain,
  depthmapXTulipAngularChoice,
  onDemandAngularIntegration,
  onDemandAngularNain
} from "../../centrality/src/angular.ts";
import { pstAngularChoice, pstAngularIntegration } from "../../centrality/src/pst.ts";
import { ROUTE_MODES, shortestRoute, type RouteMode } from "../../shortest-path/src/route.ts";

export type WebsiteMethod = "dmx" | "dmx_angular" | "pst_angular" | "angular";

export type WebsiteMeasure =
  | "integration"
  | "nain"
  | "choice"
  | "nach";

export const WEBSITE_RADII = [400, 600, 800, 1000, 1200, 1400, 1600, 1800, 2000] as const;

export type WebsiteRadius = (typeof WEBSITE_RADII)[number];

export interface ParsedAnalysisColumn {
  method: WebsiteMethod;
  measure: WebsiteMeasure;
  radius?: number;
}

export interface AnalysisMethodCatalogEntry extends ParsedAnalysisColumn {
  column: string;
  familyLabel: string;
  measureLabel: string;
  displayName: string;
  status: CentralityResult["status"];
  scope: "segment" | "route";
  onDemand: boolean;
  notes: string;
}

export interface AnalysisColumnResult {
  column: string;
  values: Float32Array;
  rowHash: string;
  featureCount: number;
  methodMetadata: {
    method: string;
    status: CentralityResult["status"];
    notes?: string;
  };
}

export type EngineWorkerProgressPhase = "started" | "completed";

export interface EngineWorkerProgressMessage {
  type: "progress";
  reqId: number;
  phase: EngineWorkerProgressPhase;
  operation: "fullmap" | "ondemand" | "route";
  completed: number;
  total: number;
  column?: string;
  mode?: RouteMode;
}

export type EngineWorkerInMessage =
  | {
      type: "init";
      source: Float64Array;
      target: Float64Array;
      length: Float64Array;
      x0?: Float64Array;
      y0?: Float64Array;
      x1?: Float64Array;
      y1?: Float64Array;
    }
  | {
      type: "fullmap";
      method: WebsiteMethod;
      measure: WebsiteMeasure;
      radius: number;
      reqId: number;
    }
  | {
      type: "ondemand";
      method: WebsiteMethod;
      measure: WebsiteMeasure;
      segIndex: number;
      radius: number;
      reqId: number;
    }
  | {
      type: "route";
      mode: RouteMode;
      fromSeg: number;
      toSeg: number;
      reqId: number;
    };

export type EngineWorkerOutMessage =
  | { type: "ready"; nSegments: number; rowHash: string }
  | EngineWorkerProgressMessage
  | { type: "fullmap"; reqId: number; values: Float32Array; column: string; rowHash: string }
  | { type: "ondemand"; reqId: number; value: number; column: string }
  | {
      type: "route";
      reqId: number;
      mode: RouteMode;
      // Feature-order (0-based) indexes into the segment array, NOT canonical segment_id values.
      segmentIndexes: Int32Array;
      distanceM: number;
      angularCost: number;
      vectorCost: number;
    }
  | { type: "error"; reqId?: number; message: string };

export function analysisColumn(method: WebsiteMethod, measure: WebsiteMeasure, radius?: number): string {
  return radius === undefined ? `${method}_${measure}` : `${method}_${measure}_r${radius}`;
}

export function parseAnalysisColumn(column: string): ParsedAnalysisColumn | null {
  const radiusMatch = /^(dmx_angular|pst_angular|dmx|angular)_([a-z_]+)_r(\d+)$/.exec(column);
  if (radiusMatch) {
    const method = radiusMatch[1] as WebsiteMethod;
    const measure = radiusMatch[2] as WebsiteMeasure;
    const radius = Number(radiusMatch[3]);
    return supportsAnalysis(method, measure, radius) ? { method, measure, radius } : null;
  }
  return null;
}

export function supportsAnalysis(method: WebsiteMethod, measure: WebsiteMeasure, radius?: number): boolean {
  if (radius !== undefined && !(WEBSITE_RADII as readonly number[]).includes(radius)) return false;
  if (method === "dmx") return measure === "integration" || measure === "choice";
  if (method === "dmx_angular") return measure === "integration" || measure === "choice";
  if (method === "pst_angular") return measure === "integration" || measure === "choice";
  if (method === "angular") return measure === "integration" || measure === "nain" || measure === "choice" || measure === "nach";
  return false;
}

export function supportsOnDemand(method: WebsiteMethod, measure: WebsiteMeasure): boolean {
  return (method === "dmx" && measure === "integration") ||
    (method === "dmx_angular" && measure === "integration") ||
    (method === "angular" && (measure === "integration" || measure === "nain"));
}

export function allowedAnalysisColumns(): Set<string> {
  const columns = new Set<string>();
  for (const radius of WEBSITE_RADII) {
    columns.add(analysisColumn("dmx", "integration", radius));
    columns.add(analysisColumn("dmx", "choice", radius));
    columns.add(analysisColumn("dmx_angular", "integration", radius));
    columns.add(analysisColumn("dmx_angular", "choice", radius));
    columns.add(analysisColumn("pst_angular", "integration", radius));
    columns.add(analysisColumn("pst_angular", "choice", radius));
    columns.add(analysisColumn("angular", "integration", radius));
    columns.add(analysisColumn("angular", "nain", radius));
    columns.add(analysisColumn("angular", "choice", radius));
    columns.add(analysisColumn("angular", "nach", radius));
  }
  return columns;
}

export function analysisMethodCatalog(radii: readonly number[] = WEBSITE_RADII): AnalysisMethodCatalogEntry[] {
  const entries: AnalysisMethodCatalogEntry[] = [];

  for (const radius of radii) {
    entries.push(
      {
        method: "dmx",
        measure: "integration",
        radius,
        column: analysisColumn("dmx", "integration", radius),
        familyLabel: familyLabel("dmx"),
        measureLabel: measureLabel("dmx", "integration"),
        displayName: displayName("dmx", "integration", radius),
        status: "compatible",
        scope: "segment",
        onDemand: true,
        notes: "DepthmapX-style metric segment integration (reciprocal mean midpoint depth). Validated against global DepthmapX Metric Mean Depth on the 178-segment Barnsbury reference: Pearson and Spearman 1.0, agreement to file precision (<=3.5e-5). Finite website radii use the same engine and remain compatible pending finite-radius DepthmapX exports."
      },
      {
        method: "dmx",
        measure: "choice",
        radius,
        column: analysisColumn("dmx", "choice", radius),
        familyLabel: familyLabel("dmx"),
        measureLabel: measureLabel("dmx", "choice"),
        displayName: displayName("dmx", "choice", radius),
        status: "compatible",
        scope: "segment",
        onDemand: false,
        notes: "DepthmapX-style metric segment choice (cyclic bucket traversal). Validated against global DepthmapX Metric Choice on the 178-segment Barnsbury reference: Pearson and Spearman 1.0, 178/178 row-exact, max absolute difference 0. Finite website radii use the same engine and remain compatible pending finite-radius DepthmapX exports."
      },
      {
        method: "dmx_angular",
        measure: "integration",
        radius,
        column: analysisColumn("dmx_angular", "integration", radius),
        familyLabel: familyLabel("dmx_angular"),
        measureLabel: measureLabel("dmx_angular", "integration"),
        displayName: displayName("dmx_angular", "integration", radius),
        status: "compatible",
        scope: "segment",
        onDemand: true,
        notes: "DepthmapX-style angular integration (Tulip 1024, N^2 / TD). Validated against the global DepthmapX Tulip integration on the 178-segment Barnsbury reference: Pearson and Spearman 1.0, slope 1.0, agreement to file precision (<=1e-5). Finite website radii use the same engine and remain compatible pending finite-radius DepthmapX exports."
      },
      {
        method: "dmx_angular",
        measure: "choice",
        radius,
        column: analysisColumn("dmx_angular", "choice", radius),
        familyLabel: familyLabel("dmx_angular"),
        measureLabel: measureLabel("dmx_angular", "choice"),
        displayName: displayName("dmx_angular", "choice", radius),
        status: "compatible",
        scope: "segment",
        onDemand: false,
        notes: "DepthmapX Tulip-style angular choice (leaf back-path audit-trail). Vs global DepthmapX Tulip choice on the 178-segment Barnsbury reference: Pearson 0.99994, Spearman 0.99983, 151/178 row-exact, total absolute difference 0.35% of choice mass, rank order preserved. The 27 non-exact rows are at multi-way junctions and the engine over-counts by ~0.35%; standard equal-path splitting was tested and regresses parity, so DepthmapX's single-geodesic audit-trail is intentionally retained. Exact tie-order parity remains open."
      },
      {
        method: "pst_angular",
        measure: "integration",
        radius,
        column: analysisColumn("pst_angular", "integration", radius),
        familyLabel: familyLabel("pst_angular"),
        measureLabel: measureLabel("pst_angular", "integration"),
        displayName: displayName("pst_angular", "integration", radius),
        status: "compatible",
        scope: "segment",
        onDemand: false,
        notes: "PST/Pstalgo-compatible AngularIntegration normal normalization: (N - 1) / (TD + 1), fixture-matched to PST expectations."
      },
      {
        method: "pst_angular",
        measure: "choice",
        radius,
        column: analysisColumn("pst_angular", "choice", radius),
        familyLabel: familyLabel("pst_angular"),
        measureLabel: measureLabel("pst_angular", "choice"),
        displayName: displayName("pst_angular", "choice", radius),
        status: "compatible",
        scope: "segment",
        onDemand: false,
        notes: "PST/Pstalgo-compatible AngularChoice over directed segment states with equal shortest-path splitting, fixture-matched to PST expectations."
      },
      {
        method: "angular",
        measure: "integration",
        radius,
        column: analysisColumn("angular", "integration", radius),
        familyLabel: familyLabel("angular"),
        measureLabel: measureLabel("angular", "integration"),
        displayName: displayName("angular", "integration", radius),
        status: "compatible",
        scope: "segment",
        onDemand: true,
        notes: "Angular segment integration over directed endpoint states. Reference-output validation is still pending."
      },
      {
        method: "angular",
        measure: "nain",
        radius,
        column: analysisColumn("angular", "nain", radius),
        familyLabel: familyLabel("angular"),
        measureLabel: measureLabel("angular", "nain"),
        displayName: displayName("angular", "nain", radius),
        status: "compatible",
        scope: "segment",
        onDemand: true,
        notes: "Angular NAIN-style normalization over directed endpoint states. Reference-output validation is still pending."
      },
      {
        method: "angular",
        measure: "choice",
        radius,
        column: analysisColumn("angular", "choice", radius),
        familyLabel: familyLabel("angular"),
        measureLabel: measureLabel("angular", "choice"),
        displayName: displayName("angular", "choice", radius),
        status: "compatible",
        scope: "segment",
        onDemand: false,
        notes: "Angular choice over directed endpoint states. Reference-output validation is still pending."
      },
      {
        method: "angular",
        measure: "nach",
        radius,
        column: analysisColumn("angular", "nach", radius),
        familyLabel: familyLabel("angular"),
        measureLabel: measureLabel("angular", "nach"),
        displayName: displayName("angular", "nach", radius),
        status: "compatible",
        scope: "segment",
        onDemand: false,
        notes: "Angular NACH-style normalization over directed endpoint states. Reference-output validation is still pending."
      }
    );
  }

  return entries;
}

export function familyLabel(method: WebsiteMethod): string {
  if (method === "dmx") return "DepthmapX-style metric";
  if (method === "dmx_angular") return "DepthmapX-style angular";
  if (method === "pst_angular") return "PST-style angular";
  if (method === "angular") return "Canonical engine angular";
  return method;
}

export function measureLabel(method: WebsiteMethod, measure: WebsiteMeasure): string {
  if (method === "dmx" && measure === "integration") return "Metric integration";
  if (method === "dmx" && measure === "choice") return "Metric choice";
  if (method === "dmx_angular" && measure === "integration") return "Angular integration";
  if (method === "dmx_angular" && measure === "choice") return "Angular choice";
  if (method === "pst_angular" && measure === "integration") return "AngularIntegration";
  if (method === "pst_angular" && measure === "choice") return "AngularChoice";
  if (method === "angular" && measure === "integration") return "Angular integration";
  if (method === "angular" && measure === "nain") return "NAIN";
  if (method === "angular" && measure === "choice") return "Canonical angular choice";
  if (method === "angular" && measure === "nach") return "NACH";
  return measure.replaceAll("_", " ");
}

export function displayName(method: WebsiteMethod, measure: WebsiteMeasure, radius?: number): string {
  const label = `${familyLabel(method)} - ${measureLabel(method, measure)}`;
  return radius === undefined ? label : `${label} R${radius}`;
}

export function computeAnalysisColumn(
  graph: CanonicalGraph,
  method: WebsiteMethod,
  measure: WebsiteMeasure,
  radius?: number
): AnalysisColumnResult {
  if (!supportsAnalysis(method, measure, radius)) {
    throw new Error(`Unsupported analysis column: ${analysisColumn(method, measure, radius)}`);
  }

  let result: CentralityResult;
  if (method === "dmx") {
    if (radius === undefined) throw new Error("DepthmapX-style analysis requires a radius.");
    result = measure === "choice"
      ? depthmapXMetricChoice(graph, radius)
      : depthmapXMetricIntegration(graph, radius);
  } else if (method === "dmx_angular") {
    if (radius === undefined) throw new Error("DepthmapX-style angular analysis requires a radius.");
    result = measure === "choice"
      ? depthmapXTulipAngularChoice(graph, radius)
      : angularIntegration(graph, radius);
  } else if (method === "pst_angular") {
    if (radius === undefined) throw new Error("PST-style angular analysis requires a radius.");
    // The website radius is a metric (network-distance) radius in metres. PST applies this as the
    // "walking" radius; its "angular" radius is a separate cumulative-turn threshold in degrees and
    // must stay unbounded here, otherwise the selected radius would never bind metrically.
    const options = { radii: { walking: radius } };
    result = measure === "choice"
      ? pstAngularChoice(graph, options)
      : pstAngularIntegration(graph, options);
  } else if (method === "angular") {
    if (radius === undefined) throw new Error("Angular analysis requires a radius.");
    if (measure === "integration") result = angularIntegration(graph, radius, 1);
    else if (measure === "nain") result = angularNain(graph, radius);
    else if (measure === "choice") result = angularChoice(graph, radius);
    else if (measure === "nach") result = angularNach(graph, radius);
    else throw new Error(`Unsupported angular measure: ${measure}`);
  } else {
    throw new Error(`${method} analysis has not been extracted into the engine adapter yet.`);
  }

  const values = float32From(result.values);
  assertFloat32Alignment(values, graph.segments.length);
  return {
    column: analysisColumn(method, measure, radius),
    values,
    rowHash: canonicalRowHash(graph.segments),
    featureCount: graph.segments.length,
    methodMetadata: {
      method: result.method,
      status: result.status,
      notes: result.notes
    }
  };
}

export function computeAnalysisColumnByName(graph: CanonicalGraph, column: string): AnalysisColumnResult {
  const parsed = parseAnalysisColumn(column);
  if (!parsed) throw new Error(`Unsupported analysis column: ${column}`);
  return computeAnalysisColumn(graph, parsed.method, parsed.measure, parsed.radius);
}

export function computeOnDemandValue(
  graph: CanonicalGraph,
  method: WebsiteMethod,
  measure: WebsiteMeasure,
  segmentIndex: number,
  radius?: number
): number {
  if (!supportsOnDemand(method, measure)) {
    throw new Error(`Unsupported on-demand analysis: ${analysisColumn(method, measure, radius)}`);
  }
  if (radius === undefined) throw new Error("On-demand analysis requires a radius.");
  if (method === "dmx" && measure === "integration") {
    return onDemandDepthmapXMetricIntegration(graph, segmentIndex, radius);
  }
  if (method === "dmx_angular" && measure === "integration") {
    return onDemandAngularIntegration(graph, segmentIndex, radius);
  }
  if (method === "angular" && measure === "integration") {
    return onDemandAngularIntegration(graph, segmentIndex, radius, 1);
  }
  if (method === "angular" && measure === "nain") {
    return onDemandAngularNain(graph, segmentIndex, radius);
  }
  throw new Error(`Unsupported on-demand analysis: ${analysisColumn(method, measure, radius)}`);
}

export function graphFromWorkerInitMessage(message: Extract<EngineWorkerInMessage, { type: "init" }>): CanonicalGraph {
  const n = message.source.length;
  if (message.target.length !== n || message.length.length !== n) {
    throw new Error("Worker init arrays must have the same length.");
  }
  const segments: CanonicalSegment[] = [];
  for (let i = 0; i < n; i += 1) {
    const x0 = message.x0?.[i];
    const y0 = message.y0?.[i];
    const x1 = message.x1?.[i];
    const y1 = message.y1?.[i];
    const hasCoordinates =
      Number.isFinite(x0) && Number.isFinite(y0) && Number.isFinite(x1) && Number.isFinite(y1);
    segments.push({
      segment_id: i,
      source: message.source[i],
      target: message.target[i],
      length_m: message.length[i],
      geometry: {
        type: "LineString",
        coordinates: hasCoordinates
          ? [[x0!, y0!], [x1!, y1!]]
          : [[0, i], [message.length[i], i]]
      },
      x0: hasCoordinates ? x0 : undefined,
      y0: hasCoordinates ? y0 : undefined,
      x1: hasCoordinates ? x1 : undefined,
      y1: hasCoordinates ? y1 : undefined
    });
  }
  return { segments };
}

export class EngineWorkerSession {
  #graph: CanonicalGraph | null = null;

  handle(message: EngineWorkerInMessage): EngineWorkerOutMessage {
    return this.handleWithProgress(message);
  }

  handleWithProgress(
    message: EngineWorkerInMessage,
    emitProgress: (message: EngineWorkerProgressMessage) => void = () => {}
  ): EngineWorkerOutMessage {
    try {
      if (message.type === "init") {
        this.#graph = graphFromWorkerInitMessage(message);
        return {
          type: "ready",
          nSegments: this.#graph.segments.length,
          rowHash: canonicalRowHash(this.#graph.segments)
        };
      }
      if (!this.#graph) throw new Error("Graph not initialised.");
      if (message.type === "fullmap") {
        const column = analysisColumn(message.method, message.measure, message.radius);
        emitProgress({
          type: "progress",
          reqId: message.reqId,
          phase: "started",
          operation: "fullmap",
          completed: 0,
          total: this.#graph.segments.length,
          column
        });
        const result = computeAnalysisColumn(this.#graph, message.method, message.measure, message.radius);
        emitProgress({
          type: "progress",
          reqId: message.reqId,
          phase: "completed",
          operation: "fullmap",
          completed: result.values.length,
          total: result.values.length,
          column: result.column
        });
        return {
          type: "fullmap",
          reqId: message.reqId,
          values: result.values,
          column: result.column,
          rowHash: result.rowHash
        };
      }
      if (message.type === "ondemand") {
        if (!supportsOnDemand(message.method, message.measure)) {
          throw new Error("On-demand measure is not available.");
        }
        const column = analysisColumn(message.method, message.measure, message.radius);
        emitProgress({
          type: "progress",
          reqId: message.reqId,
          phase: "started",
          operation: "ondemand",
          completed: 0,
          total: 1,
          column
        });
        const value = computeOnDemandValue(this.#graph, message.method, message.measure, message.segIndex, message.radius);
        emitProgress({
          type: "progress",
          reqId: message.reqId,
          phase: "completed",
          operation: "ondemand",
          completed: 1,
          total: 1,
          column
        });
        return {
          type: "ondemand",
          reqId: message.reqId,
          value,
          column
        };
      }
      if (message.type === "route") {
        if (!(ROUTE_MODES as readonly string[]).includes(message.mode)) {
          throw new Error(`Unknown route mode: ${message.mode}`);
        }
        emitProgress({
          type: "progress",
          reqId: message.reqId,
          phase: "started",
          operation: "route",
          completed: 0,
          total: 1,
          mode: message.mode
        });
        const route = shortestRoute(this.#graph, message.mode, message.fromSeg, message.toSeg);
        if (!route) throw new Error("No route found between selected segments.");
        emitProgress({
          type: "progress",
          reqId: message.reqId,
          phase: "completed",
          operation: "route",
          completed: 1,
          total: 1,
          mode: message.mode
        });
        return {
          type: "route",
          reqId: message.reqId,
          mode: message.mode,
          segmentIndexes: route.segmentIndexes,
          distanceM: route.distanceM,
          angularCost: route.angularCost,
          vectorCost: route.vectorCost
        };
      }
      return { type: "error", message: "Unknown worker message." };
    } catch (error) {
      return {
        type: "error",
        reqId: "reqId" in message ? message.reqId : undefined,
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }
}

export function assertFloat32Alignment(values: Float32Array, featureCount: number): void {
  if (values.length !== featureCount) {
    throw new Error(`Analysis column length ${values.length} does not match feature count ${featureCount}`);
  }
}

export interface RowHashSegment {
  segment_id: number;
  source: number;
  target: number;
  length_m: number;
}

export function canonicalRowHash(segments: readonly RowHashSegment[]): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (const segment of segments) {
    const line = `${segment.segment_id}|${segment.source}|${segment.target}|${roundLength(segment.length_m)}\n`;
    for (let i = 0; i < line.length; i += 1) {
      hash ^= BigInt(line.charCodeAt(i));
      hash = BigInt.asUintN(64, hash * prime);
    }
  }
  return hash.toString(16).padStart(16, "0");
}

function roundLength(lengthM: number): string {
  return Number.isFinite(lengthM) ? lengthM.toFixed(6) : "NaN";
}

function float32From(values: Float64Array): Float32Array {
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i += 1) out[i] = values[i];
  return out;
}
