import assert from "node:assert/strict";
import test from "node:test";
import { canonicalizeLineNetwork } from "../packages/canonicalize/src/index.ts";
import { canonicalRowHash } from "../packages/website-adapter/src/index.ts";

test("canonicalizes a crossing line network into split segments", () => {
  const result = canonicalizeLineNetwork([
    {
      id: "east-west",
      geometry: { type: "LineString", coordinates: [[0, 0], [10, 0]] },
      properties: { length_m: 10 }
    },
    {
      id: "north-south",
      geometry: { type: "LineString", coordinates: [[5, -5], [5, 5]] },
      properties: { length_m: 10 }
    }
  ], { preserveSourceIds: true });

  assert.equal(result.graph.segments.length, 4);
  assert.equal(result.metadata.nodeCount, 5);
  assert.equal(result.metadata.intersectionsSplit, 1);
  assert.deepEqual(result.graph.segments.map((segment) => segment.length_m), [5, 5, 5, 5]);
  assert.deepEqual(result.graph.segments.map((segment) => segment.original_feature_id), ["east-west", "east-west", "north-south", "north-south"]);
});

test("skips an intersection covered by an unlink mask", () => {
  const result = canonicalizeLineNetwork([
    {
      geometry: { type: "LineString", coordinates: [[0, 0], [10, 0]] },
      properties: { length_m: 10 }
    },
    {
      geometry: { type: "LineString", coordinates: [[5, -5], [5, 5]] },
      properties: { length_m: 10 }
    }
  ], {
    unlinkMasks: [{ center: [5, 0], radius: 0.5 }]
  });

  assert.equal(result.graph.segments.length, 2);
  assert.equal(result.metadata.intersectionsSplit, 0);
  assert.equal(result.metadata.intersectionsSkippedByUnlink, 1);
});

test("canonicalizes multiline features and preserves stable row hash changes", () => {
  const result = canonicalizeLineNetwork([
    {
      id: "multi",
      geometry: {
        type: "MultiLineString",
        coordinates: [
          [[0, 0], [10, 0]],
          [[20, 0], [30, 0]]
        ]
      },
      properties: { length_m: 20 }
    }
  ]);

  assert.equal(result.graph.segments.length, 2);
  assert.deepEqual(result.graph.segments.map((segment) => segment.length_m), [10, 10]);

  const hash = canonicalRowHash(result.graph.segments);
  const reversedHash = canonicalRowHash([...result.graph.segments].reverse());
  assert.notEqual(hash, reversedHash);
  assert.match(hash, /^[0-9a-f]{16}$/);
});

test("retains intermediate vertices of a bent line through a split", () => {
  // An L-shaped line (0,0)->(10,0)->(10,10), length 20, crossed at (10,5) by a
  // straight line. The split at arc-length 15 must keep the (10,0) corner vertex.
  const result = canonicalizeLineNetwork([
    {
      id: "bent",
      geometry: { type: "LineString", coordinates: [[0, 0], [10, 0], [10, 10]] },
      properties: { length_m: 20 }
    },
    {
      id: "crossing",
      geometry: { type: "LineString", coordinates: [[5, 5], [15, 5]] },
      properties: { length_m: 10 }
    }
  ], { preserveSourceIds: true });

  assert.equal(result.metadata.intersectionsSplit, 1);

  const cornerSegment = result.graph.segments.find((segment) => segment.geometry.coordinates.length === 3);
  assert.ok(cornerSegment, "expected a split segment that retains the bent corner vertex");
  assert.deepEqual(cornerSegment.geometry.coordinates, [[0, 0], [10, 0], [10, 5]]);
  assert.equal(cornerSegment.length_m, 15);

  // Endpoint fields stay equal to first/last geometry vertices.
  assert.deepEqual([cornerSegment.x0, cornerSegment.y0], [0, 0]);
  assert.deepEqual([cornerSegment.x1, cornerSegment.y1], [10, 5]);

  // Emitted geometry length now matches the reported length_m.
  for (const segment of result.graph.segments) {
    const coords = segment.geometry.coordinates;
    let geometryLength = 0;
    for (let i = 1; i < coords.length; i += 1) {
      geometryLength += Math.hypot(coords[i][0] - coords[i - 1][0], coords[i][1] - coords[i - 1][1]);
    }
    assert.ok(Math.abs(geometryLength - segment.length_m) < 1e-9, `segment ${segment.segment_id} geometry length ${geometryLength} != length_m ${segment.length_m}`);
  }
});

test("supports explicit end-stub pruning as a cleaning policy", () => {
  const result = canonicalizeLineNetwork([
    {
      geometry: { type: "LineString", coordinates: [[0, 0], [10, 0]] },
      properties: { length_m: 10 }
    },
    {
      geometry: { type: "LineString", coordinates: [[1, -1], [1, 1]] },
      properties: { length_m: 2 }
    }
  ], { endStubMinRatio: 0.2 });

  assert.equal(result.metadata.discardedEndStubs, 1);
  assert.equal(result.graph.segments.length, 3);
});
