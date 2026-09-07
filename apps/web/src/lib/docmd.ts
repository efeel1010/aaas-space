import { marked } from 'marked';
import DOMPurify from 'dompurify';
import katex from 'katex';
import 'katex/dist/katex.min.css';

marked.setOptions({ gfm: true, breaks: true });

// ===== DOMPurify 安全配置 =====
const SAFE_STYLE =
  /^(color|background|background-color|text-align|width|min-width|max-width|padding|margin|border|border-radius|font-size|font-weight|line-height|vertical-align|flex|gap|display|--callout-fg|--callout-bg|--callout-border)$/i;

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node instanceof Element && node.hasAttribute('style')) {
    const style = node.getAttribute('style') || '';
    const clean = style
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const idx = s.indexOf(':');
        if (idx === -1) return null;
        const prop = s.slice(0, idx).trim();
        const val = s.slice(idx + 1).trim();
        if (!SAFE_STYLE.test(prop)) return null;
        if (/url\s*\(|expression|javascript:|vbscript:/i.test(val)) return null;
        return `${prop}:${val}`;
      })
      .filter(Boolean)
      .join(';');
    if (clean) node.setAttribute('style', clean);
    else node.removeAttribute('style');
  }
});

// ===== KaTeX 渲染 =====
function renderTex(latex: string, display: boolean): string {
  try {
    return katex.renderToString(latex, {
      throwOnError: false,
      displayMode: display,
      output: 'html',
      strict: false,
    });
  } catch {
    return `<code>${latex}</code>`;
  }
}

// ===== 高亮块 / 倒计时 颜色 =====
export const CALLOUT_COLORS: Record<string, { fg: string; bg: string; border: string }> = {
  blue: { fg: '#1a56db', bg: '#e8f0ff', border: '#bcd3ff' },
  green: { fg: '#0e8a5f', bg: '#e6f7f0', border: '#b8e6d3' },
  red: { fg: '#d92d20', bg: '#fdecec', border: '#f6c6c6' },
  orange: { fg: '#b25e09', bg: '#fdf2e4', border: '#f3d9ae' },
  purple: { fg: '#6d28d9', bg: '#f1ecfe', border: '#d8c8fb' },
  gray: { fg: '#5b6472', bg: '#f0f2f5', border: '#d6dae1' },
  cyan: { fg: '#0e7490', bg: '#e6f7fb', border: '#b6e6f3' },
};

// ===== 行级处理：下划线（单波浪线）/ 公式 / 提及 / 双向链接 =====
function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderInlineLatex(src: string): string {
  // 块级公式 $$...$$（已由 renderMarkdown 先行处理，这里处理行内 $...$）
  return src.replace(/(?<![A-Za-z0-9])\$([^$\n]+?)\$(?![A-Za-z0-9])/g, (_m, latex: string) => {
    const t = latex.trim();
    if (!t || t.length > 200) return _m;
    return `<span class="katex-inline" data-latex="${escapeAttr(t)}">${renderTex(t, false)}</span>`;
  });
}

function renderUnderline(src: string): string {
  // 保护删除线 ~~...~~
  const protected_ = src.replace(/~~([^~]+?)~~/g, '\u0001$1\u0002');
  const underlined = protected_.replace(/~([^~\s][^~]*?)~/g, '<u>$1</u>');
  return underlined.replace(/\u0001([^\u0002]*?)\u0002/g, '~~$1~~');
}

function renderMentions(src: string): string {
  return src.replace(
    /(^|[\s(（>])@([\p{L}\p{N}_\-]{1,24})(?![\w@.\-])/gu,
    '$1<span class="mention" data-mention="$2">@$2</span>',
  );
}

function renderWikiLinks(src: string): string {
  let out = src.replace(
    /\[\[([^\]]+)\]\]\((\/[^)\s]+)\)/g,
    '<a class="wiki-link" href="$2">$1</a>',
  );
  out = out.replace(
    /\[\[([^\]]{1,40})\]\]/g,
    '<span class="wiki-link" data-wiki="$1">[[$1]]</span>',
  );
  return out;
}

// ===== 顶层标题收集（供目录 / 大纲 / 演示使用） =====
export interface DocHeading {
  level: number;
  text: string;
  index: number; // 在源码中的字符偏移
}

export function extractHeadings(src: string): DocHeading[] {
  const out: DocHeading[] = [];
  const re = /^(#{1,6})\s+(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    out.push({ level: m[1].length, text: m[2].trim(), index: m.index });
  }
  return out;
}

function slugify(text: string, idx: number): string {
  const base = text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\u4e00-\u9fa5]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${base || 'section'}-${idx}`;
}

function buildToc(headings: DocHeading[]): string {
  if (headings.length === 0) return '<p class="toc-empty">暂无标题</p>';
  return (
    '<div class="doc-toc"><div class="toc-title">目录</div><ul>' +
    headings
      .map(
        (h) =>
          `<li style="padding-left:${(h.level - 1) * 14}px"><a href="#${slugify(h.text, h.index)}">${h.text}</a></li>`,
      )
      .join('') +
    '</ul></div>'
  );
}

// ===== 思维导图：::: mindmap（缩进树 → 嵌套列表渲染） =====
interface MmNode {
  text: string;
  children: MmNode[];
}

function renderMindmap(body: string): string {
  const lines = body.split('\n');
  const root: MmNode[] = [];
  const stack: { indent: number; node: MmNode }[] = [];
  for (const raw of lines) {
    const t = raw.trim();
    if (!t) continue;
    const indent = raw.search(/\S/);
    const text = t.replace(/^[-*•]\s*/, '');
    const node: MmNode = { text, children: [] };
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    if (stack.length) stack[stack.length - 1].node.children.push(node);
    else root.push(node);
    stack.push({ indent, node });
  }
  const rec = (nodes: MmNode[]): string =>
    '<ul>' +
    nodes.map((n) => `<li><span>${n.text}</span>${n.children.length ? rec(n.children) : ''}</li>`).join('') +
    '</ul>';
  return `<div class="mindmap"><div class="mindmap-tree">${rec(root)}</div></div>`;
}

// ===== 冒号围栏：高亮块 / 倒计时 / 分栏 / 思维导图 =====
function renderFenced(src: string): string {
  const re = /^:::[^\n]*\n[\s\S]*?^:::$/gm;
  return src.replace(re, (block) => {
    const lines = block.split('\n');
    const meta = lines[0].replace(/^:::\s*/, '').trim();
    const body = lines.slice(1, -1).join('\n');

    // 倒计时：::: timer 2026-12-31 18:00
    if (/^timer\s+/i.test(meta)) {
      const target = meta.replace(/^timer\s+/i, '').trim();
      const t = new Date(target.replace(' ', 'T'));
      if (isNaN(t.getTime())) return block;
      return `<div class="timer-block" data-timer-end="${t.toISOString()}"><span class="timer-label">⏳ 倒计时</span><span class="timer-value">—</span><div class="timer-note">${renderFencedInner(body)}</div></div>`;
    }

    // 思维导图：::: mindmap
    if (/^mindmap\s*$/i.test(meta)) {
      return renderMindmap(body);
    }

    // 分栏：::: columns 2
    if (/^columns\s*\d*$/i.test(meta)) {
      const n = Math.min(10, Math.max(2, parseInt((meta.match(/\d+/) || ['2'])[0], 10)));
      const cols = body
        .split(/\n\s*===+\s*\n/)
        .map((c) => `<div class="doc-col">${renderFencedInner(c)}</div>`)
        .join('');
      for (let i = cols.length / 6; i < n; i++) {
        // 用占位补足栏数
      }
      return `<div class="doc-cols" style="--cols:${n}">${cols}</div>`;
    }

    // 高亮块：::: 💡 blue（颜色可省略）
    const [emoji, color] = meta.split(/\s+/);
    const c = CALLOUT_COLORS[color] ?? CALLOUT_COLORS.blue;
    const icon = emoji && emoji !== 'callout' && !CALLOUT_COLORS[emoji] ? emoji : '💡';
    return `<div class="callout" style="--callout-fg:${c.fg};--callout-bg:${c.bg};--callout-border:${c.border}"><span class="callout-icon">${icon}</span><div class="callout-body">${renderFencedInner(body)}</div></div>`;
  });
}

function renderFencedInner(body: string): string {
  // 内部只做行内渲染，不递归围栏，避免无限嵌套
  return renderInlineLatex(renderUnderline(renderMentions(renderWikiLinks(body))));
}

// ===== 主渲染入口 =====
export function renderMarkdown(src: string): string {
  if (!src) return '';
  const headings = extractHeadings(src);

  let md = src;
  // 1. 围栏块（高亮块 / 倒计时 / 分栏）→ HTML
  md = renderFenced(md);
  // 2. 块级公式 $$...$$
  md = md.replace(/\$\$([\s\S]+?)\$\$/g, (_m, latex: string) => {
    const t = latex.trim();
    if (!t || t.length > 500) return _m;
    return `<div class="katex-block" data-latex="${escapeAttr(t)}">${renderTex(t, true)}</div>`;
  });
  // 3. 行内公式
  md = renderInlineLatex(md);
  // 4. 下划线
  md = renderUnderline(md);
  // 5. @ 提及
  md = renderMentions(md);
  // 6. 双向链接
  md = renderWikiLinks(md);
  // 7. 目录占位符 → 生成目录
  md = md.replace(/\[TOC\]/g, () => buildToc(headings));

  let html = marked.parse(md) as string;

  // 给标题添加锚点 id（顺序与 extractHeadings 一致）
  let idx = 0;
  html = html.replace(/<(h[1-6])([^>]*)>(.*?)<\/\1>/g, (whole, tag: string, attrs: string, text: string) => {
    const h = headings[idx];
    idx += 1;
    const id = h ? slugify(h.text, h.index) : `section-${idx}`;
    return `<${tag}${attrs} id="${id}"><a class="anchor" href="#${id}" title="复制锚点链接" data-anchor="#${id}">#</a>${text}</${tag}>`;
  });

  return DOMPurify.sanitize(html, {
    ADD_ATTR: [
      'style',
      'align',
      'data-timer-end',
      'data-mention',
      'data-wiki',
      'data-anchor',
      'data-latex',
    ],
    ADD_TAGS: ['video', 'audio', 'source', 'iframe'],
    USE_PROFILES: { html: true },
  });
}

// 演示模式：按标题切分文档为幻灯片
export function splitSlides(src: string): { title: string; level: number; content: string }[] {
  const lines = src.split('\n');
  const slides: { title: string; level: number; content: string[] }[] = [];
  let cur: { title: string; level: number; content: string[] } | null = null;
  for (const line of lines) {
    const m = line.match(/^(#{1,6})\s+(.+)$/);
    if (m && m[1].length <= 3) {
      if (cur && cur.content.some((l) => l.trim())) slides.push(cur);
      cur = { title: m[2].trim(), level: m[1].length, content: [] };
    } else if (cur) {
      cur.content.push(line);
    }
  }
  if (cur && cur.content.some((l) => l.trim())) slides.push(cur);
  if (slides.length === 0) {
    return [{ title: '演示文稿', level: 1, content: src }];
  }
  return slides.map((s) => ({ title: s.title, level: s.level, content: s.content.join('\n') }));
}

export { marked };
