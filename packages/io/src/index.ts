import type { CanonicalGraph, CanonicalGraphMetadata, CanonicalSegment, Coordinate, LineStringGeometry } from "../../core/src/index.ts";
import { validateCanonicalGraph } from "../../core/src/index.ts";
import type { InputLineFeature, UnlinkMask } from "../../canonicalize/src/index.ts";
import { canonicalRowHash } from "../../website-adapter/src/index.ts";
import { deserialize, serialize } from "flatgeobuf/lib/mjs/geojson.js";

export interface GraphExport {
  graph: CanonicalGraph;
  rowHash: string;
  featureCount: number;
  metadata?: CanonicalGraphMetadata;
}

export interface GeoJsonFeature {
  type: "Feature";
  geometry: LineStringGeometry;
  properties: Record<string, unknown>;
  id?: string | number;
}

export interface GeoJsonFeatureCollection {
  type: "FeatureCollection";
  features: GeoJsonFeature[];
  // Reproducibility metadata carried as a GeoJSON foreign member (round-trips through
  // the in-memory/GeoJSON path; FlatGeobuf bytes cannot carry it, so use the sidecar there).
  metadata?: CanonicalGraphMetadata;
}

export interface ParsedMifLine {
  id: number;
  coords: [Coordinate, Coordinate];
  properties: Record<string, unknown>;
}

export interface ParsedMif {
  columns: string[];
  lines: ParsedMifLine[];
}

export interface LocalNormalizer {
  centerX: number;
  centerY: number;
  scale: number;
  point: (point: Coordinate) => Coordinate;
}

export function canonicalGraphToFeatureCollection(graph: CanonicalGraph): GeoJsonFeatureCollection {
  validateCanonicalGraph(graph);
  const collection: GeoJsonFeatureCollection = {
    type: "FeatureCollection",
    features: graph.segments.map((segment) => ({
      type: "Feature",
      id: segment.segment_id,
      geometry: segment.geometry,
      properties: canonicalSegmentProperties(segment)
    }))
  };
  if (graph.metadata !== undefined) collection.metadata = graph.metadata;
  return collection;
}

export function featureCollectionToCanonicalGraph(collection: GeoJsonFeatureCollection): GraphExport {
  const segments: CanonicalSegment[] = collection.features.map((feature, index) => {
    const props = feature.properties ?? {};
    const source = numericRequired(props.source, `feature ${index} source`);
    const target = numericRequired(props.target, `feature ${index} target`);
    const lengthM = numericRequired(props.length_m, `feature ${index} length_m`);
    const segmentId = numericOptional(props.segment_id) ?? numericOptional(feature.id) ?? index;
    return {
      segment_id: segmentId,
      source,
      target,
      length_m: lengthM,
      geometry: feature.geometry,
      x0: numericOptional(props.x0),
      y0: numericOptional(props.y0),
      x1: numericOptional(props.x1),
      y1: numericOptional(props.y1),
      source_dataset: stringOptional(props.source_dataset),
      cleaning_profile: stringOptional(props.cleaning_profile),
      original_feature_id: stringOrNumberOptional(props.original_feature_id),
      component_id: numericOptional(props.component_id)
    };
  });
  const graph: CanonicalGraph = collection.metadata !== undefined ? { segments, metadata: collection.metadata } : { segments };
  validateCanonicalGraph(graph);
  return {
    graph,
    rowHash: canonicalRowHash(graph.segments),
    featureCount: graph.segments.length,
    metadata: collection.metadata
  };
}

export function inputFeaturesToFeatureCollection(features: readonly InputLineFeature[]): GeoJsonFeatureCollection {
  return {
    type: "FeatureCollection",
    features: features.flatMap((feature, featureIndex) => {
      if (feature.geometry.type === "LineString") {
        return [{
          type: "Feature" as const,
          id: feature.id ?? featureIndex,
          geometry: feature.geometry,
          properties: feature.properties ?? {}
        }];
      }
      return feature.geometry.coordinates.map((coordinates, partIndex) => ({
        type: "Feature" as const,
        id: `${feature.id ?? featureIndex}:${partIndex}`,
        geometry: { type: "LineString" as const, coordinates },
        properties: feature.properties ?? {}
      }));
    })
  };
}

export function parseMidText(text: string): unknown[][] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .map(parseMidLine);
}

export function parseMifLinesText(mifText: string, midRows: readonly unknown[][] = []): ParsedMif {
  const columns: string[] = [];
  const lines: ParsedMifLine[] = [];
  const rows = mifText.split(/\r?\n/);
  let inColumns = false;
  let columnsLeft = 0;
  let inData = false;

  for (const raw of rows) {
    const line = raw.trim();
    if (!inData) {
      const colMatch = /^Columns\s+(\d+)/i.exec(line);
      if (colMatch) {
        inColumns = true;
        columnsLeft = Number(colMatch[1]);
        continue;
      }
      if (inColumns && columnsLeft > 0) {
        const match = /^(\S+)/.exec(line);
        if (match) columns.push(match[1]);
        columnsLeft -= 1;
        if (columnsLeft === 0) inColumns = false;
        continue;
      }
      if (/^Data$/i.test(line)) inData = true;
      continue;
    }

    const match = /^LINE\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/i.exec(line);
    if (!match) continue;
    const id = lines.length;
    const mid = midRows[id] ?? [];
    const properties: Record<string, unknown> = {};
    for (let i = 0; i < columns.length; i += 1) {
      properties[columns[i]] = mid[i] ?? null;
    }
    lines.push({
      id,
      coords: [
        [Number(match[1]), Number(match[2])],
        [Number(match[3]), Number(match[4])]
      ],
      properties
    });
  }

  return { columns, lines };
}

export function mifLinesToInputFeatures(parsed: ParsedMif): InputLineFeature[] {
  return parsed.lines.map((line) => ({
    id: line.id,
    geometry: { type: "LineString", coordinates: line.coords },
    properties: line.properties
  }));
}

export function extentOfInputFeatures(features: readonly InputLineFeature[]): { minX: number; minY: number; maxX: number; maxY: number } {
  const extent = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const feature of features) {
    const geometries = feature.geometry.type === "LineString" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    for (const coordinates of geometries) {
      for (const point of coordinates) {
        extent.minX = Math.min(extent.minX, point[0]);
        extent.minY = Math.min(extent.minY, point[1]);
        extent.maxX = Math.max(extent.maxX, point[0]);
        extent.maxY = Math.max(extent.maxY, point[1]);
      }
    }
  }
  return extent;
}

export function createLocalNormalizer(extent: { minX: number; minY: number; maxX: number; maxY: number }): LocalNormalizer {
  const maxDim = Math.max(extent.maxX - extent.minX, extent.maxY - extent.minY);
  if (!(maxDim > 0)) {
    throw new Error("Cannot create local normalizer for zero-size extent.");
  }
  const centerX = (extent.minX + extent.maxX) / 2;
  const centerY = (extent.minY + extent.maxY) / 2;
  const scale = 1 / maxDim;
  return {
    centerX,
    centerY,
    scale,
    point: (point: Coordinate) => [(point[0] - centerX) * scale, (point[1] - centerY) * scale]
  };
}

export function normalizeInputFeatures(features: readonly InputLineFeature[], normalizer: LocalNormalizer): InputLineFeature[] {
  return features.map((feature) => {
    if (feature.geometry.type === "LineString") {
      return {
        ...feature,
        geometry: {
          type: "LineString" as const,
          coordinates: feature.geometry.coordinates.map(normalizer.point)
        }
      };
    }
    return {
      ...feature,
      geometry: {
        type: "MultiLineString" as const,
        coordinates: feature.geometry.coordinates.map((line) => line.map(normalizer.point))
      }
    };
  });
}

export function buildUnlinkMasksFromLines(lines: readonly ParsedMifLine[], padding = 2): UnlinkMask[] {
  const masks: UnlinkMask[] = [];
  for (const line of lines) {
    const [a, b] = line.coords;
    const center: Coordinate = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const radius = Math.max(padding, distance(a, b) / 2 + padding);
    masks.push({ center, radius });
  }
  return masks;
}

export async function readFlatGeobufCanonicalGraph(bytes: Uint8Array): Promise<GraphExport> {
  const features: GeoJsonFeature[] = [];
  for await (const feature of deserialize(bytes)) {
    const rawFeature = feature as {
      id?: unknown;
      geometry?: { type?: unknown };
      properties?: unknown;
    };
    if (rawFeature.geometry?.type !== "LineString") {
      throw new Error(`FlatGeobuf canonical graph expected LineString features; found ${String(rawFeature.geometry?.type ?? "missing geometry")}.`);
    }
    features.push({
      type: "Feature",
      id: rawFeature.id as string | number | undefined,
      geometry: rawFeature.geometry as LineStringGeometry,
      properties: hasRecord(rawFeature.properties) ? rawFeature.properties : {}
    });
  }
  return featureCollectionToCanonicalGraph({ type: "FeatureCollection", features });
}

export function writeFlatGeobufCanonicalGraph(graph: CanonicalGraph, crsCode = 4326): Uint8Array {
  return serialize(canonicalGraphToFeatureCollection(graph), crsCode);
}

function canonicalSegmentProperties(segment: CanonicalSegment): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    segment_id: segment.segment_id,
    source: segment.source,
    target: segment.target,
    length_m: segment.length_m
  };
  if (segment.x0 !== undefined) properties.x0 = segment.x0;
  if (segment.y0 !== undefined) properties.y0 = segment.y0;
  if (segment.x1 !== undefined) properties.x1 = segment.x1;
  if (segment.y1 !== undefined) properties.y1 = segment.y1;
  if (segment.source_dataset !== undefined) properties.source_dataset = segment.source_dataset;
  if (segment.cleaning_profile !== undefined) properties.cleaning_profile = segment.cleaning_profile;
  if (segment.original_feature_id !== undefined) properties.original_feature_id = segment.original_feature_id;
  if (segment.component_id !== undefined) properties.component_id = segment.component_id;
  return properties;
}

function hasRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseMidLine(line: string): unknown[] {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === "\"") {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current);
  return values.map((value) => {
    const trimmed = value.trim();
    const numberValue = Number(trimmed);
    return trimmed !== "" && Number.isFinite(numberValue) ? numberValue : trimmed;
  });
}

function numericRequired(value: unknown, label: string): number {
  const numberValue = numericOptional(value);
  if (numberValue === undefined) {
    throw new Error(`Missing or invalid numeric value for ${label}`);
  }
  return numberValue;
}

function numericOptional(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const numberValue = Number(value);
    if (Number.isFinite(numberValue)) return numberValue;
  }
  return undefined;
}

function stringOptional(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function stringOrNumberOptional(value: unknown): string | number | undefined {
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}

function distance(a: Coordinate, b: Coordinate): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}
