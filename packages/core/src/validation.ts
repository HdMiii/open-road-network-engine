import type { CanonicalGraph, CanonicalSegment } from "./types.ts";

export function validateCanonicalSegment(segment: CanonicalSegment): void {
  if (!Number.isInteger(segment.segment_id) || segment.segment_id < 0) {
    throw new Error(`Invalid segment_id: ${segment.segment_id}`);
  }
  if (!Number.isInteger(segment.source) || !Number.isInteger(segment.target)) {
    throw new Error(`Segment ${segment.segment_id} has invalid endpoint ids`);
  }
  if (segment.source === segment.target) {
    throw new Error(`Segment ${segment.segment_id} has identical source and target`);
  }
  if (!Number.isFinite(segment.length_m) || segment.length_m <= 0) {
    throw new Error(`Segment ${segment.segment_id} has invalid length_m`);
  }
  if (segment.geometry.type !== "LineString" || segment.geometry.coordinates.length < 2) {
    throw new Error(`Segment ${segment.segment_id} must have a LineString with at least two coordinates`);
  }
  for (const [x, y] of segment.geometry.coordinates) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error(`Segment ${segment.segment_id} has non-finite geometry coordinates`);
    }
  }
}

export function validateCanonicalGraph(graph: CanonicalGraph): void {
  const ids = new Set<number>();
  for (const segment of graph.segments) {
    validateCanonicalSegment(segment);
    if (ids.has(segment.segment_id)) {
      throw new Error(`Duplicate segment_id: ${segment.segment_id}`);
    }
    ids.add(segment.segment_id);
  }
}

