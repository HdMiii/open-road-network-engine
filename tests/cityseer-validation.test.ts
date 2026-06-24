import assert from "node:assert/strict";
import test from "node:test";
import {
  cityseerDiamondGraph,
  validateCityseerDiamondFixture
} from "../packages/validation/src/cityseer.ts";
import { runCli, type CliIo } from "../packages/cli/src/index.ts";

test("validates cityseer diamond node harmonic fixture", () => {
  const graph = cityseerDiamondGraph();
  const report = validateCityseerDiamondFixture();

  assert.equal(graph.segments.length, 5);
  assert.equal(report.status, "pass");
  assert.equal(report.runtime.liveCityseerAvailable, false);
  assert.equal(report.comparisons.length, 3);

  const radius150 = report.comparisons.find((comparison) => comparison.radius === 150);
  assert.ok(radius150);
  assert.deepEqual(radius150.nodeHarmonic.expected, [0.02, 0.03, 0.03, 0.02]);
  assert.deepEqual(radius150.projectedSegmentHarmonic.expected, [0.025, 0.025, 0.03, 0.025, 0.025]);
  assert.ok(radius150.nodeHarmonic.maxAbsoluteDifference < 1e-9);
  assert.ok(radius150.projectedSegmentHarmonic.maxAbsoluteDifference < 1e-9);

  const radius250 = report.comparisons.find((comparison) => comparison.radius === 250);
  assert.ok(radius250);
  assert.deepEqual(radius250.projectedSegmentHarmonic.expected, [0.0275, 0.0275, 0.03, 0.0275, 0.0275]);
  assert.ok(radius250.nodeHarmonic.maxAbsoluteDifference < 1e-9);
});

test("CLI emits cityseer validation report JSON", async () => {
  const files = new Map<string, Uint8Array>();
  const stdout: string[] = [];
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

  const stdoutCode = await runCli(["validate-cityseer"], io);
  assert.equal(stdoutCode, 0);
  const stdoutReport = JSON.parse(stdout.join(""));
  assert.equal(stdoutReport.status, "pass");
  assert.equal(stdoutReport.fixture, "cityseer diamond graph");

  const outputCode = await runCli(["validate-cityseer", "--output", "cityseer.json"], io);
  assert.equal(outputCode, 0);
  const outputReport = JSON.parse(new TextDecoder().decode(files.get("cityseer.json")!));
  assert.equal(outputReport.comparisons[1].radius, 150);
});
