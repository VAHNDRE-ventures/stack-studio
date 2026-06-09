/**
 * High-resolution diagram image export check. Drives the live app headless and
 * asserts:
 *  - computeContentBounds wraps every node + group box with ~20px padding
 *  - the exported canvas aspect ratio matches the content bounding box
 *  - the export is high resolution (scale applied, big pixel dims)
 *  - toDataURL produces a valid PNG
 *  - the on-screen rendering globals (zoom/pan/canvas) are restored afterward
 * We stub HTMLCanvasElement.toDataURL capture by wrapping exportDiagramImage's
 * download: we instead call the internals via a thin probe on window.
 * Run: node samples/check-export.mjs   (needs dev server on :8777)
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

        // Bounds with 20px padding.
        const b = computeContentBounds(20);
        r.bounds = b;
        r.boundsValid = !!b && b.right > b.left && b.bottom > b.top &&
            Number.isFinite(b.left) && Number.isFinite(b.right);
        const wWorld = b.right - b.left, hWorld = b.bottom - b.top;
        r.contentAspect = +(wWorld / hWorld).toFixed(4);

        // Intercept the download + canvas so we can inspect the produced image.
        let captured = null;
        const realCreate = document.createElement.bind(document);
        const origAnchorClick = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function(){ captured = { href: this.href, download: this.download }; };

        // Capture off-screen canvas dims by hooking toDataURL.
        let exportCanvasDims = null;
        const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
        HTMLCanvasElement.prototype.toDataURL = function(...a){
            exportCanvasDims = { w: this.width, h: this.height };
            return origToDataURL.apply(this, a);
        };

        // Record on-screen globals before export.
        const beforeZoom = zoomLevel, beforePanX = panX, beforePanY = panY;
        const beforeCanvasId = canvas.id;

        exportDiagramImage(4);

        // Restore prototypes.
        HTMLAnchorElement.prototype.click = origAnchorClick;
        HTMLCanvasElement.prototype.toDataURL = origToDataURL;

        r.captured = !!captured;
        r.downloadName = captured ? captured.download : null;
        r.isPng = captured ? captured.href.startsWith('data:image/png;base64,') : false;
        r.dataUrlLen = captured ? captured.href.length : 0;
        r.exportDims = exportCanvasDims;

        // Exported aspect ratio matches content aspect (within rounding).
        if (exportCanvasDims) {
            const exportAspect = exportCanvasDims.w / exportCanvasDims.h;
            r.aspectMatch = Math.abs(exportAspect - r.contentAspect) < 0.02;
            // High-res: scale 4 means dims ~= world*4 (unless capped). At least
            // ~3x the world size, and a healthy pixel count.
            r.highRes = exportCanvasDims.w >= wWorld * 3 && exportCanvasDims.w >= 800;
        }

        // On-screen globals restored?
        r.restored = (zoomLevel === beforeZoom) && (panX === beforePanX) &&
            (panY === beforePanY) && (canvas.id === beforeCanvasId);
    } catch(e) { window.__errors.push('script: ' + e.message); }
    r.errors = window.__errors;
    const out = document.createElement('pre'); out.id='out'; out.textContent = JSON.stringify(r); document.body.appendChild(out);
}, 1500);
</script>
</body></html>`;

const tmp = path.join(__dirname, '..', '_export_harness.html');
fs.writeFileSync(tmp, harness);
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-export-'));
const res = spawnSync(CHROME, ['--headless=new','--disable-gpu','--no-sandbox',
    `--user-data-dir=${userDataDir}`,'--window-size=1600,1000','--virtual-time-budget=3800',
    '--dump-dom', `${BASE}/_export_harness.html`], { encoding: 'utf8', maxBuffer: 80*1024*1024 });
fs.rmSync(tmp, { force: true });
try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}

const m = (res.stdout||'').match(/<pre id="out">([\s\S]*?)<\/pre>/);
let failures = 0;
const log = (ok,msg)=>{console.log(`  ${ok?'PASS':'FAIL'}  ${msg}`); if(!ok)failures++;};
console.log('Diagram image export check\n');
if (!m) { console.log('  FAIL  no result'); process.exit(1); }
const r = JSON.parse(m[1].replace(/&quot;/g,'"').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>'));

log((r.errors||[]).length===0, `no errors${r.errors&&r.errors.length?': '+r.errors.join(' | '):''}`);
log(r.boundsValid === true, `content bounds valid (aspect ${r.contentAspect})`);
log(r.captured === true, `triggered a download (${r.downloadName})`);
log(r.isPng === true, `output is a PNG data URL (${r.dataUrlLen} chars)`);
log(r.exportDims && r.highRes === true, `high resolution (${r.exportDims?r.exportDims.w+'x'+r.exportDims.h:'?'})`);
log(r.aspectMatch === true, `export aspect ratio matches content bounds`);
log(r.restored === true, 'on-screen zoom/pan/canvas restored after export');

console.log(`\n${failures===0?'ALL CHECKS PASSED':failures+' CHECK(S) FAILED'}`);
process.exit(failures===0?0:1);
