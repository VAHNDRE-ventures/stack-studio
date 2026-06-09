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
  "groupOrder": [ "Phase A", ... ], // string[]? — phase/lane order for Flow view
  "diagramPositions": {             // map? — persisted diagram node positions
    "<nodeId>": { "x": 200, "y": 200 }
  }
}
```

| Field | Type | Notes |
|-------|------|-------|
| `name` | string | Shown in the title bar; used for the export filename. |
| `avgTransactionValue` | number? | Average transaction value used to evaluate percentage-of-value costs. Defaults to `50`. Editable in the Cost dashboard. |
| `layers` | Layer[] | The stack's top-level nodes. |
| `usePaths` | Action[]? | Named operations traced through the stack. May be absent. |
| `groupOrder` | string[]? | Ordered list of phase/lane names, top→bottom, for the diagram's **Flow layout** (see [Flow View](#flow-view)). Matched against `Layer.group` by exact string equality. Required for phase banding — without it the Flow view shows no lanes. Typically set by the Mermaid importer from subgraph declaration order. |
| `diagramPositions` | object? | `{ nodeId: {x, y} }` — manual node positions from the diagram, so a dragged layout survives reload. Written by node drag, group drag, snap, and auto-arrange. Keys are stringified node ids. |

---

## Layer (and Substack)

Layers are the nodes of the stack. A layer may contain `substacks`, which are
**the same shape** — and substacks may themselves contain `substacks`, to any
depth (n-level nesting). The diagram lays each level out to the right of its
parent with nested grouping boxes; the details panel drills in with a
breadcrumb.

```jsonc
{
  "id": 1,                          // number | string — unique node id
  "name": "API Gateway",            // string
  "type": "API",                    // LayerType enum
  "status": "Active",               // LayerStatus enum
  "technology": "Express.js",       // string?
  "description": "...",             // string?
  "responsibilities": "...",        // string?
  "group": "3 · Ingestion",         // string? — phase/lane label (Flow view)
  "connections": [ Connection ],    // Connection[]
  "dependencies": [],               // (number|string)[]? — reserved, unused by UI
  "visible": true,                  // boolean?
  "locked": false,                  // boolean?
  "costModel": CostModel,           // CostModel?
  "substacks": [ Substack ]         // Substack[]? — recursive, any depth
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
| `group` | string? | Phase/lane label for the **Flow layout** (see [Flow View](#flow-view)). Nodes sharing the exact same `group` string band together; the band's position comes from `groupOrder`. Pure metadata — creates no node, carries no cost, unrelated to `substacks`. Set by the Mermaid importer from `subgraph` titles. |
| `connections` | Connection[] | Outgoing edges. See [Connection](#connection). |
| `dependencies` | (number\|string)[]? | Reserved; not currently rendered. |
| `visible` | boolean? | Reserved for show/hide. |
| `locked` | boolean? | Reserved for edit-locking. |
| `costModel` | CostModel? | Cost inputs. See [CostModel](#costmodel). |
| `substacks` | Substack[]? | Nested child nodes, recursive to any depth. |

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
| `label` | string? | Free-text payload description ("what flows here"). Rendered on the diagram edge (brighter than the type label) and in the hover tooltip. |

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
| `percentageCost` | number? | Percent of transaction value (e.g. `2.9` = 2.9%). Evaluated against the project `avgTransactionValue`. |
| `percentageFixed` | number? | Flat per-transaction fee added to the percentage (e.g. `0.30`). |
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
  "source": "manual"                // string? — "imported" groups separately; any other value is treated as manual/authored
}
```

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | Unique within `usePaths`. |
| `name` | string | Shown in the Actions list and the diagram action-path dropdown. |
| `description` | string? | What the operation does. |
| `layersInvolved` | (number\|string)[] | Ordered node ids the operation passes through. Selecting the action highlights this path on the diagram. |
| `avgCallsPerLayer` | object? | `{ nodeId: callsPerRun }` — feeds cost-per-operation math. Normalized on load (1 per involved layer) if absent. |
| `notes` | string? | Free text. |
| `source` | string? | Grouping hint for the Actions list. `imported` (generated from connections) gets its own section; **any other value** (`manual`, `curated`, absent, …) is shown as manual/authored. |

> A richer ordered-`steps[]` model (each step naming the connection it
> traverses) is migrated toward internally but the editing UI still uses
> `layersInvolved` + `avgCallsPerLayer`.

---

## Flow View

The diagram has two layout modes. The **Stack** layout (the default) uses
`substacks` for composition — a node *contains* its children, drawn nested in
group boxes. The **Flow** layout renders the project as a layered process graph
(top→bottom, like a Mermaid `flowchart TD`) and is driven by two fields only:
`Layer.group` on each node and the project-level `groupOrder` array.

This section documents **exactly** what those two fields must contain for the
Flow view to render as intended. No other field affects Flow layout.

### The two fields that drive Flow

```jsonc
{
  "groupOrder": [                     // string[] — ordered phase/lane names
    "1 · Source",
    "2 · Ingest",
    "3 · Store"
  ],
  "layers": [
    { "id": "src1", "name": "Telemetry API", "group": "1 · Source",
      "connections": [ { "targetId": "ing1", "type": "HTTP" } ] },
    { "id": "ing1", "name": "Normalizer", "group": "2 · Ingest",
      "connections": [ { "targetId": "store1", "type": "HTTP" } ] },
    { "id": "store1", "name": "Data Store", "group": "3 · Store",
      "connections": [] }
  ]
}
```

#### `Layer.group` (string, optional)

- The **exact** lane label a node belongs to. It is matched against
  `groupOrder` by **case-sensitive string equality** — `"2 · Ingest"` and
  `"2 · ingest"` are different lanes.
- A node with no `group`, an empty-string `group`, or a `group` **not present
  in `groupOrder`** is treated as **ungrouped**: it is placed in a catch-all
  region **below** all named phases. Ungrouped nodes are positioned but get
  **no visible band** drawn around them (only named phases render a lane).
- `group` is metadata only. It creates **no node**, has **no cost**, and is
  unrelated to `substacks`. A Flow project should be **flat** — every node a
  top-level entry in `layers` with a `group`, and `substacks` empty.
- Two nodes with the same `group` string are in the same lane. Lane membership
  is purely this string match; node `id`, `type`, and order in `layers` do not
  affect which lane a node lands in.

#### `Project.groupOrder` (string[], optional)

- The **ordered** list of lane labels, top to bottom. Lane *N* renders above
  lane *N+1*. This array is the **single source of truth for phase order** —
  the order nodes appear in `layers` is ignored for banding.
- Only labels that (a) appear in `groupOrder` **and** (b) are the `group` of at
  least one node produce a band. A label in `groupOrder` with **no member
  nodes** produces **no band and no empty space** (it is skipped).
- A node whose `group` is **not** in `groupOrder` is ungrouped (placed in the
  catch-all region below the lanes, no band drawn), regardless of `groupOrder`
  contents.
- If `groupOrder` is absent or empty, **no phase banding occurs** even if nodes
  carry `group` values — the Flow view falls back to pure edge-rank layout with
  no lanes. To get banded lanes you **must** provide `groupOrder`.

### Exact trigger conditions

Two distinct checks govern Flow behavior. They are not the same:

| Behavior | Function | Exact condition |
|----------|----------|-----------------|
| Auto-switch to Flow layout on **Open / Import** | `projectHasGroups()` | At least one node has a truthy string `group`. `groupOrder` is **not** required for this. |
| Render **phase lanes** (banding + per-phase packing) | `hasPhases` (in `computeFlowLayout`) | `groupOrder` is a non-empty array **AND** at least one node's `group` is found in `groupOrder`. |

Consequence: a project with `group` tags but **no** `groupOrder` will open in
Flow layout (auto-switch fires) but render **without lanes** (banding does not
fire). Always ship both fields together for a banded Flow diagram.

### How edges behave in Flow

Flow layout reads `connections` exactly as Stack does (see
[Connection](#connection)) — no Flow-specific connection fields. Direction and
routing are derived:

- **Rank** of a node = longest forward path from a source (`indeg === 0`) along
  `connections`. Higher rank = lower on the canvas.
- **Back-edges** (an edge that closes a cycle — its target is still being
  visited on the current depth-first path) are **excluded from ranking** so
  cycles don't loop forever, then drawn as side-routed return connectors. No
  field marks an edge as a back-edge; it is detected from the graph topology.
- When phases are active, a node's rank is **floored to its phase's position**
  in `groupOrder`, so every node in lane *N* sits below every node in lane
  *N−1* even if an edge would otherwise pull it up.
- Edge `type` and `label` render identically to Stack mode.

### What Flow does NOT use

To be unambiguous, these fields have **no effect** on Flow **placement**:
`type`, `status`, `technology`, `costModel`, `responsibilities`, `substacks`,
`dependencies`, `visible`, `locked`, `usePaths`. `type`/`status` still affect a
node's **appearance** (color, shape, dashed border) in both modes, but not its
position in Flow.

`diagramPositions` **is** still honored in Flow: after the ranked/banded layout
is computed, any saved `{x,y}` for a node is applied over it (so a manual drag
in Flow mode persists and survives a relayout, same as Stack). It does not
drive the initial Flow arrangement — `group` + `groupOrder` + `connections` do.

### Minimal valid Flow document

```jsonc
{
  "name": "Order Pipeline",
  "groupOrder": ["Intake", "Process", "Persist"],
  "layers": [
    { "id": "a", "name": "Webhook",  "type": "API",      "status": "Active",
      "group": "Intake",  "connections": [ { "targetId": "b", "type": "HTTP" } ], "substacks": [] },
    { "id": "b", "name": "Worker",   "type": "Backend",  "status": "Active",
      "group": "Process", "connections": [ { "targetId": "c", "type": "Database", "label": "upsert" } ], "substacks": [] },
    { "id": "c", "name": "Postgres", "type": "Database", "status": "Active",
      "group": "Persist", "connections": [], "substacks": [] }
  ]
}
```

This renders three stacked lanes (Intake → Process → Persist), one node each,
connected by orthogonal top→bottom edges.

---

## Stack View

The **Stack** layout is the default mode and the inverse of Flow: where Flow is
about *process order* (`group` + `groupOrder` + edges), Stack is about
**composition** — what a node *contains*. It is driven by one structural field:
`Layer.substacks`. A node owns its children; the diagram nests them, the
carousel drills into them, and costs roll up through them.

This section documents **exactly** what Stack consumes. Unlike Flow, Stack uses
almost every node field — so this is the canonical reference for an
architecture (rather than a pipeline) document.

### The field that drives Stack

```jsonc
{
  "id": 2,
  "name": "Cloudflare",
  "type": "Core",
  "substacks": [                      // Layer[] — children this node contains
    { "id": "2_1", "name": "Pages",   "type": "Frontend", "status": "Active",
      "connections": [], "substacks": [] },
    { "id": "2_2", "name": "Workers", "type": "API", "status": "Active",
      "connections": [ { "targetId": 3, "type": "Database" } ],
      "substacks": [
        { "id": "2_2_1", "name": "Auth Handler", "type": "Backend",
          "status": "Active", "connections": [], "substacks": [] }
      ] }
  ]
}
```

#### `Layer.substacks` (Layer[], optional)

- An array of **child nodes, each the exact same shape as a top-level Layer**
  (see [Layer](#layer-and-substack)). This is the only nesting mechanism;
  there is no separate "substack" type.
- **Recursive to any depth.** A substack may have its own `substacks`, which
  may have theirs, and so on. The diagram draws each level to the right of its
  parent inside a dashed group box; the details panel drills in with a
  breadcrumb showing the full ancestry.
- **Order is preserved and meaningful.** The carousel and details list render
  substacks in array order; "Move Up / Move Down" reorders this array.
- Absent or `[]` means a leaf node (no children).
- A child's `id` should be **unique across the entire project**, not just
  within its parent. The convention (and what the UI generates) is
  `"<parentId>_<n>"` — e.g. parent `2` → `"2_1"`, `"2_2"`; nested deeper →
  `"2_2_1"`. Connections reference any node by this global `id`.

### Per-node fields Stack renders

Every field below is read for **each node at every depth** (top-level layers
and substacks alike). None is Flow-specific.

| Field | Where it shows in Stack | Required? |
|-------|-------------------------|-----------|
| `id` | Identity + connection targeting + cost-badge element id | **Yes** — unique across the project |
| `name` | Carousel card, details panel, breadcrumb, substack list | **Yes** |
| `type` | Card text + the node's **color** (see [Layer types](#layer-types)) | **Yes** |
| `status` | Status pill on the card when not `Active`; dashed/muted for future statuses | **Yes** (`Active` if unsure) |
| `technology` | Properties tab (free text) | optional |
| `description` | Properties tab + node hover tooltip | optional |
| `responsibilities` | Properties tab | optional |
| `connections` | Connections tab + drawn as edges in the diagram (see [Connection](#connection)) | optional (`[]` if none) |
| `costModel` | Cost badge on the card, the stack cost banner, and the Cost dashboard (see [CostModel](#costmodel)) | optional (absent = free) |
| `substacks` | Nested cards / group boxes / drill-in (this section) | optional (`[]` = leaf) |

### Cost rollup through composition

Stack's cost model is **hierarchical** and this is the main behavioral
difference from a flat list:

- A node's displayed cost (`getLayerCostComponents`) is the sum of **its own
  `costModel` plus every descendant's `costModel`, recursively** through
  `substacks`. A parent with no `costModel` of its own still shows a badge if
  its children cost money.
- The stack cost **banner** aggregates every top-level layer's full subtree.
- `Actor` / `External` typed nodes and `Planned` / `Proposed` status nodes are
  **excluded** from the current-state rollup (see [Layer types](#layer-types)
  and [Layer statuses](#layer-statuses)). This exclusion applies at every depth.

So to model "a service that costs $5/mo and contains three free sub-modules,"
put the `costModel` on the parent and leave the children's absent — the parent
badge reads $5/mo and the children read Free.

### Fields Stack reads but does not yet surface

These are part of the schema and preserved on save, but the **Stack UI does not
currently render or edit them**: `dependencies` (reserved for a future
dependency view), `visible` (reserved show/hide), `locked` (reserved
edit-lock). They are safe to include — they round-trip untouched — but have no
visible effect in Stack today.

### Stack vs. Flow at a glance

| Concern | Stack (composition) | Flow (process) |
|---------|---------------------|----------------|
| Structural field | `substacks` (nesting) | `group` + `groupOrder` (lanes) |
| Question answered | "what is *part of* what" | "what *flows to* what" |
| Node placement | parent → children to the right, nested boxes | ranked top→bottom by `connections` |
| Edge routing | orthogonal, horizontal-major (left→right) | orthogonal, vertical-major (top→bottom) |
| `group` / `groupOrder` | ignored | required for lanes |
| `substacks` | the whole point | should be empty (flat) |
| Costs | roll up through `substacks` | identical cost model, not used for layout |
| Best for | an architecture you own (services + modules) | a pipeline data passes through (stages) |

A document can technically carry both `substacks` and `group`, but in practice
a project is authored for one view: nest with `substacks` for an architecture,
or stay flat with `group` + `groupOrder` for a flow. Mixing produces a valid
but confusing result (e.g. a Flow lane containing a node that also owns
substacks the Flow view won't show).

### Minimal valid Stack document

```jsonc
{
  "name": "Acme Platform",
  "avgTransactionValue": 50,
  "layers": [
    { "id": 1, "name": "Web App", "type": "Frontend", "status": "Active",
      "technology": "React",
      "connections": [ { "targetId": 2, "type": "HTTP" } ],
      "substacks": [] },
    { "id": 2, "name": "API", "type": "Core", "status": "Active",
      "connections": [ { "targetId": 3, "type": "Database", "label": "queries" } ],
      "costModel": { "currency": "USD", "period": "month", "fixedCost": 5,
                     "variableCost": 0, "variableUnit": "per-request" },
      "substacks": [
        { "id": "2_1", "name": "Auth Service", "type": "Backend",
          "status": "Active", "connections": [], "substacks": [] }
      ] },
    { "id": 3, "name": "Postgres", "type": "Database", "status": "Active",
      "connections": [], "substacks": [] }
  ]
}
```

This renders three top-level cards; the API card owns one nested substack
(Auth Service) and shows a $5/mo badge that rolls up its subtree.

---

## Migrations
`migrateProject()` upgrades older documents on load. It is idempotent and
preserves unknown-but-known fields:

1. **Connections** → canonical `{ targetId, type, label? }` objects. Bare-id
   arrays and the legacy `connectionTypes` side-table are converted; `label`
   is preserved.
2. **Use paths** → ensures `layersInvolved` is an array and `avgCallsPerLayer`
   exists (defaulting to 1 call per involved layer), and populates the
   internal `steps`/cost fields. Authored actions that only specify
   `layersInvolved` (any `source`) load correctly.
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
