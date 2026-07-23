import type { Node, Zone, Id, ZoneKind } from '@model/types';
import { CONTAINMENT_ZONE_KINDS, OVERLAY_ZONE_KINDS } from './visuals';

export type Vec3 = [number, number, number];

export interface DistrictBox {
  zoneId: Id;
  kind: ZoneKind;
  name: string;
  center: Vec3;
  size: [number, number]; // width (x), depth (z)
}

export interface OverlayBox {
  zoneId: Id;
  kind: ZoneKind;
  name: string;
  min: Vec3;
  max: Vec3;
}

export interface Placement {
  positions: Record<Id, Vec3>;
  districts: DistrictBox[];
  overlays: OverlayBox[];
}

const SPACING = 4.6;
const DISTRICT_GAP = 8;
const PAD = 2.6;

/**
 * Zone-banded layout: containment zones become districts stacked front-to-back
 * (public edge → authenticated → data plane → third parties), each holding its
 * nodes in a centered grid. Non-containment zones (compliance/tenant) become
 * cross-cutting AABB overlays around their members wherever they landed. Whole
 * city is centered on the origin.
 */
export function layoutCity(nodes: Node[], zones: Zone[]): Placement {
  const zoneById = new Map<Id, Zone>();
  for (const z of zones) zoneById.set(z.id, z);

  const primaryZone = (zoneIds: Id[] | undefined): Zone | undefined => {
    for (const zid of zoneIds ?? []) {
      const z = zoneById.get(zid);
      if (z && !OVERLAY_ZONE_KINDS.includes(z.kind)) return z;
    }
    return undefined;
  };

  const groups = new Map<string, Id[]>();
  for (const n of nodes) {
    const z = primaryZone(n.zoneIds);
    const key = z ? z.id : '__ungrouped__';
    const arr = groups.get(key);
    if (arr) arr.push(n.id);
    else groups.set(key, [n.id]);
  }

  const ord = (k: ZoneKind) => {
    const i = CONTAINMENT_ZONE_KINDS.indexOf(k);
    return i >= 0 ? i : 99;
  };
  const containmentZones = zones
    .filter((z) => !OVERLAY_ZONE_KINDS.includes(z.kind))
    .sort((a, b) => ord(a.kind) - ord(b.kind));

  interface Plan {
    zoneId: Id;
    kind: ZoneKind;
    name: string;
    ids: Id[];
    cols: number;
    rows: number;
    width: number;
    depth: number;
  }

  const plans: Plan[] = [];
  const plan = (zoneId: Id, kind: ZoneKind, name: string, ids: Id[]) => {
    const cols = Math.max(1, Math.ceil(Math.sqrt(ids.length)));
    const rows = Math.max(1, Math.ceil(ids.length / cols));
    plans.push({
      zoneId,
      kind,
      name,
      ids,
      cols,
      rows,
      width: cols * SPACING + PAD * 2,
      depth: rows * SPACING + PAD * 2,
    });
  };

  for (const z of containmentZones) plan(z.id, z.kind, z.name, groups.get(z.id) ?? []);
  const ungrouped = groups.get('__ungrouped__') ?? [];
  if (ungrouped.length) plan('__ungrouped__', 'other', 'Unzoned', ungrouped);

  // Pack districts into a compact grid instead of one long front-to-back ribbon
  // (keeps the city footprint balanced rather than stretched).
  const cols = Math.max(1, Math.ceil(Math.sqrt(plans.length)));
  const rowsN = Math.ceil(plans.length / cols);
  const cellW = Math.max(1, ...plans.map((p) => p.width)) + DISTRICT_GAP;
  const cellD = Math.max(1, ...plans.map((p) => p.depth)) + DISTRICT_GAP;

  const positions: Record<Id, Vec3> = {};
  const target: Record<Id, { x: number; z: number }> = {};
  const zoneMembers: { zoneId: Id; kind: ZoneKind; name: string; ids: Id[] }[] = [];

  plans.forEach((p, di) => {
    const col = di % cols;
    const row = Math.floor(di / cols);
    const dcx = (col - (cols - 1) / 2) * cellW;
    const dcz = (row - (rowsN - 1) / 2) * cellD;
    p.ids.forEach((id, i) => {
      const c = i % p.cols;
      const r = Math.floor(i / p.cols);
      positions[id] = [
        dcx + (c - (p.cols - 1) / 2) * SPACING,
        0,
        dcz + (r - (p.rows - 1) / 2) * SPACING,
      ];
      target[id] = { x: dcx, z: dcz };
    });
    zoneMembers.push({ zoneId: p.zoneId, kind: p.kind, name: p.name, ids: p.ids });
  });

  relax(positions, target);

  // Districts are recomputed from the relaxed member positions so the plates
  // still bound their nodes.
  const districts: DistrictBox[] = [];
  for (const zm of zoneMembers) {
    if (!zm.ids.length) continue;
    const b = bounds(zm.ids.map((id) => positions[id]));
    districts.push({
      zoneId: zm.zoneId,
      kind: zm.kind,
      name: zm.name,
      center: [(b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2],
      size: [b.maxX - b.minX + PAD * 2, b.maxZ - b.minZ + PAD * 2],
    });
  }

  const overlays: OverlayBox[] = [];
  for (const z of zones) {
    if (!OVERLAY_ZONE_KINDS.includes(z.kind)) continue;
    const members = nodes.filter(
      (n) => (n.zoneIds ?? []).includes(z.id) && positions[n.id],
    );
    if (!members.length) continue;
    const b = bounds(members.map((m) => positions[m.id]));
    overlays.push({
      zoneId: z.id,
      kind: z.kind,
      name: z.name,
      min: [b.minX - PAD, 0, b.minZ - PAD],
      max: [b.maxX + PAD, 8, b.maxZ + PAD],
    });
  }

  return { positions, districts, overlays };
}

function bounds(pts: Vec3[]) {
  let minX = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxZ = -Infinity;
  for (const [x, , z] of pts) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  return { minX, minZ, maxX, maxZ };
}

/**
 * Pairwise repulsion with a 2D spring pulling each node toward its district's
 * center, so districts stay compact + separated while nodes fan out enough that
 * connection points don't overlap.
 */
function relax(positions: Record<Id, Vec3>, target: Record<Id, { x: number; z: number }>) {
  const ids = Object.keys(positions);
  const MINDIST = 5.2;
  const REP = 1.0;
  const SPRING = 0.14;
  const STEP = 0.45;
  const MAX_STEP = 0.6;
  const ITERS = 90;

  for (let it = 0; it < ITERS; it++) {
    const fx: Record<string, number> = {};
    const fz: Record<string, number> = {};
    for (const id of ids) {
      fx[id] = 0;
      fz[id] = 0;
    }

    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = positions[ids[i]];
        const b = positions[ids[j]];
        let dx = a[0] - b[0];
        let dz = a[2] - b[2];
        let d = Math.hypot(dx, dz);
        if (d < 1e-3) {
          dx = Math.random() - 0.5;
          dz = Math.random() - 0.5;
          d = Math.hypot(dx, dz) || 1;
        }
        if (d < MINDIST) {
          const f = ((MINDIST - d) / d) * REP;
          fx[ids[i]] += dx * f;
          fz[ids[i]] += dz * f;
          fx[ids[j]] -= dx * f;
          fz[ids[j]] -= dz * f;
        }
      }
    }

    for (const id of ids) {
      const p = positions[id];
      const t = target[id];
      if (t) {
        fx[id] += (t.x - p[0]) * SPRING;
        fz[id] += (t.z - p[2]) * SPRING;
      }
      p[0] += Math.max(-MAX_STEP, Math.min(MAX_STEP, fx[id] * STEP));
      p[2] += Math.max(-MAX_STEP, Math.min(MAX_STEP, fz[id] * STEP));
    }
  }
}
