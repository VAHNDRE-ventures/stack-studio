import { useRef } from 'react';
import { useStudio } from '../store';
import { DriversPanel } from './DriversPanel';
import { CostPanel } from './CostPanel';
import { FlowPanel } from './FlowPanel';
import { BuildPanel } from './BuildPanel';
import { OverlayPanel } from './OverlayPanel';
import { LegendPanel } from './LegendPanel';

export function Sidebar() {
  const projectName = useStudio((s) => s.project.name);
  const isSample = useStudio((s) => s.isSample);
  const error = useStudio((s) => s.error);
  const loadFromFile = useStudio((s) => s.loadFromFile);
  const loadSample = useStudio((s) => s.loadSample);
  const quality = useStudio((s) => s.quality);
  const toggleQuality = useStudio((s) => s.toggleQuality);
  const readOnly = useStudio((s) => s.readOnly);
  const fileRef = useRef<HTMLInputElement>(null);

  const exportJson = () => {
    const project = useStudio.getState().project;
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(project.name || 'project').replace(/\s+/g, '-').toLowerCase()}.v2.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="hud">
      <div className="hud-head">
        <div className="hud-brand">
          <img src="/brand/logo.png" alt="" className="hud-mark" draggable={false} />
          <h1>{projectName}</h1>
        </div>
        <div className="btnrow">
          {!readOnly && <button onClick={() => fileRef.current?.click()}>Open…</button>}
          {!readOnly && !isSample && <button onClick={loadSample}>Sample</button>}
          {!readOnly && <button onClick={exportJson}>Export</button>}
          <button
            onClick={toggleQuality}
            title="Rendering quality — Lite disables reflections & contact shadows"
          >
            {quality === 'high' ? 'HD' : 'Lite'}
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) loadFromFile(f);
            e.target.value = '';
          }}
        />
        {error && <div className="err">{error}</div>}
      </div>

      <div className="hud-scroll">
        <DriversPanel />
        <CostPanel />
        <FlowPanel />
        <BuildPanel />
        <OverlayPanel />
        <LegendPanel />
      </div>

      <div className="hud-foot">Drag to orbit · scroll to zoom · drop a .json to load</div>
    </div>
  );
}
