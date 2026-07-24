import { X } from 'lucide-react';
import { useStudio } from '../store';
import { LENSES } from './lenses';
import { CostPanel } from './CostPanel';
import { FlowPanel } from './FlowPanel';
import { BuildPanel } from './BuildPanel';
import { OverlayPanel } from './OverlayPanel';
import { LegendPanel } from './LegendPanel';
import type { Lens } from '../store';

const BODIES: Record<Lens, () => React.ReactElement> = {
  cost: CostPanel,
  flow: FlowPanel,
  build: BuildPanel,
  overlay: OverlayPanel,
  legend: LegendPanel,
};

export function LensDrawer() {
  const openLens = useStudio((s) => s.openLens);
  const setLens = useStudio((s) => s.setLens);

  if (!openLens) return null;
  const meta = LENSES.find((l) => l.id === openLens);
  if (!meta) return null;
  const Body = BODIES[openLens];
  const { Icon, label } = meta;

  return (
    <aside className="lens-drawer" aria-label={label}>
      <div className="lens-head">
        <div className="lens-title">
          <Icon size={15} strokeWidth={2} />
          <span>{label}</span>
        </div>
        <button
          type="button"
          className="icon-btn"
          onClick={() => setLens(null)}
          title="Close (Esc)"
          aria-label="Close lens"
        >
          <X size={16} />
        </button>
      </div>
      <div className="lens-scroll hud">
        <Body />
      </div>
    </aside>
  );
}
