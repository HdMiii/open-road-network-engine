import assert from "node:assert/strict";
import test from "node:test";
import { validateDepthmapXSegmentAngularCsv, validateDepthmapXSegmentMetricCsv } from "../packages/validation/src/depthmapx.ts";
import { runCli, type CliIo } from "../packages/cli/src/index.ts";

const chainDepthmapXCsv = `Ref,x1,y1,x2,y2,Metric Choice,Metric Mean Depth,Segment Length
0,0,0,10,0,2,15,10
1,10,0,20,0,3,10,10
2,20,0,30,0,2,15,10
`;

const angularRightAngleCsv = `Ref,x1,y1,x2,y2,Angular Mean Depth,Angular Node Count,Angular Total Depth,Segment Length
0,0,0,10,0,1,2,1,10
1,10,0,10,10,1,2,1,10
`;

const tulipRightAngleCsv = `Ref,x1,y1,x2,y2,T1024 Choice,T1024 Integration,T1024 Node Count,T1024 Total Depth,Segment Length
0,0,0,10,0,0,4,2,1,10
1,10,0,10,10,0,4,2,1,10
`;

test("validates DepthmapX metric segment CSV against engine outputs", () => {
  const report = validateDepthmapXSegmentMetricCsv(chainDepthmapXCsv);
  assert.equal(report.fixture.featureCount, 3);
  assert.equal(report.fixture.nodeCount, 4);
  assert.equal(report.fixture.engineRadius, "n");
  assert.equal(report.fixture.referenceRadius, "n");
  assert.equal(report.status, "pass");
  assert.equal(report.comparisons.metricMeanDepth.pearson, 1);
  assert.equal(report.comparisons.metricChoice.exactMatches, 3);
  assert.equal(report.comparisons.metricChoice.topDecileOverlap, 1);
});

test("flags finite-radius validation when DepthmapX columns are global", () => {
  const report = validateDepthmapXSegmentMetricCsv(chainDepthmapXCsv, { radius: 20 });
  assert.equal(report.fixture.engineRadius, 20);
  assert.equal(report.fixture.referenceRadius, "n");
  assert.equal(report.status, "review");
  assert.match(report.notes.join("\n"), /Reference columns imply radius n/);
});

test("CLI emits DepthmapX validation report JSON", async () => {
  const files = new Map<string, Uint8Array>([
    ["depthmapx.csv", new TextEncoder().encode(chainDepthmapXCsv)]
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

  const code = await runCli(["validate-depthmapx", "--input", "depthmapx.csv"], io);
  assert.equal(code, 0);
  const report = JSON.parse(stdout.join(""));
  assert.equal(report.status, "pass");
  assert.equal(report.comparisons.metricChoice.count, 3);
});

test("validates DepthmapX angular segment CSV against engine outputs", () => {
  const fullReport = validateDepthmapXSegmentAngularCsv(angularRightAngleCsv);
  assert.equal(fullReport.fixture.featureCount, 2);
  assert.equal(fullReport.status, "pass");
  assert.equal(fullReport.comparisons.angularMeanDepth?.exactMatches, 2);

  const tulipReport = validateDepthmapXSegmentAngularCsv(tulipRightAngleCsv);
  assert.equal(tulipReport.status, "pass");
  assert.equal(tulipReport.comparisons.tulipIntegration?.exactMatches, 2);
  assert.equal(tulipReport.comparisons.tulipChoice?.exactMatches, 2);
});

test("CLI emits DepthmapX angular validation report JSON", async () => {
  const files = new Map<string, Uint8Array>([
    ["depthmapx-angular.csv", new TextEncoder().encode(tulipRightAngleCsv)]
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

  const code = await runCli(["validate-depthmapx-angular", "--input", "depthmapx-angular.csv"], io);
  assert.equal(code, 0);
  const report = JSON.parse(stdout.join(""));
  assert.equal(report.status, "pass");
  assert.equal(report.comparisons.tulipChoice.count, 2);
});
