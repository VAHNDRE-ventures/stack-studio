import { useStudio } from '../store';
import type { Lens } from '../store';
import { LENSES } from './lenses';
import { Eye } from 'lucide-react';

/** Which lenses have data to show, so we can dim the empty ones. */
function useLensAvailability(): Record<Lens, boolean> {
  const project = useStudio((s) => s.project);
  return {
    cost: true,
    flow: (project.flows ?? []).length > 0,
    build: (project.phases ?? []).length > 0,
    overlay: (project.zones ?? []).length > 0,
    legend: project.nodes.length > 0,
  };
}

export function IconRail() {
  const openLens = useStudio((s) => s.openLens);
  const toggleLens = useStudio((s) => s.toggleLens);
  const toggleCleanView = useStudio((s) => s.toggleCleanView);
  const has = useLensAvailability();

  return (
    <nav className="icon-rail" aria-label="Lenses">
      {LENSES.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          className={`rail-btn${openLens === id ? ' active' : ''}${has[id] ? '' : ' empty'}`}
          onClick={() => toggleLens(id)}
          title={has[id] ? label : `${label} — none in this project`}
          aria-label={label}
          aria-pressed={openLens === id}
        >
          <Icon size={19} strokeWidth={1.9} />
        </button>
      ))}
      <div className="rail-spacer" />
      <button
        type="button"
        className="rail-btn"
        onClick={toggleCleanView}
        title="Clean view — hide all chrome"
        aria-label="Clean view"
      >
        <Eye size={19} strokeWidth={1.9} />
      </button>
    </nav>
  );
}
