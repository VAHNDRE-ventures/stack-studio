import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { SPLATS } from '../branding/assets';
import { useStudio } from '../store';
import { collectPlaced } from '../model/flatten';

/** Deterministic pseudo-random (seeded per composite). */
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Load the splat PNGs once, shared across composites.
let imgsPromise: Promise<HTMLImageElement[]> | null = null;
function loadSplatImages(): Promise<HTMLImageElement[]> {
  if (!imgsPromise) {
    imgsPromise = Promise.all(
      SPLATS.map(
        (s) =>
          new Promise<HTMLImageElement>((resolve, reject) => {
            const im = new Image();
            im.onload = () => resolve(im);
            im.onerror = reject;
            im.src = s.src;
          }),
      ),
    );
  }
  return imgsPromise;
}

/**
 * Paint splatters spattered across the studio floor — the brand palette scattered
 * like a real art-room floor. All splats are COMPOSITED onto one canvas texture
 * (2D painter's-order blending → true overlapping paint, no coplanar z-sort
 * flicker, one draw call) on a single ground plane. Reseeds + rescales to the
 * city size on every project load.
 */
export function PaintSplatters() {
  const project = useStudio((s) => s.project);
  const painted = useStudio((s) => s.painted);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const [state, setState] = useState<{ tex: THREE.CanvasTexture; span: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadSplatImages().then((imgs) => {
      if (cancelled) return;
      const nb = Math.max(1, collectPlaced(project).nodes.length);
      const R = Math.max(16, Math.min(58, 12 + Math.sqrt(nb) * 6)); // working-area radius
      const sScale = R / 30;
      const maxHalf = (44 * sScale) / 2 + 4; // biggest possible splat half-size (+pad)
      const span = 2 * (R + maxHalf); // decal plane sized to JUST the painted area
      const N = Math.max(16, Math.min(40, Math.round(nb * 1.2)));

      // Resolution follows a target texel density (px per world unit), clamped —
      // so splats stay crisp regardless of project size, without a giant texture.
      const DENSITY = 22;
      const px = Math.max(1024, Math.min(3072, Math.round(span * DENSITY)));
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = px;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.imageSmoothingQuality = 'high';
      const toPx = (w: number) => (w / span) * px;
      const c = px / 2;

      const r = mulberry32((Math.random() * 0xffffffff) >>> 0); // fresh seed each load
      for (let i = 0; i < N; i++) {
        const ang = r() * Math.PI * 2;
        const rad = Math.pow(r(), 1.5) * R; // center-weighted → clusters on the working area
        const x = Math.cos(ang) * rad;
        const z = Math.sin(ang) * rad;
        const big = r() < 0.35;
        const size = (big ? 22 + r() * 22 : 8 + r() * 16) * sScale; // wide size variance
        const rot = r() * Math.PI * 2;
        const opacity = 0.28 + r() * 0.4;
        const img = imgs[Math.floor(r() * imgs.length)];
        const sp = toPx(size);
        ctx.save();
        ctx.translate(c + toPx(x), c + toPx(z));
        ctx.rotate(rot);
        ctx.globalAlpha = opacity;
        ctx.drawImage(img, -sp / 2, -sp / 2, sp, sp);
        ctx.restore();
      }

      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      setState((prev) => {
        prev?.tex.dispose();
        return { tex, span };
      });
    });
    return () => {
      cancelled = true;
    };
  }, [project]);

  useFrame((_, dt) => {
    if (matRef.current) {
      matRef.current.opacity = THREE.MathUtils.damp(matRef.current.opacity, painted ? 1 : 0, 5, dt);
    }
  });

  if (!state) return null;
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
      <planeGeometry args={[state.span, state.span]} />
      <meshBasicMaterial
        ref={matRef}
        map={state.tex}
        transparent
        opacity={1}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}
