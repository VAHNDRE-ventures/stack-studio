/**
 * Capture screenshots of each view with the sample stack loaded, so the
 * rework can be eyeballed. Writes PNGs to samples/shots/.
 * Run: node samples/shoot.mjs <view>   (view: stack|diagram|actions|cost)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'http://localhost:8777';
const view = process.argv[2] || 'stack';
const shotsDir = path.join(__dirname, 'shots');
fs.mkdirSync(shotsDir, { recursive: true });

const body = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')
    .replace(/^[\s\S]*?<body>/, '')
    .replace(/<\/body>[\s\S]*$/, '');

const harness = `<!DOCTYPE html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/static/css/style.css"></head>
<body>
${body}
<script>
setTimeout(async () => {
    const res = await fetch('/samples/sample-saas.json');
    project = await res.json();
    migrateProject(project);
    document.getElementById('project-title').textContent = project.name;
    renderLayers(); updateStats(); selectLayer(0);
    toggleView('${view}');
    if ('${view}' === 'diagram') { setTimeout(() => zoomToFit(), 300); }
}, 800);
</script>
</body></html>`;

const tmp = path.join(__dirname, '..', '_shot_harness.html');
fs.writeFileSync(tmp, harness);

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-shot-'));
const out = path.join(shotsDir, `${view}.png`);
const args = [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    `--user-data-dir=${userDataDir}`,
    '--window-size=1600,1000',
    '--virtual-time-budget=3500',
    '--hide-scrollbars',
    `--screenshot=${out}`,
    `${BASE}/_shot_harness.html`
];
spawnSync(CHROME, args, { encoding: 'utf8' });
fs.rmSync(tmp, { force: true });
try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
console.log('wrote', out, fs.existsSync(out) ? `(${fs.statSync(out).size} bytes)` : '(MISSING)');
