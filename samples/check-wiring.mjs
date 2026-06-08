/**
 * Static wiring check: every function referenced by an inline onclick/onchange
 * in index.html (and the always-loaded view switcher) must be defined exactly
 * once across the loaded scripts. Catches the duplicate-shadowing / missing-fn
 * class of bugs without a browser.
 *
 * Run: node samples/check-wiring.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

// Scripts in load order.
const scriptSrcs = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);

let allCode = '';
const definedFns = new Map(); // name -> count
for (const src of scriptSrcs) {
    const code = fs.readFileSync(path.join(root, src), 'utf8');
    allCode += '\n' + code;
    for (const m of code.matchAll(/^function\s+(\w+)/gm)) {
        definedFns.set(m[1], (definedFns.get(m[1]) || 0) + 1);
    }
}

let failures = 0;
const log = (ok, msg) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failures++; };

console.log('Wiring check\n');

// 1. No duplicate top-level function definitions (the refactor left several).
const dupes = [...definedFns.entries()].filter(([, c]) => c > 1);
log(dupes.length === 0, `no duplicate top-level functions${dupes.length ? ': ' + dupes.map(d => d[0]).join(', ') : ''}`);

// 2. Every inline handler call target is defined somewhere.
const handlerCalls = new Set();
for (const m of html.matchAll(/on(?:click|change|keyup|input|mouseover|mouseout)="([^"]+)"/g)) {
    // pull bare function-call identifiers like fnName( but skip method calls
    // such as obj.method( (preceded by a dot).
    for (const c of m[1].matchAll(/(?<![.\w])(\w+)\s*\(/g)) {
        handlerCalls.add(c[1]);
    }
}
// Browser built-ins / DOM methods used inline that aren't our functions.
const builtins = new Set(['document', 'getElementById', 'this', 'click', 'event']);
const missing = [...handlerCalls].filter(fn =>
    !definedFns.has(fn) && !builtins.has(fn) && !/^[A-Z]/.test(fn));
log(missing.length === 0, `all inline handlers resolve${missing.length ? ': missing ' + missing.join(', ') : ''}`);

// 3. utils.js loads before everything that uses escapeHtml.
const utilsIdx = scriptSrcs.findIndex(s => s.endsWith('utils.js'));
log(utilsIdx === 0, 'utils.js loads first');

// 4. Key entry points exist.
['toggleView', 'loadProject', 'renderLayers', 'renderLayerDetails', 'renderActionsView',
 'renderCostDashboard', 'newProject', 'importProject', 'exportProject', 'undo', 'redo']
    .forEach(fn => log(definedFns.has(fn), `defined: ${fn}`));

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
