/**
 * StackStudio model — canonical TypeScript contract.
 *
 * This is the durable interface for the 3D "city planner" architecture
 * visualizer. It supersedes the legacy Layer/Connection schema documented in
 * SCHEMA.md (which described a two/n-level composition tree with a fixed 9-value
 * type enum). There is NO backward compatibility: legacy documents are brought
 * in through import maps (see MODEL.md § Importers), not migrations.
 *
 * Design law — "closed trunk, open leaf":
 *   Every entity has a CLOSED `kind` (enough structure to render + reason about)
 *   PLUS an OPEN `subtype` string and an OPEN `meta` bag. New/weird components
 *   slot in via subtype + meta + the real `other` kind, WITHOUT a schema change.
 *   Derived from 8 hyperscale systems where no fixed enum survived contact with
 *   reality (Schemaless, TAO, Venice, Device Shadow, Open Connect) and
 *   pressure-tested against a real 36-node payments/logistics stack.
 *
 * Reality is a GRAPH, not a tree: containment is one relationship among several
 * (calls, triggers, depends-on, contains), each a first-class edge kind.
 */

export const MODEL_VERSION = "2.0.0" as const;

/* ------------------------------------------------------------------ */
/* Open-leaf primitives                                               */
/* ------------------------------------------------------------------ */

/** Free-form, typed-but-open metadata. The escape hatch that kills the mold. */
export type Meta = Record<string, unknown>;

/** A stable identifier, unique across the whole document. */
export type Id = string;

/* ------------------------------------------------------------------ */
/* NODES (buildings)                                                  */
/* ------------------------------------------------------------------ */

/**
 * The closed trunk of node kinds (~25). Comprehensive by design, but never
 * complete: `other` is a permanent, first-class fallback, and `subtype`
 * absorbs precision without inflating this list.
 */
export type NodeKind =
  // edge & ingress
  | "client_app"          // first-party surface: web/mobile/TV app, SDK
  | "edge_cdn"            // CDN / edge PoP / static hosting
  | "api_gateway"         // single ingress: routing, authz, throttling
  | "load_balancer"       // L4/L7 traffic distribution / proxy / mesh ingress
  // compute
  | "compute_service"     // long-running app service (microservice or monolith)
  | "container_platform"  // orchestrator/scheduler (k8s, Titus, YARN)
  | "serverless_function" // event/request-triggered ephemeral compute
  // data at rest
  | "relational_db"       // ACID/SQL store
  | "nosql_db"            // document / wide-column / KV store, content lake
  | "cache"               // in-memory serving tier
  | "object_store"        // blob/file/asset storage
  | "search_index"        // inverted-index / OLAP query engine
  | "data_warehouse"      // analytical/batch storage + compute, data lake
  | "data_entity"         // a schema/document type INSIDE a store (a "room")
  // data in motion
  | "queue_stream"        // broker/queue/log (Kafka, SQS, Kinesis, MQTT topic)
  | "stream_processor"    // continuous transform over streams
  | "cdc_pipeline"        // change-data-capture / data integration / replication hub
  // intelligence
  | "ml_platform"         // feature store + training + model serving
  // platform & ops
  | "auth_identity"       // authn/authz, identity provider, session manager
  | "secrets_config"      // secret/config distribution (store REFERENCES only)
  | "observability"       // metrics/logs/traces/alerting
  | "cicd_deploy"         // build + release orchestration
  | "digital_twin"        // mirror of a physical/remote entity's state (IoT shadow)
  // outside the city walls
  | "actor"               // human/org initiating use; not owned, no cost
  | "external_system"     // third-party system you don't run
  // escape hatch
  | "other";

/** Who owns/controls the node — orthogonal to `kind`. */
export type Ownership =
  | "owned"       // you build/run it (your Worker, your service)
  | "managed"     // managed SaaS/PaaS you configure but don't operate (Cloudflare, Sanity)
  | "thirdParty"  // external processor/provider you integrate (PayPal, Stripe)
  | "external";   // outside your control entirely (card networks, carriers, people)

/**
 * Lifecycle / build state — a timeline you can scrub, not a static flag.
 * Powers the "construction" view (done / in-progress / planned / blast-radius).
 */
export type BuildState =
  | "proposed"     // under consideration
  | "planned"      // designed, not built (blueprint)
  | "in_progress"  // under construction (scaffolding + cranes)
  | "active"        // live
  | "deprecated"   // being retired
  | "retired";     // gone; kept for history

/** Excluded from current-state cost rollups. */
export const NON_CURRENT_STATES: ReadonlySet<BuildState> = new Set([
  "proposed",
  "planned",
]);

export interface Node {
  id: Id;
  name: string;
  kind: NodeKind;
  /** OPEN precision: e.g. "content-lake", "document-store", "cron-worker". */
  subtype?: string;
  ownership: Ownership;
  buildState: BuildState;
  /** Free text — e.g. "PostgreSQL 16", "Cloudflare Workers". */
  technology?: string;
  description?: string;
  responsibilities?: string;

  /** Zone membership is MANY-TO-MANY (see Zone). A node can sit in several. */
  zoneIds?: Id[];

  /** Which build phase this node belongs to (see Phase). */
  phaseId?: Id;

  /** Capacity vs. expected load — drives "where it strains" (congestion). */
  capacity?: Capacity;

  cost?: CostModel;

  /**
   * Composition: nodes this node CONTAINS (rooms inside a building), e.g. a
   * store's data_entity children, or a platform's sub-services. Recursive to
   * any depth. Containment is ALSO expressible as a `contains` edge for
   * cross-tree cases; children here are the common, ergonomic path.
   */
  children?: Node[];

  /** Persisted 3D layout position (city coordinates). Optional; else computed. */
  position?: Vec3;

  meta?: Meta;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Capacity + load, expressed in an open unit. Used to render congestion
 * (load/ceiling) and to feed cost foresight.
 */
export interface Capacity {
  /** Open unit string, e.g. "emails", "documents", "requests", "builds". */
  unit: string;
  /** Window the ceiling / free tier is measured in (for rate metrics). */
  per?: Period;
  /** Maximum sustainable throughput/size before strain, in `unit` per `per`. */
  ceiling?: number;
  /** How this resource's usage derives from project drivers (drives congestion + cliffs). */
  usage?: Usage;
  /** Deprecated: legacy static expected load. Prefer `usage`. */
  expected?: number;
  meta?: Meta;
}

/**
 * How a metered resource scales:
 * - `per_event`: a rate proportional to a driver (emails = orders × k).
 * - `cumulative`: accumulates over time (documents = orders × k × months).
 * - `operational`: independent of customer load (builds, seats).
 */
export interface Usage {
  model: 'per_event' | 'cumulative' | 'operational';
  /** Key into Project.drivers (per_event / cumulative). */
  driver?: string;
  /** Units of the resource consumed per one driver event. */
  perUnit?: number;
  /**
   * Additional driver contributions, SUMMED with the primary — for a resource
   * stressed by more than one driver (e.g. transactional email = orders×4 +
   * customers×1 + contacts×1). Each term is per_event/cumulative like the
   * primary. This is what lets a pressure point react to every driver that
   * loads it, not just one.
   */
  plus?: { driver: string; perUnit: number }[];
  /** operational only: fixed units per `Capacity.per`, independent of load. */
  fixed?: number;
}

/* ------------------------------------------------------------------ */
/* EDGES (roads)                                                      */
/* ------------------------------------------------------------------ */

/** The closed trunk of edge kinds (~13). `other` is permanent. */
export type EdgeKind =
  | "sync_request"       // blocking request/response (HTTP)
  | "rpc"                // structured service-to-service call (gRPC/Thrift)
  | "async_event"        // fire-and-forget event emission
  | "pub_sub"            // topic fan-out to many subscribers
  | "stream"             // continuous ordered record flow
  | "webhook_callback"   // outbound signed async notification (often inbound to you)
  | "db_query"           // read/write to a datastore
  | "cache_rw"           // cache read/write + invalidation
  | "replication"        // copy state between stores/regions
  | "batch_job"          // bulk periodic transfer/compute
  | "scheduled_trigger"  // time/cron-driven invocation
  | "persistent_session" // long-lived stateful connection (WebSocket/MQTT)
  | "contains"           // composition relationship (parent → child), for cross-tree cases
  | "depends_on"         // logical dependency (no runtime traffic)
  | "other";

export type Direction = "forward" | "bidirectional";

export type DeliveryGuarantee =
  | "at-most-once"
  | "at-least-once"
  | "exactly-once"
  | "best-effort";

export type RetryStrategy = "none" | "fixed" | "exponential-backoff";

/** The properties that make a diagram a real dataflow + security document. */
export interface Reliability {
  idempotent?: boolean;
  retry?: {
    strategy: RetryStrategy;
    /** e.g. "3 days", "5x" — open string. */
    maxWindow?: string;
  };
  deliveryGuarantee?: DeliveryGuarantee;
  /** Does the consumer shed load / buffer under pressure? */
  backpressure?: boolean;
  meta?: Meta;
}

export interface Edge {
  id: Id;
  source: Id;
  target: Id;
  kind: EdgeKind;
  subtype?: string;
  /** WHAT flows across the edge — e.g. "custom_id + amount, no cart". */
  label?: string;
  direction?: Direction;
  reliability?: Reliability;
  /** Sensitive data class crossing this edge, open string: "PCI", "PII", ... */
  dataClass?: string;
  /** Set true when source and target are in different trust zones (rendered as a warning). */
  zoneCrossing?: boolean;
  capacity?: Capacity;
  cost?: CostModel;
  /** Build phase this edge is introduced in (build-progress timeline). */
  phaseId?: Id;
  meta?: Meta;
}

/* ------------------------------------------------------------------ */
/* ZONES (districts & walls) — many-to-many overlays, NOT containment */
/* ------------------------------------------------------------------ */

export type ZoneKind =
  | "public_edge"          // internet-facing, untrusted ingress
  | "authenticated_zone"   // post-authn, pre-data-plane
  | "private_data_plane"   // internal services + datastores
  | "compliance_scope"     // regulated data boundary (cross-cuts other zones)
  | "tenant_isolation"     // per-tenant blast-radius boundary
  | "third_party_boundary" // beyond your control
  | "other";

export interface Zone {
  id: Id;
  name: string;
  kind: ZoneKind;
  subtype?: string;
  /** Plain-language explanation (shown when the scope is inspected). */
  description?: string;
  /**
   * Zones can nest for containment cases (public → gated → data plane) AND
   * cross-cut as overlays (a compliance_scope spanning several zones). Rendered
   * as a hull around member nodes, not exclusive containment.
   */
  parentZoneId?: Id;
  meta?: Meta;
}

/* ------------------------------------------------------------------ */
/* FLOWS (traffic routes) — ordered, branching routes over edges      */
/* ------------------------------------------------------------------ */

/**
 * A flow is a route traffic takes through the city. It is an ordered sequence
 * of steps over SPECIFIC edges, and it can BRANCH, fan out, and loop — because
 * most components handle more than one chain. This is what call-tracing
 * animation consumes (a car follows a route, takes a turn, sometimes forks) and
 * what accrues cost/toll along the way.
 */
export interface Flow {
  id: Id;
  name: string;
  description?: string;
  steps: FlowStep[];
  /** Projected volume — drives traffic density, per-op cost, and foresight. */
  volume?: FlowVolume;
  /** Which project driver scales this flow's traffic (e.g. "orders", "requests"). */
  driver?: string;
  meta?: Meta;
}

export interface FlowStep {
  id: Id;
  /** The edge this step traverses. Nodes are derived from the edge endpoints. */
  edgeId: Id;
  /** Ordinal within the flow. Steps with the same order run in parallel (fan-out). */
  order: number;
  /** Human condition under which this branch is taken, e.g. "if pre-check passes". */
  condition?: string;
  /**
   * Branch grouping: steps sharing a `branch` are mutually-exclusive alternatives
   * (e.g. pay-with-PayPal vs. pay-with-crypto). Absent = always taken.
   */
  branch?: string;
  /** Calls to this step per flow run (feeds per-op cost math). */
  callsPerRun?: number;
  meta?: Meta;
}

export interface FlowVolume {
  /** Runs of the whole flow per period. */
  runsPerPeriod: number;
  period: Period;
  meta?: Meta;
}

/* ------------------------------------------------------------------ */
/* PHASES (construction schedule) — the temporal/build layer          */
/* ------------------------------------------------------------------ */

/**
 * A build phase / milestone. Nodes and edges reference a phaseId; the timeline
 * of phases is what the "live build progress" view scrubs. Selecting a phase
 * highlights everything it touches (blast radius).
 */
export interface Phase {
  id: Id;
  name: string;
  order: number;
  /** Optional real dates for scheduling. */
  startTarget?: string; // ISO date
  endTarget?: string;   // ISO date
  description?: string;
  meta?: Meta;
}

/* ------------------------------------------------------------------ */
/* COST — foresight, not accounting                                   */
/* ------------------------------------------------------------------ */

export type Period = "day" | "week" | "month" | "year";

export type Currency = "USD" | "EUR" | "GBP" | "JPY" | "AUD" | "CAD";

/** How a metered dimension is priced past its free allowance. */
export interface CostTier {
  name: string;
  /** Upper bound of this tier in `unit` per `per`; null = unbounded (top tier). */
  upTo: { unit: string; amount: number; per: Period } | null;
  /** Cost per unit within this tier (0 for a free tier). */
  unitCost: number;
  /** Minimum charge to be in this tier (e.g. Workers $5/mo floor). */
  minCharge?: number;
  period?: Period;
}

/**
 * A single metered dimension of a component's cost (a component may have several
 * — e.g. Resend meters BOTH emails/month AND emails/day; the binding constraint
 * is whichever trips first).
 */
export interface Meter {
  /** Open unit: "per-request", "per-write", "documents", "labels", "emails". */
  unit: string;
  /** What's included at $0. */
  freeAllowance?: { amount: number; per: Period };
  /** Tiers beyond free (piecewise-linear). */
  tiers?: CostTier[];
  /**
   * Scope across which this meter accumulates. Some meters are billed per
   * account, not per component (e.g. Cloudflare KV writes) — those must be
   * summed across every component sharing the scope. Open string.
   */
  sharedScope?: string;
  /** Warn when projected usage exceeds this fraction of free (default 0.8). */
  warnAtPct?: number;
  /**
   * Units of this meter consumed per ONE operation, for per-op toll
   * attribution (e.g. 1 postage charge per shipment). When absent, a meter is
   * attributed per-op only if the node's `capacity.usage` unit matches this
   * meter's `unit`; otherwise it contributes $0 to the per-op toll (it still
   * counts in the monthly/free-tier foresight). Prevents multi-meter nodes
   * (seats + bandwidth + assets …) from fabricating a per-op charge.
   */
  perOp?: number;
  meta?: Meta;
}

/** Percentage-of-value + fixed fee (payment processors). "Paid from unit 1." */
export interface TransactionFee {
  /** Percent of transaction value, e.g. 3.49. */
  percent?: number;
  /** Flat fee added per transaction, e.g. 0.49. */
  fixed?: number;
  /** Optional cap / minimum per transaction. */
  cap?: number;
  min?: number;
  meta?: Meta;
}

export interface CostModel {
  currency?: Currency;
  /** Flat recurring cost regardless of usage. */
  fixedCost?: number;
  fixedPeriod?: Period;
  fixedCostDescription?: string;
  /** Metered dimensions (the free-tier foresight lives here). */
  meters?: Meter[];
  /** Per-transaction fees (processors). */
  transactionFees?: TransactionFee[];
  /** Open provider key → an external versioned rate catalog entry. */
  provider?: string;
  /** Pricing rots — stamp when it was last checked (ISO date). */
  lastVerified?: string;
  notes?: string;
  meta?: Meta;
}

/**
 * A usage projection attached to a node/edge/flow to drive time-to-crossing.
 * The foresight engine walks this forward to answer "crosses free tier in ~N
 * periods" and to pick the stack's soonest (headline) paid cliff.
 */
export interface UsageProjection {
  unit: string;
  current: number;
  growthModel: "linear" | "compound" | "step";
  /** +fraction per period (compound) or +amount per period (linear/step). */
  ratePerPeriod: number;
  period: Period;
  meta?: Meta;
}

/* ------------------------------------------------------------------ */
/* PROJECT (the whole city)                                            */
/* ------------------------------------------------------------------ */

export interface Project {
  modelVersion: typeof MODEL_VERSION;
  name: string;
  /** Average transaction value, for evaluating percentage costs. */
  avgTransactionValue?: number;
  /** Baseline monthly activity (the ×1 load scenario), e.g. { orders: 500, customers: 60 }. */
  drivers?: Record<string, number>;
  /** Time window (months) for cumulative usage projection. Default 12. */
  horizonMonths?: number;

  nodes: Node[];
  edges: Edge[];
  zones?: Zone[];
  flows?: Flow[];
  phases?: Phase[];

  /** Per-node usage projections keyed by node/edge/flow id, for foresight. */
  projections?: Record<Id, UsageProjection>;

  /** Rendering hints (semantic-zoom tuning); safe to omit. */
  view?: ViewState;

  meta?: Meta;
}

/* ------------------------------------------------------------------ */
/* VIEW / RENDERING CONTRACT (semantic zoom, metropolis → alleyway)   */
/* ------------------------------------------------------------------ */

/** The five LOD tiers of the city. */
export type LodTier =
  | "metropolis" // zones as districts, clusters as super-nodes, bundled arterials
  | "district"   // one zone expanded, kind-grouped clusters
  | "street"     // individual buildings + primary edges
  | "building"   // one node + its immediate connections
  | "interior";  // full detail: every edge label, reliability, cost, data_entity rooms

export interface ViewState {
  /** Persisted camera/zoom, so the city doesn't rearrange on reload. */
  lod?: LodTier;
  camera?: { position: Vec3; target: Vec3 };
  /** A focused node/edge/flow gets full detail + highlight-and-dim on the rest. */
  focusId?: Id;
  focusFlowId?: Id;
  meta?: Meta;
}
