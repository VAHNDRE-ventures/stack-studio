import { useMemo } from 'react';
import { useStudio } from '../store';

export function BuildPanel() {
  const project = useStudio((s) => s.project);
  const phaseCutoff = useStudio((s) => s.phaseCutoff);
  const blastPhase = useStudio((s) => s.blastPhase);
  const setPhaseCutoff = useStudio((s) => s.setPhaseCutoff);
  const toggleBlast = useStudio((s) => s.toggleBlast);
  const clearBlast = useStudio((s) => s.clearBlast);

  const phases = useMemo(
    () => [...(project.phases ?? [])].sort((a, b) => a.order - b.order),
    [project.phases],
  );
  const orders = phases.map((p) => p.order);
  const minOrder = orders.length ? Math.min(...orders) : 0;
  const maxOrder = orders.length ? Math.max(...orders) : 0;
  const cutoffVal = phaseCutoff ?? maxOrder;

  return (
    <div className="sec">
        {phases.length === 0 ? (
          <div className="about">No build phases defined in this project.</div>
        ) : (
          <>
            <input
              type="range"
              min={minOrder}
              max={maxOrder}
              step={1}
              value={cutoffVal}
              onChange={(e) => setPhaseCutoff(Number(e.target.value))}
            />
            <div className="phaselist">
              {phases.map((ph) => {
                const done = ph.order <= cutoffVal;
                const current = ph.order === cutoffVal;
                return (
                  <div
                    key={ph.id}
                    className={`phase clickable${blastPhase === ph.id ? ' sel' : ''}`}
                    onClick={() => toggleBlast(ph.id)}
                  >
                    <span>
                      <i style={{ background: done ? (current ? '#f9e2af' : '#89b4fa') : '#45507a' }} />
                      {ph.name}
                    </span>
                    <span className="binding">
                      {done ? (current ? 'building' : 'built') : 'planned'}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="btnrow">
              <button className="linkbtn" onClick={() => setPhaseCutoff(undefined)}>
                Show all
              </button>
              {blastPhase && (
                <button className="linkbtn" onClick={() => clearBlast()}>
                  Clear focus
                </button>
              )}
            </div>
            <div className="about">
              Scrub to fill the city in phase by phase; click a phase to spotlight its blast radius
              (everything it touches).
            </div>
          </>
        )}
      </div>
  );
}
