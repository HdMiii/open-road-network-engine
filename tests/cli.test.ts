import assert from "node:assert/strict";
import test from "node:test";
import { runCli, type CliIo } from "../packages/cli/src/index.ts";

test("CLI canonicalizes GeoJSON and analyzes a generated column", async () => {
  const files = new Map<string, Uint8Array>();
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io: CliIo = {
    async readFile(path) {
      const value = files.get(path);
      if (!value) throw new Error(`missing test file: ${path}`);
      return value;
    },
    async writeFile(path, data) {
      files.set(path, typeof data === "string" ? new TextEncoder().encode(data) : data);
    },
    stdout: { write: (chunk: string) => stdout.push(String(chunk)) },
    stderr: { write: (chunk: string) => stderr.push(String(chunk)) }
  };

  files.set("roads.geojson", new TextEncoder().encode(JSON.stringify({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        id: "a",
        properties: { length_m: 10 },
        geometry: { type: "LineString", coordinates: [[0, 0], [10, 0]] }
      },
      {
        type: "Feature",
        id: "b",
        properties: { length_m: 10 },
        geometry: { type: "LineString", coordinates: [[10, 0], [20, 0]] }
      }
    ]
  })));

  const canonicalizeCode = await runCli([
    "canonicalize",
    "--input",
    "roads.geojson",
    "--output",
    "graph.geojson",
    "--preserve-source-ids"
  ], io);
  assert.equal(canonicalizeCode, 0);
  assert.equal(stderr.join(""), "");

  const graph = JSON.parse(new TextDecoder().decode(files.get("graph.geojson")!));
  assert.equal(graph.features.length, 2);
  assert.equal(graph.features[0].properties.source, 0);
  assert.equal(graph.features[1].properties.target, 2);
  // Metadata is carried in-band on the GeoJSON output as a foreign member.
  assert.ok(graph.metadata);
  assert.equal(graph.metadata.outputSegmentCount, 2);

  // And a reproducibility sidecar manifest is written alongside the output.
  const sidecar = JSON.parse(new TextDecoder().decode(files.get("graph.geojson.metadata.json")!));
  assert.equal(sidecar.outputSegmentCount, 2);
  assert.equal(sidecar.nodeCount, 3);
  assert.ok(typeof sidecar.length_rule === "string");
  assert.ok(typeof sidecar.intersection_splitting_rule === "string");

  const analyzeCode = await runCli([
    "analyze",
    "--input",
    "graph.geojson",
    "--column",
    "dmx_integration_r400",
    "--output",
    "values.json"
  ], io);
  assert.equal(analyzeCode, 0);

  const values = JSON.parse(new TextDecoder().decode(files.get("values.json")!));
  assert.equal(values.column, "dmx_integration_r400");
  assert.equal(values.featureCount, 2);
  assert.deepEqual(values.values, [0.10000000149011612, 0.10000000149011612]);
  assert.deepEqual(stdout, []);
});

test("CLI reports usage for unsupported commands", async () => {
  const stderr: string[] = [];
  const code = await runCli(["nope"], {
    async readFile() {
      throw new Error("not used");
    },
    async writeFile() {},
    stdout: { write: () => true },
    stderr: { write: (chunk: string) => stderr.push(String(chunk)) }
  });

  assert.equal(code, 1);
  assert.match(stderr.join(""), /Unknown command: nope/);
  assert.match(stderr.join(""), /Usage:/);
});

test("CLI emits method catalog JSON", async () => {
  const stdout: string[] = [];
  const files = new Map<string, Uint8Array>();
  const io: CliIo = {
    async readFile() {
      throw new Error("not used");
    },
    async writeFile(path, data) {
      files.set(path, typeof data === "string" ? new TextEncoder().encode(data) : data);
    },
    stdout: { write: (chunk: string) => stdout.push(String(chunk)) },
    stderr: { write: () => true }
  };

  const stdoutCode = await runCli(["methods"], io);
  assert.equal(stdoutCode, 0);
  const report = JSON.parse(stdout.join(""));
  assert.equal(report.methods.some((entry: { column: string }) => entry.column.startsWith("sdna_")), false);
  assert.equal(report.methods.some((entry: { column: string }) => entry.column.startsWith("primal_")), false);
  assert.equal(report.methods.some((entry: { column: string }) => entry.column.startsWith("graph_")), false);
  assert.equal(report.methods.some((entry: { column: string; status: string }) =>
    entry.column === "dmx_angular_integration_r400" && entry.status === "compatible"
  ), true);

  const outputCode = await runCli(["methods", "--output", "methods.json"], io);
  assert.equal(outputCode, 0);
  const outputReport = JSON.parse(new TextDecoder().decode(files.get("methods.json")!));
  assert.equal(outputReport.radii[0], 400);
});

test("CLI emits release readiness report JSON", async () => {
  const files = new Map<string, Uint8Array>([
    ["package.json", new TextEncoder().encode(JSON.stringify({
      name: "open-road-network-engine",
      version: "0.0.0",
      exports: { ".": "./src/index.ts" },
      bin: { "open-road-network-engine": "./packages/cli/src/index.ts" },
      files: ["src", "packages", "docs", "README.md"],
      engines: { node: ">=24" }
    }))]
  ]);
  const stdout: string[] = [];
  const io: CliIo = {
    async readFile(path) {
      const value = files.get(path);
      if (!value) throw new Error(`missing test file: ${path}`);
      return value;
    },
    async writeFile(path, data) {
      files.set(path, typeof data === "string" ? new TextEncoder().encode(data) : data);
    },
    stdout: { write: (chunk: string) => stdout.push(String(chunk)) },
    stderr: { write: () => true }
  };

  const code = await runCli(["release-check"], io);
  assert.equal(code, 0);
  const report = JSON.parse(stdout.join(""));
  assert.equal(report.status, "review");
  assert.equal(report.issues.some((issue: { code: string }) => issue.code === "placeholder-version"), true);
  assert.equal(report.issues.some((issue: { code: string }) => issue.code === "missing-license-file"), true);
  assert.equal(report.issues.some((issue: { code: string }) => issue.code === "raw-source-exports"), true);
  assert.equal(report.issues.some((issue: { code: string }) => issue.code === "node-engine-too-strict"), true);

  const outputCode = await runCli(["release-check", "--output", "release.json"], io);
  assert.equal(outputCode, 0);
  const outputReport = JSON.parse(new TextDecoder().decode(files.get("release.json")!));
  assert.equal(outputReport.packageName, "open-road-network-engine");
});
