import type { Project, Node, Flow, CostModel } from '@model/types';
import { MONTHS_PER } from './usage';

/**
 * Per-operation cost — "the toll on a traced pulse".
 *
 * `analyzeCost` answers the monthly rollup and free-tier cliffs. This module
 * answers a different, complementary question: what does ONE operation cost as
 * it moves through the city, and WHERE does the money go? It decomposes each
 * node's marginal cost into three transparent parts:
 *
 *   fee      — percentage + fixed processing fees, paid from unit 1 (PayPal).
 *   metered  — per-unit charges beyond a free allowance ($6/label). $0 while
 *              still inside the free tier, flagged so the reason is visible.
 *   fixed    — flat infra (Cloudflare annual) AMORTIZED over the flow's monthly
 *              driver volume. An allocation, labeled as such — never hidden.
 */

export type CostPartKind = 'fee' | 'metered' | 'fixed';

export interface CostPart {
  label: string;
  amount: number;
  kind: CostPartKind;
  note?: string;
}

export interface NodeOpCost {
  nodeId: string;
  name: string;
  /** Marginal cost of one operation touching this node (fee + metered only). */
  marginal: number;
  /** Amortized flat-infra share per operation (allocation). */
  amortizedFixed: number;
  /** marginal + amortizedFixed. */
  total: number;
  parts: CostPart[];
}

export interface OpCostCtx {
  aov: number;
  drivers: Record<string, number>;
  load: number;
  /** The driver of the flow being priced. Auto-attribution of a meter only
   *  applies when the meter's usage is driven by THIS driver (one op = one
   *  driver event); cross-driver meters must declare `perOp`. */
  flowDriver?: string;
}

/** Evaluate a single transaction fee against the average transaction value. */
function feeAmount(f: { percent?: number; fixed?: number; cap?: number; min?: number }, aov: number): number {
  let v = ((f.percent ?? 0) / 100) * aov + (f.fixed ?? 0);
  if (f.min != null) v = Math.max(v, f.min);
  if (f.cap != null) v = Math.min(v, f.cap);
  return v;
}

/** Lowest non-zero unit cost among a meter's tiers (the first paid rate). */
function firstPaidUnitCost(c: CostModel, unit: string): number | undefined {
  const m = c.meters?.find((x) => x.unit === unit);
  if (!m?.tiers) return undefined;
  const paid = m.tiers.filter((t) => t.unitCost > 0).sort((a, b) => a.unitCost - b.unitCost);
  return paid[0]?.unitCost;
}

/**
 * The marginal + amortized cost of one operation touching `node`.
 * `driverMonthlyQty` is the monthly volume of the flow's driver, used to
 * amortize flat infra; pass 0/undefined to omit the amortized-fixed part.
 */
export function nodeOpCost(node: Node, ctx: OpCostCtx, driverMonthlyQty?: number): NodeOpCost {
  const c = node.cost;
  const parts: CostPart[] = [];
  let marginal = 0;
  let amortizedFixed = 0;

  if (c) {
    // (a) processing fees — paid from unit 1.
    for (const f of c.transactionFees ?? []) {
      const amt = feeAmount(f, ctx.aov);
      if (amt > 0) {
        const pct = f.percent ? `${f.percent}%` : '';
        const fix = f.fixed ? `${pct ? ' + ' : ''}$${f.fixed}` : '';
        parts.push({ kind: 'fee', label: `${pct}${fix} of $${ctx.aov}`.trim(), amount: amt });
        marginal += amt;
      }
    }

    // (b) metered marginal — per-unit beyond free. A meter contributes to the
    // per-op toll only when its per-op consumption is attributable: an explicit
    // `perOp`, else a capacity.usage whose unit matches this meter. Otherwise it
    // contributes $0 (still counts in the monthly foresight) — so multi-meter
    // nodes don't fabricate a per-op charge. $0 (flagged) while within free.
    for (const m of c.meters ?? []) {
      const paidUnitCost = firstPaidUnitCost(c, m.unit);
      if (!paidUnitCost) continue;
      const u = node.capacity?.usage;
      // Auto-attribution is honest only when the meter's usage is driven by the
      // SAME driver as the flow — then one operation IS one driver event and
      // `perUnit` is genuinely per-op. A cross-driver meter (e.g. emails-per-
      // customer on an orders-driven flow) would over-attribute, so it must
      // declare `perOp`; otherwise it's left out of the per-op toll.
      const usageMatches =
        !!u &&
        (u.model === 'per_event' || u.model === 'cumulative') &&
        node.capacity?.unit === m.unit &&
        (ctx.flowDriver == null || u.driver === ctx.flowDriver);

      let unitsPerOp: number | undefined;
      let monthlyUnits: number | undefined;
      if (m.perOp != null) {
        unitsPerOp = m.perOp;
        if (driverMonthlyQty != null) monthlyUnits = m.perOp * driverMonthlyQty;
      } else if (usageMatches) {
        unitsPerOp = u!.perUnit ?? 1;
        if (u!.driver) monthlyUnits = (ctx.drivers[u!.driver] ?? 0) * ctx.load * (u!.perUnit ?? 0);
      }
      if (unitsPerOp == null) continue; // no honest per-op attribution → skip

      // Within free? Only if we can compare projected monthly usage to the
      // allowance; if we can't, assume within (don't overcharge).
      let withinFree = false;
      if (m.freeAllowance) {
        if (monthlyUnits != null) {
          const freeMonthly = m.freeAllowance.amount / (MONTHS_PER[m.freeAllowance.per] || 1);
          withinFree = monthlyUnits <= freeMonthly;
        } else {
          withinFree = true;
        }
      }

      const amt = withinFree ? 0 : unitsPerOp * paidUnitCost;
      const per = unitsPerOp === 1 ? `$${paidUnitCost}/${m.unit}` : `${unitsPerOp}×$${paidUnitCost}/${m.unit}`;
      parts.push({
        kind: 'metered',
        label: per,
        amount: amt,
        note: withinFree ? 'within free tier' : undefined,
      });
      marginal += amt;
    }

    // (c) amortized flat infra — allocated over the flow's monthly driver volume.
    if (c.fixedCost && driverMonthlyQty && driverMonthlyQty > 0) {
      const monthly = c.fixedCost * (c.fixedPeriod === 'year' ? 1 / 12 : 1);
      amortizedFixed = monthly / driverMonthlyQty;
      const periodLabel = c.fixedPeriod === 'year' ? '/yr' : '/mo';
      parts.push({
        kind: 'fixed',
        label: `$${c.fixedCost}${periodLabel} ÷ vol`,
        amount: amortizedFixed,
        note: 'amortized infra',
      });
    }
  }

  return { nodeId: node.id, name: node.name, marginal, amortizedFixed, total: marginal + amortizedFixed, parts };
}

/* ------------------------------------------------------------------ */
/* Cost along a flow — accrue the toll as the pulse travels           */
/* ------------------------------------------------------------------ */

export interface FlowCostStep {
  nodeId: string;
  name: string;
  edgeId: string;
  opCost: number;
  calls: number;
  contributed: number;
  cumulative: number;
  branch?: string;
  parts: CostPart[];
}

export interface FlowCost {
  currency: string;
  /** Cost of one full run of the flow (worst-case branch chosen). */
  perRun: number;
  /** Marginal-only per run (excludes amortized infra). */
  perRunMarginal: number;
  steps: FlowCostStep[];
  driver?: string;
  runsPerMonth?: number;
  monthlyTotal?: number;
  notes: string[];
}

/**
 * Accrue per-operation cost along a flow's steps in order. Each step attributes
 * its TARGET node's op-cost × callsPerRun. Mutually-exclusive branch groups
 * (steps sharing a `branch`) contribute only their worst-case alternative, so a
 * single run isn't double-charged for paths it can't both take.
 */
export function flowCost(
  project: Project,
  flow: Flow,
  driversOverride?: Record<string, number>,
): FlowCost {
  const drivers = driversOverride ?? project.drivers ?? {};
  const ctx: OpCostCtx = {
    aov: project.avgTransactionValue ?? 50,
    drivers,
    load: 1,
    flowDriver: flow.driver,
  };
  const nodeById = new Map<string, Node>();
  const index = (n: Node) => {
    nodeById.set(n.id, n);
    for (const ch of n.children ?? []) index(ch);
  };
  for (const n of project.nodes) index(n);
  const edgeById = new Map(project.edges.map((e) => [e.id, e]));

  const driverMonthlyQty = flow.driver ? drivers[flow.driver] : undefined;
  const notes: string[] = [];

  // Compute each step's contribution (target node op-cost × calls).
  interface Raw {
    step: FlowCostStep;
    branch?: string;
    order: number;
  }
  const raws: Raw[] = [];
  for (const s of flow.steps) {
    const edge = edgeById.get(s.edgeId);
    if (!edge) continue;
    const node = nodeById.get(edge.target);
    if (!node) continue;
    const oc = nodeOpCost(node, ctx, driverMonthlyQty);
    const calls = s.callsPerRun ?? 1;
    raws.push({
      order: s.order,
      branch: s.branch,
      step: {
        nodeId: node.id,
        name: node.name,
        edgeId: s.edgeId,
        opCost: oc.total,
        calls,
        contributed: oc.total * calls,
        cumulative: 0,
        branch: s.branch,
        parts: oc.parts,
      },
    });
  }

  // Collapse mutually-exclusive branch groups to their worst-case alternative.
  const chosen: Raw[] = [];
  const branchGroups = new Map<string, Raw[]>();
  for (const r of raws) {
    if (!r.branch) chosen.push(r);
    else {
      const g = branchGroups.get(r.branch);
      if (g) g.push(r);
      else branchGroups.set(r.branch, [r]);
    }
  }
  for (const [name, group] of branchGroups) {
    const worst = group.reduce((a, b) => (b.step.contributed > a.step.contributed ? b : a));
    chosen.push(worst);
    if (group.length > 1) {
      notes.push(`branch "${name}": worst of ${group.length} shown (${worst.step.name})`);
    }
  }

  chosen.sort((a, b) => a.order - b.order);

  let cumulative = 0;
  const currency = findCurrency(project) ?? 'USD';
  for (const r of chosen) {
    cumulative += r.step.contributed;
    r.step.cumulative = cumulative;
  }
  const perRun = cumulative;
  const perRunMarginal = chosen.reduce(
    (sum, r) => sum + r.step.parts.filter((p) => p.kind !== 'fixed').reduce((a, p) => a + p.amount, 0) * r.step.calls,
    0,
  );

  // Monthly run count tracks the flow's DRIVER when set, so projected cost
  // scales with the driver slider ("see the expense coming as orders grow").
  // Falls back to the statically declared volume when there's no driver.
  const runsPerMonth =
    driverMonthlyQty != null && driverMonthlyQty > 0
      ? driverMonthlyQty
      : flow.volume != null
        ? flow.volume.runsPerPeriod / (MONTHS_PER[flow.volume.period] || 1)
        : undefined;

  return {
    currency,
    perRun,
    perRunMarginal,
    steps: chosen.map((r) => r.step),
    driver: flow.driver,
    runsPerMonth,
    monthlyTotal: runsPerMonth != null ? perRun * runsPerMonth : undefined,
    notes,
  };
}

function findCurrency(project: Project): string | undefined {
  for (const n of project.nodes) if (n.cost?.currency) return n.cost.currency;
  return undefined;
}

/* ------------------------------------------------------------------ */
/* Project monthly projection — every cost type, driver-scaled         */
/* ------------------------------------------------------------------ */

export interface NodeMonthly {
  nodeId: string;
  name: string;
  monthly: number;
}

export interface MonthlyProjection {
  currency: string;
  /** Recurring flat infra (fixedCost normalized to month). */
  fixed: number;
  /** Per-operation costs (fees + metered), summed across all flows × volume. */
  marginal: number;
  total: number;
  /** Per-node monthly cost, descending. */
  byNode: NodeMonthly[];
}

/**
 * Total projected monthly cost at the current drivers. Marginal (fee + metered)
 * costs come from replaying every flow through the per-op engine × its monthly
 * run volume — so they're honest and driver-linked — plus recurring `fixedCost`
 * counted once per node. Complements analyzeCost's free-tier foresight with a
 * concrete "what this costs per month right now" that scales with the sliders.
 */
export function projectMonthly(
  project: Project,
  driversOverride?: Record<string, number>,
): MonthlyProjection {
  const drivers = driversOverride ?? project.drivers ?? {};
  const byId = new Map<string, number>();
  const nameById = new Map<string, string>();

  // Marginal (fee + metered) from every flow, scaled by its monthly run count.
  for (const flow of project.flows ?? []) {
    const fc = flowCost(project, flow, drivers);
    const runs = fc.runsPerMonth ?? 0;
    if (runs <= 0) continue;
    for (const s of fc.steps) {
      const perRunMarginal = s.parts
        .filter((p) => p.kind !== 'fixed')
        .reduce((a, p) => a + p.amount, 0);
      const monthly = perRunMarginal * s.calls * runs;
      if (monthly > 0) {
        byId.set(s.nodeId, (byId.get(s.nodeId) ?? 0) + monthly);
        nameById.set(s.nodeId, s.name);
      }
    }
  }
  let marginal = 0;
  for (const v of byId.values()) marginal += v;

  // Recurring flat infra, once per node. This is the PROJECTED monthly, so it
  // includes planned/proposed future costs (e.g. an annual domain registered at
  // cutover) — amortized to /mo — and excludes only retired/external. Annual
  // (`fixedPeriod: 'year'`) is divided to a monthly equivalent.
  let fixed = 0;
  const walk = (n: Node) => {
    const c = n.cost;
    if (c?.fixedCost && n.buildState !== 'retired' && n.ownership !== 'external') {
      const mo = c.fixedCost * (c.fixedPeriod === 'year' ? 1 / 12 : 1);
      fixed += mo;
      byId.set(n.id, (byId.get(n.id) ?? 0) + mo);
      nameById.set(n.id, n.name);
    }
    for (const ch of n.children ?? []) walk(ch);
  };
  for (const n of project.nodes) walk(n);

  const byNode = [...byId.entries()]
    .map(([nodeId, monthly]) => ({ nodeId, name: nameById.get(nodeId) ?? nodeId, monthly }))
    .sort((a, b) => b.monthly - a.monthly);

  return { currency: findCurrency(project) ?? 'USD', fixed, marginal, total: fixed + marginal, byNode };
}
