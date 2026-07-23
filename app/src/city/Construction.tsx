import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import * as THREE from 'three';
import type { Shape } from './visuals';

const CYCLE = 2.4; // seconds per full sweep+fade cycle
const RISE = 0.68; // fraction of the cycle spent rising (rest fades out)

type Pt = [number, number, number];

/** A closed cross-section outline that fits the shape's footprint. */
function outlineFor(shape: Shape, w: number, d: number): Pt[] {
  const pad = 1.14;
  const rectShapes: Shape[] = ['tower', 'slab'];
  if (rectShapes.includes(shape)) {
    const hw = (w / 2) * pad;
    const hd = (d / 2) * pad;
    return [
      [-hw, 0, -hd],
      [hw, 0, -hd],
      [hw, 0, hd],
      [-hw, 0, hd],
      [-hw, 0, -hd],
    ];
  }
  // round / faceted shapes → regular polygon (hex for silos, circle otherwise)
  const r = (Math.max(w, d) / 2) * pad;
  const n = shape === 'silo' ? 6 : 28;
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([Math.cos(a) * r, 0, Math.sin(a) * r]);
  }
  return pts;
}

/**
 * "Under construction" treatment for in_progress nodes: a yellow wireframe of
 * the shape is revealed bottom→top by an animated horizontal clipping plane
 * (the lattice grows in), and a glowing outline that FITS the shape's cross-
 * section rides the leading edge as the sweep mask — empty-filled, just a lit
 * contour. The whole thing fades at the top and restarts from the base; each
 * instance is phase-offset so buildings don't pulse in sync.
 */
export function Construction({
  geom,
  shape,
  yOffset,
  top,
}: {
  geom: THREE.BufferGeometry;
  shape: Shape;
  yOffset: number;
  top: number;
}) {
  const wireMat = useRef<THREE.MeshBasicMaterial>(null);
  const sweep = useRef<THREE.Group>(null);
  const lineRef = useRef<any>(null);
  const glowRef = useRef<any>(null);
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, -1, 0), 0), []);
  const offset = useMemo(() => Math.random() * CYCLE, []);
  const { gl } = useThree();
  useEffect(() => {
    gl.localClippingEnabled = true;
  }, [gl]);

  const outline = useMemo(() => {
    geom.computeBoundingBox();
    const b = geom.boundingBox!;
    return outlineFor(shape, b.max.x - b.min.x, b.max.z - b.min.z);
  }, [geom, shape]);

  useFrame((state) => {
    const t = ((state.clock.elapsedTime + offset) % CYCLE) / CYCLE;
    let clipY: number;
    let opacity: number;
    if (t < RISE) {
      clipY = (t / RISE) * top;
      opacity = 1;
    } else {
      clipY = top;
      opacity = 1 - (t - RISE) / (1 - RISE);
    }
    plane.constant = clipY;
    if (wireMat.current) wireMat.current.opacity = 0.8 * opacity;
    if (sweep.current) {
      sweep.current.position.y = clipY;
      sweep.current.visible = t < RISE && clipY > 0.04;
    }
    if (lineRef.current) lineRef.current.material.opacity = opacity;
    if (glowRef.current) glowRef.current.material.opacity = 0.35 * opacity;
  });

  return (
    <group>
      {/* wireframe lattice, clipped to reveal from the base upward */}
      <mesh geometry={geom} position={[0, yOffset, 0]}>
        <meshBasicMaterial
          ref={wireMat}
          color="#f9e2af"
          wireframe
          transparent
          opacity={0.8}
          toneMapped={false}
          depthWrite={false}
          clippingPlanes={[plane]}
        />
      </mesh>
      {/* glowing, shape-fitted sweep outline (empty fill) riding the leading edge */}
      <group ref={sweep}>
        <Line ref={glowRef} points={outline} color="#ffe89a" lineWidth={6} transparent opacity={0.35} toneMapped={false} />
        <Line ref={lineRef} points={outline} color="#fff4c2" lineWidth={2} transparent opacity={1} toneMapped={false} />
      </group>
    </group>
  );
}
