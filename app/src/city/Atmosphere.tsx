import { useMemo } from 'react';
import * as THREE from 'three';
import { ContactShadows } from '@react-three/drei';
import { useStudio } from '../store';

/** Soft radial ground glow — a faint mist pool the city sits in, for depth. */
export function GroundHaze() {
  const tex = useMemo(() => {
    const s = 256;
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(90,130,200,0.20)');
    g.addColorStop(0.5, 'rgba(48,78,140,0.07)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
      <planeGeometry args={[190, 190]} />
      <meshBasicMaterial
        map={tex}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
        opacity={0.85}
      />
    </mesh>
  );
}

/**
 * Contact-shadow grounding under the buildings (baked once per project via
 * frames={1}). DIAL-BACK: drop `opacity`, or remove the <Grounding/> line.
 */
export function Grounding() {
  const key = useStudio((s) => `${s.project.name}:${s.project.nodes.length}`);
  const lite = useStudio((s) => s.quality === 'lite');
  if (lite) return null;
  return (
    <ContactShadows
      key={key}
      position={[0, -0.08, 0]}
      scale={150}
      resolution={1024}
      frames={1}
      blur={2.6}
      opacity={0.5}
      far={45}
      color="#03060e"
    />
  );
}
