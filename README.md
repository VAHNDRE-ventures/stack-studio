# StackStudio

## Architecture & Tech-Stack Visualizer

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**StackStudio** is a client-side web app for visualizing and organizing
software architectures. It is a fork and rework of
[ztack](https://github.com/Oddzac/ztack), focused on correctly handling
real-world stack layouts and diagrams. Built with vanilla JavaScript and the
HTML5 Canvas — no build step, no framework, no server.

It offers four synchronized views over a single project model:

- **Stack** — a high-level rotary carousel of layers, with substacks nested
  inside each layer.
- **Diagram** — a draggable C4-style architecture diagram with typed,
  labeled connections.
- **Actions** — user-flow / request-path tracking across layers.
- **Cost** — a roll-up of per-layer fixed and variable costs.

![Diagram view](screenshot-diagram.png)
![Stack view](screenshot-stack.png)

## Run it

Fully client-side. Serve the folder with any static server:

```bash
# Python
python -m http.server 8777

# Node
npx http-server -p 8777
```

Then open `http://localhost:8777`. Opening `index.html` directly works too,
though loading the bundled templates requires being served over `http://`.

## Data model

A project is a JSON document:

```jsonc
{
  "name": "My System",
  "layers": [
    {
      "id": 1,
      "name": "API Gateway",
      "type": "API",                 // Core|Frontend|Backend|Database|DevOps|API|Other
      "status": "Active",            // Active|Inactive|Deprecated
      "technology": "Express.js",
      "description": "...",
      "responsibilities": "...",
      "connections": [               // canonical form: array of objects
        { "targetId": 2, "type": "HTTP" }
      ],
      "costModel": { "currency": "USD", "period": "month",
                     "fixedCost": 400, "variableCost": 0.00002,
                     "variableUnit": "per-request" },
      "substacks": [ /* same shape, nested one level */ ]
    }
  ],
  "diagramPositions": { "1": { "x": 200, "y": 200 } }  // saved node positions
}
```

Connections are stored as `{ targetId, type }` objects. Legacy numeric and
parallel-array forms are migrated automatically on load. The real-world
sample in `samples/sample-saas.json` is used by the test suite.

## Using it

- **Add / edit layers** in the Stack view or via the details panel on the
  right. The panel has Properties, Connections, Cost and Substacks tabs; the
  open tab is preserved as you edit.
- **Diagram view**: drag nodes to reposition them (positions are saved with
  the project), drag the canvas to pan, scroll to zoom. The toolbar has zoom,
  Fit, and Auto-arrange (↻) controls. Connection lines are labeled with their
  type; hover a node to highlight its connections.
- **File menu**: New, Open (import JSON), Save (export JSON), and Templates.
  Projects auto-save to `localStorage`.

### Keyboard & navigation

| Input | Action |
|-------|--------|
| ↑ / ↓ | Navigate layers (Stack view) |
| → / ← | Enter / exit a substack |
| Mouse wheel | Scroll layers (Stack) / zoom (Diagram) |
| Drag node | Reposition (Diagram) |
| Drag canvas | Pan (Diagram) |
| Ctrl+Z / Ctrl+Y | Undo / Redo |

## Architecture

```
index.html              entry point, markup, script load order
static/css/style.css    all styling
static/js/
  utils.js              HTML escaping + canonical connection accessor (loads first)
  data.js               data model, migrations, cost engine, templates
  validation.js         project validation
  views/
    stackView.js        renderLayers — the carousel
    detailsView.js      renderLayerDetails — the right panel
    actionsView.js      renderActionsView — flows
    costDashboardView.js renderCostDashboard
  app.js                state, view switching, selection, navigation, undo/redo
  diagram.js            canvas rendering, layout, drag, zoom/pan
```

Each renderer is defined in exactly one place (the `views/` modules are the
single source of truth — see the changelog for why this matters).

## Testing

Zero-dependency checks under `samples/` (dev server must be running on
`:8777` for the browser ones):

```bash
node samples/validate.mjs        # data layer: migration, connections, escaping
node samples/check-wiring.mjs    # static: no dup functions, handlers resolve
node samples/smoke.mjs           # headless Chrome: boots, loads sample, all views
node samples/check-diagram.mjs   # headless: layout, edges, drag persistence
node samples/shoot.mjs <view>    # screenshot a view to samples/shots/
```

## Changelog (fork from ztack)

This fork prioritized correctness on real stacks over new features:

- **HTML escaping everywhere.** Names, descriptions and other text are now
  escaped before insertion. Real data (quotes, backticks, angle brackets)
  previously corrupted inputs and the diagram, and was an injection vector.
- **One connection format.** Standardized on `{ targetId, type }` objects (the
  format real exports use). The old migration converted *toward* a
  parallel-array form that the rest of the app didn't read.
- **Real node dragging.** The diagram now supports drag-to-reposition with
  positions persisted on the project — previously advertised but never
  implemented. Layout is computed once (and on structural change), not every
  frame, so drags survive and the CPU isn't pegged.
- **No more duplicate renderers.** An earlier refactor left `renderLayers`,
  `renderActionsView` and `updateActionsListOnly` defined in both `app.js`
  and their view module; `app.js` loaded last and silently shadowed the
  modules. The duplicates were removed.
- **Details panel** keeps your active tab across edits and only re-renders
  other views when a label-affecting field changes.
- **Robustness**: `zoomToFit` no longer divides by zero (NaN → blank canvas),
  canvas listeners bind once, and per-frame `console.log` spam was removed.
- **Cleanup**: removed the non-functional Flask stub, the unused `config.js`,
  the committed `debug.log`, and inline-styled menus (now CSS classes).
- Added on-canvas connection-type labels and an Auto-arrange control.

## License

MIT — see [LICENSE](LICENSE). Original work © the ztack authors.
