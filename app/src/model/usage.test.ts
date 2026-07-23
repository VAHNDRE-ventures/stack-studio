import { describe, it, expect } from 'vitest';
import type { Node } from '@model/types';
import { projectedUsage } from './usage';
import { nodeCongestion } from './load';

function node(cap: Node['capacity']): Node {
  return { id: 'n', name: 'n', kind: 'other', ownership: 'owned', buildState: 'active', capacity: cap } as Node;
}

describe('multi-driver load (usage.plus)', () => {
  // emails/day, ceiling 100; 4/order + 1/customer.
  const resend = node({
    unit: 'emails',
    per: 'day',
    ceiling: 100,
    usage: { model: 'per_event', driver: 'orders', perUnit: 4, plus: [{ driver: 'customers', perUnit: 1 }] },
  });

  it('congestion reacts to BOTH drivers, not just the primary', () => {
    // baseline: (500×4 + 400×1)=2400/mo → /30 = 80/day → ratio 0.80
    const base = nodeCongestion(resend, { orders: 500, customers: 400 }, 1, 12)!;
    expect(base).toBeCloseTo(0.8, 2);

    // push ORDERS only → pressure must rise (this was the Resend bug)
    const moreOrders = nodeCongestion(resend, { orders: 1000, customers: 400 }, 1, 12)!;
    expect(moreOrders).toBeGreaterThan(base);
    // (1000×4 + 400)/30 = 4400/30 = 146.7/day → 1.467
    expect(moreOrders).toBeCloseTo(1.467, 2);

    // push CUSTOMERS only → also rises
    const moreCust = nodeCongestion(resend, { orders: 500, customers: 800 }, 1, 12)!;
    expect(moreCust).toBeGreaterThan(base);
  });

  it('single-driver usage is unchanged (back-compat)', () => {
    const single = node({
      unit: 'emails',
      per: 'day',
      ceiling: 100,
      usage: { model: 'per_event', driver: 'orders', perUnit: 4 },
    });
    // 500×4/30 = 66.7/day → 0.667
    expect(projectedUsage(single, { orders: 500 }, 1, 12)!.ratio).toBeCloseTo(0.667, 2);
  });
});
