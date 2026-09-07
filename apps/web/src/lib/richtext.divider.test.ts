import { describe, it, expect, beforeEach } from 'vitest';
import {
  getCurrentBlockTag,
  isInsideTableCell,
  splitRichBlockAtCaret,
  tableHtml,
  tableInsertColumn,
  tableRemoveColumn,
  tableInsertRow,
  tableRemoveRow,
  currentTableCell,
  cellColumnIndex,
  tableColumnCount,
  editableHtmlToMarkdown,
} from './richtext';

// 构造「正文段落 + 分割线(<hr>) + 后续段落」结构，对应文档内容：
//   ```…监管要求。
//   ---
//   致法务团队…```
function makeDividerDoc(): HTMLElement {
  const editor = document.createElement('div');
  editor.setAttribute('contenteditable', 'true');
  editor.setAttribute('class', 'rich-editor');
  editor.innerHTML =
    '<div>本节介绍六大合规维度并标注属性，供法务评估各类功能的合规性及监管要求。</div><hr><div>致法务团队，请重点审阅第四章。</div>';
  document.body.appendChild(editor);
  return editor;
}

// 把光标放到 indexOf(text) 所在段落文本节点末尾
function caretAtTextEnd(editor: HTMLElement, text: string) {
  const block = Array.from(editor.querySelectorAll<HTMLElement>('div,p,h1,h2,h3')).find((el) =>
    el.textContent!.includes(text),
  )!;
  const tn = Array.from(block.childNodes)
    .filter((n) => n.nodeType === Node.TEXT_NODE)
    .pop() as Text;
  const range = document.createRange();
  range.setStart(tn, tn.data.length);
  range.collapse(true);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  return block;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('回车决策：getCurrentBlockTag', () => {
  it('普通段落内光标 → 返回 DIV（走原生 insertParagraph）', () => {
    const editor = makeDividerDoc();
    caretAtTextEnd(editor, '监管要求');
    expect(getCurrentBlockTag(editor)).toBe('DIV');
  });

  it('标题内光标 → 返回 H2（走自定义拆分降级正文）', () => {
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    editor.innerHTML = '<h2>第二章 总结</h2><div>正文</div>';
    document.body.appendChild(editor);
    caretAtTextEnd(editor, '第二章');
    expect(getCurrentBlockTag(editor)).toBe('H2');
  });
});

describe('标题回车拆分：splitRichBlockAtCaret', () => {
  it('标题末尾回车 → 在标题后新建空正文段落 P，光标移入', () => {
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    editor.innerHTML = '<h2>第二章 总结</h2><div>正文</div>';
    document.body.appendChild(editor);
    const heading = caretAtTextEnd(editor, '第二章');

    const res = splitRichBlockAtCaret(editor);
    expect(res).toBe('ok');
    expect(heading.nextElementSibling?.tagName).toBe('P');
    expect(heading.nextElementSibling?.textContent).toBe('');
    expect(getCurrentBlockTag(editor)).toBe('P');
  });

  it('标题中部回车 → 光标后内容移入新正文段落 P', () => {
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    editor.innerHTML = '<h2>第二章 总结与回顾</h2>';
    document.body.appendChild(editor);

    const tn = editor.querySelector('h2')!.childNodes[0] as Text;
    const range = document.createRange();
    range.setStart(tn, 3); // 「第二章」之后
    range.collapse(true);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    expect(splitRichBlockAtCaret(editor)).toBe('ok');
    expect(editor.querySelector('h2')!.textContent).toBe('第二章');
    expect(editor.querySelector('p')!.textContent).toBe(' 总结与回顾');
    expect(getCurrentBlockTag(editor)).toBe('P');
  });
});

describe('表格可编辑性', () => {
  function makeTableDoc(): HTMLElement {
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    editor.setAttribute('class', 'rich-editor');
    editor.innerHTML =
      '<table><thead><tr><th>模块</th><th>状态</th></tr></thead><tbody><tr><td>数据合规</td><td>涉及</td></tr></tbody></table>';
    document.body.appendChild(editor);
    return editor;
  }

  function caretInCell(editor: HTMLElement): void {
    const cell = editor.querySelector('td')!;
    const tn = cell.childNodes[0] as Text;
    const range = document.createRange();
    range.setStart(tn, 0);
    range.collapse(true);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  }

  it('光标在单元格内 → isInsideTableCell 返回 true', () => {
    const editor = makeTableDoc();
    caretInCell(editor);
    expect(isInsideTableCell(editor)).toBe(true);
  });

  it('光标在普通段落 → isInsideTableCell 返回 false', () => {
    const editor = makeDividerDoc();
    caretAtTextEnd(editor, '监管要求');
    expect(isInsideTableCell(editor)).toBe(false);
  });
});

describe('表格插入与行列编辑', () => {
  function makeEditor(rows: number, cols: number): HTMLElement {
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    editor.innerHTML = tableHtml(rows, cols);
    document.body.appendChild(editor);
    return editor;
  }

  it('tableHtml 生成可编辑表格，行/列数正确且上限 9×9', () => {
    const editor = makeEditor(4, 5);
    expect(editor.querySelector('table')).toBeTruthy();
    expect(editor.querySelectorAll('thead th').length).toBe(5);
    expect(editor.querySelectorAll('tbody tr').length).toBe(3); // 首行为表头
    // colgroup 列数与表格一致
    expect(editor.querySelectorAll('colgroup > col').length).toBe(5);

    const big = tableHtml(12, 12);
    expect((big.match(/<thead>/g) || []).length).toBe(1);
    // 只允许最多 9×9：表头 9 th，总行数 9
    expect((big.match(/<th>/g) || []).length).toBe(9);
    expect((big.match(/<tr>/g) || []).length).toBe(9);
  });

  it('在单元格右侧插入一列 → 每行列数 +1，colgroup 同步', () => {
    const editor = makeEditor(2, 3);
    const cell = editor.querySelector('tbody td') as HTMLElement;
    expect(cellColumnIndex(cell)).toBe(0);
    tableInsertColumn(cell, 1);
    editor.querySelectorAll('tr').forEach((tr) => expect(tr.querySelectorAll(':scope > th, :scope > td').length).toBe(4));
    expect(editor.querySelectorAll('colgroup > col').length).toBe(4);
    expect(tableColumnCount(editor.querySelector('table')!)).toBe(4);
  });

  it('删除当前列 → 每行列数 -1', () => {
    const editor = makeEditor(2, 3);
    const cell = editor.querySelector('tbody td') as HTMLElement;
    tableRemoveColumn(cell);
    editor.querySelectorAll('tr').forEach((tr) => expect(tr.querySelectorAll(':scope > th, :scope > td').length).toBe(2));
    expect(tableColumnCount(editor.querySelector('table')!)).toBe(2);
  });

  it('仅剩最后一列时不允许再删除，至少保留 1 列', () => {
    const editor = makeEditor(3, 2);
    const cell = editor.querySelector('tbody td') as HTMLElement; // 列索引 0
    tableRemoveColumn(cell); // 2→1
    expect(tableColumnCount(editor.querySelector('table')!)).toBe(1);
    tableRemoveColumn(cell); // 已是 1 列，不再删
    expect(tableColumnCount(editor.querySelector('table')!)).toBe(1);
  });

  it('插入行 → 数据行数 +1，列数与表格一致', () => {
    const editor = makeEditor(2, 3);
    const cell = editor.querySelector('tbody td') as HTMLElement;
    tableInsertRow(cell, 1);
    expect(editor.querySelectorAll('tbody tr').length).toBe(2);
    editor.querySelectorAll('tbody tr').forEach((tr) => expect(tr.querySelectorAll(':scope > td').length).toBe(3));
  });

  it('删除当前行 → 数据行数 -1', () => {
    const editor = makeEditor(3, 3);
    const cell = editor.querySelector('tbody td') as HTMLElement;
    tableRemoveRow(cell);
    expect(editor.querySelectorAll('tbody tr').length).toBe(1);
  });

  it('光标在单元格内时 currentTableCell 返回该单元格', () => {
    const editor = makeEditor(2, 2);
    const cellA = editor.querySelector('tbody td') as HTMLElement;
    const tn = cellA.childNodes[0] as Text;
    const range = document.createRange();
    range.setStart(tn, 0);
    range.collapse(true);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    expect(currentTableCell(editor)).toBe(cellA);
  });
});

describe('选中文字内联样式持久化', () => {
  it('颜色与字号以 <span style> 保留（markdown 无对应语法），不随保存丢失', () => {
    const md = editableHtmlToMarkdown('<div><span style="color:red;font-size:18px">重点</span>文字</div>');
    expect(md).toContain('<span style="color:red;font-size:18px">重点</span>');
  });

  it('纯样式 span（粗/斜/下划线/中划线/背景）仍转回 markdown 语法，不被套 <span>', () => {
    const md = editableHtmlToMarkdown(
      '<div><span style="font-weight:bold">加粗</span><span style="font-style:italic">斜体</span><span style="text-decoration-line:underline">下划线</span><span style="text-decoration-line:line-through">删除</span><span style="background-color:rgb(255, 233, 168)">标记</span></div>',
    );
    expect(md).toContain('**加粗**');
    expect(md).toContain('*斜体*');
    expect(md).toContain('<u>下划线</u>');
    expect(md).toContain('~~删除~~');
    expect(md).toContain('<mark>标记</mark>');
  });
});