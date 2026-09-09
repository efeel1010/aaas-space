import { describe, it, expect } from 'vitest';
import { DocKind, CreateDocRequest, Document } from '@pulse-space/contracts';

// 表格契约：DocKind 扩展出 'sheet'，创建/返回都对 sheet 透传
describe('documents 契约 - 表格 (kind: sheet)', () => {
  it('DocKind 枚举包含 sheet', () => {
    expect(DocKind.options).toContain('sheet');
    const parsed = DocKind.parse('sheet');
    expect(parsed).toBe('sheet');
  });

  it('CreateDocRequest 支持 kind=sheet 创建表格', () => {
    const parsed = CreateDocRequest.parse({
      scope: 'personal',
      kind: 'sheet',
      title: '季度预算',
      content: '',
    });
    expect(parsed.kind).toBe('sheet');
  });

  it('团队作用域创建表格同样合法', () => {
    const parsed = CreateDocRequest.parse({
      scope: 'team',
      team_id: '00000000-0000-0000-0000-000000000001',
      kind: 'sheet',
      title: '共享盘点表',
    });
    expect(parsed.kind).toBe('sheet');
  });

  it('Document（详情/列表返回）携带 kind=sheet', () => {
    const doc = Document.parse({
      id: '00000000-0000-0000-0000-000000000001',
      team_id: null,
      owner_id: '00000000-0000-0000-0000-000000000002',
      owner_name: null,
      parent_id: null,
      is_folder: false,
      kind: 'sheet',
      title: '统计表',
      content: '{"sheets":[]}',
      icon: null,
      cover: null,
      visibility: 'private',
      base_permission: 'edit',
      effective_permission: 'manage',
      last_viewed_at: null,
      is_favorite: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    expect(doc.kind).toBe('sheet');
  });

  it('非法 kind（如 docx）被拒绝', () => {
    const r = CreateDocRequest.safeParse({ scope: 'personal', kind: 'docx', title: 'x' });
    expect(r.success).toBe(false);
  });
});