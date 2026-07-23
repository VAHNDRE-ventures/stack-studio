import type { Project, Node } from '@model/types';
import { OVERLAY_ZONE_KINDS, OVERLAY_PALETTE } from './visuals';

/** Average of each driver's ratio vs baseline, clamped — drives traffic density. */
export function loadFactor(project: Project, drivers: Record<string, number>): number {
  const base = project.drivers ?? {};
  const keys = Object.keys(base);
  if (!keys.length) return 1;
  const f =
    keys.reduce(
      (s, k) => s + ((base[k] ?? 0) > 0 ? (drivers[k] ?? 0) / (base[k] as number) : 1),
      0,
    ) / keys.length;
  return Math.max(0.2, Math.min(12, f));
}

export interface OverlayInfo {
  zones: Project['zones'];
  colorOf: Record<string, string>;
  counts: Record<string, number>;
}

/** Overlay (compliance/tenant) zones + their assigned colors + member counts. */
export function overlayInfo(project: Project): OverlayInfo {
  const zones = (project.zones ?? []).filter((z) => OVERLAY_ZONE_KINDS.includes(z.kind));
  const colorOf: Record<string, string> = {};
  zones.forEach((z, i) => (colorOf[z.id] = OVERLAY_PALETTE[i % OVERLAY_PALETTE.length]));
  const ids = new Set(zones.map((z) => z.id));
  const counts: Record<string, number> = {};
  const walk = (n: Node) => {
    for (const zid of n.zoneIds ?? []) if (ids.has(zid)) counts[zid] = (counts[zid] ?? 0) + 1;
    (n.children ?? []).forEach(walk);
  };
  project.nodes.forEach(walk);
  return { zones, colorOf, counts };
}
