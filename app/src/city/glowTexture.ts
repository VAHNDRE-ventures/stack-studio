import * as THREE from 'three';

let cached: THREE.CanvasTexture | null = null;

/** A soft white→transparent radial glow, built once and shared (base haze). */
export function radialGlow(): THREE.CanvasTexture {
  if (cached) return cached;
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.4, 'rgba(180,205,245,0.32)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  cached = new THREE.CanvasTexture(c);
  cached.colorSpace = THREE.SRGBColorSpace;
  return cached;
}
