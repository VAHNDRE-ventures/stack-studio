import * as THREE from 'three';
import type { Vec3 } from './layout';

export interface Prepared {
  pts: Vec3[];
  cum: number[];
  total: number;
}

function dist(a: Vec3, b: Vec3) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Precompute cumulative arc-length along a polyline for constant-speed travel. */
export function prepare(pts: Vec3[]): Prepared {
  const cum = [0];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += dist(pts[i - 1], pts[i]);
    cum.push(total);
  }
  return { pts, cum, total: total || 1 };
}

/** Point at fraction t (0..1) along a prepared polyline, written into `out`. */
export function posAt(p: Prepared, t: number, out: THREE.Vector3) {
  const d = t * p.total;
  let i = 1;
  while (i < p.cum.length && p.cum[i] < d) i++;
  if (i >= p.pts.length) {
    const e = p.pts[p.pts.length - 1];
    out.set(e[0], e[1], e[2]);
    return;
  }
  const seg = p.cum[i] - p.cum[i - 1] || 1;
  const f = (d - p.cum[i - 1]) / seg;
  const a = p.pts[i - 1];
  const b = p.pts[i];
  out.set(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f);
}
