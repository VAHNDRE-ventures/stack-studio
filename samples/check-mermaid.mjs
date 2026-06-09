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

// FLAT model: every real node is a top-level layer (no phantom subgraph nodes,
// no substacks). The sample has 11 real nodes across 4 subgraphs + 1 bare node.
const expectedNodes = ['WEB','MOBILE','CDN','GW','AUTH','ORDERS','BILLING','PG','REDIS','USER'];
log(project.layers.length === expectedNodes.length,
    `flat: ${expectedNodes.length} top-level node-layers (got ${project.layers.length})`);
log(project.layers.every(l => !l.substacks || l.substacks.length === 0),
    'no substacks (composition not used for a flow graph)');
log(!project.layers.some(l => /Clients|Edge|Services|Data$/.test(l.name)),
    'no phantom subgraph/container layers');

const byId = id => project.layers.find(l => String(l.id) === id);

// Group (phase) tagging instead of containment.
const web = byId('WEB'), pg = byId('PG'), gw = byId('GW'), auth = byId('AUTH'), user = byId('USER');
log(!!web && web.group === '1 · Clients', `WEB tagged group "1 · Clients" (got "${web?web.group:'-'}")`);
log(!!pg && pg.group === '4 · Data', `PG tagged group "4 · Data" (got "${pg?pg.group:'-'}")`);
log(!!user && !user.group, 'bare node USER has no group (correct)');
log(Array.isArray(project.groupOrder) && project.groupOrder[0] === '1 · Clients',
    `groupOrder captured in declaration order (${project.groupOrder ? project.groupOrder.length : 0} phases)`);

// Shape→type still applies on flat nodes.
log(!!pg && pg.type === 'Database', `[(Postgres)] typed Database (got ${pg?pg.type:'-'})`);
log(!!gw && gw.type === 'API', `{API Gateway} typed API (got ${gw?gw.type:'-'})`);
log(!!auth && auth.type === 'Backend', `(Auth Service) typed Backend (got ${auth?auth.type:'-'})`);
log(!!user && user.type === 'Actor', `((Customer)) typed Actor (got ${user?user.type:'-'})`);

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

// (byId defined above; migrateProject mutates in place so refs stay valid.)

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

// Group-level edge `CLIENTS --> CDN` expands to member→target edges
// (WEB→CDN and MOBILE→CDN), since CLIENTS is now a phase tag, not a node.
const webToCdn = (byId('WEB').connections || []).some(c => String(c.targetId) === 'CDN');
const mobileToCdn = (byId('MOBILE').connections || []).some(c => String(c.targetId) === 'CDN');
log(webToCdn && mobileToCdn, 'group-level edge (CLIENTS → CDN) expanded to member nodes');

console.log(`\n${failures===0?'ALL CHECKS PASSED':failures+' CHECK(S) FAILED'}`);
process.exit(failures===0?0:1);
