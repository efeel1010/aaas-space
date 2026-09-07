import { describe, it, expect } from 'vitest';
import { buildOrganizeMessages, parseOrganize } from './organize';

describe('parseOrganize', () => {
  it('解析带 ```json 围栏的树形输出', () => {
    const raw = '```json\n[{"name":"项目","type":"folder","children":[{"name":"a.md","type":"file"}]}]\n```';
    const tree = parseOrganize(raw);
    expect(tree.length).toBe(1);
    expect(tree[0].name).toBe('项目');
    expect(tree[0].type).toBe('folder');
    expect(tree[0].children?.[0]).toEqual({ name: 'a.md', type: 'file' });
  });

  it('保留原始文件名，不补扩展名', () => {
    const raw = '[{"name":"需求文档.docx","type":"file"}]';
    const tree = parseOrganize(raw);
    expect(tree[0].name).toBe('需求文档.docx');
  });

  it('非 JSON / 空数组返回空（命中 502 分支）', () => {
    expect(parseOrganize('不是 JSON')).toEqual([]);
    expect(parseOrganize('[]')).toEqual([]);
    expect(parseOrganize('[{"name":""}]')).toEqual([]);
  });

  it('超过 6 层的节点被裁剪（最深文件不进入结果）', () => {
    // 7 层文件夹包裹一个文件，则该文件处于第 8 层（>6），应被裁剪
    let leaf: unknown = { name: 'deep.md', type: 'file' };
    for (let i = 0; i < 7; i++) leaf = { name: `f${i}`, type: 'folder', children: [leaf] };
    const tree = parseOrganize(JSON.stringify([leaf]));
    expect(tree.length).toBeGreaterThan(0);
    expect(JSON.stringify(tree)).not.toContain('deep.md');
  });
});

describe('buildOrganizeMessages', () => {
  it('system 要求严格 JSON、文件保持原名，content 截断到 2000 字符', () => {
    const long = 'x'.repeat(5000);
    const msgs = buildOrganizeMessages([{ name: '报告.md', content: long }]);
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toContain('严格输出 JSON');
    expect(msgs[1].content).toContain('报告.md');
    expect(msgs[1].content.length).toBeLessThan(3000);
    expect(msgs[1].content).not.toContain('xxxxx'.repeat(1000));
  });

  it('多个文件均出现在 user 提示中', () => {
    const msgs = buildOrganizeMessages([
      { name: 'a.md', content: '' },
      { name: 'b.pdf', content: 'x' },
    ]);
    expect(msgs[1].content).toContain('a.md');
    expect(msgs[1].content).toContain('b.pdf');
  });
});