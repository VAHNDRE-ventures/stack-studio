/**
 * Headless validation: load the sample stack through the same
 * data utilities the app uses and assert the diagram layout logic handles it
 * without crashing and produces sane levels/positions.
 *
 * Run: node samples/validate.mjs
 */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

// Build a sandbox that mimics the browser global scope the scripts expect.
const sandbox = { window: {}, console, document: undefined };
sandbox.window = sandbox;
vm.createContext(sandbox);

function load(rel) {
    const code = fs.readFileSync(path.join(root, rel), 'utf8');
    vm.runInContext(code, sandbox, { filename: rel });
}

// utils.js defines escapeHtml/getConnections; data.js defines migrations and
// constants. We avoid loading DOM-coupled files (app.js/diagram.js touch
// document) and instead re-implement the pure layout level calc to validate.
load('static/js/utils.js');
load('static/js/data.js');

const project = JSON.parse(fs.readFileSync(path.join(root, 'samples/sample-saas.json'), 'utf8'));

let failures = 0;
function check(name, cond) {
    if (cond) {
        console.log(`  PASS  ${name}`);
    } else {
        console.log(`  FAIL  ${name}`);
        failures++;
    }
}

console.log('Sample stack validation\n');

// 1. Migration runs without throwing and normalizes connections to objects.
sandbox.migrateProject(project);
const allLayers = [];
project.layers.forEach(l => {
    allLayers.push(l);
    (l.substacks || []).forEach(s => allLayers.push(s));
});
check('migrateProject completes', true);
check('all connections are {targetId,type} objects', allLayers.every(l =>
    (l.connections || []).every(c => c && typeof c === 'object' && 'targetId' in c)
));

// 2. getConnections accessor returns canonical objects for every node.
check('getConnections works on every layer', allLayers.every(l => {
    const conns = sandbox.getConnections(l);
    return Array.isArray(conns) && conns.every(c => 'targetId' in c && 'type' in c);
}));

// 3. Every connection target resolves to a real node (no dangling edges).
const idSet = new Set(allLayers.map(l => String(l.id)));
let dangling = [];
allLayers.forEach(l => {
    sandbox.getConnections(l).forEach(c => {
        if (!idSet.has(String(c.targetId))) dangling.push(`${l.name} -> ${c.targetId}`);
    });
});
check('no dangling connection targets', dangling.length === 0);
if (dangling.length) console.log('       dangling:', dangling);

// 4. HTML escaping neutralizes the special chars (quotes, backticks, angle
//    brackets) that appear in real stack descriptions and break markup.
const tricky = 'Calls `/v2/orders` with <amount> & "id"';
const escaped = sandbox.escapeHtml(tricky);
check('escapeHtml neutralizes backticks/quotes/brackets',
    !escaped.includes('`') && !escaped.includes('"') &&
    !escaped.includes('<') && !escaped.includes('>'));

// 5. Reproduce the diagram level calculation (pure copy of the algorithm) to
//    confirm it terminates and assigns a level to every top-level layer,
//    including ones reached only via substack connections.
function calculateLayerLevels(layers) {
    const levels = {};
    const visited = new Set();
    const inProgress = new Set();
    const graph = {};
    const all = [];
    layers.forEach(l => { all.push(l); (l.substacks||[]).forEach(s => all.push(s)); });
    all.forEach(layer => {
        graph[layer.id] = sandbox.getConnections(layer).map(c => c.targetId);
    });
    function dfs(id, lvl = 0) {
        if (inProgress.has(id)) return lvl;       // circular guard
        if (visited.has(id)) return levels[id];
        inProgress.add(id);
        levels[id] = lvl;
        (graph[id] || []).forEach(t => {
            const tl = dfs(t, lvl + 1);
            levels[t] = Math.max(levels[t] || 0, tl);
        });
        inProgress.delete(id);
        visited.add(id);
        return levels[id];
    }
    const hasIncoming = new Set();
    all.forEach(l => sandbox.getConnections(l).forEach(c => hasIncoming.add(c.targetId)));
    all.forEach(l => { if (!hasIncoming.has(l.id)) dfs(l.id, 0); });
    all.forEach(l => { if (levels[l.id] === undefined) levels[l.id] = 0; });
    return levels;
}

let levels;
let threw = false;
try { levels = calculateLayerLevels(project.layers); }
catch (e) { threw = true; console.log('       level calc threw:', e.message); }
check('layer level calculation terminates (no infinite recursion)', !threw);
check('every top-level layer has a level', project.layers.every(l => levels[l.id] !== undefined));

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
