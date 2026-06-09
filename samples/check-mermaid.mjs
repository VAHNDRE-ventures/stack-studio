/**
 * Mermaid → StackStudio converter check. Pure (no browser): loads the converter
 * and data-layer migration under Node and asserts the produced project is
 * well-formed and faithful to the sample .mmd.
 *
 * Asserts:
 *  - subgraphs become top-level layers; their nodes become substacks
 *  - bare nodes outside any subgraph become top-level layers
 *  - node shapes map to sensible types ([(db)]→Database, {gw}→API, ((u))→Actor)
 *  - edges become connections; dotted edges → Async; labels carried
 *  - fan-out (A --> B & C) and middle-text labels (-- JWT -->) expand correctly
 *  - subgraph-level edges (CLIENTS --> CDN) attach at the layer level
 *  - the result survives migrateProject() with no dangling connection targets
 * Run: node samples/check-mermaid.mjs   (no dev server needed)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

// Load the converter (CommonJS-style export under Node).
const mod = await import('file://' + path.join(root, 'static/js/mermaid-import.js').replace(/\\/g, '/'));
const { mermaidToProject } = mod.default || globalThis.MermaidImport || mod;

// Pull migrateProject + getAllLayers + getConnections out of data.js by
// evaluating it in a minimal sandbox (it's browser-global script style).
const dataSrc = fs.readFileSync(path.join(root, 'static/js/data.js'), 'utf8');
const utilsSrc = fs.readFileSync(path.join(root, 'static/js/utils.js'), 'utf8');
const sandbox = { console, window: {}, document: { addEventListener(){} } };
const vm = await import('node:vm');
const ctx = vm.createContext(sandbox);
vm.runInContext(utilsSrc + '\n' + dataSrc, ctx);
const migrateProject = ctx.migrateProject;

const mmd = fs.readFileSync(path.join(root, 'samples/sample-mermaid.mmd'), 'utf8');

let failures = 0;
const log = (ok, msg) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failures++; };
console.log('Mermaid → StackStudio converter check\n');

let project;
try {
    project = mermaidToProject(mmd, 'Sample Mermaid');
} catch (e) {
    console.log('  FAIL  converter threw: ' + e.message);
    process.exit(1);
}

// Top-level layers: 4 subgraphs + 1 bare node (USER).
const topNames = project.layers.map(l => l.name);
log(project.layers.length === 5, `5 top-level layers (got ${project.layers.length}: ${topNames.join(', ')})`);

const byName = n => project.layers.find(l => l.name === n);
const clients = byName('1 · Clients');
const edge = byName('2 · Edge');
const data = byName('4 · Data');
log(!!clients && clients.substacks.length === 2, `Clients subgraph has 2 substacks (${clients?clients.substacks.length:'-'})`);
log(!!data && data.substacks.length === 2, `Data subgraph has 2 substacks`);

// Bare node USER → top-level layer, typed Actor (((circle))).
const user = byName('Customer');
log(!!user, 'bare node ((Customer)) became a top-level layer');
log(!!user && user.type === 'Actor', `Customer typed Actor (got ${user?user.type:'-'})`);

// Shape→type mapping inside subgraphs.
const findSub = (layer, nm) => layer && layer.substacks.find(s => s.name === nm);
const pg = findSub(data, 'Postgres');
log(!!pg && pg.type === 'Database', `[(Postgres)] typed Database (got ${pg?pg.type:'-'})`);
const gw = findSub(edge, 'API Gateway');
log(!!gw && gw.type === 'API', `{API Gateway} typed API (got ${gw?gw.type:'-'})`);
const auth = findSub(byName('3 · Services'), 'Auth Service');
log(!!auth && auth.type === 'Backend', `(Auth Service) typed Backend (got ${auth?auth.type:'-'})`);

// Migrate + structural integrity.
project = migrateProject(project);
// data.js exposes getAllLayersFromProject(project); utils.js exposes getConnections.
const allLayers = ctx.getAllLayersFromProject(project);
const ids = new Set(allLayers.map(l => String(l.id)));
let dangling = 0, edgeCount = 0, asyncCount = 0, labelCount = 0;
allLayers.forEach(l => {
    (ctx.getConnections(l) || []).forEach(c => {
        edgeCount++;
        if (!ids.has(String(c.targetId))) dangling++;
        if (c.type === 'Async') asyncCount++;
        if (c.label) labelCount++;
    });
});
log(dangling === 0, `no dangling connection targets (${edgeCount} edges)`);

// Re-fetch nodes by id from the migrated project (migrateProject may return a
// new object graph, so pre-migration references are stale).
const byId = id => allLayers.find(l => String(l.id) === String(id));

// Fan-out: GW --> ORDERS & BILLING produces 2 edges from the gateway.
// (Read raw .connections — getConnections() normalizes to {targetId,type} and
// drops the label, which we assert on below.)
const gwM = byId('GW');
const gwConns = (gwM.connections || []);
const gwTargets = gwConns.map(c => String(c.targetId));
log(gwTargets.includes('ORDERS') && gwTargets.includes('BILLING') && gwTargets.includes('AUTH'),
    `fan-out + labeled edge from gateway (→ ${gwTargets.join(', ')})`);

// Middle-text label `-- JWT -->`.
const jwt = gwConns.find(c => String(c.targetId) === 'AUTH');
log(!!jwt && jwt.label === 'JWT', `middle-text label captured ("${jwt?jwt.label:'-'}")`);

// Dotted edge → Async with label.
const billingM = byId('BILLING');
const settle = (billingM.connections || []).find(c => c.type === 'Async');
log(!!settle && settle.label === 'async settle', `dotted edge → Async w/ label ("${settle?settle.label:'-'}")`);

// Subgraph-level edge CLIENTS --> CDN attaches on the Clients layer.
const clientsConns = (byId('CLIENTS').connections || []);
log(clientsConns.some(c => String(c.targetId) === 'CDN'), 'subgraph-level edge (CLIENTS → CDN) attached at layer level');

console.log(`\n${failures===0?'ALL CHECKS PASSED':failures+' CHECK(S) FAILED'}`);
process.exit(failures===0?0:1);
