import { spawnSync } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHROME='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE='http://localhost:8777';
const body=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').replace(/^[\s\S]*?<body>/,'').replace(/<\/body>[\s\S]*$/,'');
const harness=`<!DOCTYPE html><html><head><meta charset=utf-8><link rel=stylesheet href="/static/css/style.css"></head><body>${body}<script>
window.__e=[];window.addEventListener('error',e=>window.__e.push(String(e.message)));
setTimeout(async()=>{const r={errors:[]};
try{
  const res=await fetch('/samples/sample-saas.json');project=await res.json();migrateProject(project);renderLayers();updateStats();selectLayer(0);
  const panel=document.getElementById('details-panel'); const toggle=document.getElementById('panel-toggle'); const handle=document.getElementById('panel-resize-handle');
  const rb=()=>panel.getBoundingClientRect(), tb=()=>toggle.getBoundingClientRect();
  r.handleExists=!!handle;
  // Toggle's right edge should equal the panel's left edge (glued).
  r.gapBefore=Math.round(tb().right - rb().left);
  // Resize wider:
  setPanelWidth(620);
  r.panelW=Math.round(rb().width);
  r.gapAfter=Math.round(tb().right - rb().left);
  // Clamp test (too big -> capped at 70vw):
  setPanelWidth(99999);
  r.cappedW=Math.round(rb().width); r.maxAllowed=Math.round(innerWidth*0.7);
  // Clamp min:
  setPanelWidth(50);
  r.minW=Math.round(rb().width);
  // Collapse parks toggle at right edge:
  setPanelWidth(460); toggleDetailsPanel();
  r.collapsedToggleRight=Math.round(tb().right); r.vw=innerWidth;
}catch(e){r.errors.push('script: '+e.message);}
r.errors=r.errors.concat(window.__e);
const o=document.createElement('pre');o.id='out';o.textContent=JSON.stringify(r);document.body.appendChild(o);},1300);
</script></body></html>`;
const tmp=path.join(__dirname,'..','_panel.html');fs.writeFileSync(tmp,harness);
const ud=fs.mkdtempSync(path.join(os.tmpdir(),'pn-'));
const res=spawnSync(CHROME,['--headless=new','--disable-gpu','--no-sandbox',`--user-data-dir=${ud}`,'--window-size=1440,900','--virtual-time-budget=3000','--dump-dom',`${BASE}/_panel.html`],{encoding:'utf8',maxBuffer:50*1024*1024});
fs.rmSync(tmp,{force:true});try{fs.rmSync(ud,{recursive:true,force:true});}catch{}
const m=(res.stdout||'').match(/<pre id="out">([\s\S]*?)<\/pre>/);
let failures=0;const log=(ok,msg)=>{console.log(`  ${ok?'PASS':'FAIL'}  ${msg}`);if(!ok)failures++;};
console.log('Panel resize + toggle check\n');
if(!m){console.log('  FAIL no result');process.exit(1);}
const r=JSON.parse(m[1].replace(/&quot;/g,'"').replace(/&amp;/g,'&'));
log((r.errors||[]).length===0,`no errors${r.errors&&r.errors.length?': '+r.errors.join(' | '):''}`);
log(r.handleExists,'resize handle present');
log(Math.abs(r.gapBefore)<=2,`toggle glued to panel edge at default (gap=${r.gapBefore})`);
log(r.panelW===620,`resize to 620 applies (${r.panelW})`);
log(Math.abs(r.gapAfter)<=2,`toggle still glued after resize (gap=${r.gapAfter})`);
log(r.cappedW<=r.maxAllowed+1,`width caps at 70vw (${r.cappedW}<=${r.maxAllowed})`);
log(r.minW===300,`width floors at 300 (${r.minW})`);
log(r.collapsedToggleRight===r.vw,`collapsed toggle parks at right edge (${r.collapsedToggleRight}==${r.vw})`);
console.log(`\n${failures===0?'ALL CHECKS PASSED':failures+' FAILED'}`);
process.exit(failures===0?0:1);
