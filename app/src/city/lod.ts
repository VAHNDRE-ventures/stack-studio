import { createContext, useContext } from 'react';

// Semantic-zoom level of detail.
//   0 = FAR  (metropolis): districts dominate; building labels hidden.
//   1 = MID  (city):       building labels; data-entity badges hidden.
//   2 = NEAR (alleyway):   full detail — labels + data-entity badges.
export type Lod = 0 | 1 | 2;

// Distance (camera→controls target) thresholds, in world units. Building
// geometry is a fixed ~2 units regardless of project, so absolute thresholds
// give stable semantic zoom across projects. The enter/exit pairs form a
// dead-band around each boundary so a tier doesn't flicker while you hover the
// threshold. Tune these against the GPU render.
export const LOD_THRESHOLDS = {
  farEnter: 95, // mid → far  (pull back past this)
  farExit: 82, // far → mid  (push in past this)
  nearEnter: 42, // mid → near (push in past this)
  nearExit: 52, // near → mid (pull back past this)
} as const;

// Pure hysteresis transition: given the current tier and camera distance,
// return the next tier. Kept free of three/r3f so it unit-tests in node.
export function nextLod(cur: Lod, dist: number): Lod {
  const { farEnter, farExit, nearEnter, nearExit } = LOD_THRESHOLDS;
  if (cur === 0) return dist < farExit ? (dist < nearEnter ? 2 : 1) : 0;
  if (cur === 2) return dist > nearExit ? (dist > farEnter ? 0 : 1) : 2;
  return dist > farEnter ? 0 : dist < nearEnter ? 2 : 1;
}

export const LodContext = createContext<Lod>(2);
export const useLod = (): Lod => useContext(LodContext);
