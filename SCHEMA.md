# StackStudio Project Schema

The full reference for the JSON document StackStudio reads and writes. A
project is a single JSON object; File → Save exports it verbatim and File →
Open imports it. Older documents are upgraded automatically on load (see
[Migrations](#migrations)).

> Notation: `field: type` with `?` marking optional fields. Enums list the
> allowed string values. Defaults are noted in parentheses.

---

## Project (root object)

```jsonc
{
  "name": "My System",              // string — project title
  "avgTransactionValue": 49,        // number? — AOV for % costs (default 50)
  "layers": [ Layer, ... ],         // Layer[] — top-level nodes
  "usePaths": [ Action, ... ],      // Action[]? — traced operations
  "diagramPositions": {             // map? — persisted diagram node positions
    "<nodeId>": { "x": 200, "y": 200 }
  }
}
```

| Field | Type | Notes |
|-------|------|-------|
| `name` | string | Shown in the title bar; used for the export filename. |
| `avgTransactionValue` | number? | Average transaction value used to evaluate percentage-of-value costs (Gap 4). Defaults to `50`. Editable in the Cost dashboard. |
| `layers` | Layer[] | The stack's top-level nodes. |
| `usePaths` | Action[]? | Named operations traced through the stack. May be absent. |
| `diagramPositions` | object? | `{ nodeId: {x, y} }` — manual node positions from the diagram, so a dragged layout survives reload. Keys are stringified node ids. |

---

## Layer (and Substack)

Layers are the nodes of the stack. A layer may contain `substacks`, which are
the **same shape minus their own `substacks`** (nesting is currently one level
deep — see the schema-gaps note on recursive substacks).

```jsonc
{
  "id": 1,                          // number | string — unique node id
  "name": "API Gateway",            // string
  "type": "API",                    // LayerType enum
  "status": "Active",               // LayerStatus enum
  "technology": "Express.js",       // string?
  "description": "...",             // string?
  "responsibilities": "...",        // string?
  "connections": [ Connection ],    // Connection[]
  "dependencies": [],               // (number|string)[]? — reserved, unused by UI
  "visible": true,                  // boolean?
  "locked": false,                  // boolean?
  "costModel": CostModel,           // CostModel?
  "substacks": [ Substack ]         // Substack[]? — top-level layers only
}
```

| Field | Type | Notes |
|-------|------|-------|
| `id` | number \| string | Unique within the project. Substacks conventionally use `"<parentId>_<n>"` (e.g. `"1_2"`). |
| `name` | string | Display name. |
| `type` | LayerType | Drives color and diagram shape. See [Layer types](#layer-types). |
| `status` | LayerStatus | Lifecycle state. See [Layer statuses](#layer-statuses). |
| `technology` | string? | Free text (e.g. `"PostgreSQL 16"`). |
| `description` | string? | Long-form notes. |
| `responsibilities` | string? | What the node is responsible for. |
| `connections` | Connection[] | Outgoing edges. See [Connection](#connection). |
| `dependencies` | (number\|string)[]? | Reserved; not currently rendered. |
| `visible` | boolean? | Reserved for show/hide. |
| `locked` | boolean? | Reserved for edit-locking. |
| `costModel` | CostModel? | Cost inputs. See [CostModel](#costmodel). |
| `substacks` | Substack[]? | Nested child nodes. Only valid on top-level layers. |

### Layer types

`type` is one of:

| Value | Color | Diagram shape | Cost rollup |
|-------|-------|---------------|-------------|
| `Core` | blue | rectangle | included |
| `Frontend` | green | rectangle | included |
| `Backend` | amber | rectangle | included |
| `Database` | violet | cylinder | included |
| `DevOps` | red | cloud | included |
| `API` | cyan | hexagon | included |
| `Actor` | pink | rounded box + person glyph | **excluded** (external) |
| `External` | gray | rectangle | **excluded** (external) |
| `Other` | slate | rectangle | included |

`Actor` and `External` represent people / third-party systems you don't own or
pay for; they are excluded from cost rollups by default (`isActorType()`).

### Layer statuses

`status` is one of:

| Value | Meaning | Visual | Current-state cost |
|-------|---------|--------|--------------------|
| `Active` | Live | normal | included |
| `Inactive` | Disabled | status pill | included |
| `Deprecated` | Being retired | status pill | included |
| `Planned` | Designed, not built | dashed border, muted, pill | **excluded** |
| `Proposed` | Under consideration | dashed border, muted, pill | **excluded** |

`Planned`/`Proposed` are *future* statuses (`isFutureStatus()`). They are
excluded from the Cost dashboard's "Current" scope and included in "Projected".

---

## Connection

An outgoing edge from a node. Stored as an object (the canonical form).

```jsonc
{
  "targetId": 2,                    // number | string — id of the target node
  "type": "HTTP",                   // ConnectionType enum (default "HTTP")
  "label": "custom_id + amount"     // string? — what flows across the edge
}
```

| Field | Type | Notes |
|-------|------|-------|
| `targetId` | number \| string | Must match a node `id` anywhere in the project (layer or substack). |
| `type` | ConnectionType | Transport/semantics; drives line style + label. |
| `label` | string? | Free-text payload description (Gap 6). Rendered on the diagram edge (brighter than the type label) and in the hover tooltip. |

### Connection types

`type` is one of: `HTTP`, `gRPC`, `Event`, `Database`, `Cache`, `Message`,
`Sync`, `Async`. Each has its own color and dash pattern. Unknown values fall
back to `HTTP`.

---

## CostModel

Attached to a layer or substack. All fields optional; absent = free.

```jsonc
{
  "currency": "USD",                // CostCurrency (default "USD")
  "period": "month",                // "month" | "year" (default "month")
  "fixedCost": 400,                 // number — recurring cost per period
  "fixedCostDescription": "...",    // string? — what the fixed cost covers
  "variableCost": 0.00002,          // number — cost per unit of use
  "variableUnit": "per-request",    // VariableUnit enum
  "percentageCost": 2.9,            // number? — percent of transaction value
  "percentageFixed": 0.30,          // number? — flat fee added per transaction
  "notes": "..."                    // string?
}
```

| Field | Type | Notes |
|-------|------|-------|
| `currency` | CostCurrency | `USD`, `EUR`, `GBP`, `JPY`, `AUD`, `CAD`. |
| `period` | enum | `month` or `year` — the period for `fixedCost`. |
| `fixedCost` | number | Recurring infrastructure cost per `period`. |
| `fixedCostDescription` | string? | Human note on what the fixed cost covers. |
| `variableCost` | number | Per-use cost, in `currency`, at the `variableUnit`. |
| `variableUnit` | VariableUnit | Unit basis (see below). |
| `percentageCost` | number? | **Gap 4.** Percent of transaction value (e.g. `2.9` = 2.9%). Evaluated against the project `avgTransactionValue`. |
| `percentageFixed` | number? | **Gap 4.** Flat per-transaction fee added to the percentage (e.g. `0.30`). |
| `notes` | string? | Free text. |

**Percentage cost evaluation** (`evaluatePercentageCost`):

```
perTransaction = (percentageCost / 100) × avgTransactionValue + percentageFixed
```

Example: PayPal at `3.49% + $0.49` with AOV `$50` → `(3.49/100)×50 + 0.49 = $2.235` per transaction.

### Variable units

`variableUnit` is one of: `per-request`, `per-call`, `per-gb-month`,
`per-gb-transferred`, `per-log-entry`, `per-indexed-item`, `per-gb-second`,
`per-vcpu-hour`, `per-read`, `per-write`, `per-use`, and the synthetic
`per-transaction` (emitted internally for percentage costs). Legacy `per-1M-*`
units are converted to per-use on load.

---

## Action (usePath)

A named operation traced through the stack — what it touches and what it costs.
Lives in the project's `usePaths` array.

```jsonc
{
  "id": "action-1",                 // string — unique action id
  "name": "Checkout Flow",          // string
  "description": "...",             // string?
  "layersInvolved": [1001, 1002],   // (number|string)[] — ordered node ids
  "avgCallsPerLayer": {             // map — calls to each node per run
    "1001": 1, "1002": 2
  },
  "notes": "...",                   // string?
  "source": "manual"                // "manual" | "imported"?
}
```

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | Unique within `usePaths`. |
| `name` | string | Shown in the Actions list and the diagram path banner. |
| `description` | string? | What the operation does. |
| `layersInvolved` | (number\|string)[] | Ordered node ids the operation passes through. Selecting the action highlights this path on the diagram. |
| `avgCallsPerLayer` | object | `{ nodeId: callsPerRun }` — feeds cost-per-operation math. |
| `notes` | string? | Free text. |
| `source` | enum? | `manual` (hand-built) or `imported` (generated from connections). |

> A richer ordered-`steps[]` model (each step naming the connection it
> traverses) is migrated toward internally but the editing UI still uses
> `layersInvolved` + `avgCallsPerLayer`.

---

## Migrations

`migrateProject()` upgrades older documents on load. It is idempotent and
preserves unknown-but-known fields:

1. **Connections** → canonical `{ targetId, type, label? }` objects. Bare-id
   arrays and the legacy `connectionTypes` side-table are converted; `label`
   is preserved.
2. **Use paths** → ensures the step/cost fields exist.
3. **Cost models** → legacy `per-1M-*` units converted to per-use;
   `percentageCost` / `percentageFixed` / `fixedCostDescription` preserved.
4. **Project** → ensures `avgTransactionValue` exists (default 50).

---

## Worked example

A payment-processing substack with a percentage cost and a labeled edge:

```jsonc
{
  "id": "1003_1",
  "name": "Billing Module",
  "type": "Backend",
  "status": "Active",
  "technology": "Stripe SDK",
  "connections": [
    { "targetId": 1006, "type": "Database", "label": "writes invoices" }
  ],
  "costModel": {
    "currency": "USD", "period": "month",
    "fixedCost": 0, "variableCost": 0,
    "percentageCost": 2.9, "percentageFixed": 0.30,
    "notes": "Stripe: 2.9% + $0.30 per charge."
  }
}
```

---

*Schema reference for StackStudio. Update this file alongside any change to the
data model in `static/js/data.js`.*
