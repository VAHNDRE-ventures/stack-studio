import type { Project, Node } from '@model/types';
import { matchRate, type RateEntry } from './rateCatalog';
import { crossing, MONTHS_PER, type Crossing } from './usage';

const toMonth: Record<string, number> = { day: 30, week: 4.345, month: 1, year: 1 / 12 };
const weeksPer: Record<string, number> = { day: 1 / 7, week: 1, month: 4.345, year: 52 };

export interface Cliff {
  name: string;
  weeks: number;
  usedPct: number;
}

export interface CatalogCliff {
  key: string;
  label: string;
  binding: string;
  crossedAt?: number;
  crossed?: boolean;
  crossText?: string;
}

/** A node contributing to the monthly-fixed rollup. */
export interface FixedContrib {
  nodeId: string;
  name: string;
  monthly: number;
  detail?: string;
}

/** A node contributing to the per-transaction rollup. */
export interface TxnContrib {
  nodeId: string;
  name: string;
  percent: number;
  fixed: number;
  perTxn: number;
}

export interface CostSummary {
  currency: string;
  monthlyFixed: number;
  txnPctTotal: number;
  txnFixedTotal: number;
  perTxn: number;
  hasTxn: boolean;
  cliffs: Cliff[];
  catalogCliffs: CatalogCliff[];
  fixedContribs: FixedContrib[];
  txnContribs: TxnContrib[];
  headline: string;
}

// Current-state rollup: planned/proposed excluded; external actors excluded.
const CURRENT = new Set(['active', 'in_progress', 'deprecated']);

export function analyzeCost(
  project: Project,
  driversOverride?: Record<string, number>,
): CostSummary {
  const aov = project.avgTransactionValue ?? 50;
  const drivers = driversOverride ?? project.drivers ?? {};
  const horizon = project.horizonMonths ?? 12;
  const load = 1;
  let monthlyFixed = 0;
  let txnPctTotal = 0;
  let txnFixedTotal = 0;
  let currency = 'USD';
  const cliffs: Cliff[] = [];
  const fixedContribs: FixedContrib[] = [];
  const txnContribs: TxnContrib[] = [];
  const matched = new Map<string, RateEntry>();
  const crossInfo = new Map<string, Crossing>();

  const walk = (n: Node) => {
    const current = CURRENT.has(n.buildState) && n.ownership !== 'external';
    const c = n.cost;
    if (current) {
      // Match on the node's own identity (provider + name) first; only fall back
      // to `technology` if that finds nothing — otherwise a node whose technology
      // mentions the services it integrates with (e.g. a worker "…Resend/Sanity…")
      // would be mis-attributed another provider's cliff.
      const r =
        matchRate(`${c?.provider ?? ''} ${n.name}`) ??
        (n.technology ? matchRate(n.technology) : undefined);
      if (r) {
        matched.set(r.key, r);
        // Where this component crosses its free tier, in driver / time terms.
        if (r.freeAllowance && n.capacity?.usage) {
          const per = n.capacity.per ?? 'month';
          const freeInPer =
            r.freeAllowance.amount * (MONTHS_PER[per] / MONTHS_PER[r.freeAllowance.per]);
          const cr = crossing(n, drivers, freeInPer, load, horizon);
          if (cr) {
            const prev = crossInfo.get(r.key);
            if (!prev || (cr.loadAt ?? Infinity) < (prev.loadAt ?? Infinity)) {
              crossInfo.set(r.key, cr);
            }
          }
        }
      }
    }
    if (c && current) {
      if (c.currency) currency = c.currency;
      if (c.fixedCost) {
        const monthly = c.fixedCost * (c.fixedPeriod === 'year' ? 1 / 12 : 1);
        monthlyFixed += monthly;
        fixedContribs.push({ nodeId: n.id, name: n.name, monthly, detail: c.fixedCostDescription });
      }
      let nodePct = 0;
      let nodeFixed = 0;
      for (const f of c.transactionFees ?? []) {
        txnPctTotal += f.percent ?? 0;
        txnFixedTotal += f.fixed ?? 0;
        nodePct += f.percent ?? 0;
        nodeFixed += f.fixed ?? 0;
      }
      if (nodePct > 0 || nodeFixed > 0) {
        txnContribs.push({
          nodeId: n.id,
          name: n.name,
          percent: nodePct,
          fixed: nodeFixed,
          perTxn: (nodePct / 100) * aov + nodeFixed,
        });
      }
      const proj = project.projections?.[n.id];
      for (const m of c.meters ?? []) {
        if (!m.freeAllowance || !proj) continue;
        const freeMo = m.freeAllowance.amount * (toMonth[m.freeAllowance.per] ?? 1);
        const curMo = proj.current * (toMonth[proj.period] ?? 1);
        if (freeMo <= 0) continue;
        const usedPct = curMo / freeMo;
        let weeks = 0;
        if (usedPct < 1) {
          const wpp = weeksPer[proj.period] ?? 4.345;
          if (proj.growthModel === 'compound' && proj.ratePerPeriod > 0) {
            weeks = Math.ceil((Math.log(freeMo / curMo) / Math.log(1 + proj.ratePerPeriod)) * wpp);
          } else if (proj.ratePerPeriod > 0) {
            weeks = Math.ceil(((freeMo - curMo) / (proj.ratePerPeriod * curMo)) * wpp);
          } else {
            weeks = Infinity;
          }
        }
        cliffs.push({ name: n.name, weeks, usedPct });
      }
    }
    for (const ch of n.children ?? []) walk(ch);
  };
  for (const n of project.nodes) walk(n);

  cliffs.sort((a, b) => a.weeks - b.weeks);
  const catalogCliffs: CatalogCliff[] = [...matched.values()]
    .filter((e) => e.freeAllowance)
    .map((e) => {
      const cr = crossInfo.get(e.key);
      const crossedAt = cr?.loadAt;
      return {
        key: e.key,
        label: e.label,
        binding: e.binding,
        crossedAt,
        crossed: crossedAt != null && load >= crossedAt,
        crossText: cr?.text,
      };
    })
    .sort((a, b) => (a.crossedAt ?? Infinity) - (b.crossedAt ?? Infinity));

  const perTxn = (txnPctTotal / 100) * aov + txnFixedTotal;
  const hasTxn = txnPctTotal > 0 || txnFixedTotal > 0;

  const crossedNow = catalogCliffs.filter((c) => c.crossed);
  const soonest = catalogCliffs.find((c) => c.crossText);
  let headline: string;
  if (cliffs.length && Number.isFinite(cliffs[0].weeks)) {
    headline =
      cliffs[0].weeks <= 0
        ? `${cliffs[0].name} is over its free tier now`
        : `First paid cliff: ${cliffs[0].name} in ~${cliffs[0].weeks}w`;
  } else if (crossedNow.length) {
    headline = `Over free tier: ${crossedNow.map((c) => c.label).slice(0, 2).join(', ')}`;
  } else if (soonest?.crossText) {
    headline = `${soonest.label}: ${soonest.crossText}`;
  } else if (catalogCliffs.length) {
    headline = `First free-tier cliff: ${catalogCliffs[0].label} — ${catalogCliffs[0].binding}`;
  } else if (hasTxn) {
    headline = `No free-tier cliffs · ${currency} ${perTxn.toFixed(2)}/txn variable`;
  } else {
    headline = 'All within free tiers';
  }

  return {
    currency,
    monthlyFixed,
    txnPctTotal,
    txnFixedTotal,
    perTxn,
    hasTxn,
    cliffs,
    catalogCliffs,
    fixedContribs: fixedContribs.sort((a, b) => b.monthly - a.monthly),
    txnContribs: txnContribs.sort((a, b) => b.perTxn - a.perTxn),
    headline,
  };
}
