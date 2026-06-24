export type ReleaseReadinessStatus = "pass" | "review";

export interface ReleaseReadinessIssue {
  code: string;
  severity: "error" | "warning";
  message: string;
}

export interface ReleaseReadinessReport {
  status: ReleaseReadinessStatus;
  packageName: string;
  version: string;
  issues: ReleaseReadinessIssue[];
  checks: {
    publishable: boolean;
    versionSet: boolean;
    licenseDeclared: boolean;
    licenseFilePresent: boolean;
    exportsDeclared: boolean;
    binDeclared: boolean;
    filesAllowlistDeclared: boolean;
    nodeEngineDeclared: boolean;
    builtExportsDeclared: boolean;
    noRawTypeScriptEntrypoints: boolean;
    nodeEngineReasonable: boolean;
  };
}

export interface ReleaseReadinessInput {
  packageJsonText: string;
  licenseFilePresent?: boolean;
}

interface PackageJsonShape {
  name?: unknown;
  version?: unknown;
  private?: unknown;
  license?: unknown;
  exports?: unknown;
  bin?: unknown;
  files?: unknown;
  engines?: unknown;
}

export function checkReleaseReadiness(input: ReleaseReadinessInput): ReleaseReadinessReport {
  const packageJson = parsePackageJson(input.packageJsonText);
  const packageName = typeof packageJson.name === "string" ? packageJson.name : "";
  const version = typeof packageJson.version === "string" ? packageJson.version : "";
  const issues: ReleaseReadinessIssue[] = [];
  const checks = {
    publishable: packageJson.private !== true,
    versionSet: version !== "" && version !== "0.0.0",
    licenseDeclared: typeof packageJson.license === "string" && packageJson.license.trim() !== "",
    licenseFilePresent: input.licenseFilePresent === true,
    exportsDeclared: hasObject(packageJson.exports) && Object.prototype.hasOwnProperty.call(packageJson.exports, "."),
    binDeclared: hasObject(packageJson.bin) && Object.prototype.hasOwnProperty.call(packageJson.bin, "open-road-network-engine"),
    filesAllowlistDeclared: Array.isArray(packageJson.files) && includesAll(packageJson.files, ["dist", "docs", "README.md", "LICENSE"]),
    nodeEngineDeclared: hasObject(packageJson.engines) && typeof packageJson.engines.node === "string",
    builtExportsDeclared: packageExportsPointToDist(packageJson.exports),
    noRawTypeScriptEntrypoints: noRawTypeScriptEntrypoints(packageJson),
    nodeEngineReasonable: hasObject(packageJson.engines) &&
      typeof packageJson.engines.node === "string" &&
      packageJson.engines.node.trim() !== ">=24"
  };

  if (!packageName) {
    issues.push({ code: "missing-name", severity: "error", message: "package.json must declare a package name." });
  }
  if (!checks.publishable) {
    issues.push({ code: "private-package", severity: "error", message: "package.json private must not be true for a public release." });
  }
  if (!checks.versionSet) {
    issues.push({ code: "placeholder-version", severity: "error", message: "Set a real initial version instead of 0.0.0." });
  }
  if (!checks.licenseDeclared) {
    issues.push({ code: "missing-license-field", severity: "error", message: "Declare the chosen project license in package.json." });
  }
  if (!checks.licenseFilePresent) {
    issues.push({ code: "missing-license-file", severity: "error", message: "Add a LICENSE file matching the chosen project license." });
  }
  if (!checks.exportsDeclared) {
    issues.push({ code: "missing-exports", severity: "error", message: "Declare package exports for public API imports." });
  }
  if (!checks.binDeclared) {
    issues.push({ code: "missing-bin", severity: "error", message: "Declare the open-road-network-engine CLI bin." });
  }
  if (!checks.filesAllowlistDeclared) {
    issues.push({ code: "missing-files-allowlist", severity: "warning", message: "Declare a package files allowlist for dist, docs, README.md, and LICENSE." });
  }
  if (!checks.nodeEngineDeclared) {
    issues.push({ code: "missing-node-engine", severity: "warning", message: "Declare the supported Node.js engine range." });
  }
  if (!checks.builtExportsDeclared) {
    issues.push({ code: "raw-source-exports", severity: "error", message: "Package exports should point to built dist/ JavaScript with declaration files, not raw source files." });
  }
  if (!checks.noRawTypeScriptEntrypoints) {
    issues.push({ code: "raw-typescript-entrypoints", severity: "error", message: "Package exports and bin entries must not point at raw .ts files." });
  }
  if (checks.nodeEngineDeclared && !checks.nodeEngineReasonable) {
    issues.push({ code: "node-engine-too-strict", severity: "warning", message: "Prefer a broadly deployable Node.js range such as >=20 or >=22 instead of >=24." });
  }

  return {
    status: issues.some((issue) => issue.severity === "error") ? "review" : "pass",
    packageName,
    version,
    issues,
    checks
  };
}

function parsePackageJson(text: string): PackageJsonShape {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!hasObject(parsed)) throw new Error("package.json root must be an object.");
    return parsed as PackageJsonShape;
  } catch (error) {
    throw new Error(`Invalid package.json: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function hasObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function includesAll(values: unknown[], required: readonly string[]): boolean {
  return required.every((requiredValue) => values.includes(requiredValue));
}

function packageExportsPointToDist(exportsField: unknown): boolean {
  if (!hasObject(exportsField)) return false;
  const rootExport = exportsField["."];
  return exportTargets(exportsField).length > 0 &&
    exportTargets(rootExport).some((target) => target.startsWith("./dist/") && target.endsWith(".js")) &&
    exportTargets(rootExport).some((target) => target.startsWith("./dist/") && target.endsWith(".d.ts")) &&
    exportTargets(exportsField).every((target) => target.startsWith("./dist/"));
}

function noRawTypeScriptEntrypoints(packageJson: PackageJsonShape): boolean {
  const targets = [
    ...exportTargets(packageJson.exports),
    ...binTargets(packageJson.bin)
  ];
  return targets.length > 0 && targets.every((target) => !target.endsWith(".ts") || target.endsWith(".d.ts"));
}

function exportTargets(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!hasObject(value)) return [];
  const targets: string[] = [];
  for (const child of Object.values(value)) targets.push(...exportTargets(child));
  return targets;
}

function binTargets(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!hasObject(value)) return [];
  return Object.values(value).filter((target): target is string => typeof target === "string");
}
