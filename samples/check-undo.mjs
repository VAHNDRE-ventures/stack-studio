/**
 * Undo/redo deep check. Drives the live app in headless Chrome and asserts:
 *  - a field edit (updateLayerField) is undoable and redoable
 *  - a diagram node drag is undoable (regression: persistNodePositions used to
 *    save the project but never push onto the undo stack)
 *  - Ctrl+Z while a text input is focused blurs the field (committing its edit)
 *    then runs the app undo, instead of dead-ending in the browser's native
 *    text-undo
 * Run: node samples/check-undo.mjs   (needs dev server on :8777)
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
setTimeout(async () => {
    const r = {};
    try {
        const res = await fetch('/samples/sample-saas.json');
        project = await res.json();
        migrateProject(project);
        renderLayers(); updateStats(); selectLayer(0);

        // --- 1. Field edit undo/redo ---
        const origName = getCurrentNode().name;
        updateLayerField('name', origName + ' EDITED');
        r.afterEdit = getCurrentNode().name;
        undo();
        r.afterUndo = getCurrentNode().name;
        redo();
        r.afterRedo = getCurrentNode().name;
        r.fieldUndoOk = (r.afterUndo === origName) && (r.afterRedo === origName + ' EDITED');

        // --- 2. Diagram node drag undo ---
        toggleView('diagram');
        const firstId = project.layers[0].id;
        const before = { ...nodePositions[firstId] };
        // Simulate the drag lifecycle the way the canvas handlers do.
        dragStartSnapshot = JSON.stringify(project);
        nodePositions[firstId].x += 200; nodePositions[firstId].y += 120;
        dragMoved = true;
        commitDragUndo();
        persistNodePositions();
        const movedX = project.diagramPositions[firstId].x;
        undo();
        const restoredX = (project.diagramPositions && project.diagramPositions[firstId])
            ? project.diagramPositions[firstId].x : null;
        r.dragMovedX = movedX;
        r.dragRestoredX = restoredX;
        // After undo, the live nodePositions map should also reflect the old spot.
        r.dragNodePosRestored = Math.abs(nodePositions[firstId].x - before.x) < 1;
        r.dragUndoOk = (restoredX === null || Math.abs(restoredX - movedX) > 1) && r.dragNodePosRestored;

        // --- 3. Ctrl+Z with focus inside a text input ---
        toggleView('stack');
        selectLayer(0);
        const before3 = getCurrentNode().name;
        // Find a text input in the details panel and type into it without firing onchange.
        const input = document.querySelector('#details-panel input[type="text"], #details-panel input:not([type])');
        r.foundInput = !!input;
        if (input) {
            input.focus();
            r.editableDetected = (typeof isEditableTarget === 'function') && isEditableTarget(input);
            // Pre-seed an undoable change so app-undo has something to revert.
            updateLayerField('name', before3 + ' VIA_KEY');
            r.afterKeyEdit = getCurrentNode().name;
            const evt = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
            input.dispatchEvent(evt);
            r.activeAfterCtrlZ = document.activeElement === input; // should be false (blurred)
            r.afterKeyUndo = getCurrentNode().name;
            r.keyUndoOk = (r.afterKeyUndo === before3) && (r.activeAfterCtrlZ === false);
        }
    } catch(e) { window.__errors.push('script: ' + e.message); }
    r.errors = window.__errors;
    const out = document.createElement('pre'); out.id='out'; out.textContent = JSON.stringify(r); document.body.appendChild(out);
}, 1400);
</script>
</body></html>`;

const tmp = path.join(__dirname, '..', '_undo_harness.html');
fs.writeFileSync(tmp, harness);
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-undo-'));
const res = spawnSync(CHROME, ['--headless=new','--disable-gpu','--no-sandbox',
    `--user-data-dir=${userDataDir}`,'--window-size=1600,1000','--virtual-time-budget=3500',
    '--dump-dom', `${BASE}/_undo_harness.html`], { encoding: 'utf8', maxBuffer: 50*1024*1024 });
fs.rmSync(tmp, { force: true });
try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}

const m = (res.stdout||'').match(/<pre id="out">([\s\S]*?)<\/pre>/);
let failures = 0;
const log = (ok,msg)=>{console.log(`  ${ok?'PASS':'FAIL'}  ${msg}`); if(!ok)failures++;};
console.log('Undo/redo deep check\n');
if (!m) { console.log('  FAIL  no result'); process.exit(1); }
const r = JSON.parse(m[1].replace(/&quot;/g,'"').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>'));

log((r.errors||[]).length===0, `no errors${r.errors&&r.errors.length?': '+r.errors.join(' | '):''}`);
log(r.fieldUndoOk === true, `field edit undo+redo (undo→"${r.afterUndo}", redo→"${r.afterRedo}")`);
log(r.dragUndoOk === true, `diagram node drag is undoable (moved x=${r.dragMovedX}, restored x=${r.dragRestoredX})`);
log(r.foundInput === true, 'found a text input in details panel');
log(r.editableDetected === true, 'isEditableTarget() recognises the input');
log(r.keyUndoOk === true, `Ctrl+Z in input blurs+undoes (active after=${r.activeAfterCtrlZ}, name→"${r.afterKeyUndo}")`);

console.log(`\n${failures===0?'ALL CHECKS PASSED':failures+' CHECK(S) FAILED'}`);
process.exit(failures===0?0:1);
