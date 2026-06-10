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
  const res=await fetch('/samples/sample-saas.json');project=await res.json();migrateProject(project);renderLayers();updateStats();
  const idx=project.layers.findIndex(l=>l.substacks&&l.substacks.length); selectLayer(idx);
  await new Promise(x=>setTimeout(x,300));
  const card=document.querySelector('.layer-card.selected');
  const name=card.querySelector('.label-name');
  const meta=card.querySelector('.label-meta');
  const badge=card.querySelector('.cost-badge');
  const rb=el=>{const b=el.getBoundingClientRect();return {x:Math.round(b.x),y:Math.round(b.y),r:Math.round(b.right),btm:Math.round(b.bottom),h:Math.round(b.height)};};
  r.name=rb(name); r.meta=rb(meta); r.badge=badge?rb(badge):null;
  // meta row (status/cost/substack pills) sits below the name; the cost badge
  // lives INSIDE that meta row now, so assert the badge is below the name (not
  // overlapping it) rather than below the whole meta row.
  r.metaBelowName = r.meta.y >= r.name.btm - 2;
  r.badgeBelowName = r.badge ? (r.badge.y >= r.name.btm - 2) : true;
  // name should occupy multiple lines only if wide; check it's not absurdly tall (mid-word breaks make many short lines)
  r.nameHeight = r.name.h;
  // cost text contains no exponential notation
  r.badgeText = badge ? badge.textContent : '';
  r.noExponential = !/e-?\d/.test(r.badgeText);
  // ghost check: container should NOT have .positioning lingering after select
  r.noLingeringPositioning = !document.getElementById('stack-container').classList.contains('positioning');
}catch(e){r.errors.push('script: '+e.message);}
r.errors=r.errors.concat(window.__e);
const o=document.createElement('pre');o.id='out';o.textContent=JSON.stringify(r);document.body.appendChild(o);},900);
</script></body></html>`;
const tmp=path.join(__dirname,'..','_labelcheck.html');fs.writeFileSync(tmp,harness);
const ud=fs.mkdtempSync(path.join(os.tmpdir(),'lc-'));
const res=spawnSync(CHROME,['--headless=new','--disable-gpu','--no-sandbox',`--user-data-dir=${ud}`,'--window-size=1440,820','--virtual-time-budget=2500','--dump-dom',`${BASE}/_labelcheck.html`],{encoding:'utf8',maxBuffer:50*1024*1024});
fs.rmSync(tmp,{force:true});try{fs.rmSync(ud,{recursive:true,force:true});}catch{}
const m=(res.stdout||'').match(/<pre id="out">([\s\S]*?)<\/pre>/);
let failures=0;const log=(ok,msg)=>{console.log(`  ${ok?'PASS':'FAIL'}  ${msg}`);if(!ok)failures++;};
console.log('Stack label/badge layout check\n');
if(!m){console.log('NO RESULT');process.exit(1);}
const r=JSON.parse(m[1].replace(/&quot;/g,'"').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>'));
log((r.errors||[]).length===0,`no errors${r.errors&&r.errors.length?': '+r.errors.join(' | '):''}`);
log(r.metaBelowName,`type/meta row sits below the name (no overlap)`);
log(r.badgeBelowName,`cost badge sits below the name (no overlap) [${r.badge?JSON.stringify(r.badge):'no badge'}]`);
log(r.noExponential,`cost badge has no exponential notation ("${r.badgeText}")`);
log(r.noLingeringPositioning,'no lingering .positioning class (ghost fix)');
console.log(`\n${failures===0?'ALL CHECKS PASSED':failures+' FAILED'}`);
process.exit(failures===0?0:1);
