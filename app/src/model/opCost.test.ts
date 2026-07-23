import { describe, it, expect } from 'vitest';
import type { Project, Node } from '@model/types';
import { MODEL_VERSION } from '@model/types';
import { nodeOpCost, flowCost, projectMonthly, type OpCostCtx } from './opCost';

const ctx: OpCostCtx = { aov: 50, drivers: { orders: 500, requests: 4000 }, load: 1 };

function node(partial: Partial<Node> & { id: string }): Node {
  return { name: partial.id, kind: 'other', ownership: 'owned', buildState: 'active', ...partial } as Node;
}

describe('nodeOpCost — three cost shapes', () => {
  it('processing fee: percent × aov + fixed, paid from unit 1', () => {
    const paypal = node({ id: 'paypal', cost: { transactionFees: [{ percent: 3.49, fixed: 0.49 }] } });
    const oc = nodeOpCost(paypal, ctx);
    // 0.0349*50 + 0.49 = 2.235
    expect(oc.marginal).toBeCloseTo(2.235, 3);
    expect(oc.parts[0].kind).toBe('fee');
  });

  it('metered per-unit with no free tier: $6/label × 1 label/order', () => {
    const easypost = node({
      id: 'easypost',
      capacity: { unit: 'labels', per: 'month', usage: { model: 'per_event', driver: 'orders', perUnit: 1 } },
      cost: { meters: [{ unit: 'labels', tiers: [{ name: 'per', upTo: null, unitCost: 6 }] }] },
    });
    const oc = nodeOpCost(easypost, ctx);
    expect(oc.marginal).toBeCloseTo(6, 6);
    expect(oc.parts[0].kind).toBe('metered');
  });

  it('metered within free tier reads $0 and is flagged', () => {
    // 4000 requests/mo × 20 = 80k/mo, free is 3M/mo → within free.
    const cdn = node({
      id: 'cdn',
      capacity: { unit: 'per-request', per: 'month', usage: { model: 'per_event', driver: 'requests', perUnit: 20 } },
      cost: {
        meters: [
          {
            unit: 'per-request',
            freeAllowance: { amount: 100000, per: 'day' },
            tiers: [{ name: 'paid', upTo: null, unitCost: 0.0000003 }],
          },
        ],
      },
    });
    const oc = nodeOpCost(cdn, ctx);
    expect(oc.marginal).toBe(0);
    expect(oc.parts.find((p) => p.kind === 'metered')?.note).toBe('within free tier');
  });

  it('annual fixed amortized over monthly driver volume', () => {
    const host = node({ id: 'host', cost: { fixedCost: 240, fixedPeriod: 'year' } });
    // 240/yr → 20/mo ÷ 500 orders/mo = 0.04/order
    const oc = nodeOpCost(host, ctx, 500);
    expect(oc.amortizedFixed).toBeCloseTo(0.04, 6);
    expect(oc.marginal).toBe(0);
    expect(oc.total).toBeCloseTo(0.04, 6);
  });

  it('omits amortized fixed when no driver volume is given', () => {
    const host = node({ id: 'host', cost: { fixedCost: 240, fixedPeriod: 'year' } });
    expect(nodeOpCost(host, ctx).amortizedFixed).toBe(0);
  });

  it('multi-meter node: postage via perOp tolls, within-free platform fee is $0', () => {
    const easypost = node({
      id: 'ep',
      capacity: { unit: 'labels', per: 'month', usage: { model: 'per_event', driver: 'orders', perUnit: 1 } },
      cost: {
        meters: [
          { unit: 'labels', freeAllowance: { amount: 3000, per: 'month' }, tiers: [{ name: 'p', upTo: null, unitCost: 0.08 }] },
          { unit: 'postage', perOp: 1, tiers: [{ name: 'p', upTo: null, unitCost: 6 }] },
        ],
      },
    });
    // labels 500/mo ≤ 3000 free → $0; postage perOp 1 × $6 → $6
    expect(nodeOpCost(easypost, ctx, 500).marginal).toBeCloseTo(6, 6);
  });

  it('unattributed meters (seats/bandwidth) contribute $0 — no fabricated per-op charge', () => {
    const sanity = node({
      id: 'sanity',
      capacity: { unit: 'documents', per: 'month', usage: { model: 'cumulative', driver: 'orders', perUnit: 4 } },
      cost: {
        meters: [
          { unit: 'documents', freeAllowance: { amount: 10000, per: 'month' }, tiers: [{ name: 'p', upTo: null, unitCost: 0.006 }] },
          { unit: 'seats', freeAllowance: { amount: 20, per: 'month' }, tiers: [{ name: 'p', upTo: null, unitCost: 15 }] },
          { unit: 'bandwidth-gb', freeAllowance: { amount: 100, per: 'month' }, tiers: [{ name: 'p', upTo: null, unitCost: 0.3 }] },
        ],
      },
    });
    // documents 2000/mo ≤ 10k → $0; seats & bandwidth have no per-op attribution → skipped
    expect(nodeOpCost(sanity, ctx, 500).marginal).toBe(0);
  });
});

describe('flowCost — toll along a flow', () => {
  const project: Project = {
    modelVersion: MODEL_VERSION,
    name: 't',
    avgTransactionValue: 50,
    drivers: { orders: 500 },
    nodes: [
      node({ id: 'orders' }),
      node({ id: 'paypal', cost: { currency: 'USD', transactionFees: [{ percent: 3.49, fixed: 0.49 }] } }),
      node({ id: 'crypto', cost: { currency: 'USD', transactionFees: [{ percent: 1 }] } }),
      node({
        id: 'ship',
        capacity: { unit: 'labels', per: 'month', usage: { model: 'per_event', driver: 'orders', perUnit: 1 } },
        cost: { currency: 'USD', meters: [{ unit: 'labels', tiers: [{ name: 'p', upTo: null, unitCost: 6 }] }] },
      }),
    ],
    edges: [
      { id: 'e-pay', source: 'orders', target: 'paypal', kind: 'sync_request' },
      { id: 'e-crypto', source: 'orders', target: 'crypto', kind: 'sync_request' },
      { id: 'e-ship', source: 'orders', target: 'ship', kind: 'async_event' },
    ],
    flows: [
      {
        id: 'f',
        name: 'checkout',
        driver: 'orders',
        volume: { runsPerPeriod: 500, period: 'month' },
        steps: [
          { id: 's1', edgeId: 'e-pay', order: 1, branch: 'pay' },
          { id: 's2', edgeId: 'e-crypto', order: 1, branch: 'pay' },
          { id: 's3', edgeId: 'e-ship', order: 2 },
        ],
      },
    ],
  };

  it('accrues worst-case branch + non-branch steps, with cumulative', () => {
    const fc = flowCost(project, project.flows![0]);
    // worst-of-branch = PayPal 2.235 (> crypto 0.5), + ship 6 = 8.235
    expect(fc.perRun).toBeCloseTo(8.235, 3);
    expect(fc.steps).toHaveLength(2); // one branch alternative + ship
    expect(fc.steps[fc.steps.length - 1].cumulative).toBeCloseTo(8.235, 3);
    expect(fc.notes.some((n) => n.includes('branch'))).toBe(true);
  });

  it('projects monthly total from run volume', () => {
    const fc = flowCost(project, project.flows![0]);
    // 8.235 × 500 = 4117.5
    expect(fc.monthlyTotal).toBeCloseTo(4117.5, 1);
  });

  it('monthly projection tracks the driver override (see the expense coming)', () => {
    const fc = flowCost(project, project.flows![0], { orders: 1000 });
    // driver doubled → monthly cost doubles: 8.235 × 1000 = 8235
    expect(fc.runsPerMonth).toBe(1000);
    expect(fc.monthlyTotal).toBeCloseTo(8235, 1);
  });

  it('cross-driver meter does NOT auto-attribute per-op (needs perOp)', () => {
    // Resend-like: emails metered per CUSTOMER, but the flow is driven by ORDERS.
    // perUnit (9 emails/customer/mo) must NOT be read as 9 emails/op.
    const notifyMeter = {
      unit: 'emails',
      freeAllowance: { amount: 10, per: 'month' as const },
      tiers: [{ name: 'p', upTo: null, unitCost: 0.001 }],
    };
    const base = {
      modelVersion: MODEL_VERSION,
      name: 't',
      avgTransactionValue: 50,
      drivers: { orders: 500, customers: 400 },
      edges: [{ id: 'e-n', source: 'orders', target: 'notify', kind: 'async_event' as const }],
      flows: [
        {
          id: 'f',
          name: 'checkout',
          driver: 'orders',
          steps: [{ id: 's', edgeId: 'e-n', order: 1 }],
        },
      ],
    };
    const withoutPerOp: Project = {
      ...base,
      nodes: [
        node({ id: 'orders' }),
        node({
          id: 'notify',
          capacity: { unit: 'emails', per: 'month', usage: { model: 'per_event', driver: 'customers', perUnit: 9 } },
          cost: { currency: 'USD', meters: [notifyMeter] },
        }),
      ],
    };
    // Over free (400×9=3600 » 10) but driver ≠ flow driver → skipped, $0.
    expect(flowCost(withoutPerOp, withoutPerOp.flows![0]).perRun).toBe(0);

    const withPerOp: Project = {
      ...base,
      nodes: [
        node({ id: 'orders' }),
        node({
          id: 'notify',
          capacity: { unit: 'emails', per: 'month', usage: { model: 'per_event', driver: 'customers', perUnit: 9 } },
          cost: { currency: 'USD', meters: [{ ...notifyMeter, perOp: 1 }] },
        }),
      ],
    };
    // perOp:1 → one email per op × $0.001 (over free) = $0.001, not 9×.
    expect(flowCost(withPerOp, withPerOp.flows![0]).perRun).toBeCloseTo(0.001, 6);
  });

  it('projectMonthly covers every cost type, driver-scaled, surfaced per node', () => {
    const withFixed: Project = {
      ...project,
      nodes: [
        ...project.nodes,
        node({ id: 'db', cost: { currency: 'USD', fixedCost: 15, fixedPeriod: 'month' } }),
      ],
    };
    const mp = projectMonthly(withFixed, { orders: 500 });
    // marginal: (paypal 2.235 + ship 6) × 500 = 4117.5 ; fixed: 15/mo
    expect(mp.marginal).toBeCloseTo(4117.5, 1);
    expect(mp.fixed).toBeCloseTo(15, 6);
    expect(mp.total).toBeCloseTo(4132.5, 1);
    // EasyPost postage is the biggest line (6×500=3000) and IS surfaced per node.
    expect(mp.byNode[0].nodeId).toBe('ship');
    expect(mp.byNode.find((n) => n.nodeId === 'ship')!.monthly).toBeCloseTo(3000, 1);
    // scales with the driver
    expect(projectMonthly(withFixed, { orders: 1000 }).marginal).toBeCloseTo(8235, 1);
  });

  it('projectMonthly includes PLANNED future costs, annual amortized to /mo', () => {
    const withPlannedAnnual: Project = {
      ...project,
      nodes: [
        ...project.nodes,
        node({
          id: 'domain',
          buildState: 'planned',
          cost: { currency: 'USD', fixedCost: 10.44, fixedPeriod: 'year' },
        }),
      ],
    };
    const mp = projectMonthly(withPlannedAnnual, { orders: 500 });
    // 10.44/yr ÷ 12 = 0.87/mo, included despite being planned (projected view)
    expect(mp.fixed).toBeCloseTo(0.87, 2);
    expect(mp.byNode.find((n) => n.nodeId === 'domain')!.monthly).toBeCloseTo(0.87, 2);
  });
});
