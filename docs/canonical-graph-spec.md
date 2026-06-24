# Canonical Graph Specification

## Minimal Segment Record

Each segment must have:

| Field | Type | Meaning |
| --- | --- | --- |
| `segment_id` | integer | Stable segment row/id. |
| `source` | integer | Source/topological node id. |
| `target` | integer | Target/topological node id. |
| `length_m` | number | Segment length in metres. |
| `geometry` | LineString | Segment geometry. |

The website currently requires `source`, `target`, and `length_m` on FlatGeobuf features. Feature order is used as row identity for analysis columns.

## Optional Fields

Useful optional fields:

| Field | Meaning |
| --- | --- |
| `x0`, `y0`, `x1`, `y1` | Explicit endpoints for angular/routing calculations. |
| `source_dataset` | Source dataset name/version. |
| `cleaning_profile` | Named cleaning policy used to produce the model. |
| `original_feature_id` | Source feature id before canonicalisation. |
| `component_id` | Connected component id after graph construction. |

## Metadata Required For Reproducibility

Every canonical graph export should include metadata:

- input source and license;
- input CRS;
- output CRS or local display transform;
- boundary/clipping rule;
- intersection splitting rule;
- unlink/grade separation rule;
- duplicate and stub handling;
- length calculation rule;
- tool version and commit hash;
- feature count, node count, total length, and component count.

This metadata is preserved on export: GeoJSON output carries it in-band as a top-level
`metadata` foreign member (so the in-memory/GeoJSON round-trip reconstructs `graph.metadata`),
and the CLI `canonicalize` command additionally writes a sidecar `<output>.metadata.json`
manifest. FlatGeobuf bytes cannot carry the manifest in-band, so the sidecar is the
reproducibility record for the `.fgb` output.

## Current Engine Builder

The initial engine builder lives in:

```text
packages/canonicalize/src/index.ts
```

It currently supports ordinary `LineString` and `MultiLineString` feature-like inputs, intersection splitting, unlink-mask skipping for grade-separated crossings, stable node interning by tolerance, source-id preservation, source length scaling, and canonical graph metadata. FlatGeobuf and MapInfo file adapters are still separate extraction tasks.

## Why This Matters

The canonical graph is the evidence needed to reproduce a space syntax analysis. A sentence saying "the network was cleaned" is not enough, because the cleaned topology itself determines local results.
