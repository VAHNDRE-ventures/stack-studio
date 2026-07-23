# StackStudio Model (v2) — the city contract

This is the data model for the 3D "city planner" architecture visualizer. It is
the durable asset of the project: the renderer, the cost engine, and every
importer are built on top of it. The machine-readable contract is
[`model/types.ts`](model/types.ts); this document is the reasoning and the
authoring reference.

> **Relationship to `SCHEMA.md`.** `SCHEMA.md` documents the *legacy* schema —
> a composition tree of `Layer`s with a fixed 9-value `type` enum and
> `{targetId,type,label}` connections. Model v2 **supersedes** it. There is **no
> backward compatibility and no migration path**: the old schema was a mold
> shaped before real architecture was understood, and preserving it would
> smuggle those assumptions forward. Legacy documents (and Mermaid, and other
> sources) are brought in through **import maps** (§9), which adapt *to* the
> model rather than bending the model to history.

---

## 1. The one design law: closed trunk, open leaf

Every entity carries a **closed `kind`** — enough structure for the renderer and
the cost/flow engines to reason about it — **plus an open `subtype` string and
an open `meta` bag**, and every `kind` enum ends in a real, permanent `other`.

This is not a hedge; it is the central finding of the research. Eight hyperscale
systems (Netflix, Uber, Stripe, Shopify, Discord, LinkedIn, AWS IoT, Meta/TAO)
were surveyed and **no fixed enum survived contact with all of them** —
Schemaless, TAO, Venice, Device Shadow, and Open Connect are each legitimately
"their own category plus attributes." The model was then pressure-tested against
a real 36-node payments/logistics stack, which added exactly one kind
(`data_entity`) and validated the rest.

**Consequence for authors:** you will never be blocked. A component nobody has
seen before slots in as the nearest `kind` + a descriptive `subtype` +
`meta{}`, or as `other`. The trunk gives structure; the leaf gives room to grow.

A second law: **reality is a graph, not a tree.** Containment ("what is part of
what") is one relationship among several — calls, triggers, replication,
depends-on — each a first-class edge kind. The legacy schema overloaded a single
`connections` list and left `dependencies` unused; v2 makes the distinct
relationships distinct.

---

## 2. Project (root object)

```jsonc
{
  "modelVersion": "2.0.0",
  "name": "Acme Commerce",
  "avgTransactionValue": 30,      // per-transaction value for % fees (§8)
  "drivers": { "orders": 500, "customers": 300, "requests": 15000 }, // baseline MONTHLY activity — anchors load + cost (§12)
  "horizonMonths": 12,            // planning window for cumulative stores (§12)
  "nodes":  [ Node, ... ],        // the buildings
  "edges":  [ Edge, ... ],        // the roads
  "zones":  [ Zone, ... ],        // districts & trust walls (overlays)
  "flows":  [ Flow, ... ],        // traffic routes (ordered, branching)
  "phases": [ Phase, ... ],       // construction schedule (build timeline)
  "projections": { "<id>": UsageProjection }, // drives cost foresight
  "view":   ViewState             // camera / LOD / focus (rendering hints)
}
```

Nodes and edges are **flat top-level arrays** referenced by `id`. (Composition
still exists — a node may hold `children` — but membership in the graph is by
id, so any node or edge can reference any other regardless of nesting.)

---

## 3. Node — the buildings

A node is any addressable part of the system. Full field list in
[`types.ts`](model/types.ts) (`interface Node`).

```jsonc
{
  "id": "orders-svc",
  "name": "Orders Service",
  "kind": "compute_service",       // closed trunk (see below)
  "subtype": "modular-monolith",   // OPEN precision
  "ownership": "owned",            // orthogonal to kind
  "buildState": "active",          // lifecycle / build timeline
  "technology": "Node.js on Cloudflare Workers",
  "description": "Owns the order lifecycle and payment orchestration.", // what it IS (inspector + tooltip)
  "responsibilities": "Validate cart, capture payment, persist the order.", // what it's ON THE HOOK FOR
  "zoneIds": ["private-plane", "pci-scope"],   // MANY-TO-MANY
  "phaseId": "sprint-2",
  "capacity": { "unit": "req/s", "ceiling": 5000,
                "usage": { "model": "per_event", "driver": "orders", "perUnit": 2 } },
  "cost": CostModel,
  "children": [ Node, ... ],       // rooms inside this building (recursive)
  "position": { "x": 0, "y": 0, "z": 0 },
  "meta": { }
}
```

### Naming (nomenclature)

Node labels are authored SHORT and well-shaped **by the author** — the renderer
does not guess line breaks from punctuation (it only honors an explicit newline
and applies a gentle whitespace wrap as a safety net). Follow these rules:

1. **Name the thing, not its role.** Don't prefix with type/role words —
   `kind` + `subtype` already carry those. Write `Auth` (subtype `route-handler`),
   not `handler: api auth`; `Payment webhook`, not `handler: api payment webhook`.
2. **≲ 2 words / ≲ 18 characters.** Push path, environment, and product detail
   into `technology`, `subtype`, or `description` — never the name.
3. **Co-equal combos** use a single ` / ` and stay short (`PayPal / Venmo`).
4. **Statuses** (LIVE, sandbox, planned) belong in `buildState` / `technology`,
   not the name.
5. Only if a hard two-line label is truly needed, author the break with a
   newline; otherwise trust the short name.

Before → after: `handler: api cart` → `Cart` · `handler: api payment webhook` →
`Payment webhook` · `Resend (transactional email)` → `Resend` (technology
`Resend · transactional`) · `PayPal Standard (LIVE)` → `PayPal` · `Sanity (data
spine)` → `Sanity`.

### 3.1 `kind` — the closed trunk (~25)

| Group | Kinds |
|-------|-------|
| Edge & ingress | `client_app`, `edge_cdn`, `api_gateway`, `load_balancer` |
| Compute | `compute_service`, `container_platform`, `serverless_function` |
| Data at rest | `relational_db`, `nosql_db`, `cache`, `object_store`, `search_index`, `data_warehouse`, `data_entity` |
| Data in motion | `queue_stream`, `stream_processor`, `cdc_pipeline` |
| Intelligence | `ml_platform` |
| Platform & ops | `auth_identity`, `secrets_config`, `observability`, `cicd_deploy`, `digital_twin` |
| Outside the walls | `actor`, `external_system` |
| Escape hatch | `other` |

- **`data_entity`** is the pressure-test addition: a schema/document type that
  lives *inside* a store (a product/order/user document inside a content lake).
  It is a building's *rooms* — modelled as `children` of the store node, with
  its own edges to sibling entities (`order → orderLineItem`). Revealed at
  `interior` LOD.
- **`secrets_config`** stores **references only, never secret values.**
- `kind` also drives a coarse **rollup category** (color band / building
  silhouette) so the metropolis view reads at a glance.

### 3.2 `ownership` — orthogonal to kind

`owned` · `managed` · `thirdParty` · `external`. This is a separate fact from
`kind`: a managed content lake is `kind: nosql_db` **and** `ownership: managed`;
a payment processor is `kind: external_system`/`compute_service` **and**
`ownership: thirdParty`. `actor`/`external` ownership are excluded from cost
rollups.

### 3.3 `buildState` — the construction timeline

`proposed → planned → in_progress → active → deprecated → retired`.
`proposed` and `planned` are **excluded from current-state cost** (included in
"projected"). This axis powers the live build-progress view: blueprints
(planned), an **animated rising scaffold** (`in_progress` — a glowing shape-
fitted outline sweeps bottom→top leaving a yellow wireframe lattice, then fades
and repeats), finished-and-lit (active) — a timeline you scrub, plus blast-radius
highlighting when a phase or node is selected.

### 3.4 `capacity` — where the city strains

`{ unit, per?, ceiling, usage }`. Projected load ÷ `ceiling` renders as
congestion (building heat; roads inherit it), making scale limits *visible*
rather than buried. The load comes from `usage` — a **driver-linked** model
(`per_event` | `cumulative` | `operational`), optionally **multi-driver** via
`usage.plus` so a pressure point reacts to every driver that loads it. Author it
per §12 "Load model, drivers & congestion". (`capacity.expected` is a deprecated
static fallback — prefer `usage`.)

---

## 4. Edge — the roads

An edge is a first-class relationship between two nodes. Full list in
[`types.ts`](model/types.ts) (`interface Edge`).

```jsonc
{
  "id": "orders-to-paypal",
  "source": "orders-svc",
  "target": "paypal",
  "kind": "sync_request",
  "label": "custom_id + amount, no cart",   // WHAT flows (and what's withheld)
  "direction": "forward",
  "reliability": {
    "idempotent": true,
    "retry": { "strategy": "exponential-backoff", "maxWindow": "3 days" },
    "deliveryGuarantee": "at-least-once",
    "backpressure": false
  },
  "dataClass": "PCI",
  "zoneCrossing": true,
  "capacity": { "unit": "req/s", "ceiling": 200, "expected": 12 },
  "cost": CostModel,
  "meta": { }
}
```

### 4.1 `kind` — the closed trunk (~13)

`sync_request` · `rpc` · `async_event` · `pub_sub` · `stream` ·
`webhook_callback` · `db_query` · `cache_rw` · `replication` · `batch_job` ·
`scheduled_trigger` · `persistent_session` · `contains` · `depends_on` ·
`other`.

`contains` and `depends_on` express composition and logical dependency for
cross-tree cases (the common composition case uses `Node.children`).

### 4.2 Reliability — what makes it a security document

`idempotent`, `retry {strategy, maxWindow}`, `deliveryGuarantee`,
`backpressure`. These, plus `label` (what crosses / what is deliberately
withheld), `dataClass`, and `zoneCrossing`, turn "boxes wired together" into a
real dataflow-and-compliance document. A `zoneCrossing` edge carrying a
`dataClass` is exactly what a security review wants highlighted.

---

## 5. Zone — districts and trust walls (overlays, not containment)

Zones are **many-to-many overlay tags**, rendered as hulls around their member
nodes — **not** exclusive containment.

```jsonc
{ "id": "pci-scope", "name": "PCI Data", "kind": "compliance_scope",
  "parentZoneId": null, "meta": {} }
```

`public_edge` · `authenticated_zone` · `private_data_plane` · `compliance_scope`
· `tenant_isolation` · `third_party_boundary` · `other`.

Overlay-not-containment is the key move: a `compliance_scope` ("every node that
touches PCI data") can **cross-cut** the public/gated/private districts. Zones
may also nest (`parentZoneId`) for the straightforward public → gated → data
plane layering. A node's `zoneIds` lists every zone it belongs to.

---

## 6. Flow — traffic routes (ordered, branching)

A flow is a route traffic takes through the city: an **ordered sequence of steps
over specific edges**, which can **branch, fan out, and loop**.

```jsonc
{
  "id": "checkout",
  "name": "Checkout & pay",
  "driver": "orders",              // project driver that scales this flow's traffic + cost (§8.1)
  "steps": [
    { "id": "s1", "edgeId": "client-to-orders",   "order": 1 },
    { "id": "s2", "edgeId": "orders-precheck",     "order": 2, "condition": "fraud pre-check" },
    { "id": "s3", "edgeId": "orders-to-paypal",    "order": 3, "branch": "pay", "condition": "if precheck passes" },
    { "id": "s4", "edgeId": "orders-to-crypto",    "order": 3, "branch": "pay", "condition": "if PayPal unavailable" },
    { "id": "s5", "edgeId": "orders-to-easypost",  "order": 4 }
  ],
  "volume": { "runsPerPeriod": 500, "period": "month" }
}
```

- Steps with the **same `order`** run in parallel (fan-out — e.g. two emails
  fire at once).
- Steps sharing a **`branch`** are mutually-exclusive alternatives (pay-by-card
  vs. pay-by-crypto). This matches the real-world pattern that most components
  handle more than one chain.
- This model is exactly what **call-tracing animation** consumes: a pulse
  follows the route, takes the turn its branch condition dictates, and
  accumulates **cost (toll)** as it goes. `volume` (baseline runs) and `driver`
  (the project driver that scales it — e.g. checkout → `orders`, browse →
  `requests`) drive **traffic density**: pulse count reflects the flow's real
  per-period rate, scaled by `driver ÷ baseline`, so pushing that driver visibly
  busies the flow. Per-operation cost uses `volume` too.

---

## 7. Phase — the construction schedule

```jsonc
{ "id": "sprint-2", "name": "Cart + payment", "order": 2,
  "startTarget": "2026-08-01", "endTarget": "2026-08-08" }
```

Nodes and edges reference a `phaseId`. The ordered list of phases is the
timeline the build-progress view scrubs; selecting a phase highlights every node
and edge it touches (and, via their edges, what *those* touch) — blast radius.

---

## 8. Cost — foresight, not accounting

The cost model's job is an **early-warning system**, not a monthly tally: tell
the user *well ahead* of when any component crosses from free into paid at
projected scale. Full types in [`types.ts`](model/types.ts) (`CostModel`,
`Meter`, `CostTier`, `TransactionFee`, `UsageProjection`).

> Author the **load model first** (§12: `drivers` + `capacity.usage`) — cost
> foresight and the per-op toll both build on it.

```jsonc
"cost": {
  "currency": "USD",
  "fixedCost": 5, "fixedPeriod": "month",
  "fixedCostDescription": "Workers Paid floor",
  "meters": [
    { "unit": "per-request",
      "freeAllowance": { "amount": 100000, "per": "day" },   // foresight anchor: when do we cross free?
      "tiers": [
        { "name": "Free", "upTo": { "unit": "per-request", "amount": 100000, "per": "day" }, "unitCost": 0 },
        { "name": "Paid", "upTo": null, "unitCost": 0.0000003, "minCharge": 5, "period": "month" }  // billing shape past free
      ],
      "sharedScope": "cloudflare-account",   // open string; meters sharing it are summed across their nodes
      "warnAtPct": 0.8 }
  ],
  "transactionFees": [ { "percent": 3.49, "fixed": 0.49 } ],  // "paid from unit 1"
  "provider": "cloudflare-workers",
  "lastVerified": "2026-07-20",
  "notes": "Basis / source / estimate-labeling goes here (see §8.1 honesty rule)."
}
```

`freeAllowance` is the **foresight anchor** (drives the "when do we cross free"
warning); the `Free` `CostTier` is the **billing shape** — author both
consistently.

The **foresight engine** (built on this shape):

1. **Headroom.** `projected / freeAllowance` → green (<60%) / amber (60–90%) /
   red (>90%) ring on the building.
2. **Time-to-crossing.** Walk the node's `UsageProjection` forward; report
   "crosses free tier in ~N weeks at current growth."
3. **Cliff vs. slope.** Show the jump at crossing (e.g. $0 → $5/mo floor)
   separately from the per-unit overage rate — they warn differently.
4. **Binding constraint.** A component may meter several dimensions (e.g. emails
   *per month* **and** *per day*); the one that trips first is the headline. (A
   convention already used across the local tool knowledge base.)
5. **Shared scope.** Meters billed per account (e.g. edge KV writes) are
   **summed across every component** sharing that `sharedScope`, not counted
   per-node.
6. **Transaction fees** have no free tier → flagged **"paid from unit 1."**
   Evaluated as `percent/100 × avgTransactionValue + fixed`.
7. **Stack headline.** The **soonest-crossing** node across the whole city is
   the top-line warning ("Your first paid cliff is X, ~5 weeks out"). `proposed`
   /`planned` nodes count only in the Projected view.
8. **Staleness.** Every rate stamped `lastVerified`; stale rates are surfaced
   for re-verification. This tool *estimates*; authoritative billing lives on
   the provider's own pricing page.

### 8.1 Per-operation cost (the toll along a flow)

Beyond the monthly/free-tier foresight, the engine also accrues the cost of
**one operation** as it travels a `Flow` (cost-along-flow). Each node a flow
touches contributes a toll decomposed into three transparent parts:

- **fee** — `transactionFees` evaluated as `percent/100 × avgTransactionValue +
  fixed`. Paid from unit 1 (processors).
- **metered** — per-unit charge beyond free: `unitsPerOp × firstPaidUnitCost`.
  Reads **$0 while within the free tier** (flagged), so it's honest at low scale.
  `unitsPerOp` comes from the node's `capacity.usage` when its `unit` matches the
  meter's `unit` (e.g. a `labels` meter + `usage {per_event, driver:"orders",
  perUnit:1}` ⇒ 1 label/order).
- **fixed** — flat infra (`fixedCost`, annualized via `fixedPeriod:"year"`)
  **amortized over the flow's monthly driver volume**. An allocation, always
  labeled as such — never hidden.

**So, to make a node's toll real, author:** `transactionFees` on processors; a
meter with a paid `tier` **plus** a matching `capacity.usage` for per-unit
charges; and `fixedCost`+`fixedPeriod` for recurring infra (set
`fixedPeriod:"year"` for annual plans/domains). A mutually-exclusive branch
(`FlowStep.branch`) contributes only its worst-case alternative to a run.

When a node has **several per-op meters** (e.g. EasyPost's $0.08 platform fee
*and* the ~$6 postage per label), tag each one that scales per operation with
`Meter.perOp` (units consumed per operation). A meter with neither a `perOp` nor
a `capacity.usage` unit match contributes **$0 to the per-op toll** (it still
counts in the monthly free-tier foresight) — this is deliberate, so seats /
bandwidth / storage meters don't invent a per-order charge.

**Auto-attribution requires a driver match.** A meter's `capacity.usage` is only
reused as its per-op quantity when the usage is driven by the **same driver as
the flow** — then one operation is exactly one driver event, so `perUnit` is
genuinely per-op. A meter driven by a *different* driver (e.g. emails-per-
*customer* metered on an *orders*-driven flow, where `perUnit` is a monthly
per-customer aggregate, not a per-send count) does **not** auto-attribute; it
must declare `perOp` or it stays out of the per-op toll. This prevents a
per-driver-event rate from being mistaken for a per-operation quantity.

**Model the full future state, not just today's bill.** This is a
forward-looking map — author every cost you are aware of, even when it is not a
current out-of-pocket expense:

- **Future / planned costs** (a plan you'll move to, a payment rail not yet live,
  a domain you'll register at cutover): attach them to the `planned`/`proposed`
  node — or the phase — that introduces them. `buildState` gates them **out of
  the current rollup and into the projected view**, so the expense is visible and
  "coming" without inflating today's number.
- **Recouped / pass-through costs** (EasyPost postage you rebill at checkout, a
  fee you pass to the customer): author them as a cost anyway — the map shows the
  **gross money movement**. Record the recoupment in `notes`; netting it out is a
  later view, never a reason to hide the outflow.

> **Source it, estimate it openly, or omit it — but never fabricate.** A verified
> provider rate carries `lastVerified` + its source. An unavoidable average (e.g.
> "~$6 avg domestic label") is legitimate **if** `notes` labels it an estimate
> and states the basis — that is not fabrication. What's forbidden is a guessed
> number dressed up as a hard rate. The ONLY reason to omit a known cost is that
> you genuinely cannot even estimate it — **"future" and "recouped" are not
> reasons to omit.**

### 8.2 What the cost surfaces show

The fields above light up three read-outs in the Cost panel, each clickable to a
per-node breakdown that highlights the contributing buildings in the city:

| Read-out | What it sums | Scope |
|----------|--------------|-------|
| **fixed / mo** | recurring `fixedCost` (annual amortized to monthly) | CURRENT nodes only (active/in_progress/deprecated; excludes planned + external) — today's flat bill |
| **per txn** | `transactionFees` at `avgTransactionValue` (`%/100 × AOV + fixed`) | a per-transaction figure; does not scale with volume by itself |
| **projected / mo** | **every** cost type, driver-scaled: per-op marginal (fees + metered) of each flow × its monthly runs, **plus** recurring fixed, **plus** PLANNED/future costs (annual amortized) | the whole monthly bill at the current drivers — the figure that reacts to the sliders and shows what's *coming* |

Tracing a flow adds the **cost-along-flow** read-out: the per-run toll accruing
node-by-node, a floating `+$X` tag on each charging building, and that flow's
monthly projection. Together these answer both "what's my bill" and "what does
*this* operation cost, and where."

---

## 9. Importers (adapt to the model, don't migrate)

New sources become **import maps** that emit a v2 `Project`:

- **Legacy StackStudio** — `Layer.type` → `kind` + `subtype` (a legacy
  `Database` disambiguates to `relational_db`/`nosql_db`/`cache`/`object_store`
  by inspection); `connections` → `edges`; `substacks` → `Node.children`;
  `group`/`groupOrder` → `zones`/`phases`; legacy `CostModel` → v2 `cost`;
  `usePaths` → `flows` (linear steps).
- **Mermaid** — as today, subgraphs → zones, nodes → nodes (shape → `kind`
  best-effort), edges → edges.
- Anything else — a small adapter to the same target. The model never bends.

---

## 10. Rendering contract (metropolis → alleyway)

Semantic zoom across five LOD tiers (`LodTier` in `types.ts`):

| Tier | Shows |
|------|-------|
| `metropolis` | Zones as districts; node clusters as super-buildings with counts; edges bundled into arterials |
| `district` | One zone expanded; kind-grouped clusters; inter-cluster edges bundled |
| `street` | Individual buildings sized/tinted by kind + cost; primary edges drawn |
| `building` | One node and its immediate connections |
| `interior` | Full detail: every edge label + reliability + cost + zone-crossing; `data_entity` rooms |

Legibility is preserved by hierarchical pre-aggregation, GPU instancing
(`InstancedMesh` per kind), edge bundling, frustum/occlusion culling, and a
capped label budget. **Importance ranking** (degree, cost, zone-crossing, flow
membership) decides what survives at overview — so a **rarely-used "alleyway"
edge is hidden at the metropolis level but force-promoted to full detail the
moment you drill in or select a flow that uses it.** It stays findable without
cluttering the skyline. Positions persist (`Node.position`, `ViewState.camera`)
so the city doesn't rearrange on reload; layout of large graphs is computed off
the main thread.

---

## 11. Extensibility rules (so this never becomes a mold)

1. **Never widen a `kind` enum in place of `subtype` + `meta`.** Reach for
   `subtype`/`meta`/`other` first; promote to a new `kind` only when the
   renderer or an engine must branch on it.
2. **`other` is permanent.** It is a valid, first-class value, not a TODO.
3. **`meta` round-trips untouched.** Unknown fields are preserved on
   save/load — importers and future features can attach data without a version
   bump.
4. **Escape values, always.** All user text is HTML-escaped before rendering
   (carried forward from the legacy correctness work; names/descriptions were an
   injection vector).
5. **`modelVersion` gates breaking changes.** Additive changes keep the version;
   only a structural break bumps the major.

---

## 12. Build progress, blast radius & load (authoring)

Runtime views read these fields; author them so the views light up.

### Build progress (timeline)
- `Node.buildState` ∈ `proposed | planned | in_progress | active | deprecated |
  retired`. Renders as: planned/proposed = faint wireframe (blueprint),
  `in_progress` = animated construction scaffold (shape-fitted glowing outline
  sweeping bottom→top over a rising wireframe lattice, then fades + repeats),
  active = solid + lit. Reach for `in_progress` when scaffolding is up but not
  live — a draft pending activation, a path proven in sandbox but not cut over to
  prod, an endpoint deployed but blocked on an external step.
- `Node.phaseId` / `Edge.phaseId` → the `Phase` a thing is introduced in.
  `Phase` has `order` (+ optional `startTarget`/`endTarget` ISO dates). The
  ordered phases are the timeline a scrubber steps through: at phase *N*,
  everything with a phase ≤ *N* (and past `planned`) reads as built.
- Cost rollup already excludes `proposed`/`planned` from the **current** total
  and includes them in **projected** — planned costs show without inflating
  today's bill.

### Blast radius (what a change touches)
- Author logical build dependencies as `depends_on` edges (no runtime traffic),
  alongside the real call edges. The blast radius of a node/phase is the
  transitive closure over its outgoing call / `depends_on` / `contains` edges.
- Selecting a phase or node highlights that closure and dims the rest
  (highlight-and-dim). Nothing to author beyond edges + `phaseId`.

### Load model, drivers & congestion (authoring)

**Step 1 — anchor with real drivers.** `drivers` is the baseline MONTHLY
activity that contextualizes every derived figure; author it from real numbers
first, because everything else is relative to this ×1 scenario.

```jsonc
"drivers": {
  "orders": 500,       // real orders / month
  "customers": 300,    // ACTIVE users / month (not just new signups)
  "requests": 15000    // customer-initiated API / catalog fetches / month
},
"horizonMonths": 12    // planning window for cumulative stores
```

**Step 2 — per node, pick the DRIVER and MODEL that match reality.** The single
most important authoring decision is *what actually drives this resource*.
Getting the driver wrong (e.g. modelling document growth off `orders` when it is
really driven by user activity) yields a plausible-looking but wrong number.

| model | usage formula | use when the resource… | deriving `perUnit` |
|-------|---------------|------------------------|--------------------|
| `per_event` | `driver × N × perUnit`, normalized to `per` | is a RATE that rises with activity | count it per one driver event — emails/order, labels/order, requests/order, KV writes/session |
| `cumulative` | rate = `driver × N × perUnit`; **`ceiling` is a running TOTAL** | ACCUMULATES and is never freed (records/documents) | new records per one driver event — docs/order, or docs per user-interaction |
| `operational` | `fixed` (load-independent) | does NOT scale with customer traffic | set `fixed` to the real cadence — builds/month, seats |

Choosing the driver:
- **Order-driven** (`driver: "orders"`) — produced per transaction: order +
  tracking emails, shipping labels, order/line-item documents.
- **User / interaction-driven** (`driver: "customers"`, or add a `sessions` /
  `activeUsers` driver) — produced by people *using* the app, order or not:
  sign-in emails, session/cart writes, and documents written on browse/account
  activity. If ~M active users each generate ~k records/month, `perUnit ≈ k` on
  the user driver.
- **Operational** — deploy/ops cadence, seats, cron: `operational`, fixed.

**Step 3 — sanity-check the ×1 rate.** Read back the ×1 figure the tool derives
(emails/day, documents/month) and compare it to what the system actually
produces; adjust `perUnit` or switch drivers until the ×1 rate matches reality.
This is the step that turns a guess into a figure you trust.

```jsonc
// order-driven rate:
"capacity": { "unit": "emails", "per": "day", "ceiling": 100,
  "usage": { "model": "per_event", "driver": "orders", "perUnit": 4 } }

// user-driven cumulative store — ceiling is a TOTAL (no `per` needed):
"capacity": { "unit": "documents", "ceiling": 10000,
  "usage": { "model": "cumulative", "driver": "customers", "perUnit": 8 } }
```

The tool reports **congestion** (usage ÷ ceiling; heat halo, roads inherit it)
and the **crossing** in the terms that matter: driver quantity for rates
("crosses at ~750 orders/mo (×1.5)"), months for cumulative ("fills in ~7 mo"),
"independent of load" for operational. A node without `capacity.usage` registers
no pressure — an un-modelled component never false-alarms.

**Step 4 — if MORE THAN ONE driver stresses the resource, say so.** Many
pressure points are loaded by several drivers at once (transactional email =
order emails + sign-in emails + contact emails; a cache = sessions + orders).
Modelling only one driver means the pressure point won't react to the others.
Use `usage.plus` to sum additional driver contributions onto the primary:

```jsonc
// emails = 4 per order + 1 per active customer + 1 per contact request
"capacity": { "unit": "emails", "per": "day", "ceiling": 100,
  "usage": {
    "model": "per_event", "driver": "orders", "perUnit": 4,
    "plus": [ { "driver": "customers", "perUnit": 1 },
              { "driver": "requests",  "perUnit": 0.02 } ]
  } }
```

Now congestion rises when **any** of those drivers is pushed, and the crossing
is expressed in the primary driver holding the others at their current levels.
Pick the primary driver as the one that dominates volume.

---

*Model reference for StackStudio v2. Update this file and
[`model/types.ts`](model/types.ts) together with any change to the data model.*
