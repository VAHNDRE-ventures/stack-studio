import type { Node } from '@model/types';
import { projectedUsage } from './usage';

/** Load presets for the traffic-model selector. */
export const LOADS = [
  { label: '×1', v: 1 },
  { label: '×3', v: 3 },
  { label: '×10', v: 10 },
  { label: 'Spike', v: 30 },
];

/**
 * Congestion ratio at a given load: projected usage (from the node's usage
 * model + project drivers) over its capacity ceiling. Undefined when the node
 * declares no usage model — so un-modeled components never raise a false alarm.
 */
export function nodeCongestion(
  n: Node,
  drivers: Record<string, number>,
  load: number,
  horizonMonths: number,
): number | undefined {
  return projectedUsage(n, drivers, load, horizonMonths)?.ratio;
}

/** Heat color for a congestion ratio; undefined below the "worth showing" threshold. */
export function heatColor(ratio: number): string | undefined {
  if (ratio < 0.6) return undefined;
  if (ratio < 0.9) return '#f9e2af'; // amber — approaching
  if (ratio < 1.1) return '#fab387'; // orange — at capacity
  return '#f38ba8'; // red — over
}
