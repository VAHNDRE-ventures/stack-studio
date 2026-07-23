import { useMemo } from 'react';
import { useStudio } from '../store';
import { overlayInfo } from '../city/derive';
import { buildOverlayModal } from './modals';

export function OverlayPanel() {
  const project = useStudio((s) => s.project);
  const activeOverlay = useStudio((s) => s.activeOverlay);
  const toggleOverlay = useStudio((s) => s.toggleOverlay);
  const setModal = useStudio((s) => s.setModal);

  const { zones, colorOf, counts } = useMemo(() => overlayInfo(project), [project]);

  return (
    <details>
      <summary>Compliance scopes</summary>
      <div className="sec">
        {(zones ?? []).length === 0 ? (
          <div className="about">No compliance scopes defined in this project.</div>
        ) : (
          <>
            {(zones ?? []).map((z) => (
              <div
                key={z.id}
                className={`cliff clickable${activeOverlay === z.id ? ' sel' : ''}`}
                onClick={() => {
                  const on = activeOverlay === z.id;
                  toggleOverlay(z.id);
                  setModal(on ? null : buildOverlayModal(project, z));
                }}
              >
                <span>
                  <i style={{ background: colorOf[z.id] }} />
                  {z.name}
                </span>
                <span className="binding">{counts[z.id] ?? 0} nodes</span>
              </div>
            ))}
            <div className="about">
              Click a scope to highlight its components (the rest dims) and read what it covers. Only
              one shows at a time.
            </div>
          </>
        )}
      </div>
    </details>
  );
}
