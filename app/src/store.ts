import { create } from 'zustand';
import type { Project } from '@model/types';
import type { Selection } from './InspectorPanel';
import { ecommerce } from './sample/ecommerce';
import { importLegacy, isLegacyProject } from './model/legacyImport';
import { validateProject } from './model/validate';
import { flowCost } from './model/opCost';

export type CostFocus = 'fixed' | 'txn' | 'monthly' | null;
export type Quality = 'high' | 'lite';
/** Which single lens drawer is open in the icon-rail HUD (one at a time). */
export type Lens = 'cost' | 'flow' | 'build' | 'overlay' | 'legend';
export type ModalData = { title: string; note: string; rows: [string, string][]; source?: string };

/** True if the GPU reports as software/basic (unmasked renderer, when available). */
function gpuLooksWeak(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl') || c.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl) return true; // no WebGL at all → definitely Lite
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (!ext) return false; // renderer masked → don't judge on this
    const r = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '').toLowerCase();
    return /swiftshader|llvmpipe|software|microsoft basic|angle \(software/.test(r);
  } catch {
    return false;
  }
}

/** Heuristic first-visit tier: Lite on phones / low-core / low-memory / software GPU. */
function autoQuality(): Quality {
  try {
    const nav = navigator as Navigator & { deviceMemory?: number };
    const mobile =
      /Mobi|Android|iPhone|iPad|iPod/i.test(nav.userAgent) ||
      (nav.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 820);
    if (mobile) return 'lite';
    if (typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 4) return 'lite';
    if ((nav.hardwareConcurrency || 8) <= 4) return 'lite';
    if (gpuLooksWeak()) return 'lite';
    return 'high';
  } catch {
    return 'high';
  }
}

function initialQuality(): Quality {
  try {
    const saved = localStorage.getItem('ss-quality');
    if (saved === 'lite' || saved === 'high') return saved; // explicit user choice wins
  } catch {
    /* ignore */
  }
  return autoQuality(); // first visit → detect from the device
}

/** Default the traced flow to the COSTLIEST one, so loading a project immediately
 *  shows money moving (rather than landing on a $0 flow like "Browse"). */
export function pickDefaultFlow(project: Project, drivers: Record<string, number>): string | undefined {
  const flows = project.flows ?? [];
  if (!flows.length) return undefined;
  let bestId = flows[0].id;
  let best = -1;
  for (const f of flows) {
    const c = flowCost(project, f, drivers).perRun;
    if (c > best) {
      best = c;
      bestId = f.id;
    }
  }
  return bestId;
}

export interface StudioState {
  // --- raw state ---
  project: Project;
  isSample: boolean;
  activeFlow?: string;
  driverValues: Record<string, number>;
  phaseCutoff?: number;
  blastPhase?: string;
  sel: Selection | null;
  activeOverlay?: string;
  costFocus: CostFocus;
  error?: string;
  modal: ModalData | null;
  /** Rendering quality tier — 'lite' degrades GPU-heavy visuals (reflection, contact shadows). */
  quality: Quality;
  /** Whether the studio paint (corner logo + floor splatters) is shown. */
  painted: boolean;
  /** Running as an embedded viewer (postMessage-fed). */
  embed: boolean;
  /** Hide ingest/edit chrome (Open/Sample/drag-drop). */
  readOnly: boolean;
  /** Driver "what-if" sliders enabled. */
  allowScenario: boolean;
  /** Embed: waiting for the first model over postMessage. */
  awaitingModel: boolean;

  // --- HUD shell (icon-rail + one-lens drawer + bottom dock) ---
  /** The single open lens drawer, or null when the city is unobstructed. */
  openLens: Lens | null;
  /** Whether the bottom driver-control dock is expanded. */
  dockOpen: boolean;
  /** Clean view: hide all chrome to just the city (screenshots / portal posture). */
  cleanView: boolean;

  // --- actions ---
  /** Swap the active project and reset all view controls to its baselines. */
  loadProject: (p: Project) => void;
  /** Parse + import/validate a dropped/opened file, then load it (or surface an error). */
  loadFromFile: (file: File) => Promise<void>;
  loadSample: () => void;

  setActiveFlow: (id?: string) => void;
  setDriver: (key: string, value: number) => void;
  resetDrivers: () => void;
  setPhaseCutoff: (n?: number) => void;
  toggleBlast: (id: string) => void;
  clearBlast: () => void;
  setSel: (s: Selection | null) => void;
  selectNode: (id: string) => void;
  selectEdge: (id: string) => void;
  toggleOverlay: (id: string) => void;
  clearOverlay: () => void;
  toggleCostFocus: (f: Exclude<CostFocus, null>) => void;
  setModal: (m: ModalData | null) => void;
  setError: (e?: string) => void;
  /** Flip the rendering quality tier (persisted). */
  toggleQuality: () => void;
  /** Wipe / restore the studio paint (corner logo → no-paint + fade the floor splatters). */
  togglePaint: () => void;
  /** Enter embedded-viewer mode (read-only by default) and await a posted model. */
  enterEmbed: (o: { readOnly?: boolean; allowScenario?: boolean; quality?: Quality }) => void;
  /** Apply viewer options carried on a load message. */
  setViewerOptions: (o: { readOnly?: boolean; allowScenario?: boolean; quality?: Quality }) => void;
  /** Set the quality tier without persisting (embed options). */
  setQuality: (q: Quality) => void;
  /** Escape: clear all transient focus/selection UI. */
  dismiss: () => void;

  /** Open the given lens, or close the drawer if it's already the open one. */
  toggleLens: (l: Lens) => void;
  /** Open a specific lens (or close with null). */
  setLens: (l: Lens | null) => void;
  /** Expand/collapse the bottom driver-control dock. */
  toggleDock: () => void;
  /** Toggle clean view (hide all chrome). */
  toggleCleanView: () => void;
}

const baseline = (p: Project) => ({
  project: p,
  isSample: p === ecommerce,
  driverValues: { ...(p.drivers ?? {}) },
  activeFlow: pickDefaultFlow(p, p.drivers ?? {}),
  phaseCutoff: undefined,
  blastPhase: undefined,
  sel: null,
  activeOverlay: undefined,
  costFocus: null as CostFocus,
  error: undefined,
});

export const useStudio = create<StudioState>((set, get) => ({
  ...baseline(ecommerce),
  modal: null,
  quality: initialQuality(),
  painted: true,
  embed: false,
  readOnly: false,
  allowScenario: true,
  awaitingModel: false,
  openLens: null,
  dockOpen: true,
  cleanView: false,

  loadProject: (p) => set({ ...baseline(p), awaitingModel: false }),

  loadFromFile: async (file) => {
    try {
      const raw = JSON.parse(await file.text());
      const p: Project = isLegacyProject(raw) ? importLegacy(raw) : (raw as Project);
      if (!Array.isArray(p.nodes)) throw new Error('Not a StackStudio project');
      const { errors } = validateProject(p);
      if (errors.length) {
        set({ error: `Invalid v2 project (${errors.length}): ${errors.slice(0, 3).join(' · ')}` });
        return;
      }
      get().loadProject(p);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Failed to load' });
    }
  },

  loadSample: () => get().loadProject(ecommerce),

  setActiveFlow: (id) => set({ activeFlow: id }),
  setDriver: (key, value) => set((s) => ({ driverValues: { ...s.driverValues, [key]: value } })),
  resetDrivers: () => set((s) => ({ driverValues: { ...(s.project.drivers ?? {}) } })),
  setPhaseCutoff: (n) => set({ phaseCutoff: n }),
  toggleBlast: (id) => set((s) => ({ blastPhase: s.blastPhase === id ? undefined : id })),
  clearBlast: () => set({ blastPhase: undefined }),
  setSel: (sel) => set({ sel }),
  selectNode: (id) => set({ sel: { kind: 'node', id } }),
  selectEdge: (id) => set({ sel: { kind: 'edge', id } }),
  toggleOverlay: (id) => set((s) => ({ activeOverlay: s.activeOverlay === id ? undefined : id })),
  clearOverlay: () => set({ activeOverlay: undefined }),
  // Focusing a cost figure clears node selection + overlay so the group highlight reads cleanly.
  toggleCostFocus: (f) =>
    set((s) => ({ costFocus: s.costFocus === f ? null : f, sel: null, activeOverlay: undefined })),
  setModal: (modal) => set({ modal }),
  setError: (error) => set({ error }),
  toggleQuality: () =>
    set((s) => {
      const q: Quality = s.quality === 'high' ? 'lite' : 'high';
      try {
        localStorage.setItem('ss-quality', q);
      } catch {
        /* ignore */
      }
      return { quality: q };
    }),
  togglePaint: () => set((s) => ({ painted: !s.painted })),
  enterEmbed: (o) =>
    set((s) => ({
      embed: true,
      awaitingModel: true,
      readOnly: o.readOnly ?? true,
      allowScenario: o.allowScenario ?? true,
      quality: o.quality ?? s.quality,
    })),
  setViewerOptions: (o) =>
    set((s) => ({
      readOnly: o.readOnly ?? s.readOnly,
      allowScenario: o.allowScenario ?? s.allowScenario,
      quality: o.quality ?? s.quality,
    })),
  setQuality: (quality) => set({ quality }),
  dismiss: () =>
    set({ sel: null, modal: null, activeOverlay: undefined, costFocus: null, openLens: null }),

  toggleLens: (l) => set((s) => ({ openLens: s.openLens === l ? null : l })),
  setLens: (l) => set({ openLens: l }),
  toggleDock: () => set((s) => ({ dockOpen: !s.dockOpen })),
  toggleCleanView: () => set((s) => ({ cleanView: !s.cleanView })),
}));
