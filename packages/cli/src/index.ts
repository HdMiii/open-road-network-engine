#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { canonicalizeLineNetwork, type InputLineFeature } from "../../canonicalize/src/index.ts";
import type { CanonicalGraph } from "../../core/src/index.ts";
import {
  canonicalGraphToFeatureCollection,
  featureCollectionToCanonicalGraph,
  readFlatGeobufCanonicalGraph,
  writeFlatGeobufCanonicalGraph,
  type GeoJsonFeatureCollection
} from "../../io/src/index.ts";
import { validateDepthmapXSegmentAngularCsv, validateDepthmapXSegmentMetricCsv } from "../../validation/src/depthmapx.ts";
import { validateCityseerDiamondFixture } from "../../validation/src/cityseer.ts";
import { analysisMethodCatalog, computeAnalysisColumnByName } from "../../website-adapter/src/index.ts";
import { checkReleaseReadiness } from "../../release/src/index.ts";

export interface CliIo {
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: string | Uint8Array): Promise<void>;
  stdout: Pick<typeof process.stdout, "write">;
  stderr: Pick<typeof process.stderr, "write">;
}

export async function runCli(args: readonly string[], io: CliIo = defaultIo()): Promise<number> {
  const [command, ...rest] = args;
  try {
    if (command === "canonicalize") {
      await runCanonicalize(rest, io);
      return 0;
    }
    if (command === "analyze") {
      await runAnalyze(rest, io);
      return 0;
    }
    if (command === "methods") {
      await runMethods(rest, io);
      return 0;
    }
    if (command === "release-check") {
      await runReleaseCheck(rest, io);
      return 0;
    }
    if (command === "validate-depthmapx") {
      await runValidateDepthmapX(rest, io);
      return 0;
    }
    if (command === "validate-depthmapx-angular") {
      await runValidateDepthmapXAngular(rest, io);
      return 0;
    }
    if (command === "validate-cityseer") {
      await runValidateCityseer(rest, io);
      return 0;
    }
    if (command === "help" || command === "--help" || command === undefined) {
      io.stdout.write(usage());
      return command === undefined ? 1 : 0;
    }
    throw new Error(`Unknown command: ${command}`);
  } catch (error) {
    io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    io.stderr.write(usage());
    return 1;
  }
}

async function runCanonicalize(args: readonly string[], io: CliIo): Promise<void> {
  const flags = parseFlags(args);
  const input = requiredFlag(flags, "input");
  const output = requiredFlag(flags, "output");
  const format = optionalFlag(flags, "format") ?? inferOutputFormat(output);
  const collection = parseJson(await readText(io, input)) as GeoJsonFeatureCollection;
  const result = canonicalizeLineNetwork(featureCollectionToInputFeatures(collection), {
    splitIntersections: !flags.has("no-split-intersections"),
    preserveSourceIds: flags.has("preserve-source-ids"),
    sourceDataset: optionalFlag(flags, "source-dataset"),
    cleaningProfile: optionalFlag(flags, "cleaning-profile"),
    inputCrs: optionalFlag(flags, "input-crs"),
    outputCrs: optionalFlag(flags, "output-crs"),
    endStubMinRatio: optionalNumberFlag(flags, "end-stub-min-ratio")
  });

  if (format === "fgb") {
    await io.writeFile(output, writeFlatGeobufCanonicalGraph(result.graph));
  } else if (format === "geojson" || format === "json") {
    await io.writeFile(output, `${JSON.stringify(canonicalGraphToFeatureCollection(result.graph), null, 2)}\n`);
  } else {
    throw new Error(`Unsupported canonicalize output format: ${format}`);
  }

  // Always emit the reproducibility metadata as a sidecar JSON manifest, since FlatGeobuf
  // bytes cannot carry it in-band and the website contract lists "metadata JSON" as an output.
  const metadataOutput = optionalFlag(flags, "metadata-output") ?? `${output}.metadata.json`;
  await io.writeFile(metadataOutput, `${JSON.stringify(result.metadata, null, 2)}\n`);
}

async function runAnalyze(args: readonly string[], io: CliIo): Promise<void> {
  const flags = parseFlags(args);
  const input = requiredFlag(flags, "input");
  const column = requiredFlag(flags, "column");
  const output = optionalFlag(flags, "output");
  const graph = await readCanonicalGraph(io, input);
  const result = computeAnalysisColumnByName(graph, column);
  const body = `${JSON.stringify({
    column: result.column,
    rowHash: result.rowHash,
    featureCount: result.featureCount,
    methodMetadata: result.methodMetadata,
    values: [...result.values]
  }, null, 2)}\n`;

  if (output) {
    await io.writeFile(output, body);
  } else {
    io.stdout.write(body);
  }
}

async function runMethods(args: readonly string[], io: CliIo): Promise<void> {
  const flags = parseFlags(args);
  const output = optionalFlag(flags, "output");
  const body = `${JSON.stringify({
    radii: [400, 600, 800, 1000, 1200, 1400, 1600, 1800, 2000],
    methods: analysisMethodCatalog()
  }, null, 2)}\n`;
  if (output) {
    await io.writeFile(output, body);
  } else {
    io.stdout.write(body);
  }
}

async function runReleaseCheck(args: readonly string[], io: CliIo): Promise<void> {
  const flags = parseFlags(args);
  const output = optionalFlag(flags, "output");
  const packageJsonPath = optionalFlag(flags, "package") ?? "package.json";
  const licensePath = optionalFlag(flags, "license-file") ?? "LICENSE";
  let licenseFilePresent = true;
  try {
    await io.readFile(licensePath);
  } catch {
    licenseFilePresent = false;
  }
  const report = checkReleaseReadiness({
    packageJsonText: await readText(io, packageJsonPath),
    licenseFilePresent
  });
  const body = `${JSON.stringify(report, null, 2)}\n`;
  if (output) {
    await io.writeFile(output, body);
  } else {
    io.stdout.write(body);
  }
}

async function runValidateDepthmapX(args: readonly string[], io: CliIo): Promise<void> {
  const flags = parseFlags(args);
  const input = requiredFlag(flags, "input");
  const output = optionalFlag(flags, "output");
  const radius = parseRadius(optionalFlag(flags, "radius") ?? "n");
  const report = validateDepthmapXSegmentMetricCsv(await readText(io, input), {
    radius,
    meanDepthColumn: optionalFlag(flags, "mean-depth-column"),
    choiceColumn: optionalFlag(flags, "choice-column")
  });
  const body = `${JSON.stringify(report, null, 2)}\n`;
  if (output) {
    await io.writeFile(output, body);
  } else {
    io.stdout.write(body);
  }
}

async function runValidateDepthmapXAngular(args: readonly string[], io: CliIo): Promise<void> {
  const flags = parseFlags(args);
  const input = requiredFlag(flags, "input");
  const output = optionalFlag(flags, "output");
  const radius = parseRadius(optionalFlag(flags, "radius") ?? "n");
  const report = validateDepthmapXSegmentAngularCsv(await readText(io, input), {
    radius,
    meanDepthColumn: optionalFlag(flags, "mean-depth-column"),
    integrationColumn: optionalFlag(flags, "integration-column"),
    choiceColumn: optionalFlag(flags, "choice-column")
  });
  const body = `${JSON.stringify(report, null, 2)}\n`;
  if (output) {
    await io.writeFile(output, body);
  } else {
    io.stdout.write(body);
  }
}

async function runValidateCityseer(args: readonly string[], io: CliIo): Promise<void> {
  const flags = parseFlags(args);
  const output = optionalFlag(flags, "output");
  const body = `${JSON.stringify(validateCityseerDiamondFixture(), null, 2)}\n`;
  if (output) {
    await io.writeFile(output, body);
  } else {
    io.stdout.write(body);
  }
}

async function readCanonicalGraph(io: CliIo, path: string): Promise<CanonicalGraph> {
  const bytes = await io.readFile(path);
  if (path.toLowerCase().endsWith(".fgb")) {
    return (await readFlatGeobufCanonicalGraph(bytes)).graph;
  }
  return featureCollectionToCanonicalGraph(parseJson(new TextDecoder().decode(bytes)) as GeoJsonFeatureCollection).graph;
}

function featureCollectionToInputFeatures(collection: GeoJsonFeatureCollection): InputLineFeature[] {
  if (collection.type !== "FeatureCollection" || !Array.isArray(collection.features)) {
    throw new Error("Input must be a GeoJSON FeatureCollection.");
  }
  return collection.features.map((feature, index) => {
    if (feature.geometry?.type !== "LineString" && feature.geometry?.type !== "MultiLineString") {
      throw new Error(`Feature ${index} must be LineString or MultiLineString.`);
    }
    return {
      id: feature.id ?? index,
      geometry: feature.geometry as InputLineFeature["geometry"],
      properties: feature.properties ?? {}
    };
  });
}

function parseFlags(args: readonly string[]): Map<string, string | true> {
  const flags = new Map<string, string | true>();
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) throw new Error(`Unexpected positional argument: ${arg}`);
    const eq = arg.indexOf("=");
    if (eq !== -1) {
      flags.set(arg.slice(2, eq), arg.slice(eq + 1));
      continue;
    }
    const key = arg.slice(2);
    const next = args[i + 1];
    if (next === undefined || next.startsWith("--")) {
      flags.set(key, true);
    } else {
      flags.set(key, next);
      i += 1;
    }
  }
  return flags;
}

function requiredFlag(flags: Map<string, string | true>, key: string): string {
  const value = optionalFlag(flags, key);
  if (!value) throw new Error(`Missing required --${key}.`);
  return value;
}

function optionalFlag(flags: Map<string, string | true>, key: string): string | undefined {
  const value = flags.get(key);
  return typeof value === "string" ? value : undefined;
}

function optionalNumberFlag(flags: Map<string, string | true>, key: string): number | undefined {
  const value = optionalFlag(flags, key);
  if (value === undefined) return undefined;
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) throw new Error(`--${key} must be numeric.`);
  return numberValue;
}

async function readText(io: CliIo, path: string): Promise<string> {
  return new TextDecoder().decode(await io.readFile(path));
}

async function readOptionalText(io: CliIo, path: string): Promise<string | undefined> {
  try {
    return await readText(io, path);
  } catch {
    return undefined;
  }
}

function joinPath(base: string, child: string): string {
  return `${base.replace(/\/$/, "")}/${child}`;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON input: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function inferOutputFormat(path: string): string {
  return path.toLowerCase().endsWith(".fgb") ? "fgb" : "geojson";
}

function parseRadius(value: string): number {
  if (value === "n" || value === "global" || value === "Infinity") return Number.POSITIVE_INFINITY;
  const radius = Number(value);
  if (!Number.isFinite(radius) || radius <= 0) throw new Error("--radius must be n/global or a positive number.");
  return radius;
}

function usage(): string {
  return `Usage:
  open-road-network-engine canonicalize --input roads.geojson --output graph.geojson [--format geojson|fgb]
  open-road-network-engine analyze --input graph.geojson --column dmx_integration_r400 [--output values.json]
  open-road-network-engine methods [--output methods.json]
  open-road-network-engine release-check [--output release-check.json]
  open-road-network-engine validate-depthmapx --input depthmapx_segment_metric.csv [--radius n] [--output report.json]
  open-road-network-engine validate-depthmapx-angular --input depthmapx_segment_angular.csv [--radius n] [--output report.json]
  open-road-network-engine validate-cityseer [--output report.json]
`;
}

function defaultIo(): CliIo {
  return {
    readFile,
    writeFile: async (path, data) => {
      await writeFile(path, data);
    },
    stdout: process.stdout,
    stderr: process.stderr
  };
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  process.exitCode = await runCli(process.argv.slice(2));
}

function isCliEntrypoint(moduleUrl: string, argvPath: string | undefined): boolean {
  if (!argvPath) return false;
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(argvPath);
  } catch {
    return false;
  }
}
