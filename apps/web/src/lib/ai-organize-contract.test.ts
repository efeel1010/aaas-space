import { describe, it, expect } from 'vitest';
import {
  AiOrganizeFileInput,
  AiOrganizeNode,
  AiOrganizeRequest,
  AiOrganizeResult,
} from '@pulse-space/contracts';

// AI 整理文件到文件夹契约验证
describe('ai organize 契约', () => {
  it('AiOrganizeFileInput：name 必须有、content 带默认空串', () => {
    const input = AiOrganizeFileInput.parse({ name: '调研报告.md' });
    expect(input.name).toBe('调研报告.md');
    expect(input.content).toBe('');
  });

  it('AiOrganizeRequest 限制 files 1..10 个（>10 报错）', () => {
    expect(() =>
      AiOrganizeRequest.parse({ scope: 'personal', files: [] }),
    ).toThrow();
    const ten = Array.from({ length: 10 }, (_, i) => ({ name: `f${i}.md`, content: '' }));
    expect(AiOrganizeRequest.parse({ scope: 'personal', files: ten }).files.length).toBe(10);
    const eleven = [...ten, { name: 'f10.md', content: '' }];
    expect(() => AiOrganizeRequest.parse({ scope: 'personal', files: eleven })).toThrow();
  });

  it('AiOrganizeNode：支持递归 folder→file 的多级结构', () => {
    const node = AiOrganizeNode.parse({
      name: '项目资料',
      type: 'folder',
      children: [
        { name: '文档', type: 'folder', children: [{ name: 'README.md', type: 'file' }] },
        { name: '说明.pdf', type: 'file' },
      ],
    });
    expect(node.type).toBe('folder');
    expect(node.children?.[0]?.type).toBe('folder');
    expect(node.children?.[0]?.children?.[0]?.name).toBe('README.md');
  });

  it('AiOrganizeResult：tree 必须是节点数组', () => {
    const res = AiOrganizeResult.parse({ tree: [{ name: '归档', type: 'folder', children: [] }] });
    expect(res.tree[0].type).toBe('folder');
    expect(() => AiOrganizeResult.parse({ tree: 'oops' })).toThrow();
  });
});