// ===== 富文本（WYSIWYG）编辑工具：Markdown ⇄ 可编辑 HTML 双向转换 =====
import { renderMarkdown, CALLOUT_COLORS } from './docmd';

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return map[c] as string;
  });
}

const READONLY_SELECTORS = [
  '.callout',
  '.doc-cols',
  '.mindmap',
  '.timer-block',
  '.katex-block',
  '.doc-toc',
  '.video-embed',
  'pre',
  'video',
  'audio',
  'iframe',
];

// ===== Markdown → 可编辑 HTML（渲染 + 特殊块只读化 + 注入元数据） =====
export function markdownToEditableHtml(md: string): string {
  const raw = renderMarkdown(md);
  const doc = new DOMParser().parseFromString(raw, 'text/html');

  // 去掉标题锚点（编辑态不需要）
  doc.querySelectorAll('a.anchor').forEach((a) => a.remove());

  // 高亮块：注入 emoji / color 元数据，供转回 markdown 使用
  doc.querySelectorAll('.callout').forEach((c) => {
    const el = c as HTMLElement;
    const icon = el.querySelector('.callout-icon')?.textContent?.trim() || '💡';
    const bg = el.style.getPropertyValue('--callout-bg')?.trim();
    const color = Object.entries(CALLOUT_COLORS).find(([, v]) => v.bg === bg)?.[0] || 'blue';
    el.dataset.emoji = icon;
    el.dataset.color = color;
  });

  // 特殊块设为只读（防误编辑破坏结构）
  doc.querySelectorAll(READONLY_SELECTORS.join(',')).forEach((el) => {
    el.setAttribute('contenteditable', 'false');
  });

  return doc.body.innerHTML;
}

// ===== 行内节点 → 行内 markdown =====
function inlineMd(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();
  const children = Array.from(el.childNodes).map(inlineMd).join('');
  switch (tag) {
    case 'strong':
    case 'b':
      return `**${children}**`;
    case 'em':
    case 'i':
      return `*${children}*`;
    case 'u':
      return `<u>${children}</u>`;
    case 's':
    case 'del':
    case 'strike':
      return `~~${children}~~`;
    case 'mark':
      return `<mark>${children}</mark>`;
    case 'sub':
      return `<sub>${children}</sub>`;
    case 'sup':
      return `<sup>${children}</sup>`;
    case 'code':
      return '`' + (el.textContent ?? '') + '`';
    case 'a': {
      if (el.classList.contains('wiki-link')) {
        const href = el.getAttribute('href');
        const label = children;
        return href ? `[[${label}]](${href})` : `[[${label}]]`;
      }
      const href = el.getAttribute('href');
      return href ? `[${children}](${href})` : children;
    }
    case 'img': {
      return `![${el.getAttribute('alt') ?? ''}](${el.getAttribute('src') ?? ''})`;
    }
    case 'span':
      if (el.classList.contains('mention')) return `@${el.getAttribute('data-mention') ?? children}`;
      if (el.classList.contains('wiki-link')) {
        const w = el.getAttribute('data-wiki');
        return w ? `[[${w}]]` : children;
      }
      if (el.classList.contains('katex-inline')) {
        const latex = el.getAttribute('data-latex');
        return latex ? `$${latex}$` : children;
      }
      // 保留 markdown 无法表达的行内样式（颜色/字号等）：输出为 <span style>，否则保存时会丢失
      const preserve = [] as string[];
      if (el.style.color) preserve.push(`color:${el.style.color}`);
      if (el.style.fontSize) preserve.push(`font-size:${el.style.fontSize}`);
      if (preserve.length) {
        if (el.style.fontWeight === 'bold' || el.style.fontWeight === '700') preserve.push('font-weight:bold');
        if (el.style.fontStyle === 'italic') preserve.push('font-style:italic');
        const dec = el.style.textDecorationLine;
        if (dec?.includes('underline')) preserve.push('text-decoration-line:underline');
        if (dec?.includes('line-through')) preserve.push('text-decoration-line:line-through');
        if (el.style.backgroundColor) preserve.push(`background-color:${el.style.backgroundColor}`);
        return `<span style="${preserve.join(';')}">${children}</span>`;
      }
      // execCommand 可能产生单一格式的 span，转回 markdown 语法
      if (el.style.fontWeight === 'bold' || el.style.fontWeight === '700') return `**${children}**`;
      if (el.style.fontStyle === 'italic') return `*${children}*`;
      if (el.style.textDecorationLine?.includes('underline')) return `<u>${children}</u>`;
      if (el.style.textDecorationLine?.includes('line-through')) return `~~${children}~~`;
      if (el.style.backgroundColor) return `<mark>${children}</mark>`;
      return children;
    case 'br':
      return '\n';
    default:
      return children;
  }
}

// ===== 列表（含任务列表 / 嵌套）→ markdown =====
function listToMd(el: HTMLElement, depth: number): string {
  const ordered = el.tagName.toLowerCase() === 'ol';
  let idx = 1;
  const lines: string[] = [];
  for (const li of Array.from(el.children).filter((c) => c.tagName.toLowerCase() === 'li')) {
    const liEl = li as HTMLElement;
    const cb = liEl.querySelector(':scope > input[type="checkbox"]') as HTMLInputElement | null;
    const head = cb ? (cb.checked ? '- [x] ' : '- [ ] ') : ordered ? `${idx++}. ` : '- ';
    const indent = '  '.repeat(depth);
    // 收集非嵌套的文本内容
    let rest = '';
    for (const c of Array.from(liEl.childNodes)) {
      if (c === cb) continue;
      if (c.nodeType === Node.ELEMENT_NODE && ['UL', 'OL'].includes((c as HTMLElement).tagName)) continue;
      rest += inlineMd(c);
    }
    lines.push(indent + head + rest.trim());
    // 嵌套子列表
    for (const n of Array.from(liEl.children).filter((c) => ['UL', 'OL'].includes(c.tagName))) {
      lines.push(...listToMd(n as HTMLElement, depth + 1));
    }
  }
  return lines.join('\n');
}

// ===== 表格 → markdown =====
function tableToMd(el: HTMLElement): string {
  const rows: string[][] = [];
  el.querySelectorAll('tr').forEach((tr) => {
    const cells: string[] = [];
    tr.querySelectorAll(':scope > th, :scope > td').forEach((c) => {
      cells.push(inlineMd(c as HTMLElement).trim().replace(/\|/g, '\\|'));
    });
    if (cells.length) rows.push(cells);
  });
  if (!rows.length) return '';
  const width = Math.max(...rows.map((r) => r.length), 1);
  const pad = (cells: string[]) => Array.from({ length: width }, (_, i) => cells[i] ?? '');
  const lines = [
    '| ' + pad(rows[0]).join(' | ') + ' |',
    '| ' + pad([]).fill('---').join(' | ') + ' |',
  ];
  rows.slice(1).forEach((r) => lines.push('| ' + pad(r).join(' | ') + ' |'));
  return lines.join('\n');
}

// ===== 思维导图树 → 缩进行 =====
function walkMindmap(root: HTMLElement, out: string[]): void {
  const walk = (ul: Element, depth: number) => {
    for (const li of Array.from(ul.children).filter((c) => c.tagName.toLowerCase() === 'li')) {
      const span = li.querySelector(':scope > span');
      const text = (span ? span.textContent : li.textContent)?.trim() ?? '';
      out.push('  '.repeat(depth) + text);
      const nested = li.querySelector(':scope > ul');
      if (nested) walk(nested, depth + 1);
    }
  };
  const ul = root.querySelector(':scope > ul');
  if (ul) walk(ul, 0);
}

// ===== 块级元素 → markdown =====
function blockMd(el: HTMLElement): string {
  const tag = el.tagName.toLowerCase();

  // 特殊块（从元数据重建围栏语法）
  if (el.classList.contains('callout')) {
    const emoji = el.dataset.emoji || '💡';
    const color = el.dataset.color || 'blue';
    const bodyEl = el.querySelector('.callout-body');
    const inner = bodyEl ? contentToMd(bodyEl) : '';
    return `::: ${emoji} ${color}\n${inner}\n:::`;
  }
  if (el.classList.contains('doc-cols')) {
    const n = el.style.getPropertyValue('--cols')?.trim() || '2';
    const cols = Array.from(el.querySelectorAll(':scope > .doc-col')).map((c) => contentToMd(c as HTMLElement));
    return `::: columns ${n}\n${cols.join('\n===\n')}\n:::`;
  }
  if (el.classList.contains('mindmap')) {
    const lines: string[] = [];
    const tree = el.querySelector('.mindmap-tree');
    if (tree) walkMindmap(tree as HTMLElement, lines);
    return `::: mindmap\n${lines.join('\n')}\n:::`;
  }
  if (el.classList.contains('timer-block')) {
    const end = el.dataset.timerEnd || '';
    const noteEl = el.querySelector('.timer-note');
    const note = noteEl ? contentToMd(noteEl).replace(/\s*\n+\s*/g, ' ').trim() : '';
    return `::: timer ${end}\n${note}\n:::`;
  }
  if (el.classList.contains('katex-block')) {
    const latex = el.getAttribute('data-latex') ?? '';
    return `$$${latex}$$`;
  }

  const hm = tag.match(/^h([1-6])$/);
  if (hm) {
    const text = inlineMd(el).trim();
    const align = el.style.textAlign;
    const head = `${'#'.repeat(Number(hm[1]))} ${text}`;
    return align && align !== 'left' ? `<div style="text-align:${align}">\n${head}\n</div>` : head;
  }
  if (tag === 'pre') return '```\n' + (el.textContent ?? '').replace(/\n$/, '') + '\n```';
  if (tag === 'blockquote') {
    return contentToMd(el)
      .split('\n')
      .map((l) => (l ? `> ${l}` : '>'))
      .join('\n');
  }
  if (tag === 'ul' || tag === 'ol') return listToMd(el, 0);
  if (tag === 'table') return tableToMd(el);
  if (tag === 'hr') return '---';
  if (tag === 'video') return `<video controls src="${el.getAttribute('src') ?? ''}"></video>`;
  if (tag === 'audio') return `<audio controls src="${el.getAttribute('src') ?? ''}"></audio>`;
  if (el.classList.contains('video-embed')) {
    const iframe = el.querySelector('iframe');
    return `<div class="video-embed"><iframe src="${iframe?.getAttribute('src') ?? ''}" allowfullscreen></iframe></div>`;
  }

  // 普通块：段落 / div / li
  const align = el.style.textAlign;
  const inner = contentToMd(el).trim();
  if (!inner) return '';
  if (align && align !== 'left') return `<div style="text-align:${align}">\n${inner}\n</div>`;
  return inner;
}

// ===== 容器内所有块 → markdown（块间以空行分隔） =====
// 行内元素（含文本），需用 inlineMd 保留格式合并到同一行；
// 其余块级元素独立成块，块间以空行分隔。
const INLINE_TAGS = new Set([
  'SPAN', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'DEL', 'STRIKE',
  'MARK', 'SUB', 'SUP', 'CODE', 'A', 'IMG', 'BR',
]);

function isInlineTag(el: HTMLElement): boolean {
  return INLINE_TAGS.has(el.tagName);
}

function contentToMd(root: Element): string {
  const out: string[] = [];
  let line = '';
  const flushLine = () => {
    const t = line.replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\s+$/g, '').trim();
    if (t) out.push(t);
    line = '';
  };
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      line += node.textContent ?? '';
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const el = node as HTMLElement;
    if (isInlineTag(el)) {
      line += inlineMd(el);
      continue;
    }
    flushLine();
    const b = blockMd(el);
    if (b) out.push(b);
  }
  flushLine();
  return out.join('\n\n');
}

// ===== 可编辑 HTML → Markdown =====
export function editableHtmlToMarkdown(html: string): string {
  const doc = new DOMParser().parseFromString(html || '<p></p>', 'text/html');
  return contentToMd(doc.body);
}

// ===== DOM 辅助（光标定位 / 选区包裹 / 插入 HTML） =====
export function getCaretRect(relativeTo: Element): { left: number; top: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  const rects = range.getClientRects();
  const r = rects.length ? rects[0] : range.getBoundingClientRect();
  const base = relativeTo.getBoundingClientRect();
  return { left: r.left - base.left, top: r.top - base.top + 20 };
}

// 用 html 包裹当前选区（选中文本会保留文字，格式被替换）
export function wrapSelection(before: string, after: string): void {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
    document.execCommand('insertText', false, before + after);
    return;
  }
  const text = sel.toString();
  if (!text) {
    document.execCommand('insertText', false, before + after);
    return;
  }
  document.execCommand('insertHTML', false, `${before}${escapeHtml(text)}${after}`);
}

// 在光标处插入 HTML
export function insertHtmlAtCaret(html: string): void {
  document.execCommand('insertHTML', false, html);
}

// 在选中的所有文本节点外层包一层带样式 span（用于设置精确字号等）。
// 新样式包在里层，CSS 就近覆盖旧值；恢复正常选区，便于格式工具连续操作。
export function applyInlineStyle(cssText: string): void {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  if (range.collapsed) return; // 无选中内容则不生效
  const frag = range.extractContents();
  const created: HTMLElement[] = [];
  const wrap = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      if (!node.textContent) return;
      const span = document.createElement('span');
      const prev = span.style.cssText;
      span.style.cssText = `${prev}${prev ? ';' : ''}${cssText}`;
      span.appendChild(node.cloneNode(false));
      node.parentNode!.replaceChild(span, node);
      created.push(span);
    } else {
      Array.from(node.childNodes).forEach(wrap);
    }
  };
  wrap(frag);
  range.insertNode(frag);
  // 关键：不能对已脱离文档的 frag 做 selectNodeContents —— insertNode 后 frag 的
  // parentNode 为 null，后续按选区找块（formatRichBlockTag）会因 startContainer 不在文档内而失效。
  // 改为选中已插入到文档中的真实 span，保证选区非塌陷、且从选区向上能找到块元素。
  if (created.length) {
    const r = document.createRange();
    r.setStartBefore(created[0]);
    r.setEndAfter(created[created.length - 1]);
    sel.removeAllRanges();
    sel.addRange(r);
  }
}

// 富文本内容 → 纯文本（统计用）
export function richTextContent(container: HTMLElement): string {
  return (container.textContent ?? '').replace(/\u00a0/g, ' ');
}

// 移除块内所有 `<span>` 上的行内 font-size，让块级样式（如标题字号）接管。
// 用于「最后一次选择的格式生效」：转标题后，标题字号压过先前设置的字号。
export function stripInlineFontSize(root: HTMLElement): void {
  root.querySelectorAll('span[style]').forEach((s) => {
    (s as HTMLElement).style.removeProperty('font-size');
  });
}

// ===== 回车拆块 =====

// 普通块级标签（拆分时按同类型重建）
export const RICH_BLOCK_TAGS = ['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'PRE'];

// 返回光标当前所在块级标签名（如 P/DIV/H2）；光标落在分割线/空白/边界等无块处返回 null
export function getCurrentBlockTag(editor: HTMLElement): string | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  let node: Node | null = sel.getRangeAt(0).startContainer;
  while (node && node !== editor) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const e = node as HTMLElement;
      if (!e.isContentEditable) return null;
      if (RICH_BLOCK_TAGS.includes(e.tagName)) return e.tagName;
    }
    node = node.parentNode;
  }
  return null;
}

// 光标是否位于表格单元格（<td>/<th>）内——用于决定回车用软换行而非新建段落，避免破坏表格结构
export function isInsideTableCell(editor: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  let node: Node | null = sel.getRangeAt(0).startContainer;
  while (node && node !== editor) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const tag = (node as HTMLElement).tagName;
      if (tag === 'TD' || tag === 'TH') return true;
    }
    node = node.parentNode;
  }
  return false;
}

// 回车拆块结果：ok=已成功拆分；complex=复杂块（列表/引用/代码/表格）交由浏览器默认；none=找不到可编辑块（多为光标落在分割线等边界/空白处）
export type SplitBlockResult = 'ok' | 'complex' | 'none';

// 在光标处拆分当前块（回车时调用）：光标后内容移到新块，标题内回车 → 新正文段落
export function splitRichBlockAtCaret(editor: HTMLElement): SplitBlockResult {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return 'none';
  const range = sel.getRangeAt(0);
  let node: Node | null = range.startContainer;
  let block: HTMLElement | null = null;
  while (node && node !== editor) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const e = node as HTMLElement;
      if (!e.isContentEditable) return 'none';
      if (RICH_BLOCK_TAGS.includes(e.tagName)) {
        block = e;
        break;
      }
    }
    node = node.parentNode;
  }
  if (!block) return 'none';
  // 复杂块（列表/引用/代码/表格）交给浏览器默认行为
  if (['BLOCKQUOTE', 'PRE', 'LI', 'TABLE'].includes(block.tagName)) return 'complex';
  const doc = block.ownerDocument;
  // 提取光标后的内容
  const after = doc.createRange();
  after.selectNodeContents(block);
  after.setStart(range.startContainer, range.startOffset);
  const afterFrag = after.extractContents();
  // 标题内回车 → 正文段落；段落/div → 同类型
  const newTag = /^H[1-6]$/.test(block.tagName) ? 'P' : block.tagName;
  const newBlock = doc.createElement(newTag);
  newBlock.appendChild(afterFrag);
  block.parentNode?.insertBefore(newBlock, block.nextSibling);
  // 光标移到新块开头
  const r = doc.createRange();
  r.setStart(newBlock, 0);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
  editor.dispatchEvent(new Event('input', { bubbles: true }));
  return 'ok';
}

// ===== 选择性粘贴 =====

// 「匹配格式」保留的结构化标签：标题/段落/列表/引用/代码/表格/行内格式等
const PASTE_KEEP_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'br', 'hr',
  'ul', 'ol', 'li',
  'blockquote', 'pre', 'code',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'a', 'img',
  'strong', 'b', 'em', 'i', 'u', 's', 'del', 'strike', 'mark', 'sub', 'sup', 'span',
  'div', 'section', 'figure', 'figcaption',
]);

// 「匹配格式」：把外部复制内容清洗成当前 pulse 文档格式
//  - 去掉内联样式（字号/颜色/字体等继承当前文档主题）
//  - 保留标题/列表/引用/代码/表格等结构（目录大纲可识别）
//  - 移除 script/style 及 Word/网页粘贴的垃圾节点与危险链接
export function normalizePasteHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  // 移除无意义/危险的顶层内容
  doc.querySelectorAll('script,style,head,meta,link,title,iframe,object,embed,svg,math').forEach((el) => el.remove());

  const all = Array.from(doc.body.querySelectorAll('*'));
  for (const el of all) {
    const tag = el.tagName.toLowerCase();

    // Word 粘贴垃圾（o:p 等命名空间元素）
    if (tag.includes(':') || tag === 'font') {
      unwrap(el);
      continue;
    }
    if (!PASTE_KEEP_TAGS.has(tag)) {
      unwrap(el);
      continue;
    }

    // 仅保留有意义的属性，去掉内联样式/类名 → 让内容跟随文档主题
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name;
      if (name === 'href' || name === 'src' || name === 'alt' || name === 'target' || name === 'colspan' || name === 'rowspan') continue;
      el.removeAttribute(name);
    }
    if (el.tagName === 'A') {
      const href = el.getAttribute('href');
      if (href && !/^(https?:)?\/\//i.test(href) && !href.startsWith('/') && !href.startsWith('#') && !href.startsWith('mailto:') && !href.startsWith('tel:')) {
        el.removeAttribute('href');
      }
    }
  }

  // 匹配格式：识别 Markdown 标题语法（# / ## …）的段落，转为真正的标题标签（供文档大纲识别）
  // 仅处理首节点为纯文本的 p/div，避免破坏复杂嵌套结构
  for (const el of Array.from(doc.body.querySelectorAll('p, div'))) {
    if (el.firstChild?.nodeType !== Node.TEXT_NODE) continue;
    const m = (el.textContent ?? '').match(/^\s*(#{1,6})\s+([\s\S]+)$/);
    if (!m) continue;
    const level = Math.min(m[1].length, 6);
    const h = doc.createElement(`h${level}`);
    h.innerHTML = el.innerHTML.replace(/^\s*#{1,6}\s+/, '');
    el.replaceWith(h);
  }

  return doc.body.innerHTML;
}

// 把元素替换为其子节点（清洗「不允许的标签」时用）
function unwrap(el: Element) {
  el.replaceWith(...Array.from(el.childNodes));
}

// 「仅保留文本」：纯文本 → 段落结构（空行分段，单换行转 <br>）
export function plainTextToHtml(text: string): string {
  const t = text.replace(/\r\n?/g, '\n');
  return t
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p.trim()).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

// ===== 表格编辑辅助 =====

// 生成一个 R×C 的表格 HTML（首行为表头），列宽均分，供插入使用
export function tableHtml(rows: number, cols: number): string {
  const safeR = Math.max(1, Math.min(rows, 9));
  const safeC = Math.max(1, Math.min(cols, 9));
  const base = Math.round(720 / safeC);
  let html = `<table><colgroup>${Array.from({ length: safeC })
    .map(() => `<col style="width:${base}px">`)
    .join('')}</colgroup><thead><tr>`;
  for (let c = 0; c < safeC; c++) html += '<th><br></th>';
  html += '</tr></thead><tbody>';
  for (let r = 1; r < safeR; r++) {
    html += '<tr>';
    for (let c = 0; c < safeC; c++) html += '<td><br></td>';
    html += '</tr>';
  }
  html += '</tbody></table>';
  return html;
}

// 光标所在单元格（<td>/<th>），未在表格内返回 null
export function currentTableCell(editor: HTMLElement): HTMLElement | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  let node: Node | null = sel.getRangeAt(0).startContainer;
  while (node && node !== editor) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (el.tagName === 'TD' || el.tagName === 'TH') return el;
    }
    node = node.parentNode;
  }
  return null;
}

// 所在表格（可能为 null）
export function cellTable(cell: HTMLElement): HTMLTableElement | null {
  return cell.closest('table');
}

// 单元格所在的列索引（0 起）
export function cellColumnIndex(cell: HTMLElement): number {
  let idx = -1;
  let sib: Element | null = cell;
  while (sib) {
    if (sib.tagName === 'TD' || sib.tagName === 'TH') idx++;
    sib = sib.previousElementSibling;
  }
  return Math.max(0, idx);
}

// 表格列数
export function tableColumnCount(table: HTMLElement): number {
  const firstRow = table.querySelector('thead tr, tbody tr');
  return firstRow ? firstRow.querySelectorAll(':scope > th, :scope > td').length : 0;
}

// 同步/补齐 <colgroup>，确保列数与表格一致并给缺省宽度（用于固定布局与列宽拖拽）
export function syncColgroup(table: HTMLTableElement): void {
  const cols = tableColumnCount(table);
  if (cols <= 0) return;
  let cg = table.querySelector(':scope > colgroup') as HTMLElement | null;
  if (!cg) {
    cg = document.createElement('colgroup');
    table.insertBefore(cg, table.firstChild);
  }
  const colsEl = Array.from(cg.querySelectorAll<HTMLElement>(':scope > col'));
  while (colsEl.length < cols) {
    const c = document.createElement('col');
    cg.appendChild(c);
    colsEl.push(c);
  }
  while (colsEl.length > cols) colsEl.pop()!.remove();
  const base = Math.round(720 / cols);
  colsEl.forEach((col) => {
    if (!col.style.width) col.style.width = `${base}px`;
  });
}

// 在某列两侧插入一列（offset=-1 左侧，1 右侧）；cell 为当前单元格
export function tableInsertColumn(cell: HTMLElement, offset: -1 | 1): void {
  const table = cellTable(cell);
  if (!table) return;
  const idx = cellColumnIndex(cell);
  const at = offset === -1 ? idx : idx + 1;
  table
    .querySelectorAll('tr')
    .forEach((tr) => {
      const isHead = tr.parentElement?.tagName === 'THEAD';
      const c = document.createElement(isHead ? 'th' : 'td');
      c.innerHTML = '<br>';
      const ref = tr.children[at];
      if (ref) tr.insertBefore(c, ref);
      else tr.appendChild(c);
    });
  syncColgroup(table);
}

// 删除当前列
export function tableRemoveColumn(cell: HTMLElement): void {
  const table = cellTable(cell);
  if (!table) return;
  const idx = cellColumnIndex(cell);
  if (tableColumnCount(table) <= 1) return; // 至少保留一列
  table.querySelectorAll('tr').forEach((tr) => {
    const cells = tr.querySelectorAll(':scope > th, :scope > td');
    if (idx < cells.length) cells[idx].remove();
  });
  if (!table.querySelector('tr')) table.remove();
  else syncColgroup(table);
}

// 在当前行上方/下方插入一行（offset=-1 上方，1 下方）
export function tableInsertRow(cell: HTMLElement, offset: -1 | 1): void {
  const table = cellTable(cell);
  if (!table) return;
  const tr = cell.parentElement as HTMLTableRowElement;
  const cols = tableColumnCount(table);
  const row = document.createElement('tr');
  for (let c = 0; c < cols; c++) {
    const td = document.createElement('td');
    td.innerHTML = '<br>';
    row.appendChild(td);
  }
  if (offset === -1) tr.parentElement?.insertBefore(row, tr);
  else tr.insertAdjacentElement('afterend', row);
}

// 删除当前行
export function tableRemoveRow(cell: HTMLElement): void {
  const table = cellTable(cell);
  if (!table) return;
  const tr = cell.parentElement as HTMLTableRowElement;
  tr.remove();
  if (!table.querySelector('tr')) table.remove();
}

// 删除整个表格
export function tableRemove(table: HTMLElement): void {
  table.remove();
}

// 把光标放置到表格首个可编辑单元格，便于立即输入
export function focusFirstCell(table: HTMLElement): void {
  const cell = table.querySelector('th, td');
  if (!cell) return;
  const r = document.createRange();
  r.setStart(cell, 0);
  r.collapse(true);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(r);
}
