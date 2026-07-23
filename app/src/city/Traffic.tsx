import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Edge, Flow, Id } from '@model/types';
import { EDGE_COLOR } from './visuals';
import type { Vec3 } from './layout';
import { prepare, posAt, type Prepared } from './path';
import { radialGlow } from './glowTexture';

interface PulseInstance {
  prepared: Prepared;
  color: string;
  t: number;
}

// A pulse is a short train: a lead bead + trailing beads sampled behind it ON
// the routed path (so corners stay clean), tapering in size + brightness.
const BEADS = 4;
const GAP = 0.014; // t-spacing between beads — tight
const SIZE = [1, 0.72, 0.55, 0.42];
const BRIGHT = [1, 0.5, 0.32, 0.2];

const _dummy = new THREE.Object3D();
const _pos = new THREE.Vector3();
const _col = new THREE.Color();
const _col2 = new THREE.Color();
const ARGS = [undefined as unknown as THREE.BufferGeometry, undefined as unknown as THREE.Material] as const;

/**
 * Animated pulses tracing a flow's route. Each pulse is a tapering bead train
 * (clean through corners because every bead is sampled on the polyline) with a
 * faint additive glow halo on the lead bead. Two InstancedMeshes total — one
 * draw call each — regardless of how busy the flow is.
 */
export function Traffic({
  flow,
  routes,
  edges,
  intensity = 1,
}: {
  flow: Flow;
  routes: Record<Id, Vec3[]>;
  edges: Edge[];
  intensity?: number;
}) {
  const perToDay: Record<string, number> = { day: 1, week: 1 / 7, month: 1 / 30, year: 1 / 365 };
  const runsPerDay = flow.volume
    ? flow.volume.runsPerPeriod * (perToDay[flow.volume.period] ?? 1 / 30)
    : 15;
  const base = Math.max(1, Math.min(8, Math.round(1 + runsPerDay / 8)));
  const count = Math.max(1, Math.min(14, Math.round(base * intensity)));
  const speed = 6 + Math.min(8, intensity * 1.4);

  const pulses = useMemo<PulseInstance[]>(() => {
    const byId = new Map(edges.map((e) => [e.id, e] as const));
    const list: PulseInstance[] = [];
    for (const s of flow.steps) {
      const pts = routes[s.edgeId];
      const e = byId.get(s.edgeId);
      if (!pts || pts.length < 2 || !e) continue;
      const prepared = prepare(pts);
      const color = EDGE_COLOR[e.kind];
      const lanePhase = ((s.order - 1) * 0.18) % 1;
      for (let k = 0; k < count; k++) {
        list.push({ prepared, color, t: (lanePhase + k / count) % 1 });
      }
    }
    return list;
  }, [flow, routes, edges, count]);

  const beadRef = useRef<THREE.InstancedMesh>(null);
  const haloRef = useRef<THREE.InstancedMesh>(null);
  const ts = useRef<number[]>([]);

  useLayoutEffect(() => {
    ts.current = pulses.map((p) => p.t);
    const bm = beadRef.current;
    if (bm) {
      pulses.forEach((p, i) => {
        _col.set(p.color);
        for (let j = 0; j < BEADS; j++) {
          _col2.copy(_col).multiplyScalar(BRIGHT[j]);
          bm.setColorAt(i * BEADS + j, _col2);
        }
      });
      if (bm.instanceColor) bm.instanceColor.needsUpdate = true;
    }
    const hm = haloRef.current;
    if (hm) {
      pulses.forEach((p, i) => hm.setColorAt(i, _col.set(p.color)));
      if (hm.instanceColor) hm.instanceColor.needsUpdate = true;
    }
  }, [pulses]);

  useFrame((state, dt) => {
    const bm = beadRef.current;
    const hm = haloRef.current;
    if (!bm) return;
    for (let i = 0; i < pulses.length; i++) {
      const p = pulses[i];
      const lead = (ts.current[i] + (dt * speed) / p.prepared.total) % 1;
      ts.current[i] = lead;
      _dummy.quaternion.identity();
      for (let j = 0; j < BEADS; j++) {
        const tj = (((lead - j * GAP) % 1) + 1) % 1;
        posAt(p.prepared, tj, _pos);
        _dummy.position.set(_pos.x, _pos.y + 0.18, _pos.z);
        _dummy.scale.setScalar(SIZE[j]);
        _dummy.updateMatrix();
        bm.setMatrixAt(i * BEADS + j, _dummy.matrix);
      }
      if (hm) {
        posAt(p.prepared, lead, _pos);
        _dummy.position.set(_pos.x, _pos.y + 0.18, _pos.z);
        _dummy.quaternion.copy(state.camera.quaternion); // billboard the glow quad
        _dummy.scale.setScalar(1.5);
        _dummy.updateMatrix();
        hm.setMatrixAt(i, _dummy.matrix);
      }
    }
    bm.instanceMatrix.needsUpdate = true;
    if (hm) hm.instanceMatrix.needsUpdate = true;
  });

  const n = Math.max(1, pulses.length);
  return (
    <group>
      <instancedMesh key={`b${pulses.length}`} ref={beadRef} args={[...ARGS, n * BEADS]}>
        <sphereGeometry args={[0.22, 12, 10]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <instancedMesh key={`h${pulses.length}`} ref={haloRef} args={[...ARGS, n]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          map={radialGlow()}
          toneMapped={false}
          transparent
          opacity={0.9}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </instancedMesh>
    </group>
  );
}
