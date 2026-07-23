import { MeshReflectorMaterial } from '@react-three/drei';
import { useStudio } from '../store';

/**
 * The city's ground: a dark, softly-reflective plane (neon buildings mirror into
 * it). Reflection is the main GPU cost here — in 'lite' quality it falls back to
 * a plain matte plane.
 */
export function Floor() {
  const lite = useStudio((s) => s.quality === 'lite');
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.14, 0]} receiveShadow>
      <planeGeometry args={[400, 400]} />
      {lite ? (
        <meshStandardMaterial color="#070b16" roughness={0.9} metalness={0.3} />
      ) : (
        <MeshReflectorMaterial
          resolution={512}
          mirror={0.55}
          blur={[400, 140]}
          mixBlur={1.3}
          mixStrength={1.3}
          roughness={0.9}
          depthScale={1.1}
          minDepthThreshold={0.4}
          maxDepthThreshold={1.3}
          color="#070b16"
          metalness={0.5}
        />
      )}
    </mesh>
  );
}
