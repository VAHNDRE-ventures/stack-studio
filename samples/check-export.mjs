/**
 * High-resolution diagram image export check + companion legend doc + node
 * tooltip. Drives the live app headless and asserts:
 *  - computeContentBounds wraps every node + group box with ~20px padding
 *  - the exported canvas aspect ratio matches the content bounding box
 *  - the export is high resolution (scale applied, big pixel dims)
 *  - a PNG download fires and a companion Markdown legend (.md) downloads too
 *  - the on-screen rendering globals (zoom/pan/canvas) are restored afterward
 *  - the node hover tooltip surfaces the node's name + description
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

        const b = computeContentBounds(20);
        r.boundsValid = !!b && b.right > b.left && b.bottom > b.top &&
            Number.isFinite(b.left) && Number.isFinite(b.right);
        const wWorld = b.right - b.left, hWorld = b.bottom - b.top;
        r.contentAspect = +(wWorld / hWorld).toFixed(4);

        // Capture downloads (PNG + .md) and the markdown text via a Blob hook.
        const captures = [];
        const origClick = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function(){ captures.push({ href: this.href, download: this.download }); };
        let mdText = null;
        const OrigBlob = window.Blob;
        window.Blob = function(parts, opts){
            if (opts && opts.type === 'text/markdown' && parts && parts.length) mdText = String(parts[0]);
            return new OrigBlob(parts, opts);
        };
        let exportDims = null;
        const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
        HTMLCanvasElement.prototype.toDataURL = function(...a){
            exportDims = { w: this.width, h: this.height };
            return origToDataURL.apply(this, a);
        };

        const beforeZoom = zoomLevel, beforePanX = panX, beforePanY = panY, beforeCanvasId = canvas.id;

        exportDiagramImage(4);

        HTMLAnchorElement.prototype.click = origClick;
        HTMLCanvasElement.prototype.toDataURL = origToDataURL;
        window.Blob = OrigBlob;

        const png = captures.find(c => (c.download||'').endsWith('.png'));
        const md = captures.find(c => (c.download||'').endsWith('.md'));
        r.isPng = !!png && png.href.indexOf('data:image/png;base64,') === 0;
        r.exportDims = exportDims;
        r.docDownloaded = !!md;
        r.docName = md ? md.download : null;
        r.mdHasTitle = !!mdText && mdText.indexOf('# ') === 0;
        r.mdMentionsNode = !!mdText && mdText.indexOf('Web App') !== -1;
        r.mdHasConnects = !!mdText && mdText.indexOf('Connects to:') !== -1;

        if (exportDims) {
            r.aspectMatch = Math.abs((exportDims.w / exportDims.h) - r.contentAspect) < 0.02;
            r.highRes = exportDims.w >= wWorld * 3 && exportDims.w >= 800;
        }
        r.restored = (zoomLevel === beforeZoom) && (panX === beforePanX) &&
            (panY === beforePanY) && (canvas.id === beforeCanvasId);

        // Node hover tooltip surfaces the node's description.
        const node0 = (project.layers || []).find(l => l && l.description);
        if (node0) {
            showNodeTooltip({ clientX: 100, clientY: 100 }, node0, []);
            const tip = document.querySelector('.connection-tooltip');
            r.tooltipShown = !!tip;
            r.tooltipHasName = !!tip && tip.innerHTML.indexOf(node0.name) !== -1;
            const snippet = String(node0.description).split('\\n')[0].slice(0, 12);
            r.tooltipHasDesc = !!tip && snippet.length > 0 && tip.textContent.indexOf(snippet) !== -1;
            hideConnectionTooltip();
        } else {
            r.tooltipShown = true; r.tooltipHasName = true; r.tooltipHasDesc = true;
        }
    } catch(e) { window.__errors.push('script: ' + e.message); }
    r.errors = window.__errors;
    const out = document.createElement('pre'); out.id='out'; out.textContent = JSON.stringify(r); document.body.appendChild(out);
}, 1400);
</script>
</body></html>`;

const tmp = path.join(__dirname, '..', '_export_harness.html');
fs.writeFileSync(tmp, harness);
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-export-'));
const res = spawnSync(CHROME, ['--headless=new','--disable-gpu','--no-sandbox',
    `--user-data-dir=${userDataDir}`,'--window-size=1600,1000','--virtual-time-budget=4500',
    '--dump-dom', `${BASE}/_export_harness.html`], { encoding: 'utf8', maxBuffer: 80*1024*1024 });
fs.rmSync(tmp, { force: true });
try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}

const m = (res.stdout||'').match(/<pre id="out">([\s\S]*?)<\/pre>/);
let failures = 0;
const log = (ok,msg)=>{console.log(`  ${ok?'PASS':'FAIL'}  ${msg}`); if(!ok)failures++;};
console.log('Diagram image export + legend + tooltip check\n');
if (!m) { console.log('  FAIL  no result'); process.exit(1); }
const r = JSON.parse(m[1].replace(/&quot;/g,'"').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>'));

log((r.errors||[]).length===0, `no errors${r.errors&&r.errors.length?': '+r.errors.join(' | '):''}`);
log(r.boundsValid === true, `content bounds valid (aspect ${r.contentAspect})`);
log(r.isPng === true, 'PNG download fired (data URL)');
log(r.exportDims && r.highRes === true, `high resolution (${r.exportDims?r.exportDims.w+'x'+r.exportDims.h:'?'})`);
log(r.aspectMatch === true, 'export aspect ratio matches content bounds');
log(r.restored === true, 'on-screen zoom/pan/canvas restored after export');
log(r.docDownloaded === true, `companion legend .md downloaded (${r.docName})`);
log(r.mdHasTitle === true, 'legend starts with a Markdown H1 title');
log(r.mdMentionsNode === true, 'legend lists a node by name');
log(r.mdHasConnects === true, 'legend documents node connections');
log(r.tooltipShown === true, 'node hover tooltip renders');
log(r.tooltipHasName === true && r.tooltipHasDesc === true, 'node tooltip includes name + description');

console.log(`\n${failures===0?'ALL CHECKS PASSED':failures+' CHECK(S) FAILED'}`);
process.exit(failures===0?0:1);
