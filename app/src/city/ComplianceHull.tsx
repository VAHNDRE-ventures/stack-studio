import { Line, Text } from '@react-three/drei';
import type { OverlayBox, Vec3 } from './layout';

/**
 * A compliance/overlay scope drawn as a calm GROUND FOOTPRINT — a faint tint
 * with a dashed neon outline and a label — rather than a towering opaque box.
 * Colored per-scope (passed in) so PCI / PII / consent read as distinct, and
 * only the focused scope is rendered at a time (see CityScene).
 */
export function ComplianceHull({ box, color }: { box: OverlayBox; color: string }) {
  const [minX, , minZ] = box.min;
  const [maxX, , maxZ] = box.max;
  const w = maxX - minX;
  const d = maxZ - minZ;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const hw = w / 2;
  const hd = d / 2;
  const y = 0.12;
  const outline: Vec3[] = [
    [-hw, y, -hd],
    [hw, y, -hd],
    [hw, y, hd],
    [-hw, y, hd],
    [-hw, y, -hd],
  ];

  return (
    <group position={[cx, 0, cz]}>
      <mesh position={[0, y - 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[w, d]} />
        <meshBasicMaterial color={color} transparent opacity={0.05} depthWrite={false} />
      </mesh>
      <Line
        points={outline}
        color={color}
        lineWidth={1.6}
        dashed
        dashSize={0.7}
        gapSize={0.4}
        transparent
        opacity={0.85}
      />
      <Text
        position={[-hw + 0.4, y, -hd + 0.95]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.8}
        color={color}
        anchorX="left"
        anchorY="top"
        outlineWidth={0.02}
        outlineColor="#05070f"
      >
        {box.name.toUpperCase()}
      </Text>
    </group>
  );
}
