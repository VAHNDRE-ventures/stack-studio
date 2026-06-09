/**
 * Snap-to-grid check. Verifies the toggle/size controls exist, snapCoord
 * rounds to the grid, dragging lands a node on the grid, and turning snap on
 * realigns existing nodes.
 * Run: node samples/check-snap.mjs   (needs dev server on :8777)
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
function fireDrag(canvas, fromX, fromY, toX, toY){
  const rect=canvas.getBoundingClientRect();
  const md=new MouseEvent('mousedown',{clientX:rect.left+fromX,clientY:rect.top+fromY,bubbles:true});
  canvas.dispatchEvent(md);
  const mm=new MouseEvent('mousemove',{clientX:rect.left+toX,clientY:rect.top+toY,bubbles:true});
  canvas.dispatchEvent(mm);
  handleCanvasMouseUp();
}
setTimeout(async()=>{
  const r={errors:[]};
  try{
    const res=await fetch('/samples/sample-saas.json'); project=await res.json(); migrateProject(project);
    renderLayers(); updateStats(); selectLayer(0);
    toggleView('diagram'); renderDiagram();
    await new Promise(x=>setTimeout(x,200));

    r.hasToggle=!!document.getElementById('snap-toggle');
    r.hasSizePicker=!!document.getElementById('snap-size');

    // snapCoord rounds correctly at size 5
    snapToGrid=true; snapGridSize=5;
    r.snap123=snapCoord(123);   // -> 125
    r.snap122=snapCoord(122);   // -> 120
    r.snapOffNoop=(snapToGrid=false, snapCoord(123)); // 123 when off
    snapToGrid=true;

    // Place a node at a known on-screen spot, then drag it to an arbitrary
    // pixel and confirm the resulting world coords are multiples of 5.
    const id=project.layers[0].id;
    // put node at world (0,0); with default pan/zoom from zoomToFit, compute screen
    nodePositions[id]={x:0,y:0}; renderDiagram();
    const sx=panX*1+ (0*zoomLevel); // screen x of world 0
    const sy=panY*1;
    // mousedown on the node center (screen), move by arbitrary amount
    fireDrag(document.getElementById('diagram-canvas'), Math.round(panX), Math.round(panY), Math.round(panX)+37, Math.round(panY)+23);
    const p=nodePositions[id];
    r.landedX=p.x; r.landedY=p.y;
    r.onGrid=(Math.abs(p.x % 5)<1e-6) && (Math.abs(p.y % 5)<1e-6);

    // Turning snap on realigns existing off-grid nodes
    nodePositions[id]={x:103,y:207};
    snapAllNodePositions();
    r.realignedX=nodePositions[id].x; r.realignedY=nodePositions[id].y; // 105, 205
  }catch(e){r.errors.push('script: '+e.message);}
  r.errors=r.errors.concat(window.__e);
  const o=document.createElement('pre'); o.id='out'; o.textContent=JSON.stringify(r); document.body.appendChild(o);
},1300);
</script></body></html>`;
const tmp=path.join(__dirname,'..','_snap_h.html'); fs.writeFileSync(tmp,harness);
const ud=fs.mkdtempSync(path.join(os.tmpdir(),'sn-'));
const res=spawnSync(CHROME,['--headless=new','--disable-gpu','--no-sandbox',`--user-data-dir=${ud}`,'--window-size=1440,900','--virtual-time-budget=3000','--dump-dom',`${BASE}/_snap_h.html`],{encoding:'utf8',maxBuffer:50*1024*1024});
fs.rmSync(tmp,{force:true}); try{fs.rmSync(ud,{recursive:true,force:true});}catch{}
const m=(res.stdout||'').match(/<pre id="out">([\s\S]*?)<\/pre>/);
let failures=0; const log=(ok,msg)=>{console.log(`  ${ok?'PASS':'FAIL'}  ${msg}`); if(!ok)failures++;};
console.log('Snap-to-grid check\n');
if(!m){console.log('NO RESULT\n'+(res.stdout||'').slice(0,500));process.exit(1);}
const r=JSON.parse(m[1].replace(/&quot;/g,'"').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>'));
log((r.errors||[]).length===0, `no errors${r.errors&&r.errors.length?': '+r.errors.join(' | '):''}`);
log(r.hasToggle, 'snap toggle control present');
log(r.hasSizePicker, 'grid-size picker present');
log(r.snap123===125 && r.snap122===120, `snapCoord rounds to grid (123->${r.snap123}, 122->${r.snap122})`);
log(r.snapOffNoop===123, 'snapCoord is a no-op when snapping is off');
log(r.onGrid, `dragged node lands on the grid (${r.landedX}, ${r.landedY})`);
log(r.realignedX===105 && r.realignedY===205, `enabling snap realigns existing nodes (103,207 -> ${r.realignedX},${r.realignedY})`);
console.log(`\n${failures===0?'ALL CHECKS PASSED':failures+' FAILED'}`);
process.exit(failures===0?0:1);
