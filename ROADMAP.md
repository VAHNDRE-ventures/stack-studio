# StackStudio Roadmap — toward a hosted, agent-fed portal

The near-term goal: host StackStudio as an **authenticated portal on the Vahndre
brand website** where granted users load and view the *current state* of a
project's architecture, and **agents update the data feed** that the live view
reads. This document is the plan.

## Guiding principle: separate the generic TOOL from the per-project DATA

The `stack-studio/` repo is the **generic tool** and MUST stay free of any
client data (see the confidential invariant in `STACK-STUDIO-SCHEMA-GAPS.md` and
`MODEL.md`). Each project's `*.v2.json` lives in its **own** data store, never in
this repo. The tool renders whatever validated project it is pointed at.

## Current state (2026-07-22)

The structural refactor is **done** — the app is cleanly separated and the
groundwork for the portal is in place:

- **`model/`** — pure, unit-tested engines (cost foresight, per-op/flow cost,
  projected monthly, usage/congestion incl. multi-driver, validate, importers;
  32 vitests green).
- **`city/`** — the r3f scene, one component per concern.
- **`hud/`** — the control panels, each subscribing to the store.
- **`store.ts`** — Zustand store: all app state + actions (incl. `quality`
  HD/Lite with auto-detect, and the `painted` studio-paint toggle).
- **`App.tsx`** — a ~95-line composition shell (was an ~800-line God component).

Also shipped since the refactor: cost-along-flow toll ticker, vertical load
meters, zone fences, semantic-zoom LOD, the full illustrative-visuals pass
(reflective floor, contact shadows, ground haze, comet-bead traffic, paint-
splatter studio floor), brand placements (splatter load splash, clickable
corner watermark, ambient backdrop), a renderer perf audit (instanced traffic,
on-demand shadows, dpr/MSAA tiering), and graceful HD/Lite degradation.

## Refactor sequence (status)

1. ✅ **State store (Zustand).** All state in `store.ts`; scene + panels subscribe.
2. ✅ **Decompose the HUD** into panel components under a `Sidebar` shell.
3. ✅ **Data source + embeddable read-only viewer** — BUILT (2026-07-22).
   `EmbedBridge` + store `embed`/`readOnly`/`allowScenario`/`awaitingModel`.
   Activates on `?embed` or inside an iframe; enters read-only; postMessage
   handshake below; `validateProject` on ingest; `Export` (download canonical v2
   JSON) in the full app + `stackstudio:export` reply. URL opts: `readonly=0`,
   `scenario=0`, `quality=lite|high`. Remaining: static PNG export (Option C
   fallback) + portal chrome (pairs with the vahndre side).

   Contract (agreed with the `vahndre` agent, 2026-07-22 — see
   `vahndre-site/.../handoffs/STACKSTUDIO-V2-EMBED*.md`):
   - A **`/viewer`** route that boots **read-only** (`options.readOnly` hides the
     Open/Sample/drag-drop ingest chrome; keeps orbit/zoom, LOD, flow trace, cost
     dashboard + drill-down, build scrubber, overlays, inspector, HD/Lite, and
     the what-if driver sliders).
   - **postMessage handshake** (origin-checked): iframe→`stackstudio:ready`;
     parent→`stackstudio:load {model, options}`; iframe→`stackstudio:loaded
     {modelVersion}` / `stackstudio:error {errors}`. Model passed **inline**
     (never a URL/CDN) — confidential-safe.
     Export: parent→`stackstudio:export-request`; iframe→`stackstudio:export
     {model, modelVersion}`, plus a download "Export v2 JSON" action. The
     canonical v2 JSON **is** the stored `project.currentState` (no transform).
   - Auto-migrate on load (v1→v2 via `legacyImport`; future v2.x in the loader);
     echo `modelVersion` back so the portal can reason about drift.
   - Optional `options.quality` / `options.theme`; a static PNG export as the
     lossy Option-C fallback/thumbnail.
4. ✅ **Delete `src/spike/`.**
5. ◧ **Visual polish.** The illustrative/brand/perf passes are done; remaining is
   portal chrome (auth badge, project switcher) — pairs with step 3.

## Portal architecture (Cloudflare-native, matches the house stack)

- **App** → **Cloudflare Pages, git-connected** to `VAHNDRE-ventures/stack-studio`
  (project `stack-studio-app`). **LIVE: `https://studio.vahndre.com`** — every push
  to `main` auto-builds (`npm run build` in `app/`) and deploys; **no hand-deploys**.
  `main` is therefore a **production branch**: only push green code
  (typecheck + test + build), and note a breaking viewer/schema change reaches prod
  on push (loader-migration + the stored `modelVersion` mitigate — older models
  up-convert on load). `VIEWER_ORIGIN = https://studio.vahndre.com`. Embed
  `_headers`/`_redirects` shipped; `frame-ancestors` already allows both
  `portal.vahndre.com` and `internal.vahndre.com` (internal dogfood ready).
- **Project data feed** → each project's validated `*.v2.json` in its own **KV or
  R2**, NOT in the tool repo. Portal fetches at view time.
- **Auth** → **Cloudflare Access** in front of Pages + the data Worker. The data
  endpoint must be access-controlled (never public) — architectures can be
  confidential.
- **Agent write pipeline** → agent authors/updates the project JSON *to the
  contract* (`MODEL.md` / `model/types.ts`) → **validator gates it** → writes to
  that project's KV/R2 → portal reads latest on next load. Agents are the
  *writers* to the feed; the portal is a *read-only viewer* over it. The data
  contract + validator are what make this safe.

## Non-negotiables carried forward

- The data contract (`MODEL.md` + `model/types.ts`) is the durable asset; the
  `validateProject` gate protects the live view from bad ingests.
- No client data in this repo, ever (templates stay generic).
- Keep the app runnable and the test suite green at every step.
