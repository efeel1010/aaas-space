// ===== 文档编辑工具：Markdown 文本操作 + 斜杠命令 + 快捷键 =====

export interface SlashCommand {
  key: string;
  label: string;
  icon: string;
  aliases: string[]; // 拼音 / 缩写 / 英文
  hint: string;
  run: () => void;
}

// 在 textarea 选区处包装行内语法
export function applyInline(
  content: string,
  setContent: (v: string) => void,
  ta: HTMLTextAreaElement | null,
  before: string,
  after = before,
  placeholder = '文本',
) {
  if (!ta) return;
  const s = ta.selectionStart;
  const e = ta.selectionEnd;
  const sel = content.slice(s, e) || placeholder;
  const next = content.slice(0, s) + before + sel + after + content.slice(e);
  setContent(next);
  requestAnimationFrame(() => {
    ta.focus();
    ta.selectionStart = s + before.length;
    ta.selectionEnd = s + before.length + sel.length;
  });
}

// 对整行（或多行选区覆盖的行）做块级变换
export function applyBlock(
  content: string,
  setContent: (v: string) => void,
  ta: HTMLTextAreaElement | null,
  fn: (block: string) => string,
) {
  if (!ta) return;
  const s = ta.selectionStart;
  const e = ta.selectionEnd;
  const lineStart = content.lastIndexOf('\n', s - 1) + 1;
  const nl = content.indexOf('\n', e);
  const lineEnd = nl === -1 ? content.length : nl;
  const block = content.slice(lineStart, lineEnd);
  const nextBlock = fn(block);
  const next = content.slice(0, lineStart) + nextBlock + content.slice(lineEnd);
  setContent(next);
  requestAnimationFrame(() => {
    ta.focus();
    ta.selectionStart = lineStart;
    ta.selectionEnd = lineStart + nextBlock.length;
  });
}

// 在光标处插入
export function insertAtCursor(
  content: string,
  setContent: (v: string) => void,
  ta: HTMLTextAreaElement | null,
  text: string,
  caretOffset = 0,
) {
  if (!ta) return;
  const s = ta.selectionStart;
  const e = ta.selectionEnd;
  const next = content.slice(0, s) + text + content.slice(e);
  setContent(next);
  requestAnimationFrame(() => {
    ta.focus();
    const pos = s + text.length + caretOffset;
    ta.selectionStart = ta.selectionEnd = pos;
  });
}

export function toggleBlock(
  content: string,
  setContent: (v: string) => void,
  ta: HTMLTextAreaElement | null,
  prefix: string,
) {
  applyBlock(content, setContent, ta, (block) => {
    const lines = block.split('\n');
    const allPrefixed = lines.every((l) => l.startsWith(prefix));
    return lines.map((l) => (allPrefixed ? l.slice(prefix.length) : `${prefix}${l}`)).join('\n');
  });
}

export function toggleHeading(
  content: string,
  setContent: (v: string) => void,
  ta: HTMLTextAreaElement | null,
  level: number,
) {
  applyBlock(content, setContent, ta, (block) => {
    const m = block.match(/^(#{1,6})\s+(.+)$/);
    if (m && m[1].length === level) return m[2];
    if (m) return `${'#'.repeat(level)} ${m[2]}`;
    return `${'#'.repeat(level)} ${block}`;
  });
}

// 对齐：为当前块套上 HTML 对齐容器
export function setAlign(
  content: string,
  setContent: (v: string) => void,
  ta: HTMLTextAreaElement | null,
  align: 'left' | 'center' | 'right',
) {
  if (align === 'left') {
    // 左对齐 = 默认，去掉包裹
    applyBlock(content, setContent, ta, (block) => {
      const m = block.match(/^<div style="text-align:(center|right)">\n([\s\S]*?)\n<\/div>$/);
      return m ? m[2] : block;
    });
    return;
  }
  applyBlock(content, setContent, ta, (block) => {
    if (/^<div style="text-align:(center|right)">/.test(block)) {
      return block.replace(/style="text-align:(center|right)"/, `style="text-align:${align}"`);
    }
    return `<div style="text-align:${align}">\n${block}\n</div>`;
  });
}

// ===== 斜杠命令（飞书 / 快速插入，含拼音缩写） =====
export function buildCommands(opts: {
  getContent: () => string;
  setContent: (v: string) => void;
  ta: HTMLTextAreaElement | null;
  promptText?: (msg: string, def?: string) => string | null;
}): SlashCommand[] {
  const { getContent, setContent, ta, promptText } = opts;
  const prompt = promptText ?? window.prompt.bind(window);
  const content = () => getContent();

  const ins = (text: string, offset = 0) => insertAtCursor(content(), setContent, ta, text, offset);
  const inl = (b: string, a = b, p = '文本') => applyInline(content(), setContent, ta, b, a, p);
  const blk = (fn: (b: string) => string) => applyBlock(content(), setContent, ta, fn);
  const tgl = (p: string) => toggleBlock(content(), setContent, ta, p);
  const hd = (n: number) => toggleHeading(content(), setContent, ta, n);

  return [
    { key: 'h1', label: '一级标题', icon: 'H1', aliases: ['h1', '标题1', '一级标题'], hint: '# 标题', run: () => hd(1) },
    { key: 'h2', label: '二级标题', icon: 'H2', aliases: ['h2', '标题2', '二级标题'], hint: '## 标题', run: () => hd(2) },
    { key: 'h3', label: '三级标题', icon: 'H3', aliases: ['h3', '标题3', '三级标题'], hint: '### 标题', run: () => hd(3) },
    { key: 'text', label: '正文', icon: 'T', aliases: ['zw', 'text', '正文'], hint: '普通文本', run: () => blk((b) => b.replace(/^(#{1,6})\s+/, '')) },
    { key: 'ul', label: '无序列表', icon: '•', aliases: ['wxlb', 'bulleted list', 'ul', '无序列表'], hint: '- 列表项', run: () => tgl('- ') },
    { key: 'ol', label: '有序列表', icon: '1.', aliases: ['yxlb', 'numbered list', 'ol', '有序列表'], hint: '1. 列表项', run: () => tgl('1. ') },
    { key: 'task', label: '任务', icon: '☐', aliases: ['rw', 'todo', 'task', 'renwu', '任务'], hint: '- [ ] 任务', run: () => tgl('- [ ] ') },
    { key: 'quote', label: '引用', icon: '❝', aliases: ['yy', 'quote', '引用'], hint: '> 引用内容', run: () => tgl('> ') },
    { key: 'divider', label: '分割线', icon: '—', aliases: ['fgx', 'divider', '分割线'], hint: '---', run: () => ins('\n\n---\n\n') },
    { key: 'link', label: '链接', icon: '🔗', aliases: ['lj', 'link', 'url', '链接'], hint: '[文字](地址)', run: () => {
        const url = prompt('请输入链接地址（URL）：', 'https://');
        if (!url) return;
        const s = ta?.selectionStart ?? content().length;
        const e = ta?.selectionEnd ?? content().length;
        const sel = content().slice(s, e) || '链接';
        const label = prompt('请输入链接文字：', sel) || '链接';
        setContent(content().slice(0, s) + `[${label}](${url})` + content().slice(e));
      } },
    { key: 'image', label: '图片', icon: '🖼', aliases: ['tp', 'image', '图片'], hint: '![描述](地址)', run: () => {
        const url = prompt('请输入图片地址（URL）：', 'https://');
        if (!url) return;
        const alt = prompt('请输入图片描述：', '') || 'image';
        ins(`\n![${alt}](${url})\n`, -1);
      } },
    { key: 'table', label: '表格', icon: '▦', aliases: ['bg', 'table', '表格'], hint: '| 列 | 列 |', run: () => ins('\n| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n| 内容 | 内容 | 内容 |\n', -1) },
    { key: 'columns', label: '分栏', icon: '▯', aliases: ['fl', 'column', 'columns', '分栏'], hint: '::: columns 2', run: () => ins('\n::: columns 2\n左栏内容\n===\n右栏内容\n:::\n', -1) },
    { key: 'callout', label: '高亮块', icon: '💡', aliases: ['glk', 'callout', 'gaoliangkuai', '高亮块'], hint: '::: 💡 blue', run: () => ins('\n::: 💡 blue\n高亮块内容\n:::\n', -1) },
    { key: 'code', label: '代码块', icon: '{}', aliases: ['dmk', 'code', '代码块'], hint: '``` 代码', run: () => blk((b) => (b.startsWith('```') ? b : '```\n' + b + '\n```')) },
    { key: 'formula', label: '公式', icon: '∑', aliases: ['gs', 'eq', 'formula', 'gongshi', '公式'], hint: '$$ 公式 $$', run: () => ins('\n$$E=mc^2$$\n', -1) },
    { key: 'timer', label: '倒计时', icon: '⏳', aliases: ['djs', 'timer', 'daojishi', '倒计时'], hint: '::: timer 日期', run: () => {
        const d = prompt('请输入倒计时结束时间（如 2026-12-31 18:00）：', '');
        if (!d) return;
        ins(`\n::: timer ${d}\n倒计时说明\n:::\n`, -1);
      } },
    { key: 'mindmap', label: '思维导图', icon: '🧠', aliases: ['swdt', 'mindmap', 'siweidaotu', '思维导图'], hint: '::: mindmap', run: () => ins('\n::: mindmap\n- 中心主题\n  - 分支 1\n    - 子分支 A\n  - 分支 2\n:::\n', -1) },
    { key: 'date', label: '日期', icon: '📅', aliases: ['rq', 'date', 'reminder', '日期'], hint: '今天日期', run: () => {
        const today = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        ins(`${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())} `);
      } },
    { key: 'video', label: '音视频', icon: '▶', aliases: ['wj', 'sp', 'file', 'video', 'yinshipin', '音视频'], hint: '<video src>', run: () => {
        const url = prompt('请输入视频地址（MP4/YouTube）：', 'https://');
        if (!url) return;
        if (/youtube\.com|youtu\.be/i.test(url)) {
          const v = url.match(/(?:v=|youtu\.be\/)([\w-]{11})/);
          ins(`\n<div class="video-embed"><iframe src="https://www.youtube.com/embed/${v ? v[1] : ''}" allowfullscreen></iframe></div>\n`, -1);
        } else {
          ins(`\n<video controls src="${url}"></video>\n`, -1);
        }
      } },
    { key: 'toc', label: '目录', icon: '≡', aliases: ['ml', 'toc', '目录'], hint: '[TOC]', run: () => ins('\n[TOC]\n', -1) },
    { key: 'mention-doc', label: '@文档', icon: '🔗', aliases: ['ywd', 'docs', 'wendang', '@文档'], hint: '[[文档名]]', run: () => ins('[[文档名]]') },
  ];
}

// 斜杠菜单过滤：支持拼音 / 缩写 / 英文 / 中文
export function filterCommands(cmds: SlashCommand[], query: string): SlashCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return cmds;
  return cmds.filter((c) =>
    [c.key, c.label, ...c.aliases].some((a) => a.toLowerCase().includes(q)),
  );
}

// ===== 快捷键（macOS 优先，兼容 Windows） =====
export function isMac() {
  return typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
}

export interface ShortcutMap {
  cmd: string; // 修饰键组合（+ 分隔）
  label: string;
  run: () => void;
}

export function normalizeMods(e: { metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }): string {
  const mods: string[] = [];
  if (e.metaKey || (isMac() ? false : e.ctrlKey)) mods.push('cmd');
  if (e.altKey) mods.push('alt');
  if (e.shiftKey) mods.push('shift');
  if (isMac() ? e.ctrlKey : false) mods.push('ctrl');
  return mods.join('+');
}

// 解析快捷键配置字符串，返回 (mods, key)
export function parseShortcut(spec: string): { mods: string[]; key: string } {
  const parts = spec.split('+');
  const mods = parts.slice(0, -1).map((p) => p.toLowerCase());
  return { mods, key: parts[parts.length - 1].toLowerCase() };
}
