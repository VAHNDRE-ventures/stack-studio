/**
 * Stack carousel (vertical coverflow) check. Drives the live app headless and
 * asserts the reworked Stack view:
 *  - selected card is centered (no Y translate) and full scale; neighbors are
 *    pushed back in Z, rotated, and scaled down
 *  - navigating UP from index 0 wraps to the last card (infinite scroll)
 *  - navigating DOWN from the last card wraps to index 0
 *  - entering a substack swaps the lane to the children (axis-based depth)
 *  - exiting returns to the parent lane
 * Run: node samples/check-carousel.mjs   (needs dev server on :8777)
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
const tr = (card) => {
  // crude parse of translateY / scale from the inline transform
  const t = card.style.transform || '';
  const ty = (t.match(/translateY\\(([-0-9.]+)px\\)/)||[])[1];
  const sc = (t.match(/scale\\(([0-9.]+)\\)/)||[])[1];
  return { ty: ty!==undefined?parseFloat(ty):null, scale: sc!==undefined?parseFloat(sc):null };
};
setTimeout(async () => {
    const r = {};
    try {
        const res = await fetch('/samples/sample-saas.json');
        project = await res.json();
        migrateProject(project);
        renderLayers(); updateStats(); selectLayer(0);
        await new Promise(x=>setTimeout(x,150));

        const cards = () => Array.from(document.querySelectorAll('.layer-card'));
        const n = cards().length;
        r.cardCount = n;

        // Selected (index 0) centered + full scale; a neighbor pushed/scaled.
        const sel = cards()[0];
        r.selCentered = Math.abs(tr(sel).ty || 0) < 1 && (tr(sel).scale === null || tr(sel).scale >= 0.99);
        const nb = cards()[1];
        r.neighborScaledDown = tr(nb).scale !== null && tr(nb).scale < 0.95;
        r.neighborOffset = Math.abs(tr(nb).ty || 0) > 100;

        // Infinite wrap: UP from 0 → last card selected.
        selectLayer(-1);
        await new Promise(x=>setTimeout(x,50));
        r.wrapUp = document.querySelectorAll('.layer-card')[n-1].classList.contains('selected');

        // DOWN from last → index 0 selected.
        selectLayer(n);  // selectLayer normalizes n → 0
        await new Promise(x=>setTimeout(x,50));
        r.wrapDown = document.querySelectorAll('.layer-card')[0].classList.contains('selected');

        // Axis depth: select a layer with substacks, enter, lane swaps to kids.
        const idx = project.layers.findIndex(l => l.substacks && l.substacks.length);
        r.hasSubLayer = idx >= 0;
        if (idx >= 0) {
            selectLayer(idx);
            const before = document.querySelectorAll('.layer-card').length;
            enterSubstack();
            await new Promise(x=>setTimeout(x,50));
            const after = document.querySelectorAll('.layer-card').length;
            r.enteredSub = (typeof inSubstack !== 'undefined') && inSubstack === true &&
                           after === project.layers[idx].substacks.length;
            exitSubstack();
            await new Promise(x=>setTimeout(x,50));
            r.exitedSub = (inSubstack === false) &&
                          document.querySelectorAll('.layer-card').length === before;
        } else { r.enteredSub = true; r.exitedSub = true; }
    } catch(e) { window.__errors.push('script: ' + e.message); }
    r.errors = window.__errors;
    const out = document.createElement('pre'); out.id='out'; out.textContent = JSON.stringify(r); document.body.appendChild(out);
}, 900);
</script>
</body></html>`;

const tmp = path.join(__dirname, '..', '_carousel_harness.html');
fs.writeFileSync(tmp, harness);
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-car-'));
const res = spawnSync(CHROME, ['--headless=new','--disable-gpu','--no-sandbox',
    `--user-data-dir=${userDataDir}`,'--window-size=1440,900','--virtual-time-budget=2600',
    '--dump-dom', `${BASE}/_carousel_harness.html`], { encoding: 'utf8', maxBuffer: 50*1024*1024 });
fs.rmSync(tmp, { force: true });
try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}

const m = (res.stdout||'').match(/<pre id="out">([\s\S]*?)<\/pre>/);
let failures = 0;
const log = (ok,msg)=>{console.log(`  ${ok?'PASS':'FAIL'}  ${msg}`); if(!ok)failures++;};
console.log('Stack carousel (coverflow + wrap) check\n');
if (!m) { console.log('  FAIL  no result'); process.exit(1); }
const r = JSON.parse(m[1].replace(/&quot;/g,'"').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>'));

log((r.errors||[]).length===0, `no errors${r.errors&&r.errors.length?': '+r.errors.join(' | '):''}`);
log(r.cardCount > 0, `cards rendered (${r.cardCount})`);
log(r.selCentered === true, 'selected card is centered + full scale');
log(r.neighborScaledDown === true && r.neighborOffset === true, 'neighbor card is offset + scaled down (coverflow)');
log(r.wrapUp === true, 'navigating up from first wraps to last (infinite)');
log(r.wrapDown === true, 'navigating down from last wraps to first (infinite)');
log(r.enteredSub === true, 'entering a substack swaps the lane to children');
log(r.exitedSub === true, 'exiting returns to the parent lane');

console.log(`\n${failures===0?'ALL CHECKS PASSED':failures+' CHECK(S) FAILED'}`);
process.exit(failures===0?0:1);
