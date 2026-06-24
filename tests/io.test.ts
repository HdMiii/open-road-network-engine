import assert from "node:assert/strict";
import test from "node:test";
import { canonicalizeLineNetwork } from "../packages/canonicalize/src/index.ts";
import {
  buildUnlinkMasksFromLines,
  canonicalGraphToFeatureCollection,
  createLocalNormalizer,
  extentOfInputFeatures,
  featureCollectionToCanonicalGraph,
  mifLinesToInputFeatures,
  normalizeInputFeatures,
  parseMidText,
  parseMifLinesText,
  readFlatGeobufCanonicalGraph,
  writeFlatGeobufCanonicalGraph
} from "../packages/io/src/index.ts";
import { chainGraph } from "./fixtures/tiny-graphs.ts";

test("round-trips a canonical graph through GeoJSON-shaped features", () => {
  const collection = canonicalGraphToFeatureCollection(chainGraph);
  assert.equal(collection.features.length, 2);
  assert.equal(collection.features[0].properties.source, 0);
  assert.equal(collection.features[0].properties.length_m, 10);

  const roundTrip = featureCollectionToCanonicalGraph(collection);
  assert.equal(roundTrip.featureCount, 2);
  assert.deepEqual(roundTrip.graph.segments.map((segment) => segment.source), [0, 1]);
  assert.match(roundTrip.rowHash, /^[0-9a-f]{16}$/);

  // A graph without metadata must not gain a forced metadata key.
  assert.equal("metadata" in collection, false);
  assert.equal(roundTrip.graph.metadata, undefined);
  assert.equal(roundTrip.metadata, undefined);
});

test("preserves reproducibility metadata through the GeoJSON round-trip", () => {
  const result = canonicalizeLineNetwork([
    {
      geometry: { type: "LineString", coordinates: [[0, 0], [10, 0]] },
      properties: { length_m: 10 }
    }
  ], { inputCrs: "EPSG:27700", cleaningProfile: "test-profile" });

  const collection = canonicalGraphToFeatureCollection(result.graph);
  assert.ok(collection.metadata, "expected metadata foreign member on the feature collection");
  assert.equal(collection.metadata.input_crs, "EPSG:27700");

  const roundTrip = featureCollectionToCanonicalGraph(collection);
  assert.deepEqual(roundTrip.graph.metadata, result.graph.metadata);
  assert.deepEqual(roundTrip.metadata, result.graph.metadata);
});

test("parses MapInfo MIF/MID line features", () => {
  const mid = parseMidText("\"Main Street\",10\n\"Side Street\",20\n");
  const mif = parseMifLinesText(`
Version 300
Charset "WindowsLatin1"
Delimiter ","
Columns 2
  Name Char(40)
  length_m Float
Data
LINE 0 0 10 0
LINE 5 -5 5 5
`, mid);

  assert.deepEqual(mif.columns, ["Name", "length_m"]);
  assert.equal(mif.lines.length, 2);
  assert.equal(mif.lines[0].properties.Name, "Main Street");
  assert.equal(mif.lines[1].properties.length_m, 20);

  const features = mifLinesToInputFeatures(mif);
  const result = canonicalizeLineNetwork(features);
  assert.equal(result.graph.segments.length, 4);
});

test("normalizes input features into local display coordinates", () => {
  const features = mifLinesToInputFeatures(parseMifLinesText(`
Columns 0
Data
LINE 0 0 10 0
LINE 0 10 10 10
`));
  const normalizer = createLocalNormalizer(extentOfInputFeatures(features));
  const normalized = normalizeInputFeatures(features, normalizer);

  assert.deepEqual(normalized[0].geometry.coordinates[0], [-0.5, -0.5]);
  assert.deepEqual(normalized[1].geometry.coordinates[1], [0.5, 0.5]);
  assert.equal(normalizer.scale, 0.1);
});

test("builds unlink masks from MapInfo line markers", () => {
  const unlink = parseMifLinesText(`
Columns 0
Data
LINE 4.5 0 5.5 0
`);
  const masks = buildUnlinkMasksFromLines(unlink.lines, 0.25);
  assert.equal(masks.length, 1);
  assert.deepEqual(masks[0].center, [5, 0]);
  assert.equal(masks[0].radius, 0.75);
});

test("round-trips a canonical graph through FlatGeobuf bytes", async () => {
  const bytes = writeFlatGeobufCanonicalGraph(chainGraph);
  assert.ok(bytes.byteLength > 0);

  const roundTrip = await readFlatGeobufCanonicalGraph(bytes);
  assert.equal(roundTrip.featureCount, chainGraph.segments.length);
  assert.deepEqual(roundTrip.graph.segments.map((segment) => segment.source), [0, 1]);
  assert.deepEqual(roundTrip.graph.segments.map((segment) => segment.target), [1, 2]);
  assert.deepEqual(roundTrip.graph.segments.map((segment) => segment.length_m), [10, 10]);
});
