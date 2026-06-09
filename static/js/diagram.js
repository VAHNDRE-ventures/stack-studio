let canvas, ctx;
let nodePositions = {};
let zoomLevel = 1;
let panX = 0;
let panY = 0;
let isPanning = false;
let panStartX = 0;
let panStartY = 0;
let lastX = 0;
let lastY = 0;
let touchDistance = 0;
let connections = []; // Store connection metadata for hover detection
let hoveredConnection = null; // Track currently hovered connection
let connectionTooltip = null; // Tooltip element
let hoveredNodeId = null; // Track currently hovered node

// Drag-to-reposition state. The original app advertised drag-and-drop but
// never implemented it, and recomputed the whole layout every frame (which
// would have erased any manual move). We now lay out once, let the user drag
// nodes, and persist positions on the project so they survive save/reload.
let draggedNodeId = null;
let dragMoved = false;
let dragOffsetX = 0;
let dragOffsetY = 0;
// Pre-drag project snapshot, pushed onto the undo stack only if a drag
// actually repositions a node (so Ctrl+Z reverts node moves).
let dragStartSnapshot = null;

// Push the pre-drag snapshot onto the global undo stack so a node move can be
// undone. saveState() snapshots the *current* (already-moved) state, so we
// can't reuse it here; instead we splice our pre-drag snapshot in directly.
function commitDragUndo() {
    if (dragStartSnapshot === null) return;
    if (typeof undoStack !== 'undefined') {
        undoStack.push(dragStartSnapshot);
        if (typeof MAX_HISTORY !== 'undefined' && undoStack.length > MAX_HISTORY) {
            undoStack.shift();
        }
        if (typeof redoStack !== 'undefined') redoStack = [];
    }
    dragStartSnapshot = null;
}

// ---------------------------------------------------------------------------
// Multi-selection + group dragging.
//
// `selectedNodeIds` is the set of nodes the user has gathered (Ctrl/Cmd+click
// to toggle, or Alt+drag a parent to grab its whole subtree). Dragging any
// member moves the entire set together. `dragGroupStart` snapshots each moving
// node's position at drag start so we can apply a single delta to all of them.
// ---------------------------------------------------------------------------
let selectedNodeIds = new Set();
let dragGroupStart = null;            // { id: {x, y} } captured at drag start
let dragAnchorX = 0, dragAnchorY = 0; // world coords where the drag began
let suppressClick = false;            // skip the click after a drag / ctrl-toggle

// All ids in a node's subtree (the node itself plus every descendant).
function collectSubtreeIds(node, acc) {
    acc = acc || [];
    if (!node) return acc;
    acc.push(node.id);
    if (node.substacks) node.substacks.forEach(c => collectSubtreeIds(c, acc));
    return acc;
}

// Clear the multi-selection (used by Escape / empty-canvas click).
function clearDiagramSelection() {
    if (selectedNodeIds.size === 0) return;
    selectedNodeIds = new Set();
    renderDiagram();
}

const NODE_WIDTH = 200;
const NODE_HEIGHT = 120;

// Snap-to-grid for node dragging. When enabled, dragged node centers snap to a
// grid of `snapGridSize` world units. Persisted per-browser.
let snapToGrid = false;
let snapGridSize = 5;  // world units; user-selectable (2-5)

function loadSnapPrefs() {
    try {
        const s = localStorage.getItem('ztack_snap');
        if (s !== null) snapToGrid = s === '1';
        const g = parseInt(localStorage.getItem('ztack_snap_size') || '', 10);
        // Valid grid sizes are 5..20 in steps of 5; coerce older/invalid prefs.
        if (!isNaN(g) && g >= 1) snapGridSize = Math.min(20, Math.max(5, Math.round(g / 5) * 5));
    } catch (e) {}
}

function saveSnapPrefs() {
    try {
        localStorage.setItem('ztack_snap', snapToGrid ? '1' : '0');
        localStorage.setItem('ztack_snap_size', String(snapGridSize));
    } catch (e) {}
}

// Round a world coordinate to the snap grid (no-op when snapping is off).
function snapCoord(v) {
    if (!snapToGrid || !(snapGridSize > 0)) return v;
    return Math.round(v / snapGridSize) * snapGridSize;
}

let diagramInitialized = false;

// Diagram layout mode: 'stack' (composition — substacks nested right of their
// parent, group boxes) or 'flow' (process — nodes ranked top→bottom by edge
// direction with phase/lane bands, à la a Mermaid flowchart). Persisted.
let diagramLayoutMode = 'stack';

function loadLayoutModePref() {
    try {
        const m = localStorage.getItem('ztack_layout_mode');
        if (m === 'flow' || m === 'stack') diagramLayoutMode = m;
    } catch (e) {}
}
function saveLayoutModePref() {
    try { localStorage.setItem('ztack_layout_mode', diagramLayoutMode); } catch (e) {}
}

// True when the current project looks like a flow graph (any node carries a
// `group` tag, e.g. a Mermaid import). Used to auto-suggest flow mode.
function projectHasGroups() {
    const all = getAllLayers();
    return all.some(l => l && typeof l.group === 'string' && l.group);
}

function initDiagramView() {
    canvas = document.getElementById('diagram-canvas');
    ctx = canvas.getContext('2d');

    resizeCanvas();
    recalculateLayout();

    // Attach listeners only once. initDiagramView runs every time the user
    // switches to the diagram view; re-binding here stacked duplicate
    // handlers and caused multi-fire renders.
    if (!diagramInitialized) {
        canvas.addEventListener('mousedown', handleCanvasMouseDown);
        canvas.addEventListener('mousemove', handleCanvasMouseMove);
        canvas.addEventListener('mouseup', handleCanvasMouseUp);
        canvas.addEventListener('mouseleave', handleCanvasMouseLeave);
        canvas.addEventListener('click', handleCanvasClick);
        canvas.addEventListener('wheel', handleCanvasWheel, { passive: false });

        // Touch events for mobile
        canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
        canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
        canvas.addEventListener('touchend', handleTouchEnd);

        window.addEventListener('resize', resizeCanvas);
        diagramInitialized = true;
    }

    addZoomControls();
    zoomToFit();
    renderDiagram();
}

function resizeCanvas() {
    if (!canvas) return;
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    if (ctx) renderDiagram();
}

function addZoomControls() {
    const container = document.getElementById('diagram-view');
    if (document.getElementById('zoom-controls')) return;

    loadSnapPrefs();
    loadLayoutModePref();

    const controls = document.createElement('div');
    controls.id = 'zoom-controls';
    controls.style.cssText = 'position: absolute; top: 20px; right: 20px; display: flex; flex-direction: column; gap: 8px; z-index: 100;';
    controls.innerHTML = `
        <button onclick="zoomIn()" title="Zoom in" style="background: #0f172a; border: 1px solid #334155; color: #e2e8f0; padding: 8px 12px; border-radius: 4px; cursor: pointer; font-size: 16px;">+</button>
        <button onclick="zoomReset()" title="Reset zoom" style="background: #0f172a; border: 1px solid #334155; color: #e2e8f0; padding: 8px 12px; border-radius: 4px; cursor: pointer; font-size: 12px;">100%</button>
        <button onclick="zoomOut()" title="Zoom out" style="background: #0f172a; border: 1px solid #334155; color: #e2e8f0; padding: 8px 12px; border-radius: 4px; cursor: pointer; font-size: 16px;">\u2212</button>
        <button onclick="zoomToFit()" title="Fit to screen" style="background: #0f172a; border: 1px solid #334155; color: #e2e8f0; padding: 8px 12px; border-radius: 4px; cursor: pointer; font-size: 12px;">Fit</button>
        <button onclick="toggleLayoutMode()" id="layout-mode-btn" title="Toggle Stack / Flow layout" style="background: #0f172a; border: 1px solid #334155; color: #e2e8f0; padding: 8px 12px; border-radius: 4px; cursor: pointer; font-size: 12px;">Flow</button>
        <button onclick="arrangeButtonClick()" title="Auto-arrange nodes (groups kept apart)" style="background: #0f172a; border: 1px solid #334155; color: #e2e8f0; padding: 8px 12px; border-radius: 4px; cursor: pointer; font-size: 12px;">\u21BB</button>
        <button onclick="exportDiagramImage(4)" title="Export high-resolution PNG (fits all elements + 20px)" style="background: #0f172a; border: 1px solid #334155; color: #e2e8f0; padding: 8px 12px; border-radius: 4px; cursor: pointer; font-size: 14px;">\u2B07</button>
    `;
    container.appendChild(controls);

    // Reflect the persisted layout mode on the toggle button.
    updateLayoutModeButton();

    if (!document.getElementById('snap-controls')) {
        const snap = document.createElement('div');
        snap.id = 'snap-controls';
        snap.style.cssText = 'position: absolute; top: 60px; left: 16px; display: flex; align-items: center; gap: 8px; background: rgba(15,23,42,0.92); border: 1px solid #334155; border-radius: 6px; padding: 6px 10px; z-index: 100; font-size: 12px; color: #94a3b8;';
        snap.innerHTML = `
            <label style="display:flex; align-items:center; gap:6px; cursor:pointer; user-select:none;">
                <input type="checkbox" id="snap-toggle" ${snapToGrid ? 'checked' : ''}>
                <span>Snap to grid</span>
            </label>
            <select id="snap-size" title="Grid size" style="background:#0f172a; color:#e2e8f0; border:1px solid #334155; border-radius:4px; padding:3px 6px; font-size:12px; cursor:pointer;">
                ${[5,10,15,20].map(n => `<option value="${n}" ${snapGridSize===n?'selected':''}>${n}px</option>`).join('')}
            </select>
        `;
        container.appendChild(snap);

        const toggle = snap.querySelector('#snap-toggle');
        const sizeSel = snap.querySelector('#snap-size');
        toggle.addEventListener('change', () => {
            snapToGrid = toggle.checked;
            saveSnapPrefs();
            // Re-snap all existing positions so the grid applies immediately.
            if (snapToGrid) snapAllNodePositions();
            renderDiagram();
        });
        sizeSel.addEventListener('change', () => {
            snapGridSize = parseInt(sizeSel.value, 10) || 5;
            saveSnapPrefs();
            if (snapToGrid) { snapAllNodePositions(); }
            renderDiagram();
        });
    }

    // A subtle, dismissable hint that nodes are draggable (the original UI
    // gave no indication, and the README's drag claim was never wired up).
    if (!document.getElementById('diagram-hint')) {
        const hint = document.createElement('div');
        hint.id = 'diagram-hint';
        hint.textContent = 'Drag to move \u2022 Ctrl+click to multi-select \u2022 Alt+drag a node to move its whole group \u2022 \u21BB auto-arranges';
        hint.style.cssText = 'position: absolute; bottom: 16px; left: 16px; background: rgba(15,23,42,0.85); border: 1px solid #334155; color: #94a3b8; padding: 6px 12px; border-radius: 4px; font-size: 11px; z-index: 100; pointer-events: none;';
        container.appendChild(hint);
    }

    // Legend: explains node statuses (dashed = planned) and the actor glyph.
    if (!document.getElementById('diagram-legend')) {
        const legend = document.createElement('div');
        legend.id = 'diagram-legend';
        legend.style.cssText = 'position: absolute; bottom: 16px; right: 16px; background: rgba(15,23,42,0.9); border: 1px solid #334155; color: #94a3b8; padding: 8px 12px; border-radius: 6px; font-size: 11px; z-index: 100; pointer-events: none; line-height: 1.7;';
        legend.innerHTML =
            '<div style="display:flex;align-items:center;gap:6px;"><span style="display:inline-block;width:14px;height:10px;border:2px dashed #f59e0b;border-radius:2px;"></span> Planned / Proposed</div>' +
            '<div style="display:flex;align-items:center;gap:6px;"><span style="color:#ec4899;">\u{1F9D1}</span> External actor</div>' +
            '<div style="display:flex;align-items:center;gap:6px;"><span style="display:inline-block;width:14px;border-top:2px solid #e2e8f0;"></span> Labeled data flow</div>';
        container.appendChild(legend);
    }
}

function zoomIn() {
    zoomLevel = Math.min(zoomLevel * 1.2, 3);
    renderDiagram();
}

function zoomOut() {
    zoomLevel = Math.max(zoomLevel / 1.2, 0.3);
    renderDiagram();
}

function zoomReset() {
    zoomLevel = 1;
    panX = 0;
    panY = 0;
    renderDiagram();
}

function zoomToFit() {
    const allLayers = getAllLayers();
    if (allLayers.length === 0) return;

    ensureNodePositions();

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let counted = 0;

    allLayers.forEach(layer => {
        if (nodePositions[layer.id]) {
            minX = Math.min(minX, nodePositions[layer.id].x - NODE_WIDTH / 2);
            maxX = Math.max(maxX, nodePositions[layer.id].x + NODE_WIDTH / 2);
            minY = Math.min(minY, nodePositions[layer.id].y - NODE_HEIGHT / 2);
            maxY = Math.max(maxY, nodePositions[layer.id].y + NODE_HEIGHT / 2);
            counted++;
        }
    });

    if (counted === 0) return;

    // Guard against zero-size content (single node / coincident nodes) which
    // previously produced a division by zero -> NaN zoom and a blank canvas.
    const contentWidth = Math.max(maxX - minX, NODE_WIDTH);
    const contentHeight = Math.max(maxY - minY, NODE_HEIGHT);
    const scaleX = (canvas.width * 0.9) / contentWidth;
    const scaleY = (canvas.height * 0.9) / contentHeight;

    zoomLevel = Math.max(0.15, Math.min(scaleX, scaleY, 2));
    panX = (canvas.width / 2 - (minX + maxX) / 2 * zoomLevel);
    panY = (canvas.height / 2 - (minY + maxY) / 2 * zoomLevel);

    renderDiagram();
}

function handleCanvasWheel(e) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.3, Math.min(3, zoomLevel * delta));
    
    // Zoom towards mouse position
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    panX = mouseX - (mouseX - panX) * (newZoom / zoomLevel);
    panY = mouseY - (mouseY - panY) * (newZoom / zoomLevel);
    
    zoomLevel = newZoom;
    renderDiagram();
}

function recalculateLayout() {
    nodePositions = {};

    // Flow mode uses a completely different (ranked, banded) layout.
    if (diagramLayoutMode === 'flow') {
        computeFlowLayout();
        applySavedPositions();
        return;
    }

    // Count leaves under a node (min 1) — used to size vertical footprints so
    // deep subtrees don't overlap.
    function countLeaves(node) {
        if (!node.substacks || node.substacks.length === 0) return 1;
        return node.substacks.reduce((sum, c) => sum + countLeaves(c), 0);
    }
    
    // Build dependency graph and calculate levels (left to right flow)
    const levels = calculateLayerLevels();
    
    // Group layers by level
    const layersByLevel = {};
    project.layers.forEach(layer => {
        const level = levels[layer.id] || 0;
        if (!layersByLevel[level]) layersByLevel[level] = [];
        layersByLevel[level].push(layer);
    });
    
    // Layout parameters
    const baseX = 200;
    const baseY = 200;
    const nodeWidth = 200;
    const nodeHeight = 120;
    const minVerticalSpacing = 120; // space between sibling subtrees in a level
    const minHorizontalSpacing = 250;
    const childXStep = 320;          // horizontal step per nesting level
    const levelGap = 220;            // gap between a level's right edge and the next level

    // Max nesting depth under a node (a leaf = 0). Used to compute how far a
    // level's subtrees extend rightward, so the next level can start clear of
    // them instead of using a fixed (often-too-wide) column spacing.
    function subtreeDepth(node) {
        if (!node.substacks || node.substacks.length === 0) return 0;
        return 1 + Math.max(...node.substacks.map(subtreeDepth));
    }

    // X coordinate for each dependency level, computed cumulatively so columns
    // are spaced by their actual content width (fixes "massive + compact").
    // Long chains are wrapped into multiple rows so the diagram stays close to
    // the viewport aspect instead of becoming one very wide ribbon.
    const sortedLevels = Object.keys(layersByLevel).map(Number).sort((a, b) => a - b);
    const MAX_COLS_PER_ROW = 5;   // wrap the dependency flow after this many levels
    const ROW_GAP = 420;          // vertical gap between wrapped bands
    const levelX = {};
    const levelRow = {};
    let cursorX = baseX;
    let rowStartLevel = 0;
    sortedLevels.forEach((level, idx) => {
        const col = idx % MAX_COLS_PER_ROW;
        if (col === 0 && idx > 0) {
            cursorX = baseX;           // new band: reset X
            rowStartLevel = idx;
        }
        levelX[level] = cursorX;
        levelRow[level] = Math.floor(idx / MAX_COLS_PER_ROW);
        const maxDepth = Math.max(0, ...layersByLevel[level].map(subtreeDepth));
        const extent = nodeWidth + maxDepth * childXStep;
        cursorX += extent + levelGap;
    });

    // Per-row vertical offset: each wrapped band sits below the previous one,
    // clear of its tallest content.
    const rowBaseY = {};
    {
        let y = baseY;
        const rows = Math.max(0, ...Object.values(levelRow)) + 1;
        for (let row = 0; row < rows; row++) {
            rowBaseY[row] = y;
            // Height of this row = max total leaves across its levels.
            let maxLeaves = 1;
            sortedLevels.forEach((lv, i) => {
                if (Math.floor(i / MAX_COLS_PER_ROW) === row) {
                    layersByLevel[lv].forEach(l => { maxLeaves = Math.max(maxLeaves, countLeaves(l)); });
                }
            });
            y += maxLeaves * 150 + ROW_GAP;
        }
    }
    
    // Track occupied regions for collision detection
    const occupiedRegions = [];
    
    function checkCollision(x, y, width = nodeWidth, height = nodeHeight) {
        const padding = 20;
        const rect = {
            left: x - width / 2 - padding,
            right: x + width / 2 + padding,
            top: y - height / 2 - padding,
            bottom: y + height / 2 + padding
        };
        
        return occupiedRegions.some(occupied => {
            return !(rect.right < occupied.left || 
                     rect.left > occupied.right || 
                     rect.bottom < occupied.top || 
                     rect.top > occupied.bottom);
        });
    }
    
    function findNonCollidingPosition(baseX, baseY, width = nodeWidth, height = nodeHeight) {
        let x = baseX;
        let y = baseY;
        let attempts = 0;
        const maxAttempts = 50;
        
        while (checkCollision(x, y, width, height) && attempts < maxAttempts) {
            // Try shifting down first (preferred for visual flow)
            y += minVerticalSpacing;
            attempts++;
            
            // If we've shifted too far down, try shifting right
            if (attempts > 10) {
                x += minHorizontalSpacing;
                y = baseY;
                attempts = 0;
            }
        }
        
        return { x, y };
    }
    
    function recordOccupiedRegion(x, y, width = nodeWidth, height = nodeHeight) {
        const padding = 20;
        occupiedRegions.push({
            left: x - width / 2 - padding,
            right: x + width / 2 + padding,
            top: y - height / 2 - padding,
            bottom: y + height / 2 + padding
        });
    }
    
    // Position layers level by level (left to right, wrapping into rows)
    Object.keys(layersByLevel).sort((a, b) => a - b).forEach(level => {
        const layersInLevel = layersByLevel[level];
        let currentY = rowBaseY[levelRow[parseInt(level)]] || baseY;
        
        layersInLevel.forEach((layer, idx) => {
            // Reserve vertical space based on the layer's total leaf count
            // (full subtree), not just direct children, so deep trees don't
            // collide with the next top-level layer.
            const totalLeaves = countLeaves(layer);
            const layerHeight = totalLeaves > 1 ? totalLeaves * 150 : 120;
            
            const basePosition = {
                x: levelX[parseInt(level)],   // content-aware column X
                y: currentY
            };
            
            // Check for collisions and adjust if needed
            const finalPosition = findNonCollidingPosition(basePosition.x, basePosition.y, nodeWidth, layerHeight);
            
            nodePositions[layer.id] = {
                x: finalPosition.x,
                y: finalPosition.y,
                level: parseInt(level),
                row: idx
            };
            
            recordOccupiedRegion(finalPosition.x, finalPosition.y, nodeWidth, layerHeight);
            
            // Move baseline for next layer in this level
            currentY = finalPosition.y + layerHeight + minVerticalSpacing;
        });
    });
    
    // Position substacks relative to parents, recursively to any depth. Each
    // level steps further right; siblings are stacked vertically and spaced by
    // their own subtree height so deep trees don't overlap. (childXStep is
    // defined above and shared with the column-extent calc.)
    const leafSpacing = 150;

    function placeChildren(node) {
        if (!node.substacks || node.substacks.length === 0) return;
        if (!nodePositions[node.id]) return;
        const px = nodePositions[node.id].x;
        const py = nodePositions[node.id].y;
        const totalLeaves = node.substacks.reduce((s, c) => s + countLeaves(c), 0);
        const totalHeight = (totalLeaves - 1) * leafSpacing;
        let cursor = py - totalHeight / 2;
        node.substacks.forEach(child => {
            const span = (countLeaves(child) - 1) * leafSpacing;
            const childY = cursor + span / 2;
            nodePositions[child.id] = { x: px + childXStep, y: childY };
            cursor += span + leafSpacing;
            placeChildren(child);
        });
    }

    project.layers.forEach(layer => placeChildren(layer));

    // Restore any manually-saved positions over the computed defaults so a
    // user's drag arrangement survives view switches and reloads.
    applySavedPositions();
}

/**
 * FLOW LAYOUT — a layered directed-graph layout (Sugiyama-style, à la Mermaid
 * `flowchart TD`). Nodes are flat (substacks, if any, are flattened in); rank
 * = longest path from a source along forward edges, so the diagram reads
 * top→bottom in flow order. Within a rank, nodes are grouped by their `group`
 * (phase/lane) and ordered by the barycenter of their predecessors to reduce
 * edge crossings. Back-edges (cycles / feedback like Plan→Store→Plan) don't
 * affect ranking — they're just drawn as return edges by the normal renderer.
 *
 * Writes into nodePositions and stashes the computed phase bands on
 * `flowBands` for the renderer.
 */
let flowBands = [];   // [{ name, top, bottom, color }] in world coords (flow mode)

function computeFlowLayout() {
    flowBands = [];
    const all = getAllLayers();
    if (all.length === 0) return;

    const ids = all.map(l => String(l.id));
    const idSet = new Set(ids);
    const nodeById = {};
    all.forEach(l => { nodeById[String(l.id)] = l; });

    // Forward adjacency (only edges to real nodes).
    const out = {};
    const indeg = {};
    ids.forEach(id => { out[id] = []; indeg[id] = 0; });
    all.forEach(l => {
        const src = String(l.id);
        (l.connections || []).forEach(c => {
            const tgt = String(typeof c === 'object' ? c.targetId : c);
            if (idSet.has(tgt) && tgt !== src) { out[src].push(tgt); indeg[tgt]++; }
        });
    });

    // Rank by longest path from sources, ignoring back-edges via DFS coloring
    // so cycles don't loop forever. rank[v] = max over forward preds of rank+1.
    const rank = {};
    const state = {}; // 0=unvisited,1=in-progress,2=done
    ids.forEach(id => { rank[id] = 0; state[id] = 0; });

    function dfs(u) {
        state[u] = 1;
        out[u].forEach(v => {
            if (state[v] === 1) return; // back-edge — skip for ranking
            if (rank[v] < rank[u] + 1) rank[v] = rank[u] + 1;
            if (state[v] === 0) dfs(v);
            else if (state[v] === 2) {
                // Already ranked; if our path makes it deeper, propagate.
                if (rank[v] < rank[u] + 1) { rank[v] = rank[u] + 1; dfs(v); }
            }
        });
        state[u] = 2;
    }
    // Start from true sources (indeg 0) first, then any unvisited (cycle roots).
    ids.filter(id => indeg[id] === 0).forEach(id => { if (state[id] === 0) dfs(id); });
    ids.forEach(id => { if (state[id] === 0) dfs(id); });

    // Phase-aware rank flooring: when nodes carry `group` tags (a flow import),
    // keep each phase in its own band of ranks by flooring every node's rank to
    // its phase ordinal. This stops feedback loops (write-back → sources) from
    // interleaving phases and makes the bands disjoint, which reads far cleaner.
    const groupOrderArr = (project && Array.isArray(project.groupOrder)) ? project.groupOrder : [];
    const phaseIndex = g => groupOrderArr.indexOf(g);
    const hasPhases = groupOrderArr.length > 0 && ids.some(id => phaseIndex(nodeById[id].group) >= 0);
    if (hasPhases) {
        // Map each used phase ordinal to a contiguous "phase rank" so phases
        // with no nodes don't leave gaps, and within-phase forward edges still
        // add sub-ranks.
        const usedPhases = [...new Set(ids.map(id => phaseIndex(nodeById[id].group)).filter(i => i >= 0))].sort((a, b) => a - b);
        const phaseBase = {};
        let base = 0;
        // Leave room inside each phase for its own internal depth.
        usedPhases.forEach(pi => {
            phaseBase[pi] = base;
            // internal depth = max forward chain length among this phase's nodes
            const members = ids.filter(id => phaseIndex(nodeById[id].group) === pi);
            const localMax = members.reduce((mx, id) => Math.max(mx, rank[id]), 0);
            const localMin = members.reduce((mn, id) => Math.min(mn, rank[id]), Infinity);
            const span = Number.isFinite(localMin) ? (localMax - localMin) : 0;
            base += span + 1;
        });
        ids.forEach(id => {
            const pi = phaseIndex(nodeById[id].group);
            if (pi >= 0) {
                const members = ids.filter(x => phaseIndex(nodeById[x].group) === pi);
                const localMin = members.reduce((mn, x) => Math.min(mn, rank[x]), Infinity);
                rank[id] = phaseBase[pi] + (rank[id] - localMin);
            }
        });
    }

    // Bucket nodes by rank.
    const ranks = {};
    let maxRank = 0;
    ids.forEach(id => {
        const r = rank[id];
        (ranks[r] = ranks[r] || []).push(id);
        if (r > maxRank) maxRank = r;
    });

    // Order within each rank: primarily by group (using project.groupOrder when
    // present), secondarily by barycenter of already-placed predecessors to cut
    // crossings. Several sweeps refine the barycenter.
    const groupOrder = (project && Array.isArray(project.groupOrder)) ? project.groupOrder : [];
    const groupRank = g => {
        const i = groupOrder.indexOf(g);
        return i === -1 ? (g ? 500 : 999) : i;   // ungrouped sorts last
    };
    const orderPos = {}; // id → index within its rank

    const sortRank = (r, useBary) => {
        const arr = ranks[r];
        if (!arr || !arr.length) return;
        arr.sort((a, b) => {
            const ga = groupRank(nodeById[a].group), gb = groupRank(nodeById[b].group);
            if (ga !== gb) return ga - gb;
            if (useBary) {
                const ba = baryOf(a), bb = baryOf(b);
                if (ba !== bb) return ba - bb;
            }
            return nodeById[a].name.localeCompare(nodeById[b].name);
        });
        arr.forEach((id, i) => { orderPos[id] = i; });
    };
    // Barycenter = average order index of forward predecessors in rank-1.
    const preds = {};
    ids.forEach(id => { preds[id] = []; });
    Object.keys(out).forEach(u => out[u].forEach(v => { if (rank[v] === rank[u] + 1) preds[v].push(u); }));
    const baryOf = (id) => {
        const ps = preds[id];
        if (!ps.length) return orderPos[id] != null ? orderPos[id] : 0;
        let s = 0, n = 0;
        ps.forEach(p => { if (orderPos[p] != null) { s += orderPos[p]; n++; } });
        return n ? s / n : 0;
    };
    for (let r = 0; r <= maxRank; r++) sortRank(r, false);
    for (let pass = 0; pass < 4; pass++) {
        for (let r = 1; r <= maxRank; r++) sortRank(r, true);
    }

    // Place nodes. Vertical ranks (top→bottom), horizontal spread within rank.
    const RANK_GAP = 200;     // vertical distance between ranks
    const COL_GAP = 90;       // horizontal gap between nodes in a rank
    const colStep = NODE_WIDTH + COL_GAP;
    const widestRank = Math.max(...Object.values(ranks).map(a => a.length), 1);
    const totalWidth = widestRank * colStep;

    for (let r = 0; r <= maxRank; r++) {
        const arr = ranks[r] || [];
        const rowWidth = arr.length * colStep;
        const startX = (totalWidth - rowWidth) / 2 + colStep / 2;
        const y = 200 + r * (NODE_HEIGHT + RANK_GAP);
        arr.forEach((id, i) => {
            nodePositions[id] = { x: startX + i * colStep, y };
        });
    }

    // Compute phase bands: for each group, the min/max Y of its members,
    // padded. Bands span the full content width so they read as lanes.
    const groups = {};
    all.forEach(l => {
        const g = l.group;
        if (!g) return;
        const p = nodePositions[String(l.id)];
        if (!p) return;
        const b = groups[g] || (groups[g] = { name: g, top: Infinity, bottom: -Infinity, minX: Infinity, maxX: -Infinity });
        b.top = Math.min(b.top, p.y - NODE_HEIGHT / 2);
        b.bottom = Math.max(b.bottom, p.y + NODE_HEIGHT / 2);
        b.minX = Math.min(b.minX, p.x - NODE_WIDTH / 2);
        b.maxX = Math.max(b.maxX, p.x + NODE_WIDTH / 2);
    });
    const orderedGroupNames = Object.keys(groups).sort((a, b) => groupRank(a) - groupRank(b));
    flowBands = orderedGroupNames.map((name, i) => {
        const b = groups[name];
        const palette = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899', '#ef4444', '#64748b'];
        return {
            name,
            top: b.top - 28,
            bottom: b.bottom + 28,
            color: palette[i % palette.length]
        };
    });
}

/**
 * Draw the flow-mode phase bands: full-width horizontal lanes behind the nodes,
 * each tinted with its group color and labeled at the left. Bands are computed
 * by computeFlowLayout into `flowBands` (world coords). They span the full
 * content width so the eye reads them as process stages.
 */
function drawFlowBands() {
    if (!flowBands || !flowBands.length) return;
    // Full content width across all placed nodes (so bands are uniform).
    let minX = Infinity, maxX = -Infinity;
    Object.keys(nodePositions).forEach(id => {
        const p = nodePositions[id];
        minX = Math.min(minX, p.x - NODE_WIDTH / 2);
        maxX = Math.max(maxX, p.x + NODE_WIDTH / 2);
    });
    if (minX === Infinity) return;
    const pad = 80;
    const left = minX - pad, right = maxX + pad;
    const width = right - left;

    flowBands.forEach(band => {
        ctx.save();
        // Tinted fill.
        ctx.globalAlpha = 0.07;
        ctx.fillStyle = band.color;
        ctx.fillRect(left, band.top, width, band.bottom - band.top);
        // Top/bottom rules.
        ctx.globalAlpha = 0.4;
        ctx.strokeStyle = band.color;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([10, 6]);
        ctx.beginPath();
        ctx.moveTo(left, band.top); ctx.lineTo(right, band.top);
        ctx.moveTo(left, band.bottom); ctx.lineTo(right, band.bottom);
        ctx.stroke();
        ctx.setLineDash([]);
        // Label (left-aligned, inside the band top).
        ctx.globalAlpha = 0.95;
        ctx.fillStyle = band.color;
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(band.name, left + 14, band.top + 20);
        ctx.restore();
    });
    ctx.globalAlpha = 1;
}

/**
 * Persist current node positions onto the project so manual arrangements
 * survive save/export/reload. Stored as a flat { id: {x, y} } map.
 */
function persistNodePositions() {
    if (!project) return;
    project.diagramPositions = project.diagramPositions || {};
    Object.keys(nodePositions).forEach(id => {
        const pos = nodePositions[id];
        project.diagramPositions[id] = { x: pos.x, y: pos.y };
    });
    if (typeof saveProject === 'function') saveProject();
}

/**
 * Snap every node's current position to the grid and persist. Called when the
 * user turns snapping on or changes the grid size, so existing nodes align
 * immediately rather than only on the next drag.
 */
function snapAllNodePositions() {
    Object.keys(nodePositions).forEach(id => {
        const pos = nodePositions[id];
        pos.x = snapCoord(pos.x);
        pos.y = snapCoord(pos.y);
    });
    persistNodePositions();
}

/**
 * Draw the snap grid over the visible world region. The raw snap size (2-5px)
 * is too fine to draw directly, so we step it up to a multiple that's at least
 * ~14 screen px apart, keeping it legible and cheap at any zoom.
 */
function drawSnapGrid() {
    if (!canvas) return;
    // Choose a spacing that is a multiple of snapGridSize and >= ~14px on screen.
    const minScreenPx = 14;
    let step = snapGridSize;
    if (step * zoomLevel < minScreenPx) {
        step = snapGridSize * Math.ceil(minScreenPx / (snapGridSize * zoomLevel));
    }
    // Visible world bounds (inverse of translate+scale).
    const x0 = -panX / zoomLevel;
    const y0 = -panY / zoomLevel;
    const x1 = (canvas.width - panX) / zoomLevel;
    const y1 = (canvas.height - panY) / zoomLevel;
    const startX = Math.floor(x0 / step) * step;
    const startY = Math.floor(y0 / step) * step;

    ctx.save();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.12)';
    ctx.lineWidth = 1 / zoomLevel;  // keep ~1px regardless of zoom
    ctx.beginPath();
    for (let x = startX; x <= x1; x += step) {
        ctx.moveTo(x, y0); ctx.lineTo(x, y1);
    }
    for (let y = startY; y <= y1; y += step) {
        ctx.moveTo(x0, y); ctx.lineTo(x1, y);
    }
    ctx.stroke();
    ctx.restore();
}

/**
 * Overlay saved positions (if any) onto the freshly computed layout.
 */
function applySavedPositions() {
    if (!project || !project.diagramPositions) return;
    Object.keys(project.diagramPositions).forEach(id => {
        // nodePositions keys are coerced to strings by object access; match by
        // checking both the raw and string id against existing nodes.
        const saved = project.diagramPositions[id];
        const match = Object.keys(nodePositions).find(k => String(k) === String(id));
        if (match !== undefined) {
            nodePositions[match].x = saved.x;
            nodePositions[match].y = saved.y;
        }
    });
}

/**
 * Ensure every current layer/substack has a position. Called each render so
 * newly-added nodes appear without forcing a full relayout (which would
 * discard manual drags of existing nodes).
 */
function ensureNodePositions() {
    if (!project) return;
    const all = getAllLayers();
    let missing = false;
    let fallbackX = 200;
    let fallbackY = 200;
    all.forEach(layer => {
        if (!nodePositions[layer.id]) {
            missing = true;
            nodePositions[layer.id] = { x: fallbackX, y: fallbackY };
            fallbackY += 200;
        }
    });
    // Drop positions for nodes that no longer exist.
    const liveIds = new Set(all.map(l => String(l.id)));
    Object.keys(nodePositions).forEach(id => {
        if (!liveIds.has(String(id))) delete nodePositions[id];
    });
    if (missing) applySavedPositions();
}

/**
 * Recompute the full layout from scratch and re-fit. Use when structure
 * changes materially (add/delete layer) or when the user asks to auto-arrange.
 */
function refreshDiagramLayout(fit = false) {
    if (!canvas || !ctx) return;
    recalculateLayout();
    if (fit) zoomToFit();
    renderDiagram();
}

/**
 * Auto-arrange: a full relayout followed by the group-separation pass, then a
 * fit. This is what the toolbar's arrange button runs. It's kept separate from
 * refreshDiagramLayout so undo/redo and structural relayouts don't shove a
 * user's manual arrangement around — only an explicit arrange does that.
 */
function autoArrangeDiagram() {
    if (!canvas || !ctx) return;
    recalculateLayout();
    // Group separation only applies to the composition (stack) layout; flow
    // mode is already collision-free by construction (ranked + spread).
    if (diagramLayoutMode !== 'flow') separateTopLevelGroups();
    zoomToFit();
    renderDiagram();
}

// Toolbar arrange button: make the auto-arrange undoable by snapshotting the
// project first, then run the group-aware arrange.
function arrangeButtonClick() {
    if (typeof project !== 'undefined' && typeof undoStack !== 'undefined') {
        undoStack.push(JSON.stringify(project));
        if (typeof MAX_HISTORY !== 'undefined' && undoStack.length > MAX_HISTORY) undoStack.shift();
        if (typeof redoStack !== 'undefined') redoStack = [];
    }
    autoArrangeDiagram();
}

// Update the layout-mode button's label to show what a click will switch TO.
function updateLayoutModeButton() {
    const btn = document.getElementById('layout-mode-btn');
    if (!btn) return;
    btn.textContent = diagramLayoutMode === 'flow' ? 'Stack' : 'Flow';
    btn.title = diagramLayoutMode === 'flow'
        ? 'Switch to Stack layout (composition / substacks)'
        : 'Switch to Flow layout (process ranks + phase lanes)';
    btn.style.borderColor = diagramLayoutMode === 'flow' ? '#3b82f6' : '#334155';
}

/**
 * Switch between Stack (composition) and Flow (process) layouts. Recomputes the
 * layout fresh in the new mode and fits. The mode is persisted; manual drags
 * saved in one mode are reapplied via applySavedPositions, but a mode switch
 * intentionally recomputes so the new arrangement makes sense.
 */
function toggleLayoutMode() {
    diagramLayoutMode = (diagramLayoutMode === 'flow') ? 'stack' : 'flow';
    saveLayoutModePref();
    updateLayoutModeButton();
    recalculateLayout();
    zoomToFit();
    renderDiagram();
}

function setLayoutMode(mode) {
    if (mode !== 'flow' && mode !== 'stack') return;
    diagramLayoutMode = mode;
    saveLayoutModePref();
    updateLayoutModeButton();
}

// Background fill used for image export (matches the .diagram-frame CSS bg).
const DIAGRAM_BG = '#1e293b';

/**
 * Bounding box (world coords) of everything drawn in the diagram: every node's
 * rectangle plus every group box (which already includes its own dashed-border
 * padding), expanded by `pad` on all sides. Returns null if nothing is placed.
 */
function computeContentBounds(pad = 20) {
    const all = getAllLayers();
    let L = Infinity, T = Infinity, R = -Infinity, B = -Infinity;
    let any = false;
    all.forEach(l => {
        const p = nodePositions[l.id];
        if (p) {
            any = true;
            L = Math.min(L, p.x - NODE_WIDTH / 2);
            R = Math.max(R, p.x + NODE_WIDTH / 2);
            T = Math.min(T, p.y - NODE_HEIGHT / 2);
            B = Math.max(B, p.y + NODE_HEIGHT / 2);
        }
    });
    if (!any) return null;

    // Fold in each group box (recursively) so the dashed borders + group labels
    // are inside the exported frame, not clipped at the edge.
    const incl = (node, depth) => {
        const gb = groupBounds(node, depth);
        if (gb) {
            L = Math.min(L, gb.left); R = Math.max(R, gb.right);
            // Group label sits a few px above the box top; pad covers it.
            T = Math.min(T, gb.top); B = Math.max(B, gb.bottom);
        }
        if (node.substacks) node.substacks.forEach(c => incl(c, depth + 1));
    };
    (project.layers || []).forEach(l => incl(l, 0));

    // In flow mode, fold in the phase bands (full-width lanes + labels).
    if (diagramLayoutMode === 'flow' && flowBands && flowBands.length) {
        flowBands.forEach(band => {
            T = Math.min(T, band.top);
            B = Math.max(B, band.bottom);
        });
    }

    return { left: L - pad, top: T - pad, right: R + pad, bottom: B + pad };
}

/**
 * Export the whole diagram as an ultra-high-resolution PNG. The image aspect
 * ratio is exactly the content bounding box (top-left → bottom-right of all
 * elements) plus ~20px padding — no viewport cropping, no extra whitespace.
 *
 * Rendering reuses the live draw pipeline by temporarily pointing the module's
 * canvas/ctx/zoom/pan globals at an off-screen canvas sized to the content, so
 * the export is pixel-identical to what's on screen (minus hover/selection
 * chrome and the snap grid, which are suppressed for a clean export).
 *
 * @param {number} scale  device-pixels per world-unit (default 4 = "ultra").
 */
function exportDiagramImage(scale = 4) {
    if (!canvas || !ctx || typeof project === 'undefined' || !project) return;
    ensureNodePositions();

    const PAD = 20;
    const b = computeContentBounds(PAD);
    if (!b) { alert('Nothing to export yet.'); return; }

    const wWorld = b.right - b.left;
    const hWorld = b.bottom - b.top;

    // Cap the largest output dimension so we stay within browser canvas limits
    // (toDataURL fails on very large canvases). 12000px keeps quality high while
    // staying safe across browsers; scale is reduced to fit if needed.
    const MAX_DIM = 12000;
    let s = Math.max(1, scale);
    if (wWorld * s > MAX_DIM || hWorld * s > MAX_DIM) {
        s = Math.max(1, Math.min(MAX_DIM / wWorld, MAX_DIM / hWorld));
    }

    const off = document.createElement('canvas');
    off.width = Math.max(1, Math.round(wWorld * s));
    off.height = Math.max(1, Math.round(hWorld * s));

    // Swap the rendering globals to the off-screen target.
    const sv = {
        canvas, ctx, zoomLevel, panX, panY,
        hoveredNodeId, hoveredConnection, selectedNodeIds, snapToGrid
    };
    canvas = off;
    ctx = off.getContext('2d');
    zoomLevel = s;
    panX = -b.left * s;
    panY = -b.top * s;
    // Suppress interactive chrome for a clean export.
    hoveredNodeId = null;
    hoveredConnection = null;
    selectedNodeIds = new Set();
    snapToGrid = false;

    let url = null;
    try {
        renderDiagramWithHover();
        // Paint the background behind everything (the render clears to
        // transparent, so we composite the bg underneath).
        ctx.save();
        ctx.globalCompositeOperation = 'destination-over';
        ctx.fillStyle = DIAGRAM_BG;
        ctx.fillRect(0, 0, off.width, off.height);
        ctx.restore();
        url = off.toDataURL('image/png');
    } catch (e) {
        console.error('Diagram export failed:', e);
        alert('Export failed: ' + e.message);
    } finally {
        // Restore the on-screen rendering globals and redraw.
        canvas = sv.canvas; ctx = sv.ctx;
        zoomLevel = sv.zoomLevel; panX = sv.panX; panY = sv.panY;
        hoveredNodeId = sv.hoveredNodeId;
        hoveredConnection = sv.hoveredConnection;
        selectedNodeIds = sv.selectedNodeIds;
        snapToGrid = sv.snapToGrid;
        renderDiagram();
    }

    if (url) {
        const safe = (project.name || 'diagram').replace(/[^a-z0-9-_]+/gi, '_').replace(/^_+|_+$/g, '') || 'diagram';
        const a = document.createElement('a');
        a.href = url;
        a.download = `${safe}_diagram_${off.width}x${off.height}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();

        // Also export a companion Markdown legend documenting every node and its
        // description/connections, so the exported image has a readable key.
        exportDiagramDoc(safe);
    }
}

/**
 * Export a Markdown "legend" document for the diagram: every node grouped by
 * phase (if grouped) or listed flat, with type/status/technology, description,
 * and outgoing connections. Downloaded alongside the PNG so a shared image has
 * an accompanying written reference. Pure DOM/Blob — no dependencies.
 */
function exportDiagramDoc(baseName) {
    if (typeof project === 'undefined' || !project) return;
    const all = getAllLayers();
    if (!all.length) return;

    const safe = baseName || (project.name || 'diagram').replace(/[^a-z0-9-_]+/gi, '_').replace(/^_+|_+$/g, '') || 'diagram';
    const nameById = {};
    all.forEach(l => { nameById[String(l.id)] = l.name; });

    const esc = s => String(s == null ? '' : s);
    const lines = [];
    lines.push(`# ${esc(project.name || 'Diagram')}`);
    lines.push('');
    lines.push(`_Generated by StackStudio · ${all.length} nodes · ${new Date().toISOString().slice(0, 10)}_`);
    lines.push('');

    // Render one node as a Markdown block.
    const renderNode = (l) => {
        const meta = [l.type];
        if (l.status && l.status !== 'Active') meta.push(l.status);
        lines.push(`### ${esc(l.name)}`);
        lines.push('');
        lines.push(`- **Type:** ${meta.join(' · ')}`);
        if (l.technology) lines.push(`- **Technology:** ${esc(l.technology)}`);
        if (l.description) {
            lines.push(`- **Description:** ${esc(l.description).replace(/\n/g, '; ')}`);
        }
        const conns = (l.connections || []).map(c => {
            const tgt = nameById[String(typeof c === 'object' ? c.targetId : c)] || String(c.targetId || c);
            const type = (typeof c === 'object' && c.type) ? c.type : 'HTTP';
            const label = (typeof c === 'object' && c.label) ? ` — ${esc(c.label)}` : '';
            return `${esc(tgt)} _(${type})_${label}`;
        });
        if (conns.length) {
            lines.push(`- **Connects to:** ${conns.join('; ')}`);
        }
        lines.push('');
    };

    // Group by phase when the project is grouped; otherwise flat.
    const grouped = all.some(l => l.group);
    if (grouped) {
        const order = Array.isArray(project.groupOrder) ? project.groupOrder.slice() : [];
        // Append any groups not in groupOrder, then an ungrouped bucket.
        all.forEach(l => { if (l.group && !order.includes(l.group)) order.push(l.group); });
        order.forEach(g => {
            const members = all.filter(l => l.group === g);
            if (!members.length) return;
            lines.push(`## ${esc(g)}`);
            lines.push('');
            members.forEach(renderNode);
        });
        const ungrouped = all.filter(l => !l.group);
        if (ungrouped.length) {
            lines.push(`## Ungrouped`);
            lines.push('');
            ungrouped.forEach(renderNode);
        }
    } else {
        all.forEach(renderNode);
    }

    const md = lines.join('\n');
    const blob = new Blob([md], { type: 'text/markdown' });
    const durl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = durl;
    a.download = `${safe}_legend.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(durl), 1000);
}

/**
 * Compute the bounding box of a node's whole subtree (node + descendants),
 * inflated by the same padding drawGroupBox uses at the given depth, so the
 * box matches the dashed border drawn on screen.
 */
function groupBounds(node, depth) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const acc = (n) => {
        const p = nodePositions[n.id];
        if (p) {
            minX = Math.min(minX, p.x - NODE_WIDTH / 2);
            maxX = Math.max(maxX, p.x + NODE_WIDTH / 2);
            minY = Math.min(minY, p.y - NODE_HEIGHT / 2);
            maxY = Math.max(maxY, p.y + NODE_HEIGHT / 2);
        }
        if (n.substacks) n.substacks.forEach(acc);
    };
    acc(node);
    if (minX === Infinity) return null;
    const padH = Math.max(60, 120 - depth * 25);
    const padV = Math.max(45, 80 - depth * 15);
    return { left: minX - padH, right: maxX + padH, top: minY - padV, bottom: maxY + padV };
}

/**
 * Group-border-respecting auto-arrange. After the base layout runs, top-level
 * groups (a top-level layer plus its whole subtree) can still overlap when
 * trees are deep or were manually dragged. This pass nudges entire groups
 * apart — translating every node in a group together — until their padded
 * bounding boxes (the dashed "X Group" borders) no longer intersect.
 *
 * Only top-level layers that actually have substacks are treated as movable
 * groups; childless layers are treated as single-node groups so they don't get
 * swallowed by a neighbor's box.
 */
function separateTopLevelGroups() {
    const layers = (project && project.layers) ? project.layers : [];
    if (layers.length < 2) return;

    const GAP = 24;            // breathing room between group borders
    const MAX_PASSES = 60;

    // Translate every node in a group's subtree by (dx, dy).
    const shiftGroup = (node, dx, dy) => {
        const move = (n) => {
            const p = nodePositions[n.id];
            if (p) { p.x += dx; p.y += dy; }
            if (n.substacks) n.substacks.forEach(move);
        };
        move(node);
    };

    for (let pass = 0; pass < MAX_PASSES; pass++) {
        let moved = false;

        for (let i = 0; i < layers.length; i++) {
            for (let j = i + 1; j < layers.length; j++) {
                const a = groupBounds(layers[i], 0);
                const b = groupBounds(layers[j], 0);
                if (!a || !b) continue;

                // Overlap on each axis (positive = overlapping).
                const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left) + GAP;
                const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) + GAP;

                if (overlapX > 0 && overlapY > 0) {
                    // Push apart along the axis of least penetration (smallest
                    // shove that resolves the overlap), splitting the move
                    // between the two groups so neither runs away.
                    const aCenterX = (a.left + a.right) / 2, bCenterX = (b.left + b.right) / 2;
                    const aCenterY = (a.top + a.bottom) / 2, bCenterY = (b.top + b.bottom) / 2;
                    if (overlapX <= overlapY) {
                        const dir = aCenterX <= bCenterX ? -1 : 1;
                        const half = overlapX / 2;
                        shiftGroup(layers[i], dir * half, 0);
                        shiftGroup(layers[j], -dir * half, 0);
                    } else {
                        const dir = aCenterY <= bCenterY ? -1 : 1;
                        const half = overlapY / 2;
                        shiftGroup(layers[i], 0, dir * half);
                        shiftGroup(layers[j], 0, -dir * half);
                    }
                    moved = true;
                }
            }
        }

        if (!moved) break;
    }

    // Re-snap to the grid if snapping is on so the arranged result stays clean.
    if (snapToGrid) snapAllNodePositions();
    // Persist the arranged layout so it survives reloads / view switches.
    persistNodePositions();
}

function calculateLayerLevels() {
    const levels = {};
    const visited = new Set();
    const inProgress = new Set();
    
    // Build adjacency list from connections (both layer and substack)
    const graph = {};
    const allLayers = getAllLayers();
    
    allLayers.forEach(layer => {
        graph[layer.id] = (layer.connections || []).map(c => 
            typeof c === 'object' ? c.targetId : c
        );
    });
    
    // DFS to calculate levels (topological ordering)
    function dfs(layerId, currentLevel = 0) {
        if (inProgress.has(layerId)) return currentLevel; // Circular dependency
        if (visited.has(layerId)) return levels[layerId];
        
        inProgress.add(layerId);
        levels[layerId] = currentLevel;
        
        const connections = graph[layerId] || [];
        connections.forEach(targetId => {
            const targetLevel = dfs(targetId, currentLevel + 1);
            levels[targetId] = Math.max(levels[targetId] || 0, targetLevel);
        });
        
        inProgress.delete(layerId);
        visited.add(layerId);
        return levels[layerId];
    }
    
    // Start from layers with no incoming connections (roots)
    const hasIncoming = new Set();
    allLayers.forEach(layer => {
        const connections = (layer.connections || []).map(c => 
            typeof c === 'object' ? c.targetId : c
        );
        connections.forEach(targetId => hasIncoming.add(targetId));
    });
    
    allLayers.forEach(layer => {
        if (!hasIncoming.has(layer.id)) {
            dfs(layer.id, 0);
        }
    });
    
    // Handle disconnected layers
    allLayers.forEach(layer => {
        if (levels[layer.id] === undefined) {
            levels[layer.id] = 0;
        }
    });
    
    return levels;
}

function renderDiagram() {
    renderDiagramWithHover();
}

// A bright dashed ring drawn just outside a node to mark it as part of the
// active multi-selection (group drag / ctrl-select).
function drawSelectionRing(x, y) {
    const w = NODE_WIDTH + 16, h = NODE_HEIGHT + 16;
    ctx.save();
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([6, 4]);
    ctx.shadowColor = 'rgba(56, 189, 248, 0.6)';
    ctx.shadowBlur = 8;
    if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(x - w / 2, y - h / 2, w, h, 8);
        ctx.stroke();
    } else {
        ctx.strokeRect(x - w / 2, y - h / 2, w, h);
    }
    ctx.restore();
    ctx.setLineDash([]);
}

function drawNode(layer, x, y, isSelected) {
    const width = 200;
    const height = 120;
    
    // C4 styling based on type
    const c4Styles = {
        'Frontend': { shape: 'rect', color: '#10b981', icon: '🖥️' },
        'Backend': { shape: 'rect', color: '#f59e0b', icon: '⚙️' },
        'API': { shape: 'hexagon', color: '#06b6d4', icon: '🔌' },
        'Database': { shape: 'cylinder', color: '#8b5cf6', icon: '💾' },
        'DevOps': { shape: 'cloud', color: '#ef4444', icon: '☁️' },
        'Core': { shape: 'rect', color: '#3b82f6', icon: '🎯' },
        'Actor': { shape: 'actor', color: '#ec4899', icon: '🧑' },
        'External': { shape: 'rect', color: '#a3a3a3', icon: '🌐' },
        'Other': { shape: 'rect', color: '#6b7280', icon: '📦' }
    };
    
    const style = c4Styles[layer.type] || c4Styles['Other'];

    // Future (Planned/Proposed) nodes render with a dashed border and muted
    // fill so a single diagram can show current + roadmap state.
    const future = (typeof isFutureStatus === 'function') && isFutureStatus(layer.status);
    if (future) ctx.globalAlpha = Math.min(ctx.globalAlpha, 0.7);

    ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;

    if (future) ctx.setLineDash([7, 4]);

    // Draw shape based on type
    if (style.shape === 'cylinder') {
        drawCylinder(x, y, width, height, isSelected, style.color);
    } else if (style.shape === 'hexagon') {
        drawHexagon(x, y, width, height, isSelected, style.color);
    } else if (style.shape === 'cloud') {
        drawCloud(x, y, width, height, isSelected, style.color);
    } else if (style.shape === 'actor') {
        drawActor(x, y, width, height, isSelected, style.color);
    } else {
        drawRect(x, y, width, height, isSelected, style.color);
    }

    ctx.setLineDash([]);
    ctx.shadowColor = 'transparent';
    
    // Icon
    ctx.font = '24px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(style.icon, x, y - 38);
    
    // Name — wrapped to fit the node width (long Mermaid-derived names used to
    // overflow into neighbors). Up to 3 lines, ellipsized if still too long.
    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 13px sans-serif';
    const nameLines = wrapText(layer.name || '', width - 24, 3);
    const lineH = 15;
    // Vertically center the name block around y (slightly above to leave room
    // for the type/tech lines below).
    let ny = y - ((nameLines.length - 1) * lineH) / 2 - 4;
    nameLines.forEach(line => { ctx.fillText(line, x, ny); ny += lineH; });

    // Type sits just below the name block.
    ctx.font = '11px sans-serif';
    ctx.fillStyle = '#94a3b8';
    const typeY = y + ((nameLines.length - 1) * lineH) / 2 + 14;
    ctx.fillText(layer.type, x, typeY);

    // Status pill for non-active states so Planned/Deprecated reads at a glance.
    if (layer.status && layer.status !== 'Active') {
        ctx.font = '9px sans-serif';
        const stxt = layer.status.toUpperCase();
        const sw = ctx.measureText(stxt).width + 12;
        const sy = y - height / 2 + 12;
        ctx.fillStyle = future ? 'rgba(245, 158, 11, 0.9)' : 'rgba(148, 163, 184, 0.9)';
        if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x - sw / 2, sy - 8, sw, 14, 7); ctx.fill(); }
        else ctx.fillRect(x - sw / 2, sy - 8, sw, 14);
        ctx.fillStyle = '#0f172a';
        ctx.fillText(stxt, x, sy);
    }

    if (layer.technology) {
        ctx.font = '10px sans-serif';
        ctx.fillStyle = '#64748b';
        const techLine = wrapText(layer.technology, width - 24, 1)[0] || '';
        ctx.fillText(techLine, x, typeY + 16);
    }

    if (future) ctx.globalAlpha = 1;
}

/**
 * Greedy word-wrap for canvas text. Returns up to `maxLines` lines that each
 * fit within `maxWidth` (using the current ctx.font). The last line is
 * ellipsized if the text doesn't fit. Falls back to hard-splitting a single
 * word that's too long on its own.
 */
function wrapText(text, maxWidth, maxLines) {
    const t = String(text || '').trim();
    if (!t) return [''];
    const words = t.split(/\s+/);
    const lines = [];
    let cur = '';
    const fits = s => ctx.measureText(s).width <= maxWidth;

    for (let i = 0; i < words.length; i++) {
        let w = words[i];
        const trial = cur ? cur + ' ' + w : w;
        if (fits(trial)) { cur = trial; continue; }
        if (cur) { lines.push(cur); cur = ''; }
        // The single word itself may exceed the width — hard-split it.
        if (!fits(w)) {
            let chunk = '';
            for (const ch of w) {
                if (fits(chunk + ch)) chunk += ch;
                else { if (chunk) lines.push(chunk); chunk = ch; if (lines.length >= maxLines) break; }
            }
            cur = chunk;
        } else {
            cur = w;
        }
        if (lines.length >= maxLines) break;
    }
    if (cur && lines.length < maxLines) lines.push(cur);

    // Ellipsize if we ran out of lines with text remaining.
    if (lines.length > maxLines) lines.length = maxLines;
    const consumed = lines.join(' ').split(/\s+/).length;
    if (consumed < words.length && lines.length) {
        let last = lines[maxLines - 1];
        while (last.length && !fits(last + '…')) last = last.slice(0, -1);
        lines[maxLines - 1] = last + '…';
    }
    return lines;
}

function drawRect(x, y, width, height, isSelected, color) {
    ctx.fillStyle = isSelected ? '#334155' : '#1e293b';
    ctx.fillRect(x - width/2, y - height/2, width, height);
    ctx.strokeStyle = color;
    ctx.lineWidth = isSelected ? 3 : 2;
    ctx.strokeRect(x - width/2, y - height/2, width, height);
}

function drawCylinder(x, y, width, height, isSelected, color) {
    const ellipseHeight = 20;
    ctx.fillStyle = isSelected ? '#334155' : '#1e293b';
    
    // Main body
    ctx.fillRect(x - width/2, y - height/2 + ellipseHeight/2, width, height - ellipseHeight);
    
    // Top ellipse
    ctx.beginPath();
    ctx.ellipse(x, y - height/2 + ellipseHeight/2, width/2, ellipseHeight/2, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // Bottom ellipse
    ctx.beginPath();
    ctx.ellipse(x, y + height/2 - ellipseHeight/2, width/2, ellipseHeight/2, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // Borders
    ctx.strokeStyle = color;
    ctx.lineWidth = isSelected ? 3 : 2;
    ctx.stroke();
    
    ctx.beginPath();
    ctx.ellipse(x, y - height/2 + ellipseHeight/2, width/2, ellipseHeight/2, 0, 0, Math.PI * 2);
    ctx.stroke();
    
    ctx.beginPath();
    ctx.moveTo(x - width/2, y - height/2 + ellipseHeight/2);
    ctx.lineTo(x - width/2, y + height/2 - ellipseHeight/2);
    ctx.moveTo(x + width/2, y - height/2 + ellipseHeight/2);
    ctx.lineTo(x + width/2, y + height/2 - ellipseHeight/2);
    ctx.stroke();
}

function drawHexagon(x, y, width, height, isSelected, color) {
    const offset = width * 0.15;
    ctx.fillStyle = isSelected ? '#334155' : '#1e293b';
    ctx.beginPath();
    ctx.moveTo(x - width/2 + offset, y - height/2);
    ctx.lineTo(x + width/2 - offset, y - height/2);
    ctx.lineTo(x + width/2, y);
    ctx.lineTo(x + width/2 - offset, y + height/2);
    ctx.lineTo(x - width/2 + offset, y + height/2);
    ctx.lineTo(x - width/2, y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = isSelected ? 3 : 2;
    ctx.stroke();
}

function drawCloud(x, y, width, height, isSelected, color) {
    ctx.fillStyle = isSelected ? '#334155' : '#1e293b';
    ctx.beginPath();
    ctx.arc(x - width/4, y, height/3, 0, Math.PI * 2);
    ctx.arc(x, y - height/4, height/2.5, 0, Math.PI * 2);
    ctx.arc(x + width/4, y, height/3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = isSelected ? 3 : 2;
    ctx.stroke();
}

/**
 * External actor: a rounded box with a small person glyph in the top-left
 * corner (C4-style), distinguishing people/external systems from infra.
 */
function drawActor(x, y, width, height, isSelected, color) {
    ctx.fillStyle = isSelected ? '#3f2740' : '#241a22';
    const r = 14;
    const left = x - width / 2, top = y - height / 2;
    if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(left, top, width, height, r);
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = isSelected ? 3 : 2;
        ctx.stroke();
    } else {
        ctx.fillRect(left, top, width, height);
        ctx.strokeStyle = color;
        ctx.lineWidth = isSelected ? 3 : 2;
        ctx.strokeRect(left, top, width, height);
    }
    // Person glyph, top-left
    const px = left + 18, py = top + 20;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(px, py, 5, 0, Math.PI * 2);  // head
    ctx.fill();
    ctx.beginPath();                      // shoulders
    ctx.arc(px, py + 13, 8, Math.PI, Math.PI * 2);
    ctx.fill();
}

/**
 * Move the connection endpoints from node centers to the node-rectangle
 * borders along the line direction. Keeps lines and arrowheads on the box
 * edges instead of hidden under the nodes. Uses NODE_WIDTH/HEIGHT plus a
 * small gap; clamps so very short links don't invert.
 */
function clipLineToNodes(x1, y1, x2, y2) {
    const halfW = NODE_WIDTH / 2 + 4;
    const halfH = NODE_HEIGHT / 2 + 4;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dist = Math.hypot(dx, dy);
    if (dist < 1) return { x1, y1, x2, y2 };

    // Distance from a box center to its border along direction (dx,dy).
    const borderDist = (adx, ady) => {
        const ux = Math.abs(adx) / dist;
        const uy = Math.abs(ady) / dist;
        // Scale so the larger axis just reaches the half-extent.
        const tx = ux > 1e-6 ? halfW / ux : Infinity;
        const ty = uy > 1e-6 ? halfH / uy : Infinity;
        return Math.min(tx, ty);
    };

    const startOffset = borderDist(dx, dy);
    const endOffset = borderDist(dx, dy);
    // Don't let the two offsets cross each other on short links.
    const usableStart = Math.min(startOffset, dist * 0.45);
    const usableEnd = Math.min(endOffset, dist * 0.45);

    return {
        x1: x1 + (dx / dist) * usableStart,
        y1: y1 + (dy / dist) * usableStart,
        x2: x2 - (dx / dist) * usableEnd,
        y2: y2 - (dy / dist) * usableEnd
    };
}

function drawConnection(x1, y1, x2, y2, isSubstackConnection = false, connectionType = 'HTTP', isHovered = false, isFaded = false, customLabel = null) {
    // Get connection type styling
    const typeStyle = CONNECTION_TYPES[connectionType] || CONNECTION_TYPES['HTTP'];
    
    // Adjust styling for substack connections (lighter/thinner)
    let color = typeStyle.color;
    let lineWidth = typeStyle.width;
    let pattern = typeStyle.pattern;
    let opacity = 1;
    
    if (isSubstackConnection) {
        // Make substack connections slightly lighter
        color = typeStyle.color.replace(')', ', 0.7)').replace('rgb', 'rgba');
        lineWidth = Math.max(1, typeStyle.width - 0.5);
    }
    
    // Fade non-hovered connections when node is hovered
    if (isFaded) {
        opacity = 0.2;
    }
    
    // Highlight on hover
    if (isHovered) {
        lineWidth += 1.5;
        opacity = 1;
        color = typeStyle.color.replace(')', ', 1)').replace('rgba', 'rgb');
    }
    
    // Apply opacity to color
    if (opacity < 1) {
        // Convert hex to rgba with opacity
        if (color.startsWith('#')) {
            const hex = color.substring(1);
            const r = parseInt(hex.substring(0, 2), 16);
            const g = parseInt(hex.substring(2, 4), 16);
            const b = parseInt(hex.substring(4, 6), 16);
            color = `rgba(${r}, ${g}, ${b}, ${opacity})`;
        } else if (color.startsWith('rgb')) {
            color = color.replace(')', `, ${opacity})`).replace('rgb', 'rgba');
        }
    }
    
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.setLineDash(pattern);

    // Clip the endpoints to each node's rectangular border so the line starts
    // and the arrowhead lands on the box edge rather than the center (which
    // buried both under the node). Especially important for the long
    // cross-hierarchy edges in real stacks.
    const clipped = clipLineToNodes(x1, y1, x2, y2);
    x1 = clipped.x1; y1 = clipped.y1; x2 = clipped.x2; y2 = clipped.y2;

    // Draw main line
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    
    // Draw direction flow arrows along the line
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const distance = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
    const arrowCount = Math.max(1, Math.floor(distance / 100)); // One arrow per ~100px
    const arrowSize = 6;
    
    ctx.fillStyle = color;
    for (let i = 1; i <= arrowCount; i++) {
        const t = i / (arrowCount + 1);
        const arrowX = x1 + (x2 - x1) * t;
        const arrowY = y1 + (y2 - y1) * t;
        
        // Draw small directional arrow
        ctx.beginPath();
        ctx.moveTo(arrowX, arrowY);
        ctx.lineTo(
            arrowX - arrowSize * Math.cos(angle - Math.PI / 6),
            arrowY - arrowSize * Math.sin(angle - Math.PI / 6)
        );
        ctx.moveTo(arrowX, arrowY);
        ctx.lineTo(
            arrowX - arrowSize * Math.cos(angle + Math.PI / 6),
            arrowY - arrowSize * Math.sin(angle + Math.PI / 6)
        );
        ctx.stroke();
    }
    
    // Draw end arrow head
    const headLength = 10;
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(
        x2 - headLength * Math.cos(angle - Math.PI / 6),
        y2 - headLength * Math.sin(angle - Math.PI / 6)
    );
    ctx.moveTo(x2, y2);
    ctx.lineTo(
        x2 - headLength * Math.cos(angle + Math.PI / 6),
        y2 - headLength * Math.sin(angle + Math.PI / 6)
    );
    ctx.stroke();
    
    ctx.setLineDash([]);

    // On-canvas connection label at the midpoint. Shows the custom payload
    // label when set (e.g. "custom_id + amount only"), otherwise the transport
    // type. Custom labels carry meaning, so they show at lower zoom too.
    const hasCustom = !!customLabel;
    if ((isHovered || zoomLevel >= (hasCustom ? 0.5 : 0.7)) && !isFaded) {
        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2;
        let label = hasCustom ? customLabel : (typeStyle.label || connectionType);
        if (label.length > 36) label = label.slice(0, 35) + '…';
        ctx.font = isHovered ? 'bold 11px sans-serif' : '10px sans-serif';
        const padX = 6;
        const textW = ctx.measureText(label).width;
        const boxW = textW + padX * 2;
        const boxH = 16;

        ctx.fillStyle = '#0f172a';
        ctx.globalAlpha = isHovered ? 1 : 0.85;
        if (ctx.roundRect) {
            ctx.beginPath();
            ctx.roundRect(midX - boxW / 2, midY - boxH / 2, boxW, boxH, 3);
            ctx.fill();
        } else {
            ctx.fillRect(midX - boxW / 2, midY - boxH / 2, boxW, boxH);
        }
        // Custom payload labels get a brighter border so they stand out from
        // plain transport-type labels.
        ctx.strokeStyle = hasCustom ? '#e2e8f0' : typeStyle.color;
        ctx.lineWidth = 1;
        ctx.globalAlpha = isHovered ? 1 : (hasCustom ? 0.85 : 0.6);
        if (ctx.roundRect) {
            ctx.beginPath();
            ctx.roundRect(midX - boxW / 2, midY - boxH / 2, boxW, boxH, 3);
            ctx.stroke();
        } else {
            ctx.strokeRect(midX - boxW / 2, midY - boxH / 2, boxW, boxH);
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = hasCustom ? '#e2e8f0' : typeStyle.color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, midX, midY);
        ctx.textBaseline = 'alphabetic';
    }
}

function getNodeAtPosition(x, y) {
    const allLayers = getAllLayers();
    // Iterate in reverse so topmost (later-drawn) nodes win hit-testing.
    for (let i = allLayers.length - 1; i >= 0; i--) {
        const layer = allLayers[i];
        const pos = nodePositions[layer.id];
        if (pos && Math.abs(x - pos.x) < NODE_WIDTH / 2 && Math.abs(y - pos.y) < NODE_HEIGHT / 2) {
            return layer;
        }
    }
    return null;
}

function handleCanvasMouseDown(e) {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left - panX) / zoomLevel;
    const y = (e.clientY - rect.top - panY) / zoomLevel;

    lastX = e.clientX;
    lastY = e.clientY;

    const node = getNodeAtPosition(x, y);
    if (node) {
        const ctrl = e.ctrlKey || e.metaKey;
        const alt = e.altKey;

        // Ctrl/Cmd+click toggles a node in/out of the multi-selection without
        // starting a drag, so the user can assemble a set across the canvas.
        if (ctrl) {
            if (selectedNodeIds.has(node.id)) selectedNodeIds.delete(node.id);
            else selectedNodeIds.add(node.id);
            suppressClick = true;       // don't also focus/deselect on click
            renderDiagram();
            return;
        }

        // Alt+drag a node grabs its entire subtree (the node + all descendants)
        // as the moving set — quick way to relocate a whole group.
        if (alt) {
            const subtree = collectSubtreeIds(node);
            selectedNodeIds = new Set(subtree);
        } else if (!selectedNodeIds.has(node.id)) {
            // Plain drag on a node outside the current selection: drag it alone
            // and reset the selection to just it.
            selectedNodeIds = new Set([node.id]);
        }
        // (If the node IS already in a multi-selection, keep the whole set so
        // the group moves together.)

        // Begin dragging. Snapshot the project for undo and capture the start
        // position of every node in the moving set so we can apply one delta.
        draggedNodeId = node.id;
        dragMoved = false;
        dragStartSnapshot = (typeof project !== 'undefined') ? JSON.stringify(project) : null;
        dragAnchorX = x;
        dragAnchorY = y;
        dragGroupStart = {};
        selectedNodeIds.forEach(id => {
            const p = nodePositions[id];
            if (p) dragGroupStart[id] = { x: p.x, y: p.y };
        });
        // Safety: ensure the grabbed node is always part of the moving set.
        if (!dragGroupStart[node.id] && nodePositions[node.id]) {
            dragGroupStart[node.id] = { x: nodePositions[node.id].x, y: nodePositions[node.id].y };
        }
        const pos = nodePositions[node.id];
        dragOffsetX = x - pos.x;
        dragOffsetY = y - pos.y;
        canvas.style.cursor = 'grabbing';
    } else {
        // Mousedown on empty canvas: pan. (Selection is cleared on click, not
        // here, so a pan-drag doesn't wipe the selection.)
        isPanning = true;
        panStartX = panX;
        panStartY = panY;
        canvas.style.cursor = 'grabbing';
    }
}

function handleCanvasMouseMove(e) {
    if (draggedNodeId !== null) {
        // Drag every node in the moving set by the same delta from the anchor.
        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left - panX) / zoomLevel;
        const y = (e.clientY - rect.top - panY) / zoomLevel;
        // Delta is measured from the drag anchor, then snapped, so the whole
        // group shifts together and lands on the grid coherently.
        let dx = x - dragAnchorX;
        let dy = y - dragAnchorY;
        if (snapToGrid && snapGridSize > 0) {
            dx = Math.round(dx / snapGridSize) * snapGridSize;
            dy = Math.round(dy / snapGridSize) * snapGridSize;
        }
        if (dragGroupStart) {
            Object.keys(dragGroupStart).forEach(id => {
                const start = dragGroupStart[id];
                const p = nodePositions[id];
                if (p && start) { p.x = start.x + dx; p.y = start.y + dy; }
            });
            dragMoved = true;
            canvas.style.cursor = 'grabbing';
            renderDiagram();
        }
        return;
    }

    if (isPanning) {
        const deltaX = e.clientX - lastX;
        const deltaY = e.clientY - lastY;
        
        panX += deltaX;
        panY += deltaY;
        
        lastX = e.clientX;
        lastY = e.clientY;
        
        canvas.style.cursor = 'grabbing';
        renderDiagram();
    } else {
        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left - panX) / zoomLevel;
        const y = (e.clientY - rect.top - panY) / zoomLevel;
        
        const node = getNodeAtPosition(x, y);
        const foundConnections = getConnectionAtPosition(x, y);
        
        // Check if hovered node changed
        if (node && node.id !== hoveredNodeId) {
            hoveredNodeId = node.id;
            // Show the node's info (name/type/description) plus its connections.
            const nodeConnections = getNodeConnections(node.id);
            showNodeTooltip(e, node, nodeConnections);
            renderDiagram();
        } else if (!node && hoveredNodeId) {
            hoveredNodeId = null;
            hideConnectionTooltip();
            renderDiagram();
        } else if (node && hoveredNodeId === node.id) {
            // Update tooltip position as mouse moves over same node
            if (connectionTooltip) {
                connectionTooltip.style.left = (e.clientX + 10) + 'px';
                connectionTooltip.style.top = (e.clientY + 10) + 'px';
            }
        }
        
        if (foundConnections && foundConnections.length > 0) {
            canvas.style.cursor = 'pointer';
            
            // Check if connections changed
            const connectionsChanged = !hoveredConnection || 
                hoveredConnection.length !== foundConnections.length ||
                !hoveredConnection.every((conn, idx) => 
                    conn.sourceId === foundConnections[idx].sourceId &&
                    conn.targetId === foundConnections[idx].targetId &&
                    conn.type === foundConnections[idx].type
                );
            
            if (connectionsChanged) {
                hoveredConnection = foundConnections;
                renderDiagram();
            }
        } else {
            canvas.style.cursor = node ? 'pointer' : 'grab';
            if (hoveredConnection) {
                hoveredConnection = null;
                renderDiagram();
            }
        }
    }
}

function handleCanvasMouseUp() {
    if (draggedNodeId !== null) {
        if (dragMoved) { commitDragUndo(); persistNodePositions(); suppressClick = true; }
        draggedNodeId = null;
        dragMoved = false;
        dragStartSnapshot = null;
        dragGroupStart = null;
    }
    isPanning = false;
    canvas.style.cursor = 'grab';
}

function handleCanvasMouseLeave() {
    if (draggedNodeId !== null && dragMoved) { commitDragUndo(); persistNodePositions(); }
    draggedNodeId = null;
    dragMoved = false;
    dragStartSnapshot = null;
    dragGroupStart = null;
    hoveredConnection = null;
    hoveredNodeId = null;
    isPanning = false;
    canvas.style.cursor = 'grab';
    hideConnectionTooltip();
    renderDiagram();
}

function handleCanvasClick(e) {
    // A click that concluded a drag or a ctrl-toggle should not also trigger
    // selection/focus.
    if (dragMoved || suppressClick) {
        dragMoved = false;
        suppressClick = false;
        return;
    }

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left - panX) / zoomLevel;
    const y = (e.clientY - rect.top - panY) / zoomLevel;
    
    const clickedNode = getNodeAtPosition(x, y);
    if (clickedNode) {
        // A plain click on a node focuses it and collapses any multi-selection
        // down to just that node (matches typical canvas-tool behavior).
        selectedNodeIds = new Set([clickedNode.id]);
        // Focus the clicked node at any depth (handles top-level, direct
        // substacks, and deeply-nested nodes via the ancestry path).
        if (typeof focusNodeByPath === 'function') {
            focusNodeByPath(clickedNode.id);
            renderDiagram();
        } else {
            const mainIndex = project.layers.findIndex(l => l.id === clickedNode.id);
            if (mainIndex !== -1) {
                selectedLayerIndex = mainIndex;
                inSubstack = false;
            }
            renderDiagram();
            renderLayerDetails(clickedNode);
        }
    } else {
        // Click on empty canvas clears the multi-selection.
        if (selectedNodeIds.size > 0) {
            selectedNodeIds = new Set();
            renderDiagram();
        }
    }
}


// Touch event handlers for mobile pan and zoom
function handleTouchStart(e) {
    if (e.touches.length === 1) {
        // Single touch - panning
        lastX = e.touches[0].clientX;
        lastY = e.touches[0].clientY;
        isPanning = true;
        panStartX = panX;
        panStartY = panY;
    } else if (e.touches.length === 2) {
        // Two finger touch - pinch zoom
        isPanning = false;
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        touchDistance = Math.sqrt(dx * dx + dy * dy);
    }
}

function handleTouchMove(e) {
    e.preventDefault();
    
    if (e.touches.length === 1 && isPanning) {
        // Single touch panning
        const deltaX = e.touches[0].clientX - lastX;
        const deltaY = e.touches[0].clientY - lastY;
        
        panX += deltaX;
        panY += deltaY;
        
        lastX = e.touches[0].clientX;
        lastY = e.touches[0].clientY;
        
        renderDiagram();
    } else if (e.touches.length === 2) {
        // Two finger pinch zoom
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const newDistance = Math.sqrt(dx * dx + dy * dy);
        
        if (touchDistance > 0) {
            const scale = newDistance / touchDistance;
            const newZoom = Math.max(0.3, Math.min(3, zoomLevel * scale));
            
            // Zoom towards center of touch points
            const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
            const centerY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
            
            panX = centerX - (centerX - panX) * (newZoom / zoomLevel);
            panY = centerY - (centerY - panY) * (newZoom / zoomLevel);
            
            zoomLevel = newZoom;
            touchDistance = newDistance;
            
            renderDiagram();
        }
    }
}

function handleTouchEnd(e) {
    isPanning = false;
    touchDistance = 0;
}

// Connection hover detection and tooltip functions

function getConnectionAtPosition(x, y) {
    const tolerance = 15; // Pixels away from line to detect hover
    const hoveredConnections = [];
    
    for (let conn of connections) {
        const distance = pointToLineDistance(x, y, conn.x1, conn.y1, conn.x2, conn.y2);
        if (distance < tolerance) {
            hoveredConnections.push({
                connection: conn,
                distance: distance
            });
        }
    }
    
    // Sort by distance (closest first)
    hoveredConnections.sort((a, b) => a.distance - b.distance);
    
    // Return array of connections, or null if none found
    return hoveredConnections.length > 0 ? hoveredConnections.map(h => h.connection) : null;
}

function getNodeConnections(nodeId) {
    // Get all connections where this node is source or target
    const nodeConnections = [];
    
    for (let conn of connections) {
        if (conn.sourceId == nodeId || conn.targetId == nodeId) {
            nodeConnections.push(conn);
        }
    }
    
    return nodeConnections.length > 0 ? nodeConnections : null;
}

function pointToLineDistance(px, py, x1, y1, x2, y2) {
    // Calculate perpendicular distance from point to line segment
    const A = px - x1;
    const B = py - y1;
    const C = x2 - x1;
    const D = y2 - y1;
    
    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = -1;
    
    if (lenSq !== 0) param = dot / lenSq;
    
    let xx, yy;
    
    if (param < 0) {
        xx = x1;
        yy = y1;
    } else if (param > 1) {
        xx = x2;
        yy = y2;
    } else {
        xx = x1 + param * C;
        yy = y1 + param * D;
    }
    
    const dx = px - xx;
    const dy = py - yy;
    return Math.sqrt(dx * dx + dy * dy);
}

function showConnectionTooltip(e, connectionsArray) {
    // Remove existing tooltip if any
    hideConnectionTooltip();
    
    // Ensure connectionsArray is an array
    if (!Array.isArray(connectionsArray)) {
        connectionsArray = [connectionsArray];
    }
    
    // Create tooltip element
    connectionTooltip = document.createElement('div');
    connectionTooltip.className = 'connection-tooltip';
    
    // Build HTML for all connections
    let tooltipHTML = '';
    connectionsArray.forEach((connection, index) => {
        const typeStyle = CONNECTION_TYPES[connection.type] || CONNECTION_TYPES['HTTP'];
        const typeLabel = typeStyle.label;
        
        // Add separator between multiple connections
        if (index > 0) {
            tooltipHTML += '<div style="border-top: 1px solid #334155; margin: 6px 0;"></div>';
        }
        
        tooltipHTML += `
            <div style="font-weight: 600; margin-bottom: 4px; color: ${typeStyle.color};">${typeLabel}</div>
            <div style="font-size: 12px; color: #cbd5e1;">
                ${escapeHtml(connection.sourceName)} → ${escapeHtml(connection.targetName)}
            </div>
            ${connection.label ? `<div style="font-size: 11px; color: #93c5fd; margin-top: 3px;">${escapeHtml(connection.label)}</div>` : ''}
        `;
    });
    
    connectionTooltip.innerHTML = tooltipHTML;
    
    // Style the tooltip
    connectionTooltip.style.position = 'fixed';
    connectionTooltip.style.left = (e.clientX + 10) + 'px';
    connectionTooltip.style.top = (e.clientY + 10) + 'px';
    connectionTooltip.style.backgroundColor = '#1e293b';
    connectionTooltip.style.border = '2px solid #334155';
    connectionTooltip.style.borderRadius = '6px';
    connectionTooltip.style.padding = '8px 12px';
    connectionTooltip.style.fontSize = '13px';
    connectionTooltip.style.color = '#e2e8f0';
    connectionTooltip.style.zIndex = '1000';
    connectionTooltip.style.pointerEvents = 'none';
    connectionTooltip.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.3)';
    connectionTooltip.style.whiteSpace = 'nowrap';
    connectionTooltip.style.maxWidth = '300px';
    
    document.body.appendChild(connectionTooltip);
}

function hideConnectionTooltip() {
    if (connectionTooltip) {
        connectionTooltip.remove();
        connectionTooltip = null;
    }
}

/**
 * Rich node tooltip: the node's name, type, status, technology and full
 * description, plus a compact list of its connections. Shown on node hover so
 * the descriptive context (which is too long to render on the card) is
 * reachable without opening the details panel.
 */
function showNodeTooltip(e, node, connectionsArray) {
    hideConnectionTooltip();
    if (!node) return;

    connectionTooltip = document.createElement('div');
    connectionTooltip.className = 'connection-tooltip';

    const typeColor = (typeof LAYER_TYPES !== 'undefined' && LAYER_TYPES[node.type]) || '#94a3b8';
    const metaBits = [node.type];
    if (node.status && node.status !== 'Active') metaBits.push(node.status);
    if (node.group) metaBits.push(node.group);

    let html = '';
    html += `<div style="font-weight:700; font-size:14px; color:#e2e8f0; margin-bottom:2px;">${escapeHtml(node.name || '')}</div>`;
    html += `<div style="font-size:11px; color:${typeColor}; margin-bottom:6px;">${escapeHtml(metaBits.join(' · '))}</div>`;
    if (node.technology) {
        html += `<div style="font-size:11px; color:#64748b; margin-bottom:6px;">${escapeHtml(node.technology)}</div>`;
    }
    if (node.description) {
        // Preserve line breaks captured from Mermaid <br/> splits.
        const desc = escapeHtml(node.description).replace(/\n/g, '<br>');
        html += `<div style="font-size:12px; color:#cbd5e1; line-height:1.5; white-space:normal;">${desc}</div>`;
    }

    const conns = Array.isArray(connectionsArray) ? connectionsArray : [];
    if (conns.length) {
        html += `<div style="border-top:1px solid #334155; margin:8px 0 6px;"></div>`;
        html += `<div style="font-size:10px; text-transform:uppercase; letter-spacing:0.5px; color:#64748b; margin-bottom:4px;">Connections (${conns.length})</div>`;
        conns.slice(0, 8).forEach(c => {
            const ts = (typeof CONNECTION_TYPES !== 'undefined' && CONNECTION_TYPES[c.type]) || { color: '#3b82f6' };
            html += `<div style="font-size:11px; color:#cbd5e1; margin-bottom:2px;">`
                + `<span style="color:${ts.color};">▸</span> ${escapeHtml(c.sourceName)} → ${escapeHtml(c.targetName)}`
                + (c.label ? `<span style="color:#93c5fd;"> · ${escapeHtml(c.label)}</span>` : '')
                + `</div>`;
        });
        if (conns.length > 8) html += `<div style="font-size:10px; color:#64748b;">+${conns.length - 8} more</div>`;
    }

    connectionTooltip.innerHTML = html;
    connectionTooltip.style.position = 'fixed';
    connectionTooltip.style.left = (e.clientX + 12) + 'px';
    connectionTooltip.style.top = (e.clientY + 12) + 'px';
    connectionTooltip.style.backgroundColor = '#1e293b';
    connectionTooltip.style.border = '2px solid #334155';
    connectionTooltip.style.borderRadius = '6px';
    connectionTooltip.style.padding = '10px 12px';
    connectionTooltip.style.color = '#e2e8f0';
    connectionTooltip.style.zIndex = '1000';
    connectionTooltip.style.pointerEvents = 'none';
    connectionTooltip.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.4)';
    connectionTooltip.style.maxWidth = '320px';
    connectionTooltip.style.whiteSpace = 'normal';

    document.body.appendChild(connectionTooltip);
}

// Update renderDiagram to highlight hovered connections
function renderDiagramWithHover() {
    if (!canvas || !ctx) return;

    // Layout is computed once on entry (initDiagramView) and again only when
    // structure changes (refreshDiagramLayout). It is intentionally NOT
    // recomputed here — doing so every frame erased manual node drags and
    // thrashed the CPU. Newly added nodes without a position are placed lazily.
    ensureNodePositions();

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Apply zoom and pan
    ctx.save();
    ctx.translate(panX, panY);
    ctx.scale(zoomLevel, zoomLevel);

    // Grid overlay when snapping is on. A 2-5px grid is far too fine to render
    // line-by-line, so we draw it at a visible multiple of the snap size and
    // only when zoomed in enough to be legible (avoids a solid wash / CPU hit).
    if (snapToGrid) drawSnapGrid();

    const allLayers = getAllLayers();
    
    // In FLOW mode, draw horizontal phase bands (lanes) instead of the
    // composition group boxes. Bands sit behind everything.
    if (diagramLayoutMode === 'flow') {
        drawFlowBands();
    } else {
    // Draw substack grouping boxes (recursive — every node with children gets
    // a dashed boundary around its whole subtree; deeper boxes use tighter
    // padding so they nest visually inside their parent's box).
    const drawGroupBox = (node, depth) => {
        if (!node.substacks || node.substacks.length === 0 || !nodePositions[node.id]) return;

        // Bounds over the node and all its descendants.
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        const acc = (n) => {
            const p = nodePositions[n.id];
            if (p) {
                minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
                minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
            }
            if (n.substacks) n.substacks.forEach(acc);
        };
        acc(node);
        if (minX === Infinity) return;

        const padH = Math.max(60, 120 - depth * 25);
        const padV = Math.max(45, 80 - depth * 15);
        const color = LAYER_TYPES[node.type] || '#6b7280';
        ctx.strokeStyle = color;
        ctx.globalAlpha = Math.max(0.35, 0.85 - depth * 0.18);
        ctx.setLineDash([8, 4]);
        ctx.lineWidth = 2;
        ctx.strokeRect(minX - padH, minY - padV, maxX - minX + padH * 2, maxY - minY + padV * 2);
        ctx.setLineDash([]);
        ctx.font = 'bold 12px sans-serif';
        ctx.fillStyle = color;
        ctx.fillText(`${node.name} Group`, minX - padH + 10, minY - padV - 5);
        ctx.globalAlpha = 1;

        // Recurse into children (drawn after, so inner boxes layer on top).
        node.substacks.forEach(child => drawGroupBox(child, depth + 1));
    };
    project.layers.forEach(layer => drawGroupBox(layer, 0));
    }
    
    // Draw connections with hover highlighting
    connections = [];
    allLayers.forEach(layer => {
        if (layer.connections) {
            layer.connections.forEach(conn => {
                const targetId = typeof conn === 'object' ? conn.targetId : conn;
                const connectionType = typeof conn === 'object' ? conn.type : 'HTTP';
                const connectionLabel = (typeof conn === 'object' && conn.label) ? conn.label : null;
                const target = allLayers.find(l => l.id == targetId);
                
                const actualTargetId = target ? target.id : targetId;
                
                if (target && nodePositions[layer.id] && nodePositions[actualTargetId]) {
                    const isSubstackConnection = typeof layer.id === 'string' && layer.id.includes('_');
                    const isTargetSubstack = typeof actualTargetId === 'string' && actualTargetId.includes('_');
                    
                    const x1 = nodePositions[layer.id].x;
                    const y1 = nodePositions[layer.id].y;
                    const x2 = nodePositions[actualTargetId].x;
                    const y2 = nodePositions[actualTargetId].y;
                    
                    const connObj = {
                        x1, y1, x2, y2,
                        sourceId: layer.id,
                        sourceName: layer.name,
                        targetId: actualTargetId,
                        targetName: target.name,
                        type: connectionType,
                        label: connectionLabel,
                        isSubstack: isSubstackConnection || isTargetSubstack
                    };
                    connections.push(connObj);
                    
                    // Check if this connection is in the hovered connections array
                    let isHovered = false;
                    if (hoveredConnection && Array.isArray(hoveredConnection)) {
                        isHovered = hoveredConnection.some(hc => 
                            hc.sourceId === connObj.sourceId && 
                            hc.targetId === connObj.targetId &&
                            hc.type === connObj.type
                        );
                    }
                    
                    // Check if connection should be faded (node hover highlighting)
                    let isFaded = false;
                    if (hoveredNodeId) {
                        // Connection is faded if it doesn't involve the hovered node
                        const connectionInvolvesHoveredNode = 
                            connObj.sourceId == hoveredNodeId || 
                            connObj.targetId == hoveredNodeId;
                        isFaded = !connectionInvolvesHoveredNode;
                    }

                    // When an action path is highlighted, fade connections whose
                    // endpoints aren't both on the path.
                    if (!isFaded && typeof highlightedActionPath !== 'undefined' && highlightedActionPath) {
                        const ids = highlightedActionPath.layerIds;
                        const onPath = ids.has(String(connObj.sourceId)) && ids.has(String(connObj.targetId));
                        isFaded = !onPath;
                    }

                    drawConnection(x1, y1, x2, y2, isSubstackConnection || isTargetSubstack, connectionType, isHovered, isFaded, connectionLabel);
                }
            });
        }
    });
    
    // Draw parent-to-substack containment lines (recursive — every node to its
    // direct children, at any depth). Skipped in flow mode (nodes are flat).
    const drawContainment = (node) => {
        if (diagramLayoutMode === 'flow') return;
        if (!node.substacks || node.substacks.length === 0 || !nodePositions[node.id]) return;
        node.substacks.forEach(child => {
            if (nodePositions[child.id]) {
                ctx.strokeStyle = LAYER_TYPES[node.type] || '#6b7280';
                ctx.lineWidth = 1.5;
                ctx.setLineDash([3, 3]);
                ctx.beginPath();
                ctx.moveTo(nodePositions[node.id].x, nodePositions[node.id].y);
                ctx.lineTo(nodePositions[child.id].x, nodePositions[child.id].y);
                ctx.stroke();
                ctx.setLineDash([]);
            }
            drawContainment(child);
        });
    };
    project.layers.forEach(layer => drawContainment(layer));
    
    // Draw nodes
    const actionPath = (typeof highlightedActionPath !== 'undefined') ? highlightedActionPath : null;
    allLayers.forEach(layer => {
        if (nodePositions[layer.id]) {
            const isSelected = (!inSubstack && project.layers[selectedLayerIndex]?.id === layer.id) ||
                             (inSubstack && project.layers[selectedLayerIndex].substacks[selectedSubstackIndex]?.id === layer.id);
            // When an action path is highlighted, dim nodes not on the path.
            let dim = false;
            if (actionPath) {
                dim = !actionPath.layerIds.has(String(layer.id));
            }
            ctx.globalAlpha = dim ? 0.25 : 1;
            drawNode(layer, nodePositions[layer.id].x, nodePositions[layer.id].y, isSelected);
            // Multi-selection ring: a distinct outer highlight so the user can
            // see every node in the moving set (group drag / ctrl-select).
            if (selectedNodeIds.has(layer.id)) {
                drawSelectionRing(nodePositions[layer.id].x, nodePositions[layer.id].y);
            }
            ctx.globalAlpha = 1;
        }
    });

    ctx.restore();

    ctx.restore();

    // Action-path selector is an HTML overlay (a <select>), updated here so it
    // reflects the current highlight. Canvas can't host a real dropdown.
    updateActionPathSelector(actionPath);
}

/**
 * Build/refresh the action-path dropdown overlaid on the diagram. Lets the user
 * switch the highlighted action or clear it. Lives in the diagram-view
 * container (top-left), above the canvas.
 */
function updateActionPathSelector(actionPath) {
    const container = document.getElementById('diagram-view');
    if (!container) return;

    const paths = (project && project.usePaths) ? project.usePaths : [];

    let wrap = document.getElementById('action-path-selector');

    // No actions defined → no selector.
    if (paths.length === 0) {
        if (wrap) wrap.remove();
        return;
    }

    if (!wrap) {
        wrap = document.createElement('div');
        wrap.id = 'action-path-selector';
        wrap.style.cssText = 'position:absolute; top:16px; left:16px; z-index:100; display:flex; align-items:center; gap:6px; background:rgba(15,23,42,0.92); border:1px solid #3b82f6; border-radius:6px; padding:5px 8px; box-shadow:0 4px 12px rgba(0,0,0,0.3);';

        const label = document.createElement('span');
        label.textContent = 'Action path:';
        label.style.cssText = 'color:#94a3b8; font-size:12px; white-space:nowrap;';
        wrap.appendChild(label);

        const sel = document.createElement('select');
        sel.id = 'action-path-select';
        sel.style.cssText = 'background:#0f172a; color:#e2e8f0; border:1px solid #334155; border-radius:4px; padding:4px 8px; font-size:12px; max-width:260px; cursor:pointer;';
        sel.onchange = (e) => {
            const v = e.target.value;
            if (!v) {
                if (typeof setHighlightedActionPath === 'function') setHighlightedActionPath(null);
            } else {
                const action = (project.usePaths || []).find(p => String(p.id) === v);
                if (action && typeof setHighlightedActionPath === 'function') setHighlightedActionPath(action);
            }
        };
        wrap.appendChild(sel);

        container.appendChild(wrap);
    }

    // Rebuild options only when the set of actions or the selection changes,
    // so we don't disrupt an open dropdown on every render (hover/drag).
    const sel = wrap.querySelector('#action-path-select');
    const currentId = actionPath && actionPath.name
        ? (paths.find(p => p.name === actionPath.name) || {}).id
        : '';
    const signature = paths.map(p => `${p.id}:${p.name}`).join('|') + '#' + (currentId || '');
    if (wrap.dataset.sig !== signature) {
        wrap.dataset.sig = signature;
        sel.innerHTML =
            `<option value="">— none —</option>` +
            paths.map(p => `<option value="${escapeHtml(String(p.id))}">${escapeHtml(p.name || 'Untitled')}</option>`).join('');
        sel.value = currentId ? String(currentId) : '';
    }
}
