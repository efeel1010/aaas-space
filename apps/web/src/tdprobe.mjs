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
const round = n => Math.round(n*2)/2;
function buildLines(tc) {
  const items = tc.items.filter(i => 'str' in i && !!i.str.trim()).map(it => ({ s: it.str.trim(), x: it.transform[4], y: it.transform[5], h: it.height || 0 }));
  const raw = [];
  for (const it of items) { let l = raw.find(l => Math.abs(l.y - it.y) <= 2); if (!l) { l = { y: it.y, items: [] }; raw.push(l); } l.items.push(it); }
  return raw.map(ln => { ln.items.sort((a,b)=>a.x-b.x); return { y: ln.y, h: ln.items.map(i=>i.h).sort((a,b)=>a-b)[Math.floor(ln.items.length/2)]||0, items: [...ln.items] }; }).sort((a,b)=>b.y-a.y);
}
const TOL = 12, bodyH = 12;

function tryTable(lines, si) {
  const header = lines[si];
  if (header.items.length < 3) return null;
  const merged = [];
  for (const it of header.items) { const idx = merged.findIndex(m => Math.abs(m.x - it.x) < 6); if (idx >= 0) merged[idx] = { x: (merged[idx].x + it.x)/2, s: merged[idx].s + it.s }; else merged.push({ x: it.x, s: it.s }); }
  merged.sort((a,b)=>a.x-b.x);
  if (merged.length < 3) return null;
  if (merged.reduce((n,m)=>n+m.s.length,0) > 40) return null;
  const cols = merged.map(m=>m.x);
  const dataLines = [];
  let r = si + 1;
  while (r < lines.length) {
    const ln = lines[r];
    if (dataLines.length && (ln.y - dataLines[dataLines.length-1].y) > bodyH*3) break;
    if (ln.h >= bodyH*1.05) break;
    if (ln.h < bodyH*0.65) { r++; continue; }
    if (Math.min(...cols.map(c=>Math.abs(ln.items[0].x-c))) > bodyH*2) break;
    dataLines.push(ln); r++;
  }
  if (dataLines.length < 2) return null;
  const colHasData = cols.map((_,i)=> dataLines.some(ln=>ln.items.some(it=>Math.abs(it.x-cols[i])<=TOL)));
  // 合并相邻间距<25 的列（去掉列内碎片列）
  const activeIdx = [];
  for (let i=0;i<cols.length;i++){ if (colHasData[i]) { if (activeIdx.length && cols[i]-cols[activeIdx[activeIdx.length-1]] < 25) { /* merge: 保留前，忽略当前 */ } else activeIdx.push(i); } }
  if (activeIdx.length < 3) return null;
  const activeCols = activeIdx.map(i=>cols[i]);
  const gaps=[]; for(let i=1;i<activeCols.length;i++) gaps.push(activeCols[i]-activeCols[i-1]);
  const sg=[...gaps].sort((a,b)=>a-b); const med=sg[Math.floor(sg.length/2)];
  if (med < 40) return null;
  if (gaps.filter(g=>Math.abs(g-med)<=med*0.45).length < gaps.length-1) return null;
  // 行首 & 对齐比例 rx
  const rowStarts = dataLines.filter(ln=>activeIdx[0]>=0 && ln.items.some(it=>Math.abs(it.x-cols[activeIdx[0]])<=TOL) && activeIdx.slice(1).some(ci=>ln.items.some(it=>Math.abs(it.x-cols[ci])<=TOL)));
  let rxCount=0; for (const ln of dataLines){ const okAll = ln.items.every(it=> activeIdx.some(ci=>Math.abs(it.x-cols[ci])<=TOL)); if(okAll) rxCount++; }
  const rx = rxCount / dataLines.length;
  if (rowStarts.length < 3) return null;
  if (rx < 0.6) return null;
  // 构建
  const nCols = activeCols.length;
  const idxInFinal = new Array(cols.length).fill(-1);
  activeIdx.forEach((ci,fi)=>{ idxInFinal[ci]=fi; });
  function fiOf(x){ let b=0,bd=1e9; activeCols.forEach((c,i)=>{const d=Math.abs(x-c); if(d<bd){bd=d;b=i;}}); return b; }
  const hCells = new Array(nCols).fill('');
  for (const m of merged){ let fi; { let b=0,bd=1e9; activeCols.forEach((c,i)=>{const d=Math.abs(m.x-c); if(d<bd){bd=d;b=i;}}); fi=b; } hCells[fi]+=m.s; }
  let row = Array(nCols).fill(''); const rows = [];
  const push=()=>{ if(row.some(Boolean)) rows.push(row); row=Array(nCols).fill(''); };
  for (const ln of dataLines){
    const isRS = activeIdx[0]>=0 && ln.items.some(it=>Math.abs(it.x-cols[activeIdx[0]])<=TOL) && activeIdx.slice(1).some(ci=>ln.items.some(it=>Math.abs(it.x-cols[ci])<=TOL));
    if (isRS && rows.length) push();
    for (const it of ln.items){ const fi = fiOf(it.x); if (Math.abs(it.x-activeCols[fi]) <= TOL*1.5) row[fi] += it.s; }
  }
  push();
  const esc=s=>s.replace(/\|/g,'\\|').trim();
  const md = `| ${hCells.map(esc).join(' | ')} |\n|${activeCols.map(()=>'---').join('|')}|\n` + rows.map(r=>'| '+r.map(esc).join(' | ')+' |').join('\n');
  return { md, end: r-1, activeCols, rx, rowStarts: rowStarts.length };
}

for (let p = 3; p <= 9; p++) {
  const page = await doc.getPage(p);
  const tc = await page.getTextContent();
  const lines = buildLines(tc);
  let i = 0;
  while (i < lines.length) {
    const t = tryTable(lines, i);
    if (t) { console.log(`\n### PAGE ${p} table (${t.activeCols.length}col rx=${t.rx.toFixed(2)} rs=${t.rowStarts}) ###\n` + t.md); i = t.end + 1; }
    else i++;
  }
}