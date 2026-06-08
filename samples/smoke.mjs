/**
 * Headless browser smoke test via Chrome DevTools Protocol over the CLI.
 * Loads the app, injects the sample stack, exercises each view, and
 * reports any console errors / page exceptions.
 *
 * Uses Chrome's --dump-dom after a scripted load through a data-driven page.
 * No npm deps: drives Chrome headless with a temporary HTML harness that
 * imports the app and the sample, then prints a JSON result to the console
 * which we capture via --enable-logging.
 *
 * Run: node samples/smoke.mjs  (requires the dev server on :8777)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'http://localhost:8777';

// A harness page that loads the real app scripts, then runs assertions.
// Served from the same http origin (written into project root) so fetch()
// and relative script src resolve without cross-origin/file:// restrictions.
const harness = `<!DOCTYPE html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/static/css/style.css"></head>
<body>
${fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')
    .replace(/^[\s\S]*?<body>/, '')
    .replace(/<\/body>[\s\S]*$/, '')}
<script>
window.__errors = [];
window.addEventListener('error', e => window.__errors.push(String(e.message)));
window.addEventListener('unhandledrejection', e => window.__errors.push('promise: ' + e.reason));
setTimeout(async () => {
    const results = {};
    try {
        const res = await fetch('/samples/sample-saas.json');
        project = await res.json();
        migrateProject(project);
        document.getElementById('project-title').textContent = project.name;
        renderLayers(); updateStats(); selectLayer(0);
        results.stackLayers = document.querySelectorAll('#stack-container .layer-card').length;
        results.title = document.getElementById('project-title').textContent;

        toggleView('diagram');
        results.canvasW = document.getElementById('diagram-canvas').width;

        toggleView('actions');
        results.actionsRendered = !!document.querySelector('#actions-view');

        toggleView('cost-dashboard');
        results.costRendered = document.getElementById('cost-dashboard-view').children.length > 0;

        toggleView('stack');
        selectLayer(0);
        const details = document.getElementById('layer-details').innerHTML;
        results.detailsHasTabs = details.includes('detail-tab');
        results.detailsLen = details.length;
    } catch (e) {
        window.__errors.push('script: ' + e.message);
    }
    results.errors = window.__errors;
    const out = document.createElement('pre');
    out.id = 'smoke-out';
    out.textContent = JSON.stringify(results, null, 2);
    document.body.appendChild(out);
}, 1500);
</script>
</body></html>`;

const tmp = path.join(__dirname, '..', '_smoke_harness.html');
fs.writeFileSync(tmp, harness);

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-smoke-'));
const args = [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    `--user-data-dir=${userDataDir}`,
    '--virtual-time-budget=4000',
    '--run-all-compositor-stages-before-draw',
    '--dump-dom',
    `${BASE}/_smoke_harness.html`
];

const r = spawnSync(CHROME, args, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
const dom = r.stdout || '';

let failures = 0;
const log = (ok, msg) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failures++; };

console.log('Headless browser smoke test\n');

const m = dom.match(/<pre id="smoke-out">([\s\S]*?)<\/pre>/);
if (!m) {
    console.log('  FAIL  harness did not produce a result');
    console.log(dom.slice(0, 2000));
    fs.rmSync(tmp, { force: true });
    process.exit(1);
}
const result = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));

log((result.errors || []).length === 0, `no console errors${result.errors && result.errors.length ? ': ' + result.errors.join(' | ') : ''}`);
log(result.stackLayers === 7, `stack renders 7 top-level layers (got ${result.stackLayers})`);
log(result.title === 'Acme SaaS Platform', `project title loaded (got ${result.title})`);
log(result.canvasW > 0, `diagram canvas sized (${result.canvasW}px)`);
log(result.costRendered === true, 'cost dashboard renders');
log(result.detailsHasTabs === true, 'details panel renders tabs');

fs.rmSync(tmp, { force: true });
try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
