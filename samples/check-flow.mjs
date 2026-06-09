/**
 * Flow-layout check. Drives the live app headless, imports the neutral Mermaid
 * sample, switches the diagram to Flow mode, and asserts the layered layout:
 *  - forward edges generally point downward (target rank >= source rank)
 *  - nodes in the same rank don't horizontally overlap
 *  - phase bands exist, are ordered by groupOrder, and don't vertically overlap
 *  - a back-edge (cycle) does not break ranking (no infinite loop, finite coords)
 *  - toggling back to Stack mode changes the layout
 * Run: node samples/check-flow.mjs   (needs dev server on :8777)
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

// A flow graph with a deliberate back-edge (D -> B) to test cycle handling.
const mmd = `flowchart TD
  subgraph P1["Phase 1"]
    A["Source A"]
    A2["Source B"]
  end
  subgraph P2["Phase 2"]
    B["Ingest"]
  end
  subgraph P3["Phase 3"]
    C["Store"]
    D["Engine"]
  end
  A --> B
  A2 --> B
  B --> C
  C --> D
  D -. "feedback" .-> B
`;

const harness = `<!DOCTYPE html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/static/css/style.css"></head>
<body>
${body}
<script>
window.__errors=[];
window.addEventListener('error',e=>window.__errors.push(String(e.message)));
const MMD = ${JSON.stringify(mmd)};
setTimeout(async () => {
    const r = {};
    try {
        project = MermaidImport.mermaidToProject(MMD, 'Flow Test');
        project = migrateProject(project);
        document.getElementById('project-title').textContent = project.name;
        renderLayers(); updateStats(); selectLayer(0);
        setLayoutMode('flow');
        toggleView('diagram');
        recalculateLayout();
        renderDiagram();

        const pos = id => nodePositions[id];
        r.allPlaced = ['A','A2','B','C','D'].every(id => pos(id) && Number.isFinite(pos(id).x) && Number.isFinite(pos(id).y));

        // Forward edges point downward: B below A/A2, C below B, D below C.
        r.bBelowA = pos('B').y > pos('A').y && pos('B').y > pos('A2').y;
        r.cBelowB = pos('C').y > pos('B').y;
        r.dBelowC = pos('D').y > pos('C').y;

        // Back-edge D -. .-> B did NOT pull B down past D (ranking ignored it).
        r.backEdgeOk = pos('B').y < pos('D').y;

        // Same-rank nodes A and A2 don't overlap horizontally.
        r.sameRankNoOverlap = Math.abs(pos('A').x - pos('A2').x) >= 200;

        // Phase bands present and ordered top→bottom by groupOrder.
        r.bandCount = (typeof flowBands !== 'undefined' && flowBands) ? flowBands.length : 0;
        r.bandNames = (flowBands||[]).map(b => b.name);
        let bandsOrdered = true, bandsDisjoint = true;
        for (let i = 1; i < (flowBands||[]).length; i++) {
            if (flowBands[i].top < flowBands[i-1].top) bandsOrdered = false;
            if (flowBands[i].top < flowBands[i-1].bottom - 1) bandsDisjoint = false;
        }
        r.bandsOrdered = bandsOrdered;
        r.bandsDisjoint = bandsDisjoint;

        // Toggle to stack mode changes positions.
        const before = JSON.stringify(nodePositions['B']);
        setLayoutMode('stack');
        recalculateLayout();
        r.stackDiffers = JSON.stringify(nodePositions['B']) !== before;
    } catch(e) { window.__errors.push('script: ' + e.message); }
    r.errors = window.__errors;
    const out = document.createElement('pre'); out.id='out'; out.textContent = JSON.stringify(r); document.body.appendChild(out);
}, 1400);
</script>
</body></html>`;

const tmp = path.join(__dirname, '..', '_flow_harness.html');
fs.writeFileSync(tmp, harness);
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-flow-'));
const res = spawnSync(CHROME, ['--headless=new','--disable-gpu','--no-sandbox',
    `--user-data-dir=${userDataDir}`,'--window-size=1600,1000','--virtual-time-budget=3500',
    '--dump-dom', `${BASE}/_flow_harness.html`], { encoding: 'utf8', maxBuffer: 50*1024*1024 });
fs.rmSync(tmp, { force: true });
try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}

const m = (res.stdout||'').match(/<pre id="out">([\s\S]*?)<\/pre>/);
let failures = 0;
const log = (ok,msg)=>{console.log(`  ${ok?'PASS':'FAIL'}  ${msg}`); if(!ok)failures++;};
console.log('Flow layout check\n');
if (!m) { console.log('  FAIL  no result'); process.exit(1); }
const r = JSON.parse(m[1].replace(/&quot;/g,'"').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>'));

log((r.errors||[]).length===0, `no errors${r.errors&&r.errors.length?': '+r.errors.join(' | '):''}`);
log(r.allPlaced === true, 'all nodes placed with finite coords');
log(r.bBelowA && r.cBelowB && r.dBelowC, 'forward edges flow downward (rank order)');
log(r.backEdgeOk === true, 'back-edge (feedback) did not break ranking');
log(r.sameRankNoOverlap === true, 'same-rank nodes do not overlap horizontally');
log(r.bandCount === 3, `3 phase bands drawn (got ${r.bandCount}: ${(r.bandNames||[]).join(', ')})`);
log(r.bandsOrdered === true, 'phase bands ordered top→bottom by groupOrder');
log(r.bandsDisjoint === true, 'phase bands do not vertically overlap');
log(r.stackDiffers === true, 'toggling to Stack mode changes the layout');

console.log(`\n${failures===0?'ALL CHECKS PASSED':failures+' CHECK(S) FAILED'}`);
process.exit(failures===0?0:1);
