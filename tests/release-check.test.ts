import assert from "node:assert/strict";
import test from "node:test";
import { checkReleaseReadiness } from "open-road-network-engine/release";

test("release readiness checker flags placeholder publication metadata", () => {
  const report = checkReleaseReadiness({
    packageJsonText: JSON.stringify({
      name: "open-road-network-engine",
      version: "0.0.0",
      type: "module",
      exports: { ".": "./src/index.ts" },
      bin: { "open-road-network-engine": "./packages/cli/src/index.ts" },
      files: ["src", "packages", "docs", "README.md"],
      engines: { node: ">=24" }
    }),
    licenseFilePresent: false
  });

  assert.equal(report.status, "review");
  assert.equal(report.checks.publishable, true);
  assert.equal(report.checks.versionSet, false);
  assert.equal(report.checks.licenseDeclared, false);
  assert.equal(report.checks.licenseFilePresent, false);
  assert.equal(report.checks.builtExportsDeclared, false);
  assert.equal(report.checks.noRawTypeScriptEntrypoints, false);
  assert.equal(report.checks.nodeEngineReasonable, false);
  assert.equal(report.issues.some((issue) => issue.code === "placeholder-version"), true);
  assert.equal(report.issues.some((issue) => issue.code === "missing-license-field"), true);
  assert.equal(report.issues.some((issue) => issue.code === "missing-license-file"), true);
  assert.equal(report.issues.some((issue) => issue.code === "raw-source-exports"), true);
  assert.equal(report.issues.some((issue) => issue.code === "raw-typescript-entrypoints"), true);
  assert.equal(report.issues.some((issue) => issue.code === "node-engine-too-strict"), true);
});

test("release readiness checker passes complete publication metadata", () => {
  const report = checkReleaseReadiness({
    packageJsonText: JSON.stringify({
      name: "open-road-network-engine",
      version: "0.1.0-alpha",
      license: "MIT",
      exports: {
        ".": {
          types: "./dist/src/index.d.ts",
          import: "./dist/src/index.js"
        }
      },
      bin: { "open-road-network-engine": "./dist/packages/cli/src/index.js" },
      files: ["dist", "docs", "README.md", "LICENSE"],
      engines: { node: ">=20" }
    }),
    licenseFilePresent: true
  });

  assert.equal(report.status, "pass");
  assert.equal(report.checks.builtExportsDeclared, true);
  assert.equal(report.checks.noRawTypeScriptEntrypoints, true);
  assert.equal(report.checks.nodeEngineReasonable, true);
  assert.deepEqual(report.issues, []);
});
