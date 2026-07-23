// Brand assets served from /public/brand. The splat sequence + timing mirror
// vahndre-site's homepage splatter reveal (shared.js SPLATS).
export const LOGO = '/brand/logo.png';
export const LOGO_NOPAINT = '/brand/logo-nopaint.png';

export interface Splat {
  src: string;
  x: number;
  y: number;
  delay: number;
  revealDur: number;
  initialClip: number;
}

export const SPLATS: Splat[] = [
  { src: '/brand/01-Turquiose.png', x: 59.5, y: 48.3, delay: 0, revealDur: 600, initialClip: 8 },
  { src: '/brand/02-Yellow.png', x: 33.2, y: 52.5, delay: 250, revealDur: 500, initialClip: 0.3 },
  { src: '/brand/03-Indigo.png', x: 45.5, y: 47, delay: 450, revealDur: 550, initialClip: 0.4 },
  { src: '/brand/04-Pink.png', x: 49.8, y: 62.03, delay: 650, revealDur: 900, initialClip: 3 },
  { src: '/brand/05-Orange.png', x: 34, y: 56.04, delay: 850, revealDur: 500, initialClip: 0.3 },
];
