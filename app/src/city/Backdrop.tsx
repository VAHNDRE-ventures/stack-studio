import { useMemo } from 'react';
import * as THREE from 'three';
import { LOGO } from '../branding/assets';

/** A large, very faint brand mark parked in a fixed ambient spot behind/above
 *  the city — part of the environment, not something that tracks you. */
export function Backdrop() {
  const tex = useMemo(() => {
    const t = new THREE.TextureLoader().load(LOGO);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);

  return (
    <mesh position={[0, 32, -125]}>
      <planeGeometry args={[120, 120]} />
      <meshBasicMaterial
        map={tex}
        transparent
        opacity={0.05}
        depthWrite={false}
        toneMapped={false}
        side={THREE.FrontSide}
      />
    </mesh>
  );
}
