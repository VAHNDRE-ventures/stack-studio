/**
 * Orthogonal edge routing check (both modes). Drives the live app headless and
 * asserts:
 *  - in Flow mode, connections carry a `route` polyline of right-angle segments
 *    (vertical-major: exit bottom, enter top)
 *  - the route starts near the source box edge and ends near the target box edge
 *  - in Stack mode, connections also carry an orthogonal `route`, axis-aligned
 *    (horizontal-major: exit side, jog in the column corridor)
 *  - hit-testing follows the polyline (a point on a mid segment is detected)
 * Run: node samples/check-ortho.mjs   (needs dev server on :8777)
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

const mmd = `flowchart TD
  subgraph P1["Phase 1"]
    A["Source"]
  end
  subgraph P2["Phase 2"]
    B["Mid"]
    C["Other"]
  end
  subgraph P3["Phase 3"]
    D["Sink"]
  end
  A --> B
  A --> C
  B --> D
  C --> D
`;

const harness = `<!DOCTYPE html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/static/css/style.css"></head>
<body>
${body}
<script>
window.__errors=[];
window.addEventListener('error',e=>window.__errors.push(String(e.message)));
const MMD = ${JSON.stringify(mmd)};
function isAxisAligned(pts){
  for (let i=0;i<pts.length-1;i++){
    const a=pts[i], b=pts[i+1];
    if (Math.abs(a.x-b.x) > 0.5 && Math.abs(a.y-b.y) > 0.5) return false; // diagonal
  }
  return true;
}
setTimeout(async () => {
    const r = {};
    try {
        project = MermaidImport.mermaidToProject(MMD, 'Ortho Test');
        project = migrateProject(project);
        renderLayers(); updateStats(); selectLayer(0);
        setLayoutMode('flow');
        toggleView('diagram');
        recalculateLayout();
        renderDiagram();  // populates connections with routes

        r.connCount = connections.length;
        const withRoute = connections.filter(c => c.route && c.route.length >= 2);
        r.allHaveRoutes = withRoute.length === connections.length && connections.length > 0;
        r.allAxisAligned = withRoute.every(c => isAxisAligned(c.route));
        r.someElbows = withRoute.some(c => c.route.length >= 3); // at least one bend somewhere

        // A→B route: starts near A's bottom edge, ends near B's top edge.
        const ab = connections.find(c => String(c.sourceId)==='A' && String(c.targetId)==='B');
        if (ab) {
            const aPos = nodePositions['A'], bPos = nodePositions['B'];
            const start = ab.route[0], end = ab.route[ab.route.length-1];
            r.startsAtSourceEdge = Math.abs(start.y - (aPos.y + 60)) < 8;  // NODE_HEIGHT/2=60
            r.endsAtTargetEdge = Math.abs(end.y - (bPos.y - 60)) < 8;
        }

        // Hit-testing follows the polyline: sample the midpoint of A→B's
        // longest segment and confirm getConnectionAtPosition finds it.
        if (ab) {
            let bx=0, by=0, best=0;
            for (let i=0;i<ab.route.length-1;i++){
                const p=ab.route[i], q=ab.route[i+1];
                const len=Math.hypot(q.x-p.x,q.y-p.y);
                if (len>best){best=len;bx=(p.x+q.x)/2;by=(p.y+q.y)/2;}
            }
            const hit = getConnectionAtPosition(bx, by);
            r.hitTestWorks = !!hit && hit.some(h => String(h.sourceId)==='A' && String(h.targetId)==='B');
        }

        // Stack mode: now also routes orthogonally, but horizontal-major
        // (edges exit the side, jog in the column corridor). Verify routes
        // exist and are axis-aligned.
        setLayoutMode('stack');
        recalculateLayout();
        renderDiagram();
        const stackRouted = connections.filter(c => c.route && c.route.length >= 2);
        r.stackHasRoutes = stackRouted.length === connections.length && connections.length > 0;
        r.stackAxisAligned = stackRouted.every(c => isAxisAligned(c.route));
    } catch(e) { window.__errors.push('script: ' + e.message); }
    r.errors = window.__errors;
    const out = document.createElement('pre'); out.id='out'; out.textContent = JSON.stringify(r); document.body.appendChild(out);
}, 1400);
</script>
</body></html>`;

const tmp = path.join(__dirname, '..', '_ortho_harness.html');
fs.writeFileSync(tmp, harness);
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-ortho-'));
const res = spawnSync(CHROME, ['--headless=new','--disable-gpu','--no-sandbox',
    `--user-data-dir=${userDataDir}`,'--window-size=1600,1000','--virtual-time-budget=3500',
    '--dump-dom', `${BASE}/_ortho_harness.html`], { encoding: 'utf8', maxBuffer: 50*1024*1024 });
fs.rmSync(tmp, { force: true });
try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}

const m = (res.stdout||'').match(/<pre id="out">([\s\S]*?)<\/pre>/);
let failures = 0;
const log = (ok,msg)=>{console.log(`  ${ok?'PASS':'FAIL'}  ${msg}`); if(!ok)failures++;};
console.log('Orthogonal routing check\n');
if (!m) { console.log('  FAIL  no result'); process.exit(1); }
const r = JSON.parse(m[1].replace(/&quot;/g,'"').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>'));

log((r.errors||[]).length===0, `no errors${r.errors&&r.errors.length?': '+r.errors.join(' | '):''}`);
log(r.allHaveRoutes === true, `every flow edge has an orthogonal route (${r.connCount})`);
log(r.allAxisAligned === true, 'all route segments are axis-aligned (right angles)');
log(r.someElbows === true, 'routes include elbow bends');
log(r.startsAtSourceEdge === true, 'route starts at the source box edge');
log(r.endsAtTargetEdge === true, 'route ends at the target box edge');
log(r.hitTestWorks === true, 'hit-testing follows the polyline');
log(r.stackHasRoutes === true, 'Stack mode also routes orthogonally (horizontal-major)');
log(r.stackAxisAligned === true, 'Stack-mode routes are axis-aligned (right angles)');

console.log(`\n${failures===0?'ALL CHECKS PASSED':failures+' CHECK(S) FAILED'}`);
process.exit(failures===0?0:1);
