import { describe, it, expect } from 'vitest';
import { diffLines, diffStats } from './diff';

describe('diffLines', () => {
  it('完全相同时全部为 same', () => {
    const lines = diffLines('a\nb\nc', 'a\nb\nc');
    expect(lines).toEqual([
      { type: 'same', text: 'a' },
      { type: 'same', text: 'b' },
      { type: 'same', text: 'c' },
    ]);
  });

  it('新增行标记为 add', () => {
    const lines = diffLines('a\nc', 'a\nb\nc');
    expect(lines).toEqual([
      { type: 'same', text: 'a' },
      { type: 'add', text: 'b' },
      { type: 'same', text: 'c' },
    ]);
  });

  it('删除行标记为 del', () => {
    const lines = diffLines('a\nb\nc', 'a\nc');
    expect(lines).toEqual([
      { type: 'same', text: 'a' },
      { type: 'del', text: 'b' },
      { type: 'same', text: 'c' },
    ]);
  });

  it('修改一行 = 删除旧行 + 新增新行', () => {
    const lines = diffLines('hello', 'world');
    const stats = diffStats(lines);
    expect(stats).toEqual({ added: 1, removed: 1 });
  });

  it('空文档对比', () => {
    // ''.split('\n') === ['']，空串视为一个空行
    expect(diffLines('', 'x')).toEqual([
      { type: 'del', text: '' },
      { type: 'add', text: 'x' },
    ]);
    expect(diffLines('x', '')).toEqual([
      { type: 'del', text: 'x' },
      { type: 'add', text: '' },
    ]);
    expect(diffLines('', '')).toEqual([{ type: 'same', text: '' }]);
  });
});
