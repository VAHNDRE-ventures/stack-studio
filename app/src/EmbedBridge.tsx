import { useEffect } from 'react';
import type { Project } from '@model/types';
import { MODEL_VERSION } from '@model/types';
import { useStudio } from './store';
import { validateProject } from './model/validate';
import { importLegacy, isLegacyProject } from './model/legacyImport';

/** Origins allowed to drive the embedded viewer. */
const ALLOWED = [
  /^https?:\/\/([a-z0-9-]+\.)*vahndre\.com$/i,
  /^https?:\/\/localhost(:\d+)?$/i,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/i,
];
const originOk = (o: string) => ALLOWED.some((re) => re.test(o));

interface LoadMsg {
  type: 'stackstudio:load';
  model: unknown;
  options?: { readOnly?: boolean; allowScenario?: boolean; quality?: 'high' | 'lite' };
}

/**
 * Portal render contract (see ROADMAP §3 / the vahndre handoff): when embedded
 * (`?embed` or inside an iframe), enter read-only mode and exchange the model
 * with the parent purely over postMessage — nothing in a URL/CDN.
 *
 *   iframe → parent : {type:'stackstudio:ready'}
 *   parent → iframe : {type:'stackstudio:load', model, options}
 *   iframe → parent : {type:'stackstudio:loaded', modelVersion} | {type:'stackstudio:error', errors}
 *   parent → iframe : {type:'stackstudio:export-request'}
 *   iframe → parent : {type:'stackstudio:export', model, modelVersion}
 */
export function EmbedBridge() {
  const enterEmbed = useStudio((s) => s.enterEmbed);
  const setViewerOptions = useStudio((s) => s.setViewerOptions);
  const loadProject = useStudio((s) => s.loadProject);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const embedded = params.has('embed') || window.parent !== window;
    if (!embedded) return;

    enterEmbed({
      readOnly: params.get('readonly') !== '0',
      allowScenario: params.get('scenario') !== '0',
      quality:
        params.get('quality') === 'lite' ? 'lite' : params.get('quality') === 'high' ? 'high' : undefined,
    });

    const reply = (msg: unknown, origin: string) => {
      try {
        window.parent.postMessage(msg, origin);
      } catch {
        /* parent gone */
      }
    };

    const onMsg = (e: MessageEvent) => {
      if (!originOk(e.origin) || !e.data || typeof e.data !== 'object') return;
      const d = e.data as { type?: string } & Partial<LoadMsg>;

      if (d.type === 'stackstudio:load') {
        try {
          const raw = d.model as unknown;
          const p: Project = isLegacyProject(raw) ? importLegacy(raw as never) : (raw as Project);
          if (!p || !Array.isArray(p.nodes)) {
            reply({ type: 'stackstudio:error', errors: ['Not a StackStudio project'] }, e.origin);
            return;
          }
          const { errors } = validateProject(p);
          if (errors.length) {
            reply({ type: 'stackstudio:error', errors }, e.origin);
            return;
          }
          if (d.options) setViewerOptions(d.options);
          loadProject(p);
          reply({ type: 'stackstudio:loaded', modelVersion: p.modelVersion ?? MODEL_VERSION }, e.origin);
        } catch (err) {
          reply({ type: 'stackstudio:error', errors: [err instanceof Error ? err.message : String(err)] }, e.origin);
        }
      } else if (d.type === 'stackstudio:export-request') {
        const proj = useStudio.getState().project;
        reply({ type: 'stackstudio:export', model: proj, modelVersion: proj.modelVersion }, e.origin);
      }
    };

    window.addEventListener('message', onMsg);
    // Announce readiness (ping only, no data → '*' is safe).
    try {
      window.parent.postMessage({ type: 'stackstudio:ready' }, '*');
    } catch {
      /* ignore */
    }
    return () => window.removeEventListener('message', onMsg);
  }, [enterEmbed, setViewerOptions, loadProject]);

  return null;
}
