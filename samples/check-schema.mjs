/**
 * Schema-features check (Gaps 2/3/6): Planned status, Actor/External node type,
 * and connection labels. Verifies the model accepts them, the diagram renders
 * without error, and the connections carry labels through to the render list.
 * Run: node samples/check-schema.mjs   (needs dev server on :8777)
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
    const all=getAllLayers();
    r.hasActor = all.some(l=>l.type==='Actor');
    r.hasPlanned = all.some(l=>l.status==='Planned');
    r.actorHelper = (typeof isActorType==='function') && isActorType('Actor') && !isActorType('Backend');
    r.futureHelper = (typeof isFutureStatus==='function') && isFutureStatus('Planned') && !isFutureStatus('Active');
    r.statusesIncludePlanned = LAYER_STATUSES.includes('Planned') && LAYER_STATUSES.includes('Proposed');
    r.typesIncludeActor = Object.keys(LAYER_TYPES).includes('Actor') && Object.keys(LAYER_TYPES).includes('External');
    // Diagram renders the new types/statuses without error:
    toggleView('diagram'); renderDiagram();
    // connection labels survive into the render list:
    const labeled = connections.filter(c=>c.label);
    r.renderedLabeledConnections = labeled.length;
    r.sampleLabel = labeled[0] ? labeled[0].label : null;
    // Status select in details includes Planned:
    toggleView('stack'); selectLayer(0);
    const sel = document.querySelector('.detail-tab-content[data-tab="properties"] select');
    // find the status select (second select in properties)
    const selects = document.querySelectorAll('.detail-tab-content[data-tab="properties"] select');
    let hasPlannedOption=false;
    selects.forEach(s=>{ [...s.options].forEach(o=>{ if(o.value==='Planned')hasPlannedOption=true; }); });
    r.statusSelectHasPlanned = hasPlannedOption;
    // Connection label input present in connections tab:
    switchDetailTab('connections');
    r.hasLabelInput = !!document.querySelector('.connection-label-input');
    r.legendPresent = !!document.getElementById('diagram-legend');
  }catch(e){r.errors.push('script: '+e.message);}
  r.errors=r.errors.concat(window.__e);
  const o=document.createElement('pre'); o.id='out'; o.textContent=JSON.stringify(r); document.body.appendChild(o);
},1500);
</script></body></html>`;
const tmp=path.join(__dirname,'..','_schema_h.html'); fs.writeFileSync(tmp,harness);
const ud=fs.mkdtempSync(path.join(os.tmpdir(),'cs-'));
const res=spawnSync(CHROME,['--headless=new','--disable-gpu','--no-sandbox',`--user-data-dir=${ud}`,'--window-size=1600,1000','--virtual-time-budget=3500','--dump-dom',`${BASE}/_schema_h.html`],{encoding:'utf8',maxBuffer:50*1024*1024});
fs.rmSync(tmp,{force:true}); try{fs.rmSync(ud,{recursive:true,force:true});}catch{}
const m=(res.stdout||'').match(/<pre id="out">([\s\S]*?)<\/pre>/);
let failures=0; const log=(ok,msg)=>{console.log(`  ${ok?'PASS':'FAIL'}  ${msg}`); if(!ok)failures++;};
console.log('Schema features check (Planned status / Actor type / connection labels)\n');
if(!m){console.log('  FAIL  no result');process.exit(1);}
const r=JSON.parse(m[1].replace(/&quot;/g,'"').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>'));
log((r.errors||[]).length===0, `no errors${r.errors&&r.errors.length?': '+r.errors.join(' | '):''}`);
log(r.typesIncludeActor, 'LAYER_TYPES includes Actor + External');
log(r.statusesIncludePlanned, 'LAYER_STATUSES includes Planned + Proposed');
log(r.actorHelper, 'isActorType() works');
log(r.futureHelper, 'isFutureStatus() works');
log(r.hasActor, 'sample contains an Actor node');
log(r.hasPlanned, 'sample contains a Planned node');
log(r.renderedLabeledConnections >= 1, `connection labels reach the renderer (${r.renderedLabeledConnections}, e.g. "${r.sampleLabel}")`);
log(r.statusSelectHasPlanned, 'details status select offers Planned');
log(r.hasLabelInput, 'connections tab has a label input');
log(r.legendPresent, 'diagram legend is present');
console.log(`\n${failures===0?'ALL CHECKS PASSED':failures+' CHECK(S) FAILED'}`);
process.exit(failures===0?0:1);
