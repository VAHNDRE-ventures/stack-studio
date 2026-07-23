import { Line, Text } from '@react-three/drei';
import * as THREE from 'three';
import type { DistrictBox, Vec3 } from './layout';
import { ZONE_VISUAL } from './visuals';
import { useLod } from './lod';

export function District({ box }: { box: DistrictBox }) {
  const v = ZONE_VISUAL[box.kind];
  const lod = useLod();
  const [cx, , cz] = box.center;
  const [w, d] = box.size;
  const hw = w / 2;
  const hd = d / 2;
  const y = 0.06;
  const outline: Vec3[] = [
    [-hw, y, -hd],
    [hw, y, -hd],
    [hw, y, hd],
    [-hw, y, hd],
    [-hw, y, -hd],
  ];

  // Zone "fence": low walls (no roof) + a glowing top rail, so a zone reads as a
  // bounded region without boxing it in. Fades as you zoom in.
  const fenceH = 1.25;
  const curtainOpacity = lod === 0 ? 0.09 : lod === 1 ? 0.055 : 0.025;
  const topRim: Vec3[] = [
    [-hw, fenceH, -hd],
    [hw, fenceH, -hd],
    [hw, fenceH, hd],
    [-hw, fenceH, hd],
    [-hw, fenceH, -hd],
  ];
  const walls: { pos: Vec3; rot: [number, number, number]; len: number }[] = [
    { pos: [0, fenceH / 2, -hd], rot: [0, 0, 0], len: w },
    { pos: [0, fenceH / 2, hd], rot: [0, 0, 0], len: w },
    { pos: [-hw, fenceH / 2, 0], rot: [0, Math.PI / 2, 0], len: d },
    { pos: [hw, fenceH / 2, 0], rot: [0, Math.PI / 2, 0], len: d },
  ];

  // Fit the label to the district width so long zone names never spill past the
  // box edge. Estimate glyph advance (~0.6em uppercase), cap by the LOD-desired
  // size, floor so it stays readable; maxWidth wraps as a backstop if the
  // estimate is off.
  const label = box.name.toUpperCase();
  const pad = 0.5;
  const avail = Math.max(2, w - pad * 2);
  const desired = lod === 0 ? 1.5 : lod === 1 ? 1.0 : 0.82;
  const fitted = avail / (label.length * 0.6);
  const fontSize = Math.max(0.42, Math.min(desired, fitted));

  return (
    <group position={[cx, 0, cz]}>
      {/* dark tinted footprint on the grid */}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial
          color={v.color}
          roughness={0.85}
          metalness={0.2}
          transparent
          opacity={0.34}
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={-2}
          polygonOffsetUnits={-2}
        />
      </mesh>
      {/* glowing neon outline */}
      <Line points={outline} color={v.accent} lineWidth={1.8} transparent opacity={0.85} />
      {/* zone fence: low walls (no roof) + glowing top rail */}
      {walls.map((wl, i) => (
        <mesh key={i} position={wl.pos} rotation={wl.rot}>
          <planeGeometry args={[wl.len, fenceH]} />
          <meshBasicMaterial
            color={v.accent}
            transparent
            opacity={curtainOpacity}
            depthWrite={false}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>
      ))}
      <Line points={topRim} color={v.accent} lineWidth={1} transparent opacity={curtainOpacity * 5} />
      <Text
        position={[-hw + pad, y, -hd + 1.15]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={fontSize}
        maxWidth={avail}
        color={v.accent}
        anchorX="left"
        anchorY="top"
        outlineWidth={0.02}
        outlineColor="#05070f"
        fillOpacity={lod === 2 ? 0.55 : 1}
        outlineOpacity={lod === 2 ? 0.55 : 1}
      >
        {label}
      </Text>
    </group>
  );
}
