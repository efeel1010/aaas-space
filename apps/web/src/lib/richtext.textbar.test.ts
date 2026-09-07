import { describe, it, beforeEach, expect } from 'vitest';
import { applyInlineStyle, stripInlineFontSize, RICH_BLOCK_TAGS } from './richtext';

// 回归测试：选中文字设置字号/颜色（包裹真实 span）后，选区必须指向文档内的元素，
// 后续「转标题」等按选区定位块的格式操作不能失效（insertNode 后 frag 已脱离文档）。
function makeEditor(): HTMLElement {
  const editor = document.createElement('div');
  editor.setAttribute('contenteditable', 'true');
  editor.setAttribute('class', 'rich-editor');
  editor.innerHTML = '<div>你好 世界</div>';
  document.body.appendChild(editor);
  return editor;
}

function selectAllText(editor: HTMLElement): void {
  // 支持 span(内联格式) 包裹后的嵌套结构：始终选中块内最深的文本节点
  const block = editor.querySelector('div,h1,h2,h3,p')!;
  const span = block.querySelector('span');
  const textNode = (span ? span.firstChild : block.childNodes[0]) as Text;
  const range = document.createRange();
  range.setStart(textNode, 0);
  range.setEnd(textNode, (textNode.data ?? '').length);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
}

// 复刻 DocEditor.formatRichBlockTag 的块转换核心：从选区 startContainer 向上找块并换标签
function convertToTag(editor: HTMLElement, tag: string): { ok: boolean; reason: string } {
  editor.focus();
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return { ok: false, reason: 'no-sel' };
  const range = sel.getRangeAt(0);
  let node: Node | null = range.startContainer;
  let block: HTMLElement | null = null;
  while (node && node !== editor) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const e = node as HTMLElement;
      if (RICH_BLOCK_TAGS.includes(e.tagName)) {
        block = e;
        break;
      }
    }
    node = node.parentNode;
  }
  if (!block) return { ok: false, reason: 'no-block, startInDoc=' + (range.startContainer.isConnected ?? '?') };
  if (block.tagName === tag.toUpperCase()) return { ok: true, reason: 'same' };
  const nb = document.createElement(tag.toUpperCase());
  nb.innerHTML = block.innerHTML;
  block.replaceWith(nb);
  return { ok: true, reason: 'converted' };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('applyInlineStyle 后选区仍锚定在文档内（格式可连续操作）', () => {
  it('设字号后选区非塌陷，且选区内 startContainer 已在文档中', () => {
    const editor = makeEditor();
    selectAllText(editor);
    applyInlineStyle('font-size:12px');
    const sel = window.getSelection()!;
    expect(sel.rangeCount).toBe(1);
    expect(sel.getRangeAt(0).collapsed).toBe(false);
    expect(sel.getRangeAt(0).startContainer.isConnected).toBe(true);
  });

  it('设字号后能正常 div → h2（原 bug：选区指向已脱离文档的 frag，找块失效）', () => {
    const editor = makeEditor();
    selectAllText(editor);
    applyInlineStyle('font-size:12px');
    const res = convertToTag(editor, 'h2');
    expect(res, JSON.stringify(res)).toMatchObject({ ok: true });
    expect(editor.querySelector('h2')).toBeTruthy();
    expect(editor.querySelector('h2')!.innerHTML).toContain('font-size');
  });

  it('设字号后能继续应用不同字号（span 就近覆盖），不残留孤立选区', () => {
    const editor = makeEditor();
    selectAllText(editor);
    applyInlineStyle('font-size:12px');
    selectAllText(editor);
    applyInlineStyle('font-size:18px');
    expect(editor.innerHTML).toContain('18px');
    const res = convertToTag(editor, 'h2');
    expect(res, JSON.stringify(res)).toMatchObject({ ok: true });
  });

  it('设置颜色后选区仍有效，可继续转标题', () => {
    const editor = makeEditor();
    selectAllText(editor);
    applyInlineStyle('color:red');
    const sel = window.getSelection()!;
    expect(sel.getRangeAt(0).collapsed).toBe(false);
    const res = convertToTag(editor, 'h1');
    expect(res, JSON.stringify(res)).toMatchObject({ ok: true });
    expect(editor.querySelector('h1')).toBeTruthy();
  });

  it('转标题时清掉块内行内字号，让标题样式接管（最后一次选择的格式生效）', () => {
    const editor = makeEditor();
    selectAllText(editor);
    applyInlineStyle('font-size:12px');
    expect(editor.innerHTML).toContain('12px');
    const h2 = document.createElement('h2');
    h2.innerHTML = editor.querySelector('div')!.innerHTML;
    stripInlineFontSize(h2);
    expect(h2.innerHTML).not.toContain('font-size');
    expect(h2.innerHTML).toContain('你好 世界');
  });
});