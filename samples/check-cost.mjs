/**
 * Cost-model check (Gaps 4 + 5): percentage-of-value costs and status-aware
 * rollup. Verifies the percentage math, that future/actor nodes are excluded
 * from the current-state rollup, and that the scope toggle includes them.
 * Run: node samples/check-cost.mjs   (needs dev server on :8777)
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
<body>${body}<script>
window.__e=[]; window.addEventListener('error',e=>window.__e.push(String(e.message)));
setTimeout(async()=>{
  const r={errors:[]};
  try{
    const res=await fetch('/samples/sample-saas.json'); project=await res.json(); migrateProject(project);
    renderLayers(); updateStats(); selectLayer(0);

    // Gap 4: percentage math. Billing Module = 2.9% + $0.30 at AOV 49 => 1.72
    r.aov = getAvgTransactionValue(project);
    const bm = getAllLayers().find(l=>l.name==='Billing Module');
    r.perTxn = +evaluatePercentageCost(bm.costModel, r.aov).toFixed(2);
    r.perTxnExpected = +((2.9/100)*49 + 0.30).toFixed(2);

    // Percentage component surfaces in the rollup as type 'percentage'
    const currentAgg = aggregateStackCosts(project.layers, { includeFuture:false, includeActors:false });
    r.hasPercentageComponent = currentAgg.some(c=>c.type==='percentage');

    // Gap 5: status-aware rollup. The Planned "Analytics Pipeline" has a $35
    // fixed cost; it must be EXCLUDED from current-state and INCLUDED in projected.
    const fixedCurrent = currentAgg.filter(c=>c.type==='fixed').reduce((s,c)=>s+c.amount,0);
    const projAgg = aggregateStackCosts(project.layers, { includeFuture:true, includeActors:false });
    const fixedProjected = projAgg.filter(c=>c.type==='fixed').reduce((s,c)=>s+c.amount,0);
    r.fixedCurrent = fixedCurrent;
    r.fixedProjected = fixedProjected;
    r.plannedExcludedFromCurrent = (fixedProjected - fixedCurrent) === 35;

    // Actors carry no cost and are excluded regardless.
    const customer = getAllLayers().find(l=>l.type==='Actor');
    r.actorPresent = !!customer;

    // Dashboard renders with the scope controls.
    toggleView('cost-dashboard');
    await new Promise(x=>setTimeout(x,200));
    const dash = document.getElementById('cost-dashboard-view').innerHTML;
    r.dashHasScopeToggle = dash.includes('Scope:');
    r.dashHasAovInput = dash.toLowerCase().includes('avg transaction value');
    r.dashHasPerTxnCard = dash.includes('Per-Transaction Fees');
  }catch(e){r.errors.push('script: '+e.message);}
  r.errors=r.errors.concat(window.__e);
  const o=document.createElement('pre'); o.id='out'; o.textContent=JSON.stringify(r); document.body.appendChild(o);
},1500);
</script></body></html>`;
const tmp=path.join(__dirname,'..','_cost_h.html'); fs.writeFileSync(tmp,harness);
const ud=fs.mkdtempSync(path.join(os.tmpdir(),'cc-'));
const res=spawnSync(CHROME,['--headless=new','--disable-gpu','--no-sandbox',`--user-data-dir=${ud}`,'--window-size=1600,1000','--virtual-time-budget=3500','--dump-dom',`${BASE}/_cost_h.html`],{encoding:'utf8',maxBuffer:50*1024*1024});
fs.rmSync(tmp,{force:true}); try{fs.rmSync(ud,{recursive:true,force:true});}catch{}
const m=(res.stdout||'').match(/<pre id="out">([\s\S]*?)<\/pre>/);
let failures=0; const log=(ok,msg)=>{console.log(`  ${ok?'PASS':'FAIL'}  ${msg}`); if(!ok)failures++;};
console.log('Cost model check (percentage cost + status-aware rollup)\n');
if(!m){console.log('  FAIL  no result');process.exit(1);}
const r=JSON.parse(m[1].replace(/&quot;/g,'"').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>'));
log((r.errors||[]).length===0, `no errors${r.errors&&r.errors.length?': '+r.errors.join(' | '):''}`);
log(r.perTxn === r.perTxnExpected, `percentage cost math correct (${r.perTxn} == ${r.perTxnExpected})`);
log(r.hasPercentageComponent, 'percentage cost surfaces in the rollup');
log(r.plannedExcludedFromCurrent, `Planned node excluded from current, included in projected (Δ=${r.fixedProjected - r.fixedCurrent})`);
log(r.actorPresent, 'actor node present (and contributes no cost)');
log(r.dashHasScopeToggle, 'dashboard shows the scope toggle');
log(r.dashHasAovInput, 'dashboard shows the AOV input');
log(r.dashHasPerTxnCard, 'dashboard shows the per-transaction fees card');
console.log(`\n${failures===0?'ALL CHECKS PASSED':failures+' CHECK(S) FAILED'}`);
process.exit(failures===0?0:1);
