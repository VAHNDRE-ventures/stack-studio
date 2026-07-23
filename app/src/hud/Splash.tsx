import { useEffect, useRef, useState } from 'react';
import { LOGO, LOGO_NOPAINT, SPLATS } from '../branding/assets';
import './splash.css';

/**
 * Load splash — a faithful port of vahndre-site's splatter reveal: the no-paint
 * logo, five color splats clip-revealed in a staggered sequence, then the painted
 * logo crossfades in; the overlay then fades to reveal the app. Click to skip.
 */
export function Splash({ onDone }: { onDone: () => void }) {
  const splatRefs = useRef<(HTMLImageElement | null)[]>([]);
  const finalRef = useRef<HTMLImageElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const [dismiss, setDismiss] = useState(false);
  const doneRef = useRef(false);

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    setDismiss(true);
    setTimeout(onDone, 720);
  };

  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      if (finalRef.current) finalRef.current.style.opacity = '1';
      const t = setTimeout(finish, 900);
      return () => clearTimeout(t);
    }

    let raf = 0;
    let t0: number | null = null;
    let phase: 'splatter' | 'fade' = 'splatter';
    const states = SPLATS.map(() => 'waiting');
    const timers: number[] = [];

    const start = window.setTimeout(() => {
      const frame = (ts: number) => {
        if (t0 === null) t0 = ts;
        const elapsed = ts - t0;
        let allDone = true;
        SPLATS.forEach((s, i) => {
          const el = splatRefs.current[i];
          if (!el) return;
          if (elapsed < s.delay) {
            allDone = false;
            return;
          }
          const se = elapsed - s.delay;
          if (states[i] === 'waiting') {
            states[i] = 'revealing';
            el.style.opacity = '1';
          }
          if (states[i] === 'revealing') {
            const p = Math.min(1, se / s.revealDur);
            const eased = 1 - Math.pow(1 - p, 5);
            const r = s.initialClip + eased * (50 - s.initialClip);
            el.style.clipPath = `circle(${r}% at 50% 50%)`;
            if (p >= 1) {
              states[i] = 'done';
              el.style.clipPath = 'none';
            }
          }
          if (states[i] !== 'done') allDone = false;
        });

        if (allDone) {
          phase = 'fade';
          timers.push(
            window.setTimeout(() => {
              if (finalRef.current) finalRef.current.style.opacity = '1';
              if (layerRef.current) {
                layerRef.current.style.transition = 'opacity 1s ease-in-out';
                layerRef.current.style.opacity = '0';
              }
              timers.push(window.setTimeout(finish, 1650));
            }, 150),
          );
        }
        if (phase === 'splatter') raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    }, 220);

    return () => {
      clearTimeout(start);
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
    };
  }, []);

  return (
    <div className={`splash${dismiss ? ' dismiss' : ''}`} onClick={finish}>
      <div className="splash-logo">
        <img src={LOGO_NOPAINT} className="splash-base" alt="Vahndre Ventures" draggable={false} />
        <div className="splash-splats" ref={layerRef}>
          {SPLATS.map((s, i) => (
            <img
              key={i}
              ref={(el) => {
                splatRefs.current[i] = el;
              }}
              src={s.src}
              className="splash-splat"
              alt=""
              draggable={false}
              style={{
                width: '100%',
                left: `${s.x - 50}%`,
                top: `${s.y - 50}%`,
                clipPath: `circle(${s.initialClip}% at 50% 50%)`,
              }}
            />
          ))}
        </div>
        <img src={LOGO} className="splash-final" ref={finalRef} alt="" draggable={false} />
      </div>
      <div className="splash-hint">click to skip</div>
    </div>
  );
}
