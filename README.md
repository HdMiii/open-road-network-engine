# Open Road Network Engine

Open Road Network Engine is a TypeScript package for canonical road-network graph
construction, centrality analysis, shortest-path routing, validation, and website
adapter integration.

The engine addresses the **modifiable model problem**: a cleaned road network is not
a neutral derivative of a source dataset. Different source data, cleaning rules,
topology decisions, and analysis engines can produce networks that look globally
similar but diverge locally. This package makes transformation and analysis explicit,
reproducible, testable, and reusable.

## Capabilities

1. **Canonical graph transformation**
   - Transform coordinate line networks into canonical graph records.
   - Preserve stable segment and node identifiers.
   - Record cleaning decisions and transformation metadata.

2. **Centrality analysis**
   - `dmx`: DepthmapX-style metric segment integration and choice.
   - `dmx_angular`: DepthmapX/Tulip-style angular integration and choice.
   - `pst_angular`: PST/Pstalgo-style angular integration and choice.
   - `angular`: canonical engine angular measures, including `angular_choice`.
   - API-only cityseer-style, sDNA-style, PST place-accessibility, and baseline graph measures.
   - Validation status for every method: `validated`, `compatible`, or `experimental`.

3. **Shortest distance and route calculation**
   - Metric, topological, angular, and vector route costs.
   - Radius-bounded one-to-many and all-segment searches.
   - Route outputs aligned to feature-order segment indexes.

4. **I/O and integration**
   - GeoJSON-shaped canonical graph conversion.
   - FlatGeobuf canonical graph read/write helpers.
   - Analysis column generation aligned to feature order.
   - Worker-compatible website adapter messages.

## Installation

```text
npm install open-road-network-engine
```

The supported runtime target is Node.js `>=20`.

## Package API

The root package export includes the main engine APIs:

```ts
import {
  analysisMethodCatalog,
  canonicalizeLineNetwork,
  computeAnalysisColumn,
  depthmapXMetricChoice,
  shortestRoute
} from "open-road-network-engine";
```

Subpath exports are also available:

```ts
import { validateCanonicalGraph } from "open-road-network-engine/core";
import { writeFlatGeobufCanonicalGraph } from "open-road-network-engine/io";
import { ROUTE_MODES } from "open-road-network-engine/shortest-path/route";
```

## CLI

Emit the supported website column catalog and validation status:

```text
open-road-network-engine methods --output methods.json
```

Canonicalize a GeoJSON line network:

```text
open-road-network-engine canonicalize --input roads.geojson --output graph.geojson
```

Compute an analysis column:

```text
open-road-network-engine analyze --input graph.geojson --column dmx_integration_r400 --output values.json
```

Check package release readiness:

```text
open-road-network-engine release-check --output release-check.json
```

## Validation And Method Claims

The engine separates implementation from scientific claims. Public methods report
their validation status as one of:

- `validated`: compared against reference outputs or hand-checkable fixtures for the declared scope.
- `compatible`: implements a documented interpretation but still needs broader reference comparison.
- `experimental`: useful for exploration, without a paper-level equivalence claim.

Reference systems are used for definitions, validation fixtures, and output comparison
only. GPL/LGPL/AGPL-family implementations are not copied into this package.

## Documentation

Key documents:

- `docs/canonical-graph-spec.md`

## License

MIT. See `LICENSE`.
