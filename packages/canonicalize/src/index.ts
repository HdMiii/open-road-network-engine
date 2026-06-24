import type { CanonicalGraph, CanonicalGraphMetadata, Coordinate, LineStringGeometry } from "../../core/src/index.ts";
import { validateCanonicalGraph } from "../../core/src/index.ts";

const EPS = 1e-10;
const DEFAULT_LENGTH_KEYS = ["length_m", "Line_Length", "Segment_Length", "line_length", "length", "Length", "LENGTH", "len", "LEN"];

export interface InputLineFeature {
  id?: string | number;
  geometry: LineStringGeometry | { type: "MultiLineString"; coordinates: readonly Coordinate[][] };
  properties?: Record<string, unknown>;
}

export interface UnlinkMask {
  center: Coordinate;
  radius: number;
}

export interface CanonicalizationOptions {
  splitIntersections?: boolean;
  preserveSourceIds?: boolean;
  cleaningProfile?: string;
  sourceDataset?: string;
  inputCrs?: string;
  outputCrs?: string;
  lengthKeys?: readonly string[];
  nodeTolerance?: number;
  endStubMinRatio?: number;
  unlinkMasks?: readonly UnlinkMask[];
}

export interface CanonicalizationMetadata extends CanonicalGraphMetadata {
  inputFeatureCount: number;
  sourceLineCount: number;
  outputSegmentCount: number;
  nodeCount: number;
  intersectionsSplit: number;
  intersectionsSkippedByUnlink: number;
  discardedEndStubs: number;
  zeroLengthDiscarded: number;
  cleaningProfile?: string;
  source_dataset?: string;
  notes: string[];
}

interface PreparedLine {
  id: number;
  originalFeatureId?: string | number;
  coords: readonly Coordinate[];
  cum: readonly number[];
  geometryLength: number;
  reportedLength: number;
  splits: number[];
  splitTolerance: number;
}

interface PreparedLineSegment {
  id: number;
  lineIndex: number;
  coordIndex: number;
  a: Coordinate;
  b: Coordinate;
  baseDistance: number;
  length: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface CanonicalizationResult {
  graph: CanonicalGraph;
  metadata: CanonicalizationMetadata;
}

export function canonicalizeLineNetwork(features: readonly InputLineFeature[], options: CanonicalizationOptions = {}): CanonicalizationResult {
  const lines = prepareLines(features, options);
  if (lines.length === 0) {
    throw new Error("No valid line features found.");
  }

  const metadata: CanonicalizationMetadata = {
    inputFeatureCount: features.length,
    sourceLineCount: lines.length,
    outputSegmentCount: 0,
    nodeCount: 0,
    intersectionsSplit: 0,
    intersectionsSkippedByUnlink: 0,
    discardedEndStubs: 0,
    zeroLengthDiscarded: 0,
    cleaningProfile: options.cleaningProfile,
    input_crs: options.inputCrs,
    output_crs: options.outputCrs,
    source_dataset: options.sourceDataset,
    intersection_splitting_rule: options.splitIntersections === false ? "none" : "split all non-parallel line intersections unless covered by unlink mask",
    unlink_rule: options.unlinkMasks?.length ? "skip intersections whose point falls inside an unlink mask" : "none",
    duplicate_rule: "not yet implemented",
    stub_rule: `discard end stubs shorter than endStubMinRatio=${options.endStubMinRatio ?? 0}`,
    length_rule: "length_m = reported source length scaled by split geometry proportion; geometry length is used when no length property exists",
    notes: []
  };

  if (options.splitIntersections !== false) {
    const splitStats = addIntersectionSplits(lines, options.unlinkMasks ?? []);
    metadata.intersectionsSplit = splitStats.intersectionsSplit;
    metadata.intersectionsSkippedByUnlink = splitStats.intersectionsSkippedByUnlink;
  }

  const extent = extentOfLines(lines);
  const maxDim = Math.max(extent.maxX - extent.minX, extent.maxY - extent.minY);
  const nodeTolerance = options.nodeTolerance ?? Math.max(maxDim * 1e-9, 1e-10);
  const nodeIds = new Map<string, number>();
  const nodeKey = (point: Coordinate) => `${Math.round(point[0] / nodeTolerance)},${Math.round(point[1] / nodeTolerance)}`;
  const internNode = (point: Coordinate): number => {
    const key = nodeKey(point);
    const existing = nodeIds.get(key);
    if (existing !== undefined) return existing;
    const id = nodeIds.size;
    nodeIds.set(key, id);
    return id;
  };

  const endStubMinRatio = options.endStubMinRatio ?? 0;
  const segments = [];

  for (const line of lines) {
    const splits = uniqueSortedSplits(line);
    for (let i = 1; i < splits.length; i += 1) {
      const startD = splits[i - 1];
      const endD = splits[i];
      const geometryLength = endD - startD;
      if (!(geometryLength > line.splitTolerance)) {
        metadata.zeroLengthDiscarded += 1;
        continue;
      }
      const isEndStub = i === 1 || i === splits.length - 1;
      if (endStubMinRatio > 0 && isEndStub && geometryLength / line.geometryLength < endStubMinRatio) {
        metadata.discardedEndStubs += 1;
        continue;
      }
      const a = pointAtDistance(line.coords, line.cum, startD);
      const b = pointAtDistance(line.coords, line.cum, endD);
      const source = internNode(a);
      const target = internNode(b);
      if (source === target) {
        metadata.zeroLengthDiscarded += 1;
        continue;
      }
      const lengthM = line.reportedLength * (geometryLength / line.geometryLength);
      segments.push({
        segment_id: segments.length,
        source,
        target,
        length_m: lengthM,
        geometry: { type: "LineString" as const, coordinates: subPolyline(line.coords, line.cum, startD, endD) },
        x0: a[0],
        y0: a[1],
        x1: b[0],
        y1: b[1],
        source_dataset: options.sourceDataset,
        cleaning_profile: options.cleaningProfile,
        original_feature_id: options.preserveSourceIds ? line.originalFeatureId : undefined
      });
    }
  }

  if (segments.length === 0) {
    throw new Error("No output segments produced.");
  }

  metadata.outputSegmentCount = segments.length;
  metadata.nodeCount = nodeIds.size;
  metadata.feature_count = segments.length;
  metadata.node_count = nodeIds.size;
  metadata.total_length_m = segments.reduce((sum, segment) => sum + segment.length_m, 0);

  const graph = { segments, metadata };
  validateCanonicalGraph(graph);
  return { graph, metadata };
}

function prepareLines(features: readonly InputLineFeature[], options: CanonicalizationOptions): PreparedLine[] {
  const lines: PreparedLine[] = [];
  const lengthKeys = options.lengthKeys ?? DEFAULT_LENGTH_KEYS;

  for (let featureIndex = 0; featureIndex < features.length; featureIndex += 1) {
    const feature = features[featureIndex];
    const geometries = flattenLineGeometry(feature.geometry);
    const preparedGeometries = geometries
      .map((coords) => coords
        .map((point) => [Number(point[0]), Number(point[1])] as Coordinate)
        .filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1])))
      .filter((coords) => coords.length >= 2);
    const geometryLengths = preparedGeometries.map((coords) => lineLength(coords));
    const featureGeometryLength = geometryLengths.reduce((sum, length) => sum + length, 0);
    const featureReportedLength = numericProperty(feature.properties, lengthKeys);

    for (let geometryIndex = 0; geometryIndex < preparedGeometries.length; geometryIndex += 1) {
      const clean = preparedGeometries[geometryIndex];
      const geometryLength = geometryLengths[geometryIndex];
      if (!(geometryLength > 0)) continue;
      const reportedLength = Number.isFinite(featureReportedLength) && featureGeometryLength > 0
        ? featureReportedLength * (geometryLength / featureGeometryLength)
        : geometryLength;
      lines.push({
        id: lines.length,
        originalFeatureId: feature.id ?? feature.properties?.id as string | number | undefined ?? featureIndex,
        coords: clean,
        cum: cumulativeLengths(clean),
        geometryLength,
        reportedLength,
        splits: [0, geometryLength],
        splitTolerance: Math.max(geometryLength * 1e-9, 1e-12)
      });
    }
  }

  return lines;
}

function flattenLineGeometry(geometry: InputLineFeature["geometry"]): readonly (readonly Coordinate[])[] {
  if (geometry.type === "LineString") return [geometry.coordinates];
  if (geometry.type === "MultiLineString") return geometry.coordinates;
  return [];
}

function addIntersectionSplits(lines: PreparedLine[], unlinkMasks: readonly UnlinkMask[]): Pick<CanonicalizationMetadata, "intersectionsSplit" | "intersectionsSkippedByUnlink"> {
  let intersectionsSplit = 0;
  let intersectionsSkippedByUnlink = 0;
  const segments = preparedLineSegments(lines);
  const candidatePairs = spatialCandidatePairs(segments);

  for (const [aSegmentIndex, bSegmentIndex] of candidatePairs) {
    const aSegment = segments[aSegmentIndex];
    const bSegment = segments[bSegmentIndex];
    if (!boxesOverlap(aSegment, bSegment)) continue;
    const hit = segmentIntersection(aSegment.a, aSegment.b, bSegment.a, bSegment.b);
    if (!hit) continue;
    if (isInsideUnlinkMask(hit.point, unlinkMasks)) {
      intersectionsSkippedByUnlink += 1;
      continue;
    }
    addSplit(lines[aSegment.lineIndex], aSegment.baseDistance + hit.t * aSegment.length);
    addSplit(lines[bSegment.lineIndex], bSegment.baseDistance + hit.u * bSegment.length);
    intersectionsSplit += 1;
  }

  return { intersectionsSplit, intersectionsSkippedByUnlink };
}

function preparedLineSegments(lines: readonly PreparedLine[]): PreparedLineSegment[] {
  const segments: PreparedLineSegment[] = [];
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    for (let coordIndex = 1; coordIndex < line.coords.length; coordIndex += 1) {
      const a = line.coords[coordIndex - 1];
      const b = line.coords[coordIndex];
      const minX = Math.min(a[0], b[0]);
      const minY = Math.min(a[1], b[1]);
      const maxX = Math.max(a[0], b[0]);
      const maxY = Math.max(a[1], b[1]);
      segments.push({
        id: segments.length,
        lineIndex,
        coordIndex,
        a,
        b,
        baseDistance: line.cum[coordIndex - 1],
        length: line.cum[coordIndex] - line.cum[coordIndex - 1],
        minX,
        minY,
        maxX,
        maxY
      });
    }
  }
  return segments;
}

function spatialCandidatePairs(segments: readonly PreparedLineSegment[]): Array<[number, number]> {
  if (segments.length <= 1) return [];
  const grid = new Map<string, number[]>();
  const cellSize = spatialCellSize(segments);

  for (const segment of segments) {
    const minCellX = Math.floor((segment.minX - EPS) / cellSize);
    const maxCellX = Math.floor((segment.maxX + EPS) / cellSize);
    const minCellY = Math.floor((segment.minY - EPS) / cellSize);
    const maxCellY = Math.floor((segment.maxY + EPS) / cellSize);
    for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
      for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
        const key = `${cellX},${cellY}`;
        const bucket = grid.get(key);
        if (bucket) bucket.push(segment.id);
        else grid.set(key, [segment.id]);
      }
    }
  }

  const seen = new Set<string>();
  const pairs: Array<[number, number]> = [];
  for (const bucket of grid.values()) {
    for (let i = 0; i < bucket.length; i += 1) {
      const a = bucket[i];
      for (let j = i + 1; j < bucket.length; j += 1) {
        const b = bucket[j];
        if (segments[a].lineIndex === segments[b].lineIndex) continue;
        const first = Math.min(a, b);
        const second = Math.max(a, b);
        const key = `${first}:${second}`;
        if (seen.has(key)) continue;
        seen.add(key);
        pairs.push([first, second]);
      }
    }
  }
  return pairs;
}

function spatialCellSize(segments: readonly PreparedLineSegment[]): number {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let totalLength = 0;
  for (const segment of segments) {
    minX = Math.min(minX, segment.minX);
    minY = Math.min(minY, segment.minY);
    maxX = Math.max(maxX, segment.maxX);
    maxY = Math.max(maxY, segment.maxY);
    totalLength += segment.length;
  }
  const maxDim = Math.max(maxX - minX, maxY - minY);
  const extentCell = maxDim / Math.max(1, Math.sqrt(segments.length));
  const meanLength = totalLength / segments.length;
  return Math.max(EPS, extentCell, meanLength);
}

function boxesOverlap(a: PreparedLineSegment, b: PreparedLineSegment): boolean {
  return a.minX <= b.maxX + EPS &&
    a.maxX + EPS >= b.minX &&
    a.minY <= b.maxY + EPS &&
    a.maxY + EPS >= b.minY;
}

function isInsideUnlinkMask(point: Coordinate, masks: readonly UnlinkMask[]): boolean {
  return masks.some((mask) => distance(point, mask.center) <= mask.radius);
}

function addSplit(line: PreparedLine, distanceValue: number): void {
  const d = Math.min(line.geometryLength, Math.max(0, distanceValue));
  if (!line.splits.some((existing) => Math.abs(existing - d) <= line.splitTolerance)) {
    line.splits.push(d);
  }
}

function uniqueSortedSplits(line: PreparedLine): number[] {
  line.splits.sort((a, b) => a - b);
  const out: number[] = [];
  for (const d of line.splits) {
    if (out.length === 0 || Math.abs(out[out.length - 1] - d) > line.splitTolerance) {
      out.push(d);
    }
  }
  return out;
}

function segmentIntersection(a: Coordinate, b: Coordinate, c: Coordinate, d: Coordinate): { t: number; u: number; point: Coordinate } | null {
  const rx = b[0] - a[0];
  const ry = b[1] - a[1];
  const sx = d[0] - c[0];
  const sy = d[1] - c[1];
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < EPS) return null;
  const qpx = c[0] - a[0];
  const qpy = c[1] - a[1];
  const t = (qpx * sy - qpy * sx) / denom;
  const u = (qpx * ry - qpy * rx) / denom;
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null;
  const clampedT = Math.min(1, Math.max(0, t));
  const clampedU = Math.min(1, Math.max(0, u));
  return {
    t: clampedT,
    u: clampedU,
    point: [a[0] + rx * clampedT, a[1] + ry * clampedT]
  };
}

function extentOfLines(lines: readonly PreparedLine[]): { minX: number; minY: number; maxX: number; maxY: number } {
  const extent = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const line of lines) {
    for (const point of line.coords) {
      extent.minX = Math.min(extent.minX, point[0]);
      extent.minY = Math.min(extent.minY, point[1]);
      extent.maxX = Math.max(extent.maxX, point[0]);
      extent.maxY = Math.max(extent.maxY, point[1]);
    }
  }
  return extent;
}

function cumulativeLengths(coords: readonly Coordinate[]): number[] {
  const out = [0];
  for (let i = 1; i < coords.length; i += 1) {
    out.push(out[i - 1] + distance(coords[i - 1], coords[i]));
  }
  return out;
}

function pointAtDistance(coords: readonly Coordinate[], cum: readonly number[], distanceValue: number): Coordinate {
  if (distanceValue <= 0) return [...coords[0]];
  const total = cum[cum.length - 1];
  if (distanceValue >= total) return [...coords[coords.length - 1]];
  for (let i = 1; i < coords.length; i += 1) {
    if (distanceValue <= cum[i] + EPS) {
      const segmentLength = cum[i] - cum[i - 1];
      const t = segmentLength > 0 ? (distanceValue - cum[i - 1]) / segmentLength : 0;
      const a = coords[i - 1];
      const b = coords[i];
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
  }
  return [...coords[coords.length - 1]];
}

function subPolyline(coords: readonly Coordinate[], cum: readonly number[], startD: number, endD: number): Coordinate[] {
  const total = cum[cum.length - 1];
  const from = Math.min(Math.max(0, Math.min(startD, endD)), total);
  const to = Math.min(Math.max(0, Math.max(startD, endD)), total);
  const out: Coordinate[] = [pointAtDistance(coords, cum, from)];
  for (let i = 0; i < coords.length; i += 1) {
    if (cum[i] > from + EPS && cum[i] < to - EPS) {
      out.push([...coords[i]] as Coordinate);
    }
  }
  out.push(pointAtDistance(coords, cum, to));
  return out;
}

function lineLength(coords: readonly Coordinate[]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i += 1) {
    total += distance(coords[i - 1], coords[i]);
  }
  return total;
}

function distance(a: Coordinate, b: Coordinate): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function numericProperty(properties: Record<string, unknown> | undefined, keys: readonly string[]): number {
  for (const key of keys) {
    const value = properties?.[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
    if (typeof value === "string" && value.trim()) {
      const numberValue = Number(value);
      if (Number.isFinite(numberValue) && numberValue > 0) return numberValue;
    }
  }
  return Number.NaN;
}
