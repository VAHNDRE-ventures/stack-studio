/**
 * Recursive substacks check (Gap 1). Loads a 4-level nested project and
 * verifies the tree is flattened to all depths, deeply-nested nodes are
 * costed, connections to deep nodes resolve, and the diagram renders + places
 * every node without error.
 * Run: node samples/check-nesting.mjs   (needs dev server on :8777)
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
    const res=await fetch('/samples/sample-nested.json'); project=await res.json(); migrateProject(project);
    renderLayers(); updateStats(); selectLayer(0);

    const all = getAllLayers();
    r.flatCount = all.length;                 // expect 4 (Platform, Edge, Auth, Token)
    r.hasLevel4 = all.some(l => String(l.id)==='1_1_1_1');

    // findNodePath gives ancestry to a depth-4 node:
    const fp = findNodePath('1_1_1_1');
    r.pathDepth = fp ? fp.path.length : 0;     // expect 4
    r.pathNames = fp ? fp.path.map(n=>n.name).join(' / ') : '';

    // Cost rolls up all 4 levels: 100+50+25+10 = 185
    const agg = aggregateStackCosts(project.layers, { includeFuture:false, includeActors:false });
    r.fixedTotal = agg.filter(c=>c.type==='fixed').reduce((s,c)=>s+c.amount,0);

    // Connection to a deep node resolves (no dangling): every connection target exists
    const ids = new Set(all.map(l=>String(l.id)));
    let dangling = 0;
    all.forEach(l => getConnections(l).forEach(c => { if(!ids.has(String(c.targetId))) dangling++; }));
    r.dangling = dangling;

    // Diagram places every node via the real layout (not lazy fallback):
    toggleView('diagram');
    refreshDiagramLayout();
    const positioned = all.filter(l => nodePositions[l.id]);
    r.positioned = positioned.length;
    r.allFinite = positioned.every(l => Number.isFinite(nodePositions[l.id].x));
    // Each deeper level should sit to the right of its parent.
    const px = id => nodePositions[id] ? nodePositions[id].x : null;
    r.depthStepsRight = px(1) < px('1_1') && px('1_1') < px('1_1_1') && px('1_1_1') < px('1_1_1_1');
  }catch(e){r.errors.push('script: '+e.message);}
  r.errors=r.errors.concat(window.__e);
  const o=document.createElement('pre'); o.id='out'; o.textContent=JSON.stringify(r); document.body.appendChild(o);
},1500);
</script></body></html>`;
const tmp=path.join(__dirname,'..','_nest_h.html'); fs.writeFileSync(tmp,harness);
const ud=fs.mkdtempSync(path.join(os.tmpdir(),'cn-'));
const res=spawnSync(CHROME,['--headless=new','--disable-gpu','--no-sandbox',`--user-data-dir=${ud}`,'--window-size=1600,1000','--virtual-time-budget=3500','--dump-dom',`${BASE}/_nest_h.html`],{encoding:'utf8',maxBuffer:50*1024*1024});
fs.rmSync(tmp,{force:true}); try{fs.rmSync(ud,{recursive:true,force:true});}catch{}
const m=(res.stdout||'').match(/<pre id="out">([\s\S]*?)<\/pre>/);
let failures=0; const log=(ok,msg)=>{console.log(`  ${ok?'PASS':'FAIL'}  ${msg}`); if(!ok)failures++;};
console.log('Recursive substacks check (Gap 1)\n');
if(!m){console.log('  FAIL  no result\n'+(res.stdout||'').slice(0,600));process.exit(1);}
const r=JSON.parse(m[1].replace(/&quot;/g,'"').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>'));
log((r.errors||[]).length===0, `no errors${r.errors&&r.errors.length?': '+r.errors.join(' | '):''}`);
log(r.flatCount===4, `getAllLayers flattens all 4 levels (${r.flatCount})`);
log(r.hasLevel4, 'depth-4 node present in flatten');
log(r.pathDepth===4, `findNodePath returns full ancestry (${r.pathDepth}: ${r.pathNames})`);
log(r.fixedTotal===185, `cost rolls up all levels (100+50+25+10=185, got ${r.fixedTotal})`);
log(r.dangling===0, `connections to deep nodes resolve (dangling=${r.dangling})`);
log(r.positioned===4 && r.allFinite, `diagram places all 4 nodes with finite coords (${r.positioned})`);
log(r.depthStepsRight, 'each deeper level is laid out to the right of its parent');
console.log(`\n${failures===0?'ALL CHECKS PASSED':failures+' CHECK(S) FAILED'}`);
process.exit(failures===0?0:1);
