/**
 * Deep diagram check: load the sample stack, run the real layout, and assert positions are
 * sane — every node placed, finite coords, parents left of their substacks,
 * and the connection list the renderer builds covers every edge in the data.
 * Runs in headless Chrome against the live app (canvas + layout code).
 * Run: node samples/check-diagram.mjs   (needs dev server on :8777)
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
        toggleView('diagram');
        // Count expected edges from the data.
        const all = getAllLayers();
        let edgeCount = 0;
        all.forEach(l => { edgeCount += getConnections(l).length; });
        r.dataEdges = edgeCount;

        // Positions after layout.
        const positioned = all.filter(l => nodePositions[l.id]);
        r.nodes = all.length;
        r.positioned = positioned.length;
        r.allFinite = positioned.every(l => Number.isFinite(nodePositions[l.id].x) && Number.isFinite(nodePositions[l.id].y));

        // Substacks should sit to the right of their parent by default layout.
        let parentsRightOk = true;
        project.layers.forEach(layer => {
            if (layer.substacks && layer.substacks.length && nodePositions[layer.id]) {
                layer.substacks.forEach(s => {
                    if (nodePositions[s.id] && nodePositions[s.id].x <= nodePositions[layer.id].x) parentsRightOk = false;
                });
            }
        });
        r.substacksRightOfParent = parentsRightOk;

        // The renderer populates the global 'connections' array each draw.
        renderDiagram();
        r.renderedConnections = connections.length;

        // Drag persistence: move a node, confirm it saves and survives a re-fit.
        const firstId = project.layers[0].id;
        const before = { ...nodePositions[firstId] };
        nodePositions[firstId].x += 123; nodePositions[firstId].y += 45;
        persistNodePositions();
        recalculateLayout(); // would normally reset positions
        r.dragPersisted = Math.abs(nodePositions[firstId].x - (before.x + 123)) < 1;
    } catch(e) { window.__errors.push('script: ' + e.message); }
    r.errors = window.__errors;
    const out = document.createElement('pre'); out.id='out'; out.textContent = JSON.stringify(r); document.body.appendChild(out);
}, 1400);
</script>
</body></html>`;

const tmp = path.join(__dirname, '..', '_diag_harness.html');
fs.writeFileSync(tmp, harness);
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-diag-'));
const res = spawnSync(CHROME, ['--headless=new','--disable-gpu','--no-sandbox',
    `--user-data-dir=${userDataDir}`,'--window-size=1600,1000','--virtual-time-budget=3500',
    '--dump-dom', `${BASE}/_diag_harness.html`], { encoding: 'utf8', maxBuffer: 50*1024*1024 });
fs.rmSync(tmp, { force: true });
try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}

const m = (res.stdout||'').match(/<pre id="out">([\s\S]*?)<\/pre>/);
let failures = 0;
const log = (ok,msg)=>{console.log(`  ${ok?'PASS':'FAIL'}  ${msg}`); if(!ok)failures++;};
console.log('Diagram layout deep check\n');
if (!m) { console.log('  FAIL  no result'); process.exit(1); }
const r = JSON.parse(m[1].replace(/&quot;/g,'"').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>'));

log((r.errors||[]).length===0, `no errors${r.errors&&r.errors.length?': '+r.errors.join(' | '):''}`);
log(r.positioned === r.nodes, `every node positioned (${r.positioned}/${r.nodes})`);
log(r.allFinite === true, 'all coordinates finite (no NaN)');
log(r.substacksRightOfParent === true, 'substacks laid out right of their parent');
log(r.renderedConnections >= r.dataEdges, `renderer drew all edges (${r.renderedConnections} >= ${r.dataEdges})`);
log(r.dragPersisted === true, 'manual drag position persists across relayout');

console.log(`\n${failures===0?'ALL CHECKS PASSED':failures+' CHECK(S) FAILED'}`);
process.exit(failures===0?0:1);
