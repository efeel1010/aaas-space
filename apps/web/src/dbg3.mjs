import { Window } from 'happy-dom';
import fs from 'node:fs';
const win = new Window();
for (const k of ['DOMMatrix','DOMPoint','DOMPointReadOnly','DOMRect','DOMRectReadOnly','DOMParser','Path2D','HTMLCanvasElement','CanvasRenderingContext2D','Image','Blob','File','FileReader','TextEncoder','TextDecoder','getComputedStyle','requestAnimationFrame','cancelAnimationFrame','URL','Response','Headers','Request']) {
  if (win[k] !== undefined && globalThis[k] === undefined) globalThis[k] = win[k];
}
globalThis.window = win; globalThis.document = win.document;
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const path = '/Users/evanh/Desktop/产品/pulse/宣传资料/合规介绍/Pulse 产品介绍与合规评估说明书.pdf';
const data = new Uint8Array(fs.readFileSync(path));
const doc = await pdfjs.getDocument({ data, useSystemFonts: true, isEvalSupported: false }).promise;
function round(n) { return Math.round(n*2)/2; }

async function pageLines(p) {
  const tc = await doc.getPage(p).then(pp=>pp.getTextContent());
  const items = tc.items.filter(i => 'str' in i && !!i.str.trim()).map(it => ({ s: it.str.trim(), x: it.transform[4], y: it.transform[5], h: it.height || 0 }));
  const raw = [];
  for (const it of items) { let l = raw.find(l => Math.abs(l.y - it.y) <= 2); if (!l) { l = { y: it.y, items: [] }; raw.push(l); } l.items.push(it); }
  return raw.map(ln => { ln.items.sort((a,b)=>a.x-b.x); return { y: ln.y, h: ln.items.map(i=>i.h).sort((a,b)=>a-b)[Math.floor(ln.items.length/2)]||0, items: [...ln.items] }; }).sort((a,b)=>b.y-a.y);
}

const GAP=55, CONT=26;
let DBG=false;
function colClusters(items){ items=[...items].sort((a,b)=>a.x-b.x); const cl=[]; for(const it of items){ const cur=cl[cl.length-1]; if(!cur||it.x-cur.right>GAP){ cl.push({left:it.x,right:it.x,first:it.x,its:[it]}); } else { cur.right=it.x; cur.its.push(it); } } return cl; }
function isMove(xs){ if(xs.length<2) return false; let big=0; for(let k=1;k<xs.length;k++) if(xs[k]-xs[k-1]>GAP) big++; return big>=2 && big/(xs.length-1)>=0.5; }
function clusterAnchors(sortedX, minN){ const bands=[]; for(const x of sortedX){ const b=bands[bands.length-1]; if(b&&x-b.x<=38){ b.x=Math.round((b.x+b.n*x)/(b.n+1)); b.n++; } else bands.push({x,n:1}); } return bands.filter(b=>b.n>=minN).map(b=>b.x); }

function tryTable(lines, i, bodyH){
  const header=lines[i];
  const hxs=header.items.map(it=>it.x).sort((a,b)=>a-b);
  if(!isMove(hxs)) return null;
  if(header.h<bodyH*0.8 || header.h>bodyH*1.15) return null;
  const region=[]; let j=i+1;
  while(j<lines.length){ const h=lines[j].h; if(h<bodyH*0.72 || h>bodyH*1.1) break; region.push(lines[j]); j++; }
  // anchors
  const pool=[];
  for(const cl of colClusters(header.items)) pool.push(cl.first);
  for(const ln of region){ const xs=ln.items.map(it=>it.x).sort((a,b)=>a-b); if(isMove(xs)) for(const cl of colClusters(ln.items)) pool.push(cl.first); }
  let anchors=clusterAnchors([...pool].sort((a,b)=>a-b), 2);
  if(anchors.length<2) return null;
  console.log('  anchors=', JSON.stringify(anchors));
  const anchorOf=x=>{ let b=0,bd=1e9; anchors.forEach((a,idx)=>{const d=Math.abs(a-x); if(d<bd){bd=d;b=idx;}}); return b; };
  const col0=anchors[0];
  const col1=anchors[1]??col0;
  const mid01=(col0+col1)/2; // 列0(标签)与列1(数据)的分界中点
  // 若列1为符号列（值为●◐○ 等单字符标记），则标签换行碎片一律归属列0；用略小于列1锚点的分界避开亚像素抖动
  const col1IsSymbol = region.some(ln=>ln.items.some(it=>anchorOf(it.x)===1 && it.s.length<=1 && '●○◐'.includes(it.s)));
  const thr = col1IsSymbol ? (col1-4) : mid01;
  const route=(x)=> x<thr ? 0 : anchorOf(x);
  // header cells
  const headerCells=new Array(anchors.length).fill('');
  for(const it of header.items) headerCells[anchorOf(it.x)]+=it.s;
  const nonEmptyH=headerCells.filter(Boolean);
  if(nonEmptyH.length<2) return null;
  if(nonEmptyH.some(c=>c.length>8)) return null; // header 必须为短标签
  const isSymbol=c=>c==='●'||c==='○'||c==='◐';
  // 若非列0的表头全是符号 → 实为跨页续表的首个数据行，把表头行当数据行使用
  const headerIsData = nonEmptyH.length>1 && nonEmptyH.slice(1).every(c=>[...c].every(isSymbol));
  // rows
  const rows=[]; let cur=null, prevY=header.y, consumed=0, ended=false;
  let rowMarkers=0, compactRows=0;
  if(headerIsData){ cur=headerCells.slice(); rowMarkers++; if(cur.every(c=>!c||c.length<=30)) compactRows++; }
  for(const ln of region){
    if(ended) break;
    const minX=Math.min(...ln.items.map(it=>it.x));
    if(minX<col0-4){ ended=true; break; } // 段落缩进(54)而非表格列(60) → 表结束
    const its=[...ln.items].sort((a,b)=>a.x-b.x);
    const hasCol0=its.some(it=>anchorOf(it.x)===0);
    const hasFar=its.some(it=>anchorOf(it.x)>=2); // 存在第 3 列及以后的内容（符号列/远列）
    const gap=prevY-ln.y;
    if(DBG) console.log('y='+ln.y,'c0='+hasCol0,'far='+hasFar,'gap='+Math.round(gap), its.map(function(it){return Math.round(it.x)+':'+anchorOf(it.x);}).join(' '));
    if(hasCol0&&hasFar){
      // 真正的数据行：含列0标签 + 远列内容（●◐○ 或远列文本）
      if(cur) rows.push(cur);
      cur=new Array(anchors.length).fill('');
      for(const it of its) cur[route(it.x)]+=it.s;
      rowMarkers++;
      if(cur.every(c=>!c||c.length<=30)) compactRows++;
      consumed++; prevY=ln.y;
    } else if(!cur){
      ended=true; break;
    } else if(gap<=CONT){
      // 续行：按 route 分界，标签换行碎片并入列0，多行单元格归最近列
      for(const it of its) cur[route(it.x)]+=it.s;
      consumed++; prevY=ln.y;
    } else {
      ended=true;
    }
  }
  if(cur) rows.push(cur);
  if(rowMarkers<2) return null; // 至少 2 个数据行
  if(compactRows/rowMarkers < 0.7) return null; // 数据行须紧凑，拒绝段落误判
  // build md
  const esc=s=>(s||'').replace(/\|/g,'\\|').trim();
  const head=anchors.map((_,i)=>esc(headerCells[i]));
  const md='| '+head.join(' | ')+' |\n|'+anchors.map(()=>'---').join('|')+'|\n'+rows.map(r=>'| '+r.map(c=>esc(c)).join(' | ')+' |').join('\n');
  return { md, end: i+consumed }; // consumed counts region lines (excludes trailing prose due to ended)
}

let bodyH=round(12);
for(let p=1;p<=doc.numPages;p++){
  DBG = (p===3||p===6);
  const lines=await pageLines(p);
  // recompute bodyH from all for correctness (approx: use global below)
  let i=0;
  while(i<lines.length){
    const t=tryTable(lines,i,bodyH);
    if(t){ console.log(`\n### PAGE ${p} [idx ${i}..${t.end}] ###`); console.log(t.md); i=t.end+1; }
    else i++;
  }
}