import { useMemo } from 'react';
import { useStudio } from '../store';
import { KIND_VISUAL } from '../city/visuals';

export function LegendPanel() {
  const project = useStudio((s) => s.project);
  const kinds = useMemo(
    () => Array.from(new Set(project.nodes.map((n) => n.kind))),
    [project],
  );

  return (
    <div className="sec legend">
        {kinds.map((k) => (
          <div className="row" key={k}>
            <span>
              <i style={{ background: KIND_VISUAL[k].color }} />
              {k.replace(/_/g, ' ')}
            </span>
          </div>
        ))}
      </div>
  );
}
