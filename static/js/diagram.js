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

const NODE_WIDTH = 200;
const NODE_HEIGHT = 120;

let diagramInitialized = false;

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
    
    const controls = document.createElement('div');
    controls.id = 'zoom-controls';
    controls.style.cssText = 'position: absolute; top: 20px; right: 20px; display: flex; flex-direction: column; gap: 8px; z-index: 100;';
    controls.innerHTML = `
        <button onclick="zoomIn()" title="Zoom in" style="background: #0f172a; border: 1px solid #334155; color: #e2e8f0; padding: 8px 12px; border-radius: 4px; cursor: pointer; font-size: 16px;">+</button>
        <button onclick="zoomReset()" title="Reset zoom" style="background: #0f172a; border: 1px solid #334155; color: #e2e8f0; padding: 8px 12px; border-radius: 4px; cursor: pointer; font-size: 12px;">100%</button>
        <button onclick="zoomOut()" title="Zoom out" style="background: #0f172a; border: 1px solid #334155; color: #e2e8f0; padding: 8px 12px; border-radius: 4px; cursor: pointer; font-size: 16px;">\u2212</button>
        <button onclick="zoomToFit()" title="Fit to screen" style="background: #0f172a; border: 1px solid #334155; color: #e2e8f0; padding: 8px 12px; border-radius: 4px; cursor: pointer; font-size: 12px;">Fit</button>
        <button onclick="refreshDiagramLayout(true)" title="Auto-arrange nodes" style="background: #0f172a; border: 1px solid #334155; color: #e2e8f0; padding: 8px 12px; border-radius: 4px; cursor: pointer; font-size: 12px;">\u21BB</button>
    `;
    container.appendChild(controls);

    // A subtle, dismissable hint that nodes are draggable (the original UI
    // gave no indication, and the README's drag claim was never wired up).
    if (!document.getElementById('diagram-hint')) {
        const hint = document.createElement('div');
        hint.id = 'diagram-hint';
        hint.textContent = 'Drag nodes to reposition \u2022 drag canvas to pan \u2022 scroll to zoom';
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

    zoomLevel = Math.max(0.3, Math.min(scaleX, scaleY, 2));
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
    const levelSpacing = 700;
    const nodeWidth = 200;
    const nodeHeight = 120;
    const minVerticalSpacing = 200; // Minimum space between node centers
    const minHorizontalSpacing = 250; // Minimum space between nodes horizontally
    
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
    
    // Position layers level by level (left to right)
    Object.keys(layersByLevel).sort((a, b) => a - b).forEach(level => {
        const layersInLevel = layersByLevel[level];
        let currentY = baseY;
        
        layersInLevel.forEach((layer, idx) => {
            // Reserve vertical space based on the layer's total leaf count
            // (full subtree), not just direct children, so deep trees don't
            // collide with the next top-level layer.
            const totalLeaves = countLeaves(layer);
            const layerHeight = totalLeaves > 1 ? totalLeaves * 160 : 120;
            
            const basePosition = {
                x: baseX + (parseInt(level) * levelSpacing),
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
    // their own subtree height so deep trees don't overlap.
    const childXStep = 360;
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
    ctx.fillText(style.icon, x, y - 30);
    
    // Text
    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(layer.name, x, y);
    
    ctx.font = '11px sans-serif';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(layer.type, x, y + 18);

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
        ctx.fillText(layer.technology.substring(0, 30), x, y + 35);
    }

    if (future) ctx.globalAlpha = 1;
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
        // Begin dragging this node (real drag-to-reposition, finally).
        draggedNodeId = node.id;
        dragMoved = false;
        const pos = nodePositions[node.id];
        dragOffsetX = x - pos.x;
        dragOffsetY = y - pos.y;
        canvas.style.cursor = 'grabbing';
    } else {
        isPanning = true;
        panStartX = panX;
        panStartY = panY;
        canvas.style.cursor = 'grabbing';
    }
}

function handleCanvasMouseMove(e) {
    if (draggedNodeId !== null) {
        // Drag the node under the cursor.
        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left - panX) / zoomLevel;
        const y = (e.clientY - rect.top - panY) / zoomLevel;
        const pos = nodePositions[draggedNodeId];
        if (pos) {
            pos.x = x - dragOffsetX;
            pos.y = y - dragOffsetY;
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
            // Show all connections for this node
            const nodeConnections = getNodeConnections(node.id);
            if (nodeConnections && nodeConnections.length > 0) {
                showConnectionTooltip(e, nodeConnections);
            } else {
                hideConnectionTooltip();
            }
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
        if (dragMoved) persistNodePositions();
        draggedNodeId = null;
        dragMoved = false;
    }
    isPanning = false;
    canvas.style.cursor = 'grab';
}

function handleCanvasMouseLeave() {
    if (draggedNodeId !== null && dragMoved) persistNodePositions();
    draggedNodeId = null;
    dragMoved = false;
    hoveredConnection = null;
    hoveredNodeId = null;
    isPanning = false;
    canvas.style.cursor = 'grab';
    hideConnectionTooltip();
    renderDiagram();
}

function handleCanvasClick(e) {
    // A click that concluded a drag should not also trigger selection.
    if (dragMoved) {
        dragMoved = false;
        return;
    }

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left - panX) / zoomLevel;
    const y = (e.clientY - rect.top - panY) / zoomLevel;
    
    const clickedNode = getNodeAtPosition(x, y);
    if (clickedNode) {
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
    
    const allLayers = getAllLayers();
    
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
    // direct children, at any depth).
    const drawContainment = (node) => {
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
            ctx.globalAlpha = 1;
        }
    });

    ctx.restore();

    // Action-path banner (drawn in screen space, after restore).
    if (actionPath) {
        const label = `Action path: ${actionPath.name}`;
        ctx.save();
        ctx.font = '600 13px sans-serif';
        const tw = ctx.measureText(label).width;
        const bw = tw + 28;
        ctx.fillStyle = 'rgba(59, 130, 246, 0.15)';
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 1;
        const bx = 16, by = 16, bh = 30;
        if (ctx.roundRect) {
            ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 6); ctx.fill(); ctx.stroke();
        } else {
            ctx.fillRect(bx, by, bw, bh); ctx.strokeRect(bx, by, bw, bh);
        }
        ctx.fillStyle = '#bfdbfe';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, bx + 14, by + bh / 2);
        ctx.textBaseline = 'alphabetic';
        ctx.restore();
    }
}
