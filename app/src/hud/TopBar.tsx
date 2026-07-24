import { useRef } from 'react';
import { FolderOpen, Sparkles, Download, Monitor, Brush } from 'lucide-react';
import { useStudio } from '../store';

export function TopBar() {
  const projectName = useStudio((s) => s.project.name);
  const isSample = useStudio((s) => s.isSample);
  const error = useStudio((s) => s.error);
  const loadFromFile = useStudio((s) => s.loadFromFile);
  const loadSample = useStudio((s) => s.loadSample);
  const quality = useStudio((s) => s.quality);
  const toggleQuality = useStudio((s) => s.toggleQuality);
  const readOnly = useStudio((s) => s.readOnly);
  const painted = useStudio((s) => s.painted);
  const togglePaint = useStudio((s) => s.togglePaint);
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
    <header className="top-bar">
      <div className="tb-brand">
        <img src="/brand/logo.png" alt="" className="tb-mark" draggable={false} />
        <h1>{projectName}</h1>
      </div>
      <div className="tb-actions">
        {/* Studio-paint toggle — the corner watermark's utility, surfaced in the
            header on mobile where the corner mark is hidden by the full-width dock. */}
        <button
          type="button"
          className={`tb-paint${painted ? ' active' : ''}`}
          onClick={togglePaint}
          title={painted ? 'Wipe the paint — dial back visual noise' : 'Repaint the studio'}
          aria-label="Toggle studio paint"
        >
          <Brush size={15} />
        </button>
        {!readOnly && (
          <button type="button" onClick={() => fileRef.current?.click()} title="Open a project…">
            <FolderOpen size={15} />
            <span>Open</span>
          </button>
        )}
        {!readOnly && !isSample && (
          <button type="button" onClick={loadSample} title="Load the sample project">
            <Sparkles size={15} />
            <span>Sample</span>
          </button>
        )}
        {!readOnly && (
          <button type="button" onClick={exportJson} title="Download canonical v2 JSON">
            <Download size={15} />
            <span>Export</span>
          </button>
        )}
        <button
          type="button"
          onClick={toggleQuality}
          title="Rendering quality — Lite disables reflections & contact shadows"
        >
          <Monitor size={15} />
          <span>{quality === 'high' ? 'HD' : 'Lite'}</span>
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
      {error && <div className="tb-err">{error}</div>}
    </header>
  );
}
