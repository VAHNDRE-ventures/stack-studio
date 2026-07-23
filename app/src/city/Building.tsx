import { Text, Billboard } from '@react-three/drei';
import * as THREE from 'three';
import type { Node } from '@model/types';
import { KIND_VISUAL, type Shape } from './visuals';
import type { Vec3 } from './layout';
import { heatColor } from '../model/load';
import { useLod } from './lod';
import { Construction } from './Construction';
import { radialGlow } from './glowTexture';

interface Built {
  geom: THREE.BufferGeometry;
  yOffset: number;
  top: number;
  tip?: number;
}

function build(shape: Shape, h: number): Built {
  switch (shape) {
    case 'tower':
      return { geom: new THREE.BoxGeometry(1.4, h, 1.4), yOffset: h / 2, top: h };
    case 'slab':
      return { geom: new THREE.BoxGeometry(2.6, h, 1.3), yOffset: h / 2, top: h };
    case 'silo':
      // faceted hex silo
      return { geom: new THREE.CylinderGeometry(1.05, 1.05, h, 6), yOffset: h / 2, top: h };
    case 'gate':
      // portal ring
      return { geom: new THREE.TorusGeometry(1.15, 0.16, 6, 18), yOffset: 1.35, top: 2.9 };
    case 'crystal': {
      const r = Math.max(1.0, h * 0.45);
      return { geom: new THREE.IcosahedronGeometry(r, 0), yOffset: r + 0.4, top: 2 * r + 0.4 };
    }
    case 'beacon':
      return { geom: new THREE.CylinderGeometry(0.16, 0.5, h, 6), yOffset: h / 2, top: h + 0.4, tip: h };
    case 'marker':
      return { geom: new THREE.IcosahedronGeometry(0.95, 0), yOffset: 1.4, top: 2.5 };
    default:
      return { geom: new THREE.BoxGeometry(1.4, h, 1.4), yOffset: h / 2, top: h };
  }
}

// Buildings of the same shape (height is fixed per kind) share ONE geometry +
// edge geometry, so we allocate per-shape, not per-node.
const geomCache = new Map<string, Built>();
const edgeCache = new Map<string, THREE.EdgesGeometry>();
function getBuilt(shape: Shape, h: number): Built {
  const k = `${shape}:${h}`;
  let b = geomCache.get(k);
  if (!b) {
    b = build(shape, h);
    geomCache.set(k, b);
  }
  return b;
}
function getEdges(geom: THREE.BufferGeometry, key: string): THREE.EdgesGeometry {
  let e = edgeCache.get(key);
  if (!e) {
    e = new THREE.EdgesGeometry(geom, 1);
    edgeCache.set(key, e);
  }
  return e;
}

// Labels are authored SHORT and well-shaped per the naming rules (MODEL.md §3).
// The renderer does NOT guess breaks from punctuation — it only honors explicit
// newlines and applies a gentle whitespace wrap as a safety net.
function foldLabel(name: string): string {
  if (name.includes('\n')) return name;
  const MAX = 18;
  if (name.length <= MAX) return name;
  const lines: string[] = [];
  let line = '';
  for (const word of name.split(/\s+/)) {
    if (!line) line = word;
    else if ((line + ' ' + word).length <= MAX) line += ' ' + word;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

export function Building({
  node,
  position,
  dataCount = 0,
  congestion,
  future = false,
  dimmed = false,
  emphasized = false,
  toll,
  onSelect,
}: {
  node: Node;
  position: Vec3;
  dataCount?: number;
  congestion?: number;
  future?: boolean;
  dimmed?: boolean;
  emphasized?: boolean;
  toll?: number;
  onSelect?: () => void;
}) {
  const v = KIND_VISUAL[node.kind];
  const lod = useLod();
  const external =
    node.ownership === 'external' || node.ownership === 'thirdParty' || node.kind === 'actor';
  const planned = node.buildState === 'planned' || node.buildState === 'proposed';
  const constructing = node.buildState === 'in_progress';
  const ghost = external || planned || future || constructing;

  const shapeKey = `${v.shape}:${v.base}`;
  const { geom, yOffset, top, tip } = getBuilt(v.shape, v.base);
  const edges = getEdges(geom, shapeKey);
  const childCount = dataCount;
  const labelY = top + 0.7;
  const heat = congestion !== undefined ? heatColor(congestion) : undefined;
  // Vertical load meter (near zoom): a fill bar up the building height.
  const meterRatio = congestion !== undefined ? Math.min(congestion, 1) : 0;
  const meterColor = (congestion !== undefined && heatColor(congestion)) || '#5b8bd0';
  const showMeter = congestion !== undefined && congestion >= 0.05 && !future && !dimmed && lod >= 2;
  const glowTex = radialGlow();

  const edgeOpacity = dimmed ? 0.1 : future ? 0.3 : constructing ? 0.4 : planned ? 0.35 : external ? 0.6 : 0.95;
  const labelOpacity = dimmed ? 0.1 : future ? 0.45 : 1;

  return (
    <group
      position={[position[0], 0, position[2]]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect?.();
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        document.body.style.cursor = 'auto';
      }}
    >
      {/* base haze glow — a faint pool of the node's hue at its foot */}
      <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[5, 5]} />
        <meshBasicMaterial
          map={glowTex}
          color={v.color}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
          opacity={dimmed ? 0.05 : future ? 0.08 : 0.28}
        />
      </mesh>

      {heat && !future && !dimmed && (
        <mesh position={[0, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[1.35, 1.8, 40]} />
          <meshBasicMaterial
            color={heat}
            transparent
            opacity={Math.min(0.85, 0.35 + (congestion ?? 0) * 0.35)}
            toneMapped={false}
            depthWrite={false}
          />
        </mesh>
      )}
      {/* Ghosted solid body — dark + translucent so the neon edges carry the
          form. External / planned / not-yet-built nodes are pure wireframe. */}
      {!ghost && (
        <mesh geometry={geom} position={[0, yOffset, 0]} castShadow receiveShadow>
          <meshStandardMaterial
            color="#0b1120"
            emissive={v.color}
            emissiveIntensity={dimmed ? 0.04 : 0.16}
            metalness={0.4}
            roughness={0.35}
            transparent
            opacity={dimmed ? 0.06 : 0.26}
          />
        </mesh>
      )}

      {showMeter && (
        <group position={[1.3, 0, 0]}>
          <mesh position={[0, top / 2, 0]}>
            <boxGeometry args={[0.1, top, 0.1]} />
            <meshBasicMaterial color="#1a2338" transparent opacity={0.45} toneMapped={false} />
          </mesh>
          <mesh position={[0, (meterRatio * top) / 2, 0]}>
            <boxGeometry args={[0.17, Math.max(0.05, meterRatio * top), 0.17]} />
            <meshBasicMaterial color={meterColor} transparent opacity={0.92} toneMapped={false} />
          </mesh>
        </group>
      )}

      <lineSegments geometry={edges} position={[0, yOffset, 0]}>
        <lineBasicMaterial color={v.color} transparent opacity={edgeOpacity} toneMapped={false} />
      </lineSegments>

      {constructing && !future && !dimmed && (
        <Construction geom={geom} shape={v.shape} yOffset={yOffset} top={top} />
      )}

      {tip !== undefined && !ghost && !dimmed && (
        <mesh position={[0, tip, 0]}>
          <sphereGeometry args={[0.28, 16, 12]} />
          <meshStandardMaterial
            color={v.color}
            emissive={v.color}
            emissiveIntensity={2.4}
            toneMapped={false}
          />
        </mesh>
      )}

      <Billboard position={[0, labelY, 0]}>
        {toll != null && toll > 0 && !dimmed && !future && (lod >= 1 || emphasized) && (
          <Text
            position={[0, 0.75, 0]}
            fontSize={0.52}
            color="#a6e3a1"
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.03}
            outlineColor="#05070f"
          >
            {`+$${toll.toFixed(2)}`}
          </Text>
        )}
        {(lod >= 1 || emphasized) && (
          <Text
            fontSize={0.6}
            color="#e8ecf7"
            anchorX="center"
            anchorY="middle"
            textAlign="center"
            overflowWrap="break-word"
            outlineWidth={0.03}
            outlineColor="#05070f"
            maxWidth={5}
            fillOpacity={labelOpacity}
            outlineOpacity={labelOpacity}
          >
            {foldLabel(node.name)}
          </Text>
        )}

        {lod >= 2 && childCount > 0 && !dimmed && !future && (
          <Text
            position={[0, -0.55, 0]}
            fontSize={0.36}
            color="#c4b5fd"
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.02}
            outlineColor="#05070f"
          >
            {`▸ ${childCount} data entities`}
          </Text>
        )}
      </Billboard>
    </group>
  );
}
