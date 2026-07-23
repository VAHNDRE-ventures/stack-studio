import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { useStudio } from '../store';

/**
 * Drives the real HD/Lite differences and ties up per-frame waste:
 *  - Pixel ratio: HD renders up to 2× device pixels, Lite pins to 1× (a large,
 *    perceptible + cheap difference — 4× fewer pixels through bloom/shadows).
 *  - Shadows: ON in HD, OFF in Lite (skips the whole shadow pass).
 *  - On-demand shadow rendering: the city is static, so instead of re-rendering
 *    the shadow map EVERY frame we bake it only when the built geometry can
 *    change (project / build-phase). A quiet but real per-frame win in HD.
 */
export function QualityController() {
  const gl = useThree((s) => s.gl);
  const setDpr = useThree((s) => s.setDpr);
  const quality = useStudio((s) => s.quality);
  const project = useStudio((s) => s.project);
  const phaseCutoff = useStudio((s) => s.phaseCutoff);

  useEffect(() => {
    const high = quality === 'high';
    setDpr(high ? Math.min(window.devicePixelRatio || 1, 2) : 1);
    gl.shadowMap.enabled = high;
    gl.shadowMap.autoUpdate = false; // static scene → render shadows on demand
    gl.shadowMap.needsUpdate = high;
  }, [quality, gl, setDpr]);

  // Re-bake shadows only when what casts them can change (+ a beat for async layout).
  useEffect(() => {
    if (quality !== 'high') return;
    gl.shadowMap.needsUpdate = true;
    const id = window.setTimeout(() => {
      gl.shadowMap.needsUpdate = true;
    }, 150);
    return () => clearTimeout(id);
  }, [project, phaseCutoff, quality, gl]);

  return null;
}
