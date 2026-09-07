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
const page = await doc.getPage(4);
const tc = await page.getTextContent();
const items = tc.items.filter(i => 'str' in i && !!i.str.trim()).map(it => ({ s: it.str.trim(), x: it.transform[4], y: it.transform[5], h: it.height || 0 }));
const raw = [];
for (const it of items) { let l = raw.find(l => Math.abs(l.y - it.y) <= 2); if (!l) { l = { y: it.y, items: [] }; raw.push(l); } l.items.push(it); }
const lines = raw.map(ln => { ln.items.sort((a,b)=>a.x-b.x); return { y: ln.y, h: ln.items.map(i=>i.h).sort((a,b)=>a-b)[Math.floor(ln.items.length/2)]||0, items: [...ln.items] }; }).sort((a,b)=>b.y-a.y);
lines.forEach((ln,i) => {
  console.log(i, 'h='+ln.h, JSON.stringify(ln.items.map(it=>Math.round(it.x)+':'+it.s).join(' ')).slice(0,90));
});