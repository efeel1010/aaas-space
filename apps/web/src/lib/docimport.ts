// ===== 本地文档导入：md / pdf / docx → Markdown（适配在线文档格式） =====

// 从文件名取标题（去掉扩展名）
function titleFromName(name: string): string {
  const base = name.replace(/\.[^.]+$/, '');
  return base.trim() || '未命名文档';
}

// Markdown 行内代码清理：把错误嵌套的代码围栏修复为规整的围栏块
function normalizeFences(md: string): string {
  return md
    .replace(/^`{1,2}([^`\n]+)`{1,2}\s*$/gm, '`$1`')
    .trim();
}

// .docx → Markdown（mammoth 输出 HTML，再转 Markdown）
async function parseDocx(buf: ArrayBuffer): Promise<string> {
  const mammoth = await import('mammoth');
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer: buf });
  if (!html.trim()) return '';
  const { editableHtmlToMarkdown } = await import('./richtext');
  return normalizeFences(editableHtmlToMarkdown(`<div>${html}</div>`));
}

// ===== PDF → Markdown：按字块聚类成行，按相对字号还原标题层级，按行距还原段落 =====
// PDF 文本坐标系：Y 越大越靠上，故行需按 Y 降序（自上而下）排列，行内按 X 升序（自左而右）。

// ===== 表格识别（基于坐标聚类，还原 Markdown 表格） =====
// 核心思路：表头行有「多列」「列距>55」；据此聚合出列锚点，然后把区域内每行按
// 锚点路由到对应列，生成 Markdown 表格。
const TAB_GAP = 55; // 列间距阈值：两列的锚点必须相距 >55
const TAB_CONT = 30; // 续行行距阈值：<=30 视为同一单元格换行

interface PdfItem {
  s: string;
  x: number;
  y: number;
  h: number;
}

interface PdfLine {
  y: number;
  h: number;
  items: PdfItem[];
  text: string;
}

// 把同一行的 item 按列距聚类（紧挨着的碎片并为一簇，取首项 x 作代表）
function colClusters(items: PdfItem[]): { left: number; first: number }[] {
  const sorted = [...items].sort((a, b) => a.x - b.x);
  const cl: { left: number; first: number }[] = [];
  for (const it of sorted) {
    const cur = cl[cl.length - 1];
    if (!cur || it.x - cur.left > TAB_GAP) cl.push({ left: it.x, first: it.x });
    else cur.left = it.x;
  }
  return cl;
}

// 判断某行横向分布是否「多列」（存在 >=2 个大间距，且大间距占比 >=50%）
function isMove(xs: number[]): boolean {
  if (xs.length < 2) return false;
  let big = 0;
  for (let k = 1; k < xs.length; k++) if (xs[k] - xs[k - 1] > TAB_GAP) big++;
  return big >= 2 && big / (xs.length - 1) >= 0.5;
}

// 把散布的 x 聚成列锚点（相距 <=38 的归并，取加权均值）
function clusterAnchors(sortedX: number[], minN: number): number[] {
  const bands: { x: number; n: number }[] = [];
  for (const x of sortedX) {
    const b = bands[bands.length - 1];
    if (b && x - b.x <= 38) {
      b.x = Math.round((b.x * b.n + x) / (b.n + 1));
      b.n++;
    } else bands.push({ x, n: 1 });
  }
  return bands.filter((b) => b.n >= minN).map((b) => b.x);
}

// 尝试从 lines[i] 开始识别一张表格；成功返回 Markdown 与消耗的行下标，失败返回 null
function tryTable(
  lines: PdfLine[],
  i: number,
  bodyH: number,
): { md: string; end: number } | null {
  const header = lines[i];
  const hxs = header.items.map((it) => it.x).sort((a, b) => a - b);
  if (!isMove(hxs)) return null; // 表头必须横向多列
  if (header.h < bodyH * 0.8 || header.h > bodyH * 1.15) return null;

  // 收集可能属于表格的区域：字号处于正文 ± 合理范围的连续行
  const region: PdfLine[] = [];
  let j = i + 1;
  while (j < lines.length) {
    const h = lines[j].h;
    if (h < bodyH * 0.72 || h > bodyH * 1.1) break;
    region.push(lines[j]);
    j++;
  }

  // 列锚点：表头首列 + 区域内所有「多列行」的首列，聚类归并
  const pool: number[] = [];
  for (const cl of colClusters(header.items)) pool.push(cl.first);
  for (const ln of region) {
    const xs = ln.items.map((it) => it.x).sort((a, b) => a - b);
    if (isMove(xs)) for (const cl of colClusters(ln.items)) pool.push(cl.first);
  }
  const anchors = clusterAnchors([...pool].sort((a, b) => a - b), 2);
  if (anchors.length < 2) return null;

  const anchorOf = (x: number): number => {
    let b = 0,
      bd = 1e9;
    anchors.forEach((a, idx) => {
      const d = Math.abs(a - x);
      if (d < bd) {
        bd = d;
        b = idx;
      }
    });
    return b;
  };
  const col0 = anchors[0];
  const col1 = anchors[1] ?? col0;
  const mid01 = (col0 + col1) / 2; // 列0(标签)与列1(数据)的分界中点
  // 若列1为符号列（值为 ●◐○ 等单字符标记），则标签换行碎片一律归属列0；
  // 用略小于列1锚点的分界避开亚像素抖动
  const col1IsSymbol = region.some(
    (ln) =>
      ln.items.some(
        (it) => anchorOf(it.x) === 1 && it.s.length <= 1 && '●○◐'.includes(it.s),
      ),
  );
  const thr = col1IsSymbol ? col1 - 4 : mid01;
  const route = (x: number): number => (x < thr ? 0 : anchorOf(x));

  // 表头单元格
  const headerCells = new Array(anchors.length).fill('');
  for (const it of header.items) headerCells[anchorOf(it.x)] += it.s;
  const nonEmptyH = headerCells.filter(Boolean);
  if (nonEmptyH.length < 2) return null;
  if (nonEmptyH.some((c) => c.length > 8)) return null; // 表头必须为短标签
  const isSymbol = (c: string): boolean => c === '●' || c === '○' || c === '◐';
  // 若非列0的表头全是符号 → 实为跨页续表的首个数据行，把表头行当数据行使用
  const headerIsData =
    nonEmptyH.length > 1 &&
    nonEmptyH.slice(1).every((c) => [...c].every(isSymbol));

  // 数据行
  const rows: string[][] = [];
  let cur: string[] | null = null;
  let prevY = header.y;
  let consumed = 0;
  let ended = false;
  let rowMarkers = 0;
  let compactRows = 0;
  if (headerIsData) {
    cur = headerCells.slice();
    rowMarkers++;
    if (cur.every((c) => !c || c.length <= 30)) compactRows++;
  }
  for (const ln of region) {
    if (ended) break;
    const minX = Math.min(...ln.items.map((it) => it.x));
    // 段落缩进明显左于列0 → 表格结束
    if (minX < col0 - 4) {
      ended = true;
      break;
    }
    const its = [...ln.items].sort((a, b) => a.x - b.x);
    const hasCol0 = its.some((it) => anchorOf(it.x) === 0);
    const hasFar = its.some((it) => anchorOf(it.x) >= 2);
    const gap = prevY - ln.y;
    if (hasCol0 && hasFar) {
      // 真正的数据行：含列0标签 + 远列内容
      if (cur) rows.push(cur);
      cur = new Array(anchors.length).fill('');
      for (const it of its) cur[route(it.x)] += it.s;
      rowMarkers++;
      if (cur.every((c) => !c || c.length <= 30)) compactRows++;
      consumed++;
      prevY = ln.y;
    } else if (!cur) {
      ended = true;
      break;
    } else if (gap <= TAB_CONT) {
      // 续行：按分界路由到对应列
      for (const it of its) cur[route(it.x)] += it.s;
      consumed++;
      prevY = ln.y;
    } else {
      ended = true;
    }
  }
  if (cur) rows.push(cur);
  if (rowMarkers < 2) return null; // 至少 2 个数据行
  if (compactRows / rowMarkers < 0.7) return null; // 数据行须紧凑，拒绝段落误判

  const esc = (s: string | undefined): string =>
    (s || '').replace(/\|/g, '\\|').trim();
  const head = anchors.map((_, k) => esc(headerCells[k]));
  const md =
    '| ' +
    head.join(' | ') +
    ' |\n|' +
    anchors.map(() => '---').join('|') +
    '|\n' +
    rows.map((r) => '| ' + r.map((c) => esc(c)).join(' | ') + ' |').join('\n');
  return { md, end: i + consumed };
}

async function parsePdf(buf: ArrayBuffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?worker');
  pdfjs.GlobalWorkerOptions.workerPort = new worker.default();

  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;

  // 第一遍：抽取全部行（每页自上而下），供统计正文字号
  const pagesLines: PdfLine[][] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const items: PdfItem[] = tc.items
      .filter((i) => 'str' in i && !!i.str.trim())
      .map((it) => ({
        s: (it as { str: string }).str as string,
        x: (it as { transform: number[] }).transform[4] as number,
        y: (it as { transform: number[] }).transform[5] as number,
        h: (it as { height?: number }).height || 0,
      }));

    // 同一行：Y 相差 <=2（基线一致）
    const raw: { y: number; items: PdfItem[] }[] = [];
    for (const it of items) {
      let line = raw.find((l) => Math.abs(l.y - it.y) <= 2);
      if (!line) {
        line = { y: it.y, items: [] };
        raw.push(line);
      }
      line.items.push(it);
    }

    // 行内按 X 排序拼接（空白项视为空格；避免 Latin 与中文粘连误加空格）
    const lines: PdfLine[] = raw
      .map((ln) => {
        ln.items.sort((a, b) => a.x - b.x);
        let t = '';
        for (const it of ln.items) {
          if (!it.s.trim()) {
            if (t && !/\s$/.test(t)) t += ' ';
            continue;
          }
          t += it.s;
        }
        t = t.replace(/^\s+|\s+$/g, '');
        if (!t) return null;
        const h =
          ln.items
            .map((i) => i.h)
            .sort((a, b) => b - a)[Math.floor(ln.items.length / 2)] || 0;
        return { y: ln.y, h, items: [...ln.items], text: t };
      })
      .filter((l): l is PdfLine => !!l)
      // 自上而下：Y 降序
      .sort((a, b) => b.y - a.y);
    pagesLines.push(lines);
  }

  // 正文字号 = 所有行字号中的众数（出现最多的字号）
  const freq = new Map<number, number>();
  for (const pl of pagesLines)
    for (const l of pl) freq.set(round(l.h), (freq.get(round(l.h)) || 0) + 1);
  let bodyH = round(12);
  let best = -1;
  for (const [h, c] of freq) {
    if (c > best) {
      best = c;
      bodyH = h;
    }
  }
  if (!bodyH) bodyH = 12;

  // 第二遍：优先识别表格；其余行按相对字号定标题层级 + 按行距断折段落
  // 返回 -1=跳过（页脚/极小声明），0=正文段落，1/2/3=标题层级
  const lineKind = (h: number): -1 | 0 | 1 | 2 | 3 => {
    const r = h / bodyH;
    if (r < 0.72) return -1; // 页脚/极小注释：直接跳过
    if (r >= 1.85) return 1;
    if (r >= 1.35) return 2;
    if (r >= 1.08) return 3;
    return 0;
  };

  const out: string[] = [];
  const LIST_RE = /^\s*[•▪●◦‣∙・▪━«»►]*\s*([•●○◐]|[-\d]+[、．.)）])/;

  for (const pl of pagesLines) {
    let para: string[] = [];
    let prevY: number | null = null;
    const flushPara = () => {
      if (para.length) {
        out.push(para.join(' '));
        para = [];
      }
    };
    let idx = 0;
    while (idx < pl.length) {
      // 表格识别优先：识别成功则整块输出 Markdown 表格并跳过
      const t = tryTable(pl, idx, bodyH);
      if (t) {
        flushPara();
        out.push(t.md);
        prevY = null;
        idx = t.end + 1;
        continue;
      }
      const l = pl[idx];
      const kind = lineKind(l.h);
      if (kind === -1) {
        idx++;
        continue; // 页脚页码等，跳过
      }
      const gap = prevY === null ? 0 : prevY - l.y; // 行距（小=续行，大=段间）
      prevY = l.y;

      if (kind > 0) {
        flushPara();
        out.push('#'.repeat(kind) + ' ' + l.text);
        idx++;
        continue;
      }

      // 正文：列表行单独成项，否则并入段落（行距过小视为同一段续行）
      if (LIST_RE.test(l.text)) {
        flushPara();
        out.push('- ' + l.text);
        idx++;
        continue;
      }
      if (gap > bodyH * 1.35) flushPara(); // 段间留白 → 新段落
      para.push(l.text);
      idx++;
    }
    flushPara();
    out.push(''); // 页间空行
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function round(n: number): number {
  // 字号聚类到 0.5 步长，抵消浮点/渲染差异
  return Math.round(n * 2) / 2;
}

export interface ImportResult {
  title: string;
  markdown: string;
}

export const IMPORT_ACCEPT = '.md,.markdown,.pdf,.doc,.docx';

export async function parseDocFile(file: File): Promise<ImportResult> {
  const ext = (file.name.split('.').pop() ?? '').toLowerCase();
  const title = titleFromName(file.name);

  if (ext === 'md' || ext === 'markdown') {
    const text = await file.text();
    return { title, markdown: text || '' };
  }

  const buf = await file.arrayBuffer();

  if (ext === 'doc' || ext === 'docx') {
    let md = '';
    try {
      md = await parseDocx(buf);
    } catch {
      // 旧版 .doc（真实二进制）不作为 docx 处理时 fallback 到原始文本
      const raw = await file.text();
      md = raw.trim();
    }
    if (!md.trim()) throw new Error('无法解析该 Word 文档（仅支持 .docx）');
    return { title, markdown: md };
  }

  if (ext === 'pdf') {
    const md = await parsePdf(buf);
    if (!md.trim()) throw new Error('PDF 未提取到可导入的文本');
    return { title, markdown: md };
  }

  throw new Error('不支持的文件类型');
}