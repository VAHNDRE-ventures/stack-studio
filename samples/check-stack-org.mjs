/**
 * Stack-mode organizational layout check. Drives the live app headless on the
 * neutral nested sample and asserts the composition view's structure:
 *  - substacks are laid out to the RIGHT of their parent (left→right flow)
 *  - top-level group boxes do not overlap on a fresh layout (boundary respect)
 *  - edges route orthogonally (horizontal-major) and are axis-aligned
 *  - directional edges generally point rightward (operational flow)
 * Run: node samples/check-stack-org.mjs   (needs dev server on :8777)
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
function isAxisAligned(pts){
  for (let i=0;i<pts.length-1;i++){const a=pts[i],b=pts[i+1];
    if (Math.abs(a.x-b.x)>0.5 && Math.abs(a.y-b.y)>0.5) return false;}
  return true;
}
function gb(node){let a=Infinity,bb=-Infinity,c=Infinity,d=-Infinity;
  const acc=(n)=>{const p=nodePositions[n.id];if(p){a=Math.min(a,p.x-100);bb=Math.max(bb,p.x+100);c=Math.min(c,p.y-60);d=Math.max(d,p.y+60);}if(n.substacks)n.substacks.forEach(acc);};
  acc(node);if(a===Infinity)return null;return{left:a-120,right:bb+120,top:c-80,bottom:d+80};}
function ov(a,b){return a&&b&&a.left<b.right&&b.left<a.right&&a.top<b.bottom&&b.top<a.bottom;}
setTimeout(async () => {
    const r = {};
    try {
        const res = await fetch('/samples/sample-nested.json');
        project = await res.json();
        migrateProject(project);
        delete project.diagramPositions; // test the computed layout, not saved drags
        renderLayers(); updateStats(); selectLayer(0);
        setLayoutMode('stack');
        toggleView('diagram');
        recalculateLayout();
        renderDiagram();

        // Substacks to the right of their parent.
        let rightOk = true;
        const checkRight = (n) => {
            const pp = nodePositions[n.id];
            (n.substacks||[]).forEach(c => {
                const cp = nodePositions[c.id];
                if (pp && cp && cp.x <= pp.x) rightOk = false;
                checkRight(c);
            });
        };
        project.layers.forEach(checkRight);
        r.childrenRight = rightOk;

        // Top-level group boxes don't overlap.
        let overlaps = 0;
        const t = project.layers;
        for (let i=0;i<t.length;i++) for (let j=i+1;j<t.length;j++) if (ov(gb(t[i]), gb(t[j]))) overlaps++;
        r.groupOverlaps = overlaps;

        // Edges routed orthogonally + axis-aligned.
        const routed = connections.filter(c => c.route && c.route.length >= 2);
        r.allRouted = routed.length === connections.length && connections.length > 0;
        r.axisAligned = routed.every(c => isAxisAligned(c.route));

        // Operational flow: forward edges (target right of source) point right —
        // their route's final segment moves toward +x.
        let fwd = 0, fwdRight = 0;
        connections.forEach(c => {
            const sp = nodePositions[c.sourceId], tp = nodePositions[c.targetId];
            if (sp && tp && tp.x - sp.x > 200) {
                fwd++;
                const pts = c.route; const end = pts[pts.length-1], pen = pts[pts.length-2];
                if (end.x >= pen.x) fwdRight++;
            }
        });
        r.forwardCount = fwd;
        r.forwardPointRight = fwd === 0 || fwdRight === fwd;

        // Auto-arrange overrides manual placements: set a bogus saved position,
        // arrange, and confirm the node moved off it (and diagramPositions was
        // refreshed, not left stale).
        const nid = String(project.layers[0].id);
        project.diagramPositions = { [nid]: { x: -9999, y: -9999 } };
        recalculateLayout();              // honors saved → node at -9999
        const honored = Math.abs(nodePositions[nid].x - (-9999)) < 1;
        arrangeButtonClick();             // should override
        const afterX = nodePositions[nid].x;
        r.arrangeOverrides = honored && Math.abs(afterX - (-9999)) > 1;
        // diagramPositions refreshed to the arranged spot (not the bogus one).
        const saved = project.diagramPositions[nid];
        r.arrangePersisted = saved && Math.abs(saved.x - afterX) < 1;
    } catch(e) { window.__errors.push('script: ' + e.message); }
    r.errors = window.__errors;
    const out = document.createElement('pre'); out.id='out'; out.textContent = JSON.stringify(r); document.body.appendChild(out);
}, 1400);
</script>
</body></html>`;

const tmp = path.join(__dirname, '..', '_stackorg_harness.html');
fs.writeFileSync(tmp, harness);
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-sorg-'));
const res = spawnSync(CHROME, ['--headless=new','--disable-gpu','--no-sandbox',
    `--user-data-dir=${userDataDir}`,'--window-size=1600,1100','--virtual-time-budget=3500',
    '--dump-dom', `${BASE}/_stackorg_harness.html`], { encoding: 'utf8', maxBuffer: 50*1024*1024 });
fs.rmSync(tmp, { force: true });
try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}

const m = (res.stdout||'').match(/<pre id="out">([\s\S]*?)<\/pre>/);
let failures = 0;
const log = (ok,msg)=>{console.log(`  ${ok?'PASS':'FAIL'}  ${msg}`); if(!ok)failures++;};
console.log('Stack organizational layout check\n');
if (!m) { console.log('  FAIL  no result'); process.exit(1); }
const r = JSON.parse(m[1].replace(/&quot;/g,'"').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>'));

log((r.errors||[]).length===0, `no errors${r.errors&&r.errors.length?': '+r.errors.join(' | '):''}`);
log(r.childrenRight === true, 'substacks laid out to the right of their parent');
log(r.groupOverlaps === 0, `no overlapping top-level group boxes (${r.groupOverlaps})`);
log(r.allRouted === true, 'every stack edge has an orthogonal route');
log(r.axisAligned === true, 'stack routes are axis-aligned (right angles)');
log(r.forwardPointRight === true, `forward edges point rightward (${r.forwardCount} forward)`);
log(r.arrangeOverrides === true, 'auto-arrange overrides manual placement');
log(r.arrangePersisted === true, 'auto-arrange persists the new positions');

console.log(`\n${failures===0?'ALL CHECKS PASSED':failures+' CHECK(S) FAILED'}`);
process.exit(failures===0?0:1);
