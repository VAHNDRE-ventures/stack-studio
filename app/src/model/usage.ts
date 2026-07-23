import type { Node } from '@model/types';

/** Months contained in one `per` window (drivers are monthly). */
export const MONTHS_PER: Record<string, number> = {
  day: 1 / 30,
  week: 7 / 30,
  month: 1,
  year: 12,
};

export interface UsageResult {
  value: number; // projected usage in the capacity.per window (or total, cumulative)
  ceiling?: number;
  ratio?: number;
  model: 'per_event' | 'cumulative' | 'operational';
}

/** Monthly load rate = primary driver contribution + every `plus` term. */
function monthlyRate(u: { driver?: string; perUnit?: number; plus?: { driver: string; perUnit: number }[] }, drivers: Record<string, number>): number {
  let r = (drivers[u.driver ?? ''] ?? 0) * (u.perUnit ?? 0);
  for (const t of u.plus ?? []) r += (drivers[t.driver] ?? 0) * t.perUnit;
  return r;
}

/** Projected usage for a node at a load multiplier, using its usage model. */
export function projectedUsage(
  n: Node,
  drivers: Record<string, number>,
  load: number,
  horizonMonths: number,
): UsageResult | undefined {
  const cap = n.capacity;
  const u = cap?.usage;
  if (!cap || !u) return undefined;
  const per = cap.per ?? 'month';
  let value: number;
  let ratio: number | undefined;
  if (u.model === 'operational') {
    value = u.fixed ?? 0;
    ratio = cap.ceiling ? value / cap.ceiling : undefined;
  } else {
    const monthly = monthlyRate(u, drivers) * load;
    if (u.model === 'cumulative') {
      // `value` is the monthly fill RATE; the ceiling is a running total, so
      // pressure = fraction of the cap consumed over the planning horizon.
      value = monthly;
      ratio = cap.ceiling ? (monthly * horizonMonths) / cap.ceiling : undefined;
    } else {
      value = monthly * MONTHS_PER[per];
      ratio = cap.ceiling ? value / cap.ceiling : undefined;
    }
  }
  return { value, ceiling: cap.ceiling, ratio, model: u.model };
}

export interface Crossing {
  text: string;
  /** Load multiplier at which usage crosses the threshold (per_event only). */
  loadAt?: number;
}

/**
 * When usage crosses a threshold (in the capacity.per window for per_event /
 * operational, or a total for cumulative), expressed in the terms that matter:
 * driver quantity for rates, months for cumulative, "independent" for ops.
 */
export function crossing(
  n: Node,
  drivers: Record<string, number>,
  threshold: number,
  load: number,
  _horizonMonths: number,
): Crossing | undefined {
  const cap = n.capacity;
  const u = cap?.usage;
  if (!cap || !u) return undefined;
  const per = cap.per ?? 'month';

  if (u.model === 'operational') {
    const v = u.fixed ?? 0;
    return {
      text:
        v >= threshold
          ? `operational · ${v}/${per} exceeds ${threshold} free`
          : `operational · independent of load (${v}/${per})`,
    };
  }

  const d = drivers[u.driver ?? ''] ?? 0;
  const perUnit = u.perUnit ?? 0;
  if (d <= 0 || perUnit <= 0) return undefined;

  // Contribution of any additional (plus) drivers at their current levels.
  let plusMonthly = 0;
  for (const t of u.plus ?? []) plusMonthly += (drivers[t.driver] ?? 0) * t.perUnit;

  if (u.model === 'per_event') {
    // Monthly primary-driver quantity at which total usage hits the threshold,
    // holding other drivers at their current levels.
    const driverAt = (threshold / MONTHS_PER[per] - plusMonthly) / perUnit;
    if (driverAt <= 0) return { text: `over free from other drivers`, loadAt: 0 };
    const loadAt = driverAt / d;
    return { text: `crosses at ~${fmt(driverAt)} ${u.driver}/mo`, loadAt };
  }

  // cumulative: months until the accumulated total reaches the threshold
  const monthly = (d * perUnit + plusMonthly) * load;
  const monthsAt = monthly > 0 ? threshold / monthly : Infinity;
  return { text: Number.isFinite(monthsAt) ? `fills in ~${Math.round(monthsAt)} mo` : 'stable' };
}

function fmt(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return `${Math.round(n)}`;
}
