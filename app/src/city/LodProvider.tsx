import { useRef, useState, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { LodContext, nextLod, type Lod } from './lod';

const FALLBACK_TARGET = new THREE.Vector3(0, 4, 0);

// Watches the camera's distance to the orbit target and publishes a discrete
// LOD tier to the scene. The distance is sampled every frame but state is
// committed ONLY when the tier actually changes — the scene re-renders on tier
// transitions, not per frame, preserving the compute-once discipline.
export function LodProvider({ children }: { children: ReactNode }) {
  const [lod, setLod] = useState<Lod>(0);
  const ref = useRef<Lod>(0);
  const frame = useRef(0);

  useFrame((state) => {
    // LOD transitions aren't time-critical; sample every 4th frame.
    if ((frame.current = (frame.current + 1) & 3) !== 0) return;
    const controls = state.controls as { target?: THREE.Vector3 } | null;
    const target = controls?.target ?? FALLBACK_TARGET;
    const dist = state.camera.position.distanceTo(target);
    const next = nextLod(ref.current, dist);
    if (next !== ref.current) {
      ref.current = next;
      setLod(next);
    }
  });

  return <LodContext.Provider value={lod}>{children}</LodContext.Provider>;
}
