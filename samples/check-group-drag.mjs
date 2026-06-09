/**
 * Group drag + group-aware auto-arrange check. Drives the live app headless and
 * asserts:
 *  - Ctrl/Cmd "click" toggles nodes into selectedNodeIds
 *  - dragging the set translates every member by the same delta (group move)
 *  - Alt-grab selects a node's whole subtree
 *  - autoArrangeDiagram() leaves no two top-level group bounding boxes
 *    overlapping (group borders are respected)
 *  - the whole arrange is one undo step
 * Run: node samples/check-group-drag.mjs   (needs dev server on :8777)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'http://localhost:8777';

const body = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')
    .replace(/^[\s\S]*?<body>/, '').replace(/<\/body>[\s\S]*$/, '');

const harness = `<!DOCTYPE html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/static/css/style.css"></head>
<body>
${body}
<script>
window.__errors=[];
window.addEventListener('error',e=>window.__errors.push(String(e.message)));

// Re-implements groupBounds at depth 0 for the assertion (mirrors diagram.js).
function gb(node) {
    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
    const acc=(n)=>{ const p=nodePositions[n.id]; if(p){ minX=Math.min(minX,p.x-100);maxX=Math.max(maxX,p.x+100);minY=Math.min(minY,p.y-60);maxY=Math.max(maxY,p.y+60);} if(n.substacks)n.substacks.forEach(acc); };
    acc(node);
    if(minX===Infinity)return null;
    return {left:minX-120,right:maxX+120,top:minY-80,bottom:maxY+80};
}
function boxesOverlap(a,b){ return a&&b && a.left<b.right && b.left<a.right && a.top<b.bottom && b.top<a.bottom; }

function rectAt(id){ return canvas.getBoundingClientRect(); }
function evt(type, worldX, worldY, opts){
    const rect = canvas.getBoundingClientRect();
    const clientX = rect.left + worldX*zoomLevel + panX;
    const clientY = rect.top + worldY*zoomLevel + panY;
    return new MouseEvent(type, Object.assign({clientX, clientY, bubbles:true, cancelable:true}, opts||{}));
}

setTimeout(async () => {
    const r = {};
    try {
        const res = await fetch('/samples/sample-saas.json');
        project = await res.json();
        migrateProject(project);
        renderLayers(); updateStats(); selectLayer(0);
        toggleView('diagram');

        const all = getAllLayers();
        const idA = project.layers[0].id;
        const idB = project.layers[1].id;

        // --- 1. Ctrl-click multi-select toggles into the set ---
        // mousedown with ctrl toggles selection (no drag).
        canvas.dispatchEvent(evt('mousedown', nodePositions[idA].x, nodePositions[idA].y, {ctrlKey:true}));
        canvas.dispatchEvent(evt('mousedown', nodePositions[idB].x, nodePositions[idB].y, {ctrlKey:true}));
        r.selCount = selectedNodeIds.size;
        r.selHasBoth = selectedNodeIds.has(idA) && selectedNodeIds.has(idB);

        // --- 2. Drag the selection: both move by the same delta ---
        const aBefore = {...nodePositions[idA]};
        const bBefore = {...nodePositions[idB]};
        const startX = nodePositions[idA].x, startY = nodePositions[idA].y;
        canvas.dispatchEvent(evt('mousedown', startX, startY));        // grab A (selection kept)
        canvas.dispatchEvent(evt('mousemove', startX + 300, startY + 0));
        canvas.dispatchEvent(evt('mouseup', startX + 300, startY + 0));
        const aDx = nodePositions[idA].x - aBefore.x;
        const bDx = nodePositions[idB].x - bBefore.x;
        r.aDx = Math.round(aDx); r.bDx = Math.round(bDx);
        r.groupMovedTogether = Math.abs(aDx - bDx) < 1 && Math.abs(aDx) > 100;

        // --- 3. Alt-grab selects the whole subtree ---
        // Find a top-level layer that has substacks.
        const parent = project.layers.find(l => l.substacks && l.substacks.length);
        if (parent) {
            const expected = [];
            const collect = (n)=>{ expected.push(n.id); if(n.substacks)n.substacks.forEach(collect); };
            collect(parent);
            canvas.dispatchEvent(evt('mousedown', nodePositions[parent.id].x, nodePositions[parent.id].y, {altKey:true}));
            r.altSubtreeOk = expected.every(id => selectedNodeIds.has(id)) && selectedNodeIds.size === expected.length;
            r.altSubtreeSize = selectedNodeIds.size;
            // release without moving
            canvas.dispatchEvent(evt('mouseup', nodePositions[parent.id].x, nodePositions[parent.id].y));
            clearDiagramSelection();
        } else { r.altSubtreeOk = true; r.altSubtreeSize = 0; }

        // --- 4. Group-aware auto-arrange: no top-level group boxes overlap ---
        const undoLenBefore = undoStack.length;
        arrangeButtonClick();
        r.undoPushed = (undoStack.length === undoLenBefore + 1);
        let overlaps = 0;
        const tops = project.layers;
        for (let i=0;i<tops.length;i++){
            for (let j=i+1;j<tops.length;j++){
                if (boxesOverlap(gb(tops[i]), gb(tops[j]))) overlaps++;
            }
        }
        r.groupOverlaps = overlaps;

        // --- 5. Arrange is undoable in one step ---
        const snapBeforeUndo = JSON.stringify(project.diagramPositions||{});
        undo();
        r.undoChangedLayout = JSON.stringify(project.diagramPositions||{}) !== snapBeforeUndo;
    } catch(e) { window.__errors.push('script: ' + e.message); }
    r.errors = window.__errors;
    const out = document.createElement('pre'); out.id='out'; out.textContent = JSON.stringify(r); document.body.appendChild(out);
}, 1500);
</script>
</body></html>`;

const tmp = path.join(__dirname, '..', '_group_harness.html');
fs.writeFileSync(tmp, harness);
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-group-'));
const res = spawnSync(CHROME, ['--headless=new','--disable-gpu','--no-sandbox',
    `--user-data-dir=${userDataDir}`,'--window-size=1600,1000','--virtual-time-budget=3800',
    '--dump-dom', `${BASE}/_group_harness.html`], { encoding: 'utf8', maxBuffer: 50*1024*1024 });
fs.rmSync(tmp, { force: true });
try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}

const m = (res.stdout||'').match(/<pre id="out">([\s\S]*?)<\/pre>/);
let failures = 0;
const log = (ok,msg)=>{console.log(`  ${ok?'PASS':'FAIL'}  ${msg}`); if(!ok)failures++;};
console.log('Group drag + auto-arrange check\n');
if (!m) { console.log('  FAIL  no result'); process.exit(1); }
const r = JSON.parse(m[1].replace(/&quot;/g,'"').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>'));

log((r.errors||[]).length===0, `no errors${r.errors&&r.errors.length?': '+r.errors.join(' | '):''}`);
log(r.selHasBoth === true, `ctrl-click selects multiple nodes (${r.selCount})`);
log(r.groupMovedTogether === true, `group drag moves all selected by same delta (A=${r.aDx}, B=${r.bDx})`);
log(r.altSubtreeOk === true, `alt-grab selects the whole subtree (${r.altSubtreeSize} nodes)`);
log(r.groupOverlaps === 0, `auto-arrange leaves no overlapping group boxes (${r.groupOverlaps})`);
log(r.undoPushed === true, 'auto-arrange pushes exactly one undo state');
log(r.undoChangedLayout === true, 'undo reverts the auto-arrange');

console.log(`\n${failures===0?'ALL CHECKS PASSED':failures+' CHECK(S) FAILED'}`);
process.exit(failures===0?0:1);
