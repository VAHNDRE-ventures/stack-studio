import { describe, it, expect } from 'vitest';
import type { Project, Node } from '@model/types';
import { MODEL_VERSION } from '@model/types';
import { analyzeCost } from './costForesight';

function node(p: Partial<Node> & { id: string }): Node {
  return { name: p.id, kind: 'other', ownership: 'owned', buildState: 'active', ...p } as Node;
}

const project: Project = {
  modelVersion: MODEL_VERSION,
  name: 't',
  avgTransactionValue: 42,
  drivers: { orders: 500 },
  nodes: [
    node({ id: 'db', cost: { currency: 'USD', fixedCost: 15, fixedPeriod: 'month', fixedCostDescription: 'Managed Postgres' } }),
    node({ id: 'domain', cost: { currency: 'USD', fixedCost: 11, fixedPeriod: 'year' } }),
    node({ id: 'paypal', cost: { currency: 'USD', transactionFees: [{ percent: 2.9, fixed: 0.3 }] } }),
    // planned node must be excluded from the current-state rollup:
    node({ id: 'future', buildState: 'planned', cost: { currency: 'USD', fixedCost: 999, fixedPeriod: 'month' } }),
  ],
  edges: [],
};

describe('analyzeCost contributor breakdown', () => {
  const c = analyzeCost(project);

  it('fixed contributors sum to the monthly-fixed total (planned excluded)', () => {
    const sum = c.fixedContribs.reduce((a, f) => a + f.monthly, 0);
    expect(sum).toBeCloseTo(c.monthlyFixed, 6);
    // 15/mo + 11/yr(=0.9166) = 15.9166; the $999 planned node is excluded.
    expect(c.monthlyFixed).toBeCloseTo(15.9167, 3);
    expect(c.fixedContribs.map((f) => f.nodeId)).not.toContain('future');
  });

  it('txn contributors sum to the per-txn total', () => {
    const sum = c.txnContribs.reduce((a, t) => a + t.perTxn, 0);
    expect(sum).toBeCloseTo(c.perTxn, 6);
    // 2.9% × 42 + 0.30 = 1.518
    expect(c.perTxn).toBeCloseTo(1.518, 3);
  });

  it('sorts contributors by amount descending', () => {
    expect(c.fixedContribs[0].nodeId).toBe('db'); // 15 > 0.92
  });
});
