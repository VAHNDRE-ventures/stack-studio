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
  const res=await fetch('/samples/sample-curated.json');project=await res.json();migrateProject(project);renderLayers();updateStats();selectLayer(0);
  toggleView('actions');
  await new Promise(x=>setTimeout(x,300));
  const av=document.getElementById('actions-view');
  // Count actual action cards (each has a delete ✕ button inside the list).
  const list=av.querySelector('[data-actions-list]');
  r.cardCount = list ? [...list.querySelectorAll('button')].filter(b=>b.textContent==='✕').length : 0;
  r.usePaths=project.usePaths.length;
  r.emptyMsgShown=/No actions defined yet/.test(av.innerHTML);
}catch(e){r.errors.push('script: '+e.message);}
r.errors=r.errors.concat(window.__e);
const o=document.createElement('pre');o.id='out';o.textContent=JSON.stringify(r);document.body.appendChild(o);},900);
</script></body></html>`;
const tmp=path.join(__dirname,'..','_actionsload_h.html');fs.writeFileSync(tmp,harness);
const ud=fs.mkdtempSync(path.join(os.tmpdir(),'al-'));
const res=spawnSync(CHROME,['--headless=new','--disable-gpu','--no-sandbox',`--user-data-dir=${ud}`,'--window-size=1440,900','--virtual-time-budget=2500','--dump-dom',`${BASE}/_actionsload_h.html`],{encoding:'utf8',maxBuffer:50*1024*1024});
fs.rmSync(tmp,{force:true});try{fs.rmSync(ud,{recursive:true,force:true});}catch{}
const m=(res.stdout||'').match(/<pre id="out">([\s\S]*?)<\/pre>/);
let failures=0;const log=(ok,msg)=>{console.log(`  ${ok?'PASS':'FAIL'}  ${msg}`);if(!ok)failures++;};
console.log('Curated actions load check\n');
if(!m){console.log('NO RESULT\n'+(res.stdout||'').slice(0,500));process.exit(1);}
const r=JSON.parse(m[1].replace(/&quot;/g,'"').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>'));
log((r.errors||[]).length===0,`no errors${r.errors&&r.errors.length?': '+r.errors.join(' | '):''}`);
log(!r.emptyMsgShown,'empty-state message NOT shown (actions present)');
log(r.cardCount===r.usePaths,`all ${r.usePaths} curated actions rendered as cards (got ${r.cardCount})`);
console.log(`\n${failures===0?'ALL CHECKS PASSED':failures+' FAILED'}`);
process.exit(failures===0?0:1);


