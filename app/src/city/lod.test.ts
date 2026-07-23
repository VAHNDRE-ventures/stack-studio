import { describe, it, expect } from 'vitest';
import { nextLod, LOD_THRESHOLDS, type Lod } from './lod';

const { farEnter, farExit, nearEnter, nearExit } = LOD_THRESHOLDS;

describe('nextLod semantic-zoom hysteresis', () => {
  it('drops to near/mid/far by distance from a cold start', () => {
    expect(nextLod(0, nearEnter - 1)).toBe(2); // far, pushed all the way in
    expect(nextLod(0, farExit - 1)).toBe(1); // far, pushed just past mid
    expect(nextLod(0, farEnter + 1)).toBe(0); // far, still far
  });

  it('climbs back out from near', () => {
    expect(nextLod(2, nearExit + 1)).toBe(1); // near → mid
    expect(nextLod(2, farEnter + 1)).toBe(0); // near → far in one pull
    expect(nextLod(2, nearEnter + 1)).toBe(2); // inside dead-band: stays near
  });

  it('holds tier inside the dead-band (no flicker)', () => {
    // Between nearExit and nearEnter, near stays near and mid stays mid.
    for (const d of [nearEnter + 0.5, (nearEnter + nearExit) / 2, nearExit - 0.5]) {
      expect(nextLod(2, d)).toBe(2);
      expect(nextLod(1, d)).toBe(1);
    }
    // Between farExit and farEnter, far stays far and mid stays mid.
    for (const d of [farExit + 0.5, (farExit + farEnter) / 2, farEnter - 0.5]) {
      expect(nextLod(0, d)).toBe(0);
      expect(nextLod(1, d)).toBe(1);
    }
  });

  it('mid transitions on either side of its band', () => {
    expect(nextLod(1, farEnter + 1)).toBe(0);
    expect(nextLod(1, nearEnter - 1)).toBe(2);
    const mid: Lod = 1;
    expect(nextLod(mid, (nearEnter + farEnter) / 2)).toBe(1);
  });
});
