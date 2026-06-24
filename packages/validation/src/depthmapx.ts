import type { CanonicalGraph, CanonicalSegment } from "../../core/src/index.ts";
import { angularIntegration, depthmapXTulipAngularChoice } from "../../centrality/src/angular.ts";
import { depthmapXMetricChoice, depthmapXMetricIntegration } from "../../centrality/src/depthmapx.ts";

export interface DepthmapXValidationOptions {
  radius?: number;
  meanDepthColumn?: string;
  choiceColumn?: string;
  integrationColumn?: string;
}

export interface ColumnComparison {
  referenceColumn: string;
  engineColumn: string;
  count: number;
  pearson: number;
  spearman: number;
  meanAbsoluteDifference: number;
  medianAbsoluteDifference: number;
  maxAbsoluteDifference: number;
  exactMatches: number;
  topDecileOverlap: number;
}

export interface DepthmapXValidationReport {
  fixture: {
    featureCount: number;
    nodeCount: number;
    engineRadius: number | "n";
    referenceRadius: number | "n" | "unknown";
  };
  comparisons: {
    metricMeanDepth: ColumnComparison;
    metricChoice: ColumnComparison;
  };
  status: "pass" | "review";
  notes: string[];
}

export interface DepthmapXAngularValidationReport {
  fixture: {
    featureCount: number;
    nodeCount: number;
    engineRadius: number | "n";
    referenceRadius: number | "n" | "unknown";
  };
  comparisons: {
    angularMeanDepth?: ColumnComparison;
    tulipIntegration?: ColumnComparison;
    tulipChoice?: ColumnComparison;
  };
  status: "pass" | "review";
  notes: string[];
}

export function validateDepthmapXSegmentMetricCsv(
  csvText: string,
  options: DepthmapXValidationOptions = {}
): DepthmapXValidationReport {
  const rows = parseCsv(csvText);
  if (rows.length < 2) throw new Error("DepthmapX CSV must contain a header and at least one data row.");
  const header = rows[0].map((value) => value.trim());
  const dataRows = rows.slice(1).filter((row) => row.some((value) => value.trim() !== ""));
  const columnIndex = new Map(header.map((column, index) => [column, index]));
  const meanDepthColumn = options.meanDepthColumn ?? findColumn(header, /^Metric Mean Depth(?: |$)/);
  const choiceColumn = options.choiceColumn ?? findColumn(header, /^Metric Choice(?: |$)/);
  const referenceRadius = inferReferenceRadius(meanDepthColumn, choiceColumn);
  const graph = graphFromDepthmapXCsvRows(dataRows, columnIndex);
  const radius = options.radius ?? Number.POSITIVE_INFINITY;
  const integration = depthmapXMetricIntegration(graph, radius).values;
  const engineMeanDepth = [...integration].map((value) => value === 0 ? Number.POSITIVE_INFINITY : 1 / value);
  const engineChoice = [...depthmapXMetricChoice(graph, radius).values];
  const referenceMeanDepth = numericColumn(dataRows, columnIndex, meanDepthColumn);
  const referenceChoice = numericColumn(dataRows, columnIndex, choiceColumn);

  const metricMeanDepth = compareColumns(referenceMeanDepth, engineMeanDepth, meanDepthColumn, "1 / dmx_integration");
  const metricChoice = compareColumns(referenceChoice, engineChoice, choiceColumn, "dmx_choice");
  const notes: string[] = [];
  if (metricMeanDepth.pearson < 0.999 || metricChoice.pearson < 0.99) {
    notes.push("Correlation is below the provisional DepthmapX compatibility threshold; inspect row alignment and radius semantics.");
  }
  if (metricChoice.maxAbsoluteDifference > 0) {
    notes.push("Choice is not an exact row-by-row match; DepthmapX path-credit and tie handling should be reviewed before marking validated.");
  }
  if (!sameRadius(referenceRadius, radius)) {
    notes.push(`Reference columns imply radius ${formatRadius(referenceRadius)}, but the engine comparison used radius ${formatRadius(radius)}.`);
  }

  return {
    fixture: {
      featureCount: graph.segments.length,
      nodeCount: uniqueNodeCount(graph),
      engineRadius: Number.isFinite(radius) ? radius : "n",
      referenceRadius
    },
    comparisons: {
      metricMeanDepth,
      metricChoice
    },
    status: notes.length === 0 ? "pass" : "review",
    notes
  };
}

export function validateDepthmapXSegmentAngularCsv(
  csvText: string,
  options: DepthmapXValidationOptions = {}
): DepthmapXAngularValidationReport {
  const rows = parseCsv(csvText);
  if (rows.length < 2) throw new Error("DepthmapX CSV must contain a header and at least one data row.");
  const header = rows[0].map((value) => value.trim());
  const dataRows = rows.slice(1).filter((row) => row.some((value) => value.trim() !== ""));
  const columnIndex = new Map(header.map((column, index) => [column, index]));
  const graph = graphFromDepthmapXCsvRows(dataRows, columnIndex);
  const radius = options.radius ?? Number.POSITIVE_INFINITY;
  const notes: string[] = [];
  const comparisons: DepthmapXAngularValidationReport["comparisons"] = {};

  const fullMeanDepthColumn = options.meanDepthColumn ?? header.find((column) => /^Angular Mean Depth(?: |$)/.test(column));
  if (fullMeanDepthColumn) {
    const referenceMeanDepth = numericColumn(dataRows, columnIndex, fullMeanDepthColumn);
    const engineIntegration = [...angularIntegration(graph, radius).values];
    const engineMeanDepth = engineIntegration.map((value) => {
      if (!Number.isFinite(value) || value <= 0) return Number.NaN;
      const totalDepth = (graph.segments.length * graph.segments.length) / value;
      return totalDepth / Math.max(1, graph.segments.length - 1);
    });
    comparisons.angularMeanDepth = compareColumns(referenceMeanDepth, engineMeanDepth, fullMeanDepthColumn, "angular_mean_depth_from_integration");
  }

  const tulipIntegrationColumn = options.integrationColumn ?? header.find((column) => /^T\d+ Integration(?: |$)/.test(column));
  if (tulipIntegrationColumn) {
    const referenceIntegration = numericColumn(dataRows, columnIndex, tulipIntegrationColumn);
    const engineIntegration = [...angularIntegration(graph, radius).values];
    comparisons.tulipIntegration = compareColumns(referenceIntegration, engineIntegration, tulipIntegrationColumn, "angular_integration");
  }

  const tulipChoiceColumn = options.choiceColumn ?? header.find((column) => /^T\d+ Choice(?: |$)/.test(column));
  if (tulipChoiceColumn) {
    const referenceChoice = numericColumn(dataRows, columnIndex, tulipChoiceColumn);
    const engineChoice = [...depthmapXTulipAngularChoice(graph, radius).values];
    comparisons.tulipChoice = compareColumns(referenceChoice, engineChoice, tulipChoiceColumn, "depthmapx_tulip_angular_choice");
  }

  if (!comparisons.angularMeanDepth && !comparisons.tulipIntegration && !comparisons.tulipChoice) {
    throw new Error("DepthmapX angular CSV must include Angular Mean Depth or Tulip Integration/Choice columns.");
  }

  const referenceRadius = inferReferenceRadius(
    ...[fullMeanDepthColumn, tulipIntegrationColumn, tulipChoiceColumn].filter((column): column is string => column !== undefined)
  );
  if (!sameRadius(referenceRadius, radius)) {
    notes.push(`Reference columns imply radius ${formatRadius(referenceRadius)}, but the engine comparison used radius ${formatRadius(radius)}.`);
  }
  for (const [name, comparison] of Object.entries(comparisons)) {
    if (!comparison) continue;
    if (comparison.exactMatches === comparison.count) continue;
    if (!Number.isFinite(comparison.pearson) || comparison.pearson < 0.99 || comparison.spearman < 0.99) {
      notes.push(`${name} correlation is below the provisional DepthmapX angular compatibility threshold.`);
    }
  }
  if (comparisons.tulipChoice && comparisons.tulipChoice.exactMatches !== comparisons.tulipChoice.count) {
    notes.push("Tulip choice is not an exact row-by-row match; angular path-credit and tie handling need review before marking validated.");
  }

  return {
    fixture: {
      featureCount: graph.segments.length,
      nodeCount: uniqueNodeCount(graph),
      engineRadius: Number.isFinite(radius) ? radius : "n",
      referenceRadius
    },
    comparisons,
    status: notes.length === 0 ? "pass" : "review",
    notes
  };
}

function graphFromDepthmapXCsvRows(rows: readonly string[][], columnIndex: Map<string, number>): CanonicalGraph {
  const nodeIds = new Map<string, number>();
  const nodeId = (x: number, y: number): number => {
    const key = `${x},${y}`;
    const existing = nodeIds.get(key);
    if (existing !== undefined) return existing;
    const next = nodeIds.size;
    nodeIds.set(key, next);
    return next;
  };

  const segments: CanonicalSegment[] = rows.map((row, index) => {
    const x1 = numericCell(row, columnIndex, "x1");
    const y1 = numericCell(row, columnIndex, "y1");
    const x2 = numericCell(row, columnIndex, "x2");
    const y2 = numericCell(row, columnIndex, "y2");
    const lengthM = numericCell(row, columnIndex, "Segment Length");
    return {
      segment_id: index,
      source: nodeId(x1, y1),
      target: nodeId(x2, y2),
      length_m: lengthM,
      geometry: { type: "LineString", coordinates: [[x1, y1], [x2, y2]] },
      x0: x1,
      y0: y1,
      x1: x2,
      y1: y2
    };
  });
  return { segments };
}

function compareColumns(
  reference: readonly number[],
  engine: readonly number[],
  referenceColumn: string,
  engineColumn: string
): ColumnComparison {
  if (reference.length !== engine.length) {
    throw new Error(`Column length mismatch: ${reference.length} reference values, ${engine.length} engine values.`);
  }
  const pairs = reference.map((value, index) => ({ reference: value, engine: engine[index] }))
    .filter((pair) => Number.isFinite(pair.reference) && Number.isFinite(pair.engine));
  if (pairs.length === 0) throw new Error(`No comparable finite values for ${referenceColumn}.`);
  const comparableReference = pairs.map((pair) => pair.reference);
  const comparableEngine = pairs.map((pair) => pair.engine);
  const absDiffs = pairs.map((pair) => Math.abs(pair.reference - pair.engine));
  const sortedAbsDiffs = [...absDiffs].sort((a, b) => a - b);
  const exactMatches = absDiffs.filter((value) => value === 0).length;
  return {
    referenceColumn,
    engineColumn,
    count: pairs.length,
    pearson: pearson(comparableReference, comparableEngine),
    spearman: pearson(ranks(comparableReference), ranks(comparableEngine)),
    meanAbsoluteDifference: absDiffs.reduce((sum, value) => sum + value, 0) / absDiffs.length,
    medianAbsoluteDifference: median(sortedAbsDiffs),
    maxAbsoluteDifference: sortedAbsDiffs[sortedAbsDiffs.length - 1] ?? 0,
    exactMatches,
    topDecileOverlap: topDecileOverlap(comparableReference, comparableEngine)
  };
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === "\"") {
      if (quoted && text[i + 1] === "\"") {
        cell += "\"";
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function numericColumn(rows: readonly string[][], columnIndex: Map<string, number>, column: string): number[] {
  return rows.map((row) => numericCell(row, columnIndex, column));
}

function numericCell(row: readonly string[], columnIndex: Map<string, number>, column: string): number {
  const index = columnIndex.get(column);
  if (index === undefined) throw new Error(`Missing required DepthmapX CSV column: ${column}`);
  const value = Number(row[index]);
  if (!Number.isFinite(value)) throw new Error(`Invalid numeric value in column ${column}: ${row[index]}`);
  return value;
}

function findColumn(header: readonly string[], pattern: RegExp): string {
  const column = header.find((value) => pattern.test(value));
  if (!column) throw new Error(`Missing DepthmapX CSV column matching ${pattern}.`);
  return column;
}

function inferReferenceRadius(...columns: readonly string[]): number | "n" | "unknown" {
  let inferred: number | "n" | "unknown" = "unknown";
  for (const column of columns) {
    const match = / R(\d+(?:\.\d+)?) metric(?:$| )/.exec(column);
    const radius = match ? Number(match[1]) : "n";
    if (inferred === "unknown") {
      inferred = radius;
    } else if (inferred !== radius) {
      return "unknown";
    }
  }
  return inferred;
}

function sameRadius(referenceRadius: number | "n" | "unknown", engineRadius: number): boolean {
  if (referenceRadius === "unknown") return true;
  if (referenceRadius === "n") return !Number.isFinite(engineRadius);
  return Number.isFinite(engineRadius) && Math.abs(referenceRadius - engineRadius) < 1e-9;
}

function formatRadius(radius: number | "n" | "unknown"): string {
  if (radius === "unknown" || radius === "n") return radius;
  return String(radius);
}

function pearson(a: readonly number[], b: readonly number[]): number {
  const n = a.length;
  const meanA = a.reduce((sum, value) => sum + value, 0) / n;
  const meanB = b.reduce((sum, value) => sum + value, 0) / n;
  let numerator = 0;
  let denomA = 0;
  let denomB = 0;
  for (let i = 0; i < n; i += 1) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    numerator += da * db;
    denomA += da * da;
    denomB += db * db;
  }
  return numerator / Math.sqrt(denomA * denomB);
}

function ranks(values: readonly number[]): number[] {
  const indexed = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const out = new Array<number>(values.length);
  for (let i = 0; i < indexed.length;) {
    let j = i + 1;
    while (j < indexed.length && indexed[j].value === indexed[i].value) j += 1;
    const rank = (i + 1 + j) / 2;
    for (let k = i; k < j; k += 1) out[indexed[k].index] = rank;
    i = j;
  }
  return out;
}

function topDecileOverlap(reference: readonly number[], engine: readonly number[]): number {
  const n = reference.length;
  const topCount = Math.max(1, Math.ceil(n * 0.1));
  const referenceTop = topIndexes(reference, topCount);
  const engineTop = topIndexes(engine, topCount);
  let overlap = 0;
  for (const index of referenceTop) {
    if (engineTop.has(index)) overlap += 1;
  }
  return overlap / topCount;
}

function topIndexes(values: readonly number[], count: number): Set<number> {
  return new Set(values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => b.value - a.value || a.index - b.index)
    .slice(0, count)
    .map((item) => item.index));
}

function median(sortedValues: readonly number[]): number {
  if (sortedValues.length === 0) return Number.NaN;
  const mid = Math.floor(sortedValues.length / 2);
  return sortedValues.length % 2 === 0 ? (sortedValues[mid - 1] + sortedValues[mid]) / 2 : sortedValues[mid];
}

function uniqueNodeCount(graph: CanonicalGraph): number {
  const nodes = new Set<number>();
  for (const segment of graph.segments) {
    nodes.add(segment.source);
    nodes.add(segment.target);
  }
  return nodes.size;
}
