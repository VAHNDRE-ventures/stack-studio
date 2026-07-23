import type { Edge, Id } from '@model/types';
import type { Vec3 } from './layout';

/**
 * Orthogonal edge router. Rasterizes building footprints into an occupancy
 * grid, then routes each connection with A* (4-directional) around the
 * obstacles. A turn penalty keeps paths clean (few right-angle bends), and a
 * per-cell usage penalty — accumulated as edges are routed — pushes parallel
 * routes into separate lanes instead of stacking. Endpoints' own footprints are
 * temporarily passable so a route can reach its source/target.
 */

const CELL = 1.2; // grid resolution (world units)
const FOOT = 2.0; // building footprint radius that blocks routing
const MARGIN = 8; // grid padding around the city
const TURN = 3.0; // cost of a 90° turn
const USAGE = 2.5; // cost per prior route already using a cell
const Y = 0.16; // ground height of the roads

class MinHeap {
  private a: { k: number; f: number }[] = [];
  get size() {
    return this.a.length;
  }
  push(k: number, f: number) {
    const a = this.a;
    a.push({ k, f });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): { k: number; f: number } {
    const a = this.a;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

export function routeEdges(edges: Edge[], positions: Record<Id, Vec3>): Record<Id, Vec3[]> {
  const ids = Object.keys(positions);
  if (!ids.length) return {};

  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (const id of ids) {
    const p = positions[id];
    minX = Math.min(minX, p[0]);
    maxX = Math.max(maxX, p[0]);
    minZ = Math.min(minZ, p[2]);
    maxZ = Math.max(maxZ, p[2]);
  }
  minX -= MARGIN;
  minZ -= MARGIN;
  maxX += MARGIN;
  maxZ += MARGIN;

  const W = Math.max(1, Math.ceil((maxX - minX) / CELL) + 1);
  const H = Math.max(1, Math.ceil((maxZ - minZ) / CELL) + 1);
  const idx = (gx: number, gz: number) => gx * H + gz;
  const worldX = (gx: number) => minX + gx * CELL;
  const worldZ = (gz: number) => minZ + gz * CELL;
  const gridX = (x: number) => Math.round((x - minX) / CELL);
  const gridZ = (z: number) => Math.round((z - minZ) / CELL);

  const blocked = new Uint8Array(W * H);
  const nodeCells = new Map<Id, Set<number>>();
  const footR = Math.ceil(FOOT / CELL);
  for (const id of ids) {
    const p = positions[id];
    const bx = gridX(p[0]);
    const bz = gridZ(p[2]);
    const set = new Set<number>();
    for (let dx = -footR; dx <= footR; dx++) {
      for (let dz = -footR; dz <= footR; dz++) {
        const gx = bx + dx;
        const gz = bz + dz;
        if (gx < 0 || gz < 0 || gx >= W || gz >= H) continue;
        if (Math.hypot(dx * CELL, dz * CELL) <= FOOT) {
          const c = idx(gx, gz);
          blocked[c] = 1;
          set.add(c);
        }
      }
    }
    nodeCells.set(id, set);
  }

  const usage = new Float32Array(W * H);
  const DX = [0, 1, -1, 0, 0];
  const DZ = [0, 0, 0, 1, -1];
  const routes: Record<Id, Vec3[]> = {};

  const routable = edges.filter((e) => positions[e.source] && positions[e.target]);

  for (const e of routable) {
    const s = positions[e.source];
    const t = positions[e.target];
    const sc = idx(gridX(s[0]), gridZ(s[2]));
    const goal = idx(gridX(t[0]), gridZ(t[2]));
    const tx = gridX(t[0]);
    const tz = gridZ(t[2]);
    const endpoint = new Set<number>([
      ...(nodeCells.get(e.source) ?? []),
      ...(nodeCells.get(e.target) ?? []),
    ]);

    // A* over (cell, incomingDir) states so we can charge for turns.
    const g = new Float32Array(W * H * 5).fill(Infinity);
    const prev = new Int32Array(W * H * 5).fill(-1);
    const heap = new MinHeap();
    const heur = (gx: number, gz: number) => Math.abs(gx - tx) + Math.abs(gz - tz);
    const start = sc * 5;
    g[start] = 0;
    heap.push(start, heur(gridX(s[0]), gridZ(s[2])));

    let found = -1;
    while (heap.size) {
      const { k: state } = heap.pop();
      const cell = Math.floor(state / 5);
      const dir = state % 5;
      if (cell === goal) {
        found = state;
        break;
      }
      const gx = Math.floor(cell / H);
      const gz = cell % H;
      const base = g[state];
      if (base === Infinity) continue;
      for (let nd = 1; nd <= 4; nd++) {
        const ngx = gx + DX[nd];
        const ngz = gz + DZ[nd];
        if (ngx < 0 || ngz < 0 || ngx >= W || ngz >= H) continue;
        const nc = idx(ngx, ngz);
        if (blocked[nc] && !endpoint.has(nc)) continue;
        let cost = 1 + usage[nc] * USAGE;
        if (dir !== 0 && nd !== dir) cost += TURN;
        const ns = nc * 5 + nd;
        const ng = base + cost;
        if (ng < g[ns]) {
          g[ns] = ng;
          prev[ns] = state;
          heap.push(ns, ng + heur(ngx, ngz));
        }
      }
    }

    let pts: Vec3[];
    if (found >= 0) {
      const cells: number[] = [];
      let st = found;
      while (st !== -1) {
        cells.push(Math.floor(st / 5));
        st = prev[st];
      }
      cells.reverse();
      for (const c of cells) usage[c] += 1;
      const world: Vec3[] = cells.map((c) => [worldX(Math.floor(c / H)), Y, worldZ(c % H)]);
      pts = simplify(world);
    } else {
      // fallback: simple orthogonal L-route
      const midZ = (s[2] + t[2]) / 2;
      pts = [
        [s[0], Y, s[2]],
        [s[0], Y, midZ],
        [t[0], Y, midZ],
        [t[0], Y, t[2]],
      ];
    }
    routes[e.id] = pts;
  }

  return routes;
}

/** Drop points that lie on a straight run, keeping only the corners. */
function simplify(p: Vec3[]): Vec3[] {
  if (p.length <= 2) return p;
  const out: Vec3[] = [p[0]];
  for (let i = 1; i < p.length - 1; i++) {
    const a = out[out.length - 1];
    const b = p[i];
    const c = p[i + 1];
    const abx = Math.sign(b[0] - a[0]);
    const abz = Math.sign(b[2] - a[2]);
    const bcx = Math.sign(c[0] - b[0]);
    const bcz = Math.sign(c[2] - b[2]);
    if (abx === bcx && abz === bcz) continue;
    out.push(b);
  }
  out.push(p[p.length - 1]);
  return out;
}
