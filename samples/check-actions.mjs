/**
 * Actions behavior check (headless Chrome against the live app):
 *  - the sample ships with actions and they load
 *  - assembly edits (add layer, change calls) persist to localStorage
 *    WITHOUT clicking Save (the bug we fixed)
 *  - an export round-trip preserves usePaths
 *  - selecting an action highlights its path on the diagram
 * Run: node samples/check-actions.mjs   (needs dev server on :8777)
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
    r.loadedActions = (project.usePaths||[]).length;

    toggleView('actions');
    // Edit assembly of the first action WITHOUT clicking Save:
    const a = project.usePaths[0];
    const beforeLayers = a.layersInvolved.length;
    addLayerToPath(a, project.layers[4].id);     // add Edge Cache (1005)
    updateLayerCalls(a.id, project.layers[4].id, 5);
    const ls = JSON.parse(localStorage.getItem('ztack_project')||'{}');
    const lsAction = (ls.usePaths||[]).find(p=>p.id===a.id) || {};
    r.persistedWithoutSave = (lsAction.layersInvolved||[]).length === beforeLayers + 1
        && lsAction.avgCallsPerLayer && lsAction.avgCallsPerLayer[project.layers[4].id] === 5;

    // Export round-trip preserves actions:
    const exported = JSON.parse(JSON.stringify(project));
    r.exportKeepsActions = (exported.usePaths||[]).length === r.loadedActions;

    // Diagram highlight:
    editAction(project.usePaths[1].id);  // select "Checkout Flow"
    r.highlightSet = !!(highlightedActionPath && highlightedActionPath.layerIds.size > 0);
    r.highlightName = highlightedActionPath ? highlightedActionPath.name : null;
    toggleView('diagram');
    r.highlightSurvivesToDiagram = !!(highlightedActionPath && highlightedActionPath.layerIds.size > 0);
    // Leaving to stack clears it:
    toggleView('stack');
    r.highlightClearedOnStack = highlightedActionPath === null;
  }catch(e){r.errors.push('script: '+e.message);}
  r.errors=r.errors.concat(window.__e);
  const o=document.createElement('pre'); o.id='out'; o.textContent=JSON.stringify(r); document.body.appendChild(o);
},1400);
</script></body></html>`;
const tmp=path.join(__dirname,'..','_actions_h.html'); fs.writeFileSync(tmp,harness);
const ud=fs.mkdtempSync(path.join(os.tmpdir(),'ca-'));
const res=spawnSync(CHROME,['--headless=new','--disable-gpu','--no-sandbox',`--user-data-dir=${ud}`,'--window-size=1600,1000','--virtual-time-budget=3500','--dump-dom',`${BASE}/_actions_h.html`],{encoding:'utf8',maxBuffer:50*1024*1024});
fs.rmSync(tmp,{force:true}); try{fs.rmSync(ud,{recursive:true,force:true});}catch{}
const m=(res.stdout||'').match(/<pre id="out">([\s\S]*?)<\/pre>/);
let failures=0; const log=(ok,msg)=>{console.log(`  ${ok?'PASS':'FAIL'}  ${msg}`); if(!ok)failures++;};
console.log('Actions behavior check\n');
if(!m){console.log('  FAIL  no result');process.exit(1);}
const r=JSON.parse(m[1].replace(/&quot;/g,'"').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>'));
log((r.errors||[]).length===0, `no errors${r.errors&&r.errors.length?': '+r.errors.join(' | '):''}`);
log(r.loadedActions===3, `sample ships with actions (${r.loadedActions})`);
log(r.persistedWithoutSave===true, 'assembly edits persist without clicking Save');
log(r.exportKeepsActions===true, 'export round-trip preserves actions');
log(r.highlightSet===true, `selecting an action sets the path highlight (${r.highlightName})`);
log(r.highlightSurvivesToDiagram===true, 'highlight persists when opening the diagram');
log(r.highlightClearedOnStack===true, 'highlight clears when leaving to stack view');
console.log(`\n${failures===0?'ALL CHECKS PASSED':failures+' CHECK(S) FAILED'}`);
process.exit(failures===0?0:1);
