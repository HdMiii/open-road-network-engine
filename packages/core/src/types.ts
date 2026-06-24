export type ValidationStatus = "validated" | "compatible" | "experimental";

export type Coordinate = readonly [x: number, y: number];

export interface LineStringGeometry {
  type: "LineString";
  coordinates: readonly Coordinate[];
}

export interface CanonicalSegment {
  segment_id: number;
  source: number;
  target: number;
  length_m: number;
  geometry: LineStringGeometry;
  x0?: number;
  y0?: number;
  x1?: number;
  y1?: number;
  source_dataset?: string;
  cleaning_profile?: string;
  original_feature_id?: string | number;
  component_id?: number;
}

export interface CanonicalGraph {
  segments: readonly CanonicalSegment[];
  metadata?: CanonicalGraphMetadata;
}

export interface CanonicalGraphMetadata {
  input_source?: string;
  input_license?: string;
  input_crs?: string;
  output_crs?: string;
  boundary_rule?: string;
  intersection_splitting_rule?: string;
  unlink_rule?: string;
  duplicate_rule?: string;
  stub_rule?: string;
  length_rule?: string;
  tool_version?: string;
  commit_hash?: string;
  feature_count?: number;
  node_count?: number;
  total_length_m?: number;
  component_count?: number;
}

export interface GraphEdge {
  from: number;
  to: number;
  segmentIndex: number;
  segmentId: number;
  weight: number;
}

export type Adjacency = Map<number, GraphEdge[]>;

export interface DualEdge {
  fromSegmentIndex: number;
  toSegmentIndex: number;
  viaNode: number;
  weight: number;
}

export type DualAdjacency = Map<number, DualEdge[]>;

export interface DistanceResult {
  distances: Float64Array;
  predecessors: Int32Array;
}

export interface CentralityResult {
  values: Float64Array;
  status: ValidationStatus;
  method: string;
  notes?: string;
}

