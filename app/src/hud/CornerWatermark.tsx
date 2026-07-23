import { LOGO, LOGO_NOPAINT } from '../branding/assets';
import { useStudio } from '../store';

/**
 * Clickable brand mark in the corner. The no-paint logo sits underneath; the
 * painted logo layers on top and crossfades OUT on click — revealing the clean
 * mark — while the studio floor splatters de-render in the scene. Click again to
 * repaint.
 */
export function CornerWatermark() {
  const painted = useStudio((s) => s.painted);
  const togglePaint = useStudio((s) => s.togglePaint);

  return (
    <button
      className="corner-watermark"
      onClick={togglePaint}
      title={painted ? 'Wipe the paint' : 'Repaint'}
      aria-label="Toggle studio paint"
    >
      <img src={LOGO_NOPAINT} className="cw-img" alt="" draggable={false} />
      <img
        src={LOGO}
        className={`cw-img cw-paint${painted ? '' : ' cleaned'}`}
        alt="Vahndre"
        draggable={false}
      />
    </button>
  );
}
