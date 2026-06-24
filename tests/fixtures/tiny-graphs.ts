import type { CanonicalGraph } from "../../packages/core/src/index.ts";

export const chainGraph: CanonicalGraph = {
  segments: [
    {
      segment_id: 0,
      source: 0,
      target: 1,
      length_m: 10,
      geometry: { type: "LineString", coordinates: [[0, 0], [10, 0]] }
    },
    {
      segment_id: 1,
      source: 1,
      target: 2,
      length_m: 10,
      geometry: { type: "LineString", coordinates: [[10, 0], [20, 0]] }
    }
  ]
};

export const threeSegmentChainGraph: CanonicalGraph = {
  segments: [
    ...chainGraph.segments,
    {
      segment_id: 2,
      source: 2,
      target: 3,
      length_m: 10,
      geometry: { type: "LineString", coordinates: [[20, 0], [30, 0]] }
    }
  ]
};

export const crossGraph: CanonicalGraph = {
  segments: [
    {
      segment_id: 0,
      source: 0,
      target: 1,
      length_m: 10,
      geometry: { type: "LineString", coordinates: [[0, 0], [10, 0]] }
    },
    {
      segment_id: 1,
      source: 1,
      target: 2,
      length_m: 10,
      geometry: { type: "LineString", coordinates: [[10, 0], [20, 0]] }
    },
    {
      segment_id: 2,
      source: 1,
      target: 3,
      length_m: 10,
      geometry: { type: "LineString", coordinates: [[10, 0], [10, 10]] }
    },
    {
      segment_id: 3,
      source: 1,
      target: 4,
      length_m: 10,
      geometry: { type: "LineString", coordinates: [[10, 0], [10, -10]] }
    }
  ]
};

export const rightAngleGraph: CanonicalGraph = {
  segments: [
    {
      segment_id: 0,
      source: 0,
      target: 1,
      length_m: 10,
      geometry: { type: "LineString", coordinates: [[0, 0], [10, 0]] },
      x0: 0,
      y0: 0,
      x1: 10,
      y1: 0
    },
    {
      segment_id: 1,
      source: 1,
      target: 2,
      length_m: 10,
      geometry: { type: "LineString", coordinates: [[10, 0], [10, 10]] },
      x0: 10,
      y0: 0,
      x1: 10,
      y1: 10
    }
  ]
};

export const disconnectedGraph: CanonicalGraph = {
  segments: [
    ...chainGraph.segments,
    {
      segment_id: 2,
      source: 10,
      target: 11,
      length_m: 5,
      geometry: { type: "LineString", coordinates: [[100, 0], [105, 0]] }
    }
  ]
};
