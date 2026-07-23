import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Billboard, Text } from '@react-three/drei';
import * as THREE from 'three';
import type { Id } from '@model/types';
import type { FlowCost } from '../model/opCost';
import type { Vec3 } from './layout';
import { prepare, posAt, type Prepared } from './path';
import { useLod } from './lod';

interface Seg {
  prepared: Prepared;
  cumulative: number;
}

/**
 * A single "$" marker that rides the traced flow and ticks up to each step's
 * cumulative toll as it passes that node — pricing made kinetic.
 * DIAL-BACK: remove the <FlowCostTicker/> line in CityScene.
 */
export function FlowCostTicker({
  fc,
  routes,
}: {
  fc: FlowCost;
  routes: Record<Id, Vec3[]>;
}) {
  const lod = useLod();
  const segs = useMemo<Seg[]>(
    () =>
      fc.steps
        .map((s) => {
          const pts = routes[s.edgeId];
          return pts && pts.length >= 2
            ? { prepared: prepare(pts), cumulative: s.cumulative }
            : null;
        })
        .filter((x): x is Seg => x !== null),
    [fc, routes],
  );

  const groupRef = useRef<THREE.Group>(null);
  const textRef = useRef<{ text: string; sync?: () => void }>(null);
  const st = useRef({ seg: 0, t: 0, shown: -1 });
  const pos = useRef(new THREE.Vector3());

  useFrame((_, dt) => {
    if (!segs.length || !groupRef.current) return;
    const s = st.current;
    if (s.seg >= segs.length) s.seg = 0;
    const cur = segs[s.seg];
    s.t += (dt * 7) / cur.prepared.total;
    if (s.t >= 1) {
      s.t = 0;
      s.seg = (s.seg + 1) % segs.length;
    }
    const seg = segs[s.seg];
    posAt(seg.prepared, s.t, pos.current);
    groupRef.current.position.set(pos.current.x, pos.current.y + 1.0, pos.current.z);
    if (s.shown !== s.seg && textRef.current) {
      s.shown = s.seg;
      textRef.current.text = `${fc.currency} ${seg.cumulative.toFixed(2)}`;
      textRef.current.sync?.();
    }
  });

  if (!segs.length || lod < 1) return null;

  return (
    <group ref={groupRef}>
      <Billboard>
        <Text
          ref={textRef as never}
          fontSize={0.72}
          color="#a6e3a1"
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.045}
          outlineColor="#04121a"
        >
          {`${fc.currency} 0.00`}
        </Text>
      </Billboard>
    </group>
  );
}
