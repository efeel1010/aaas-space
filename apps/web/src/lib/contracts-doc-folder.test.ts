import { describe, it, expect } from 'vitest';
import {
  CreateDocRequest,
  UpdateDocRequest,
  Document,
} from '@pulse-space/contracts';

// 文件夹功能契约验证：is_folder 字段的默认值与可选性、Document 必须携带
describe('documents 契约 - 文件夹 (is_folder)', () => {
  it('CreateDocRequest 默认 is_folder=false（普通文档）', () => {
    const parsed = CreateDocRequest.parse({
      scope: 'personal',
      kind: 'doc',
      title: '未命名文档',
    });
    expect(parsed.is_folder).toBe(false);
  });

  it('CreateDocRequest 支持显式 is_folder=true（文件夹）并可带 parent_id（含子级）', () => {
    const parsed = CreateDocRequest.parse({
      scope: 'personal',
      kind: 'doc',
      parent_id: '00000000-0000-0000-0000-000000000001',
      is_folder: true,
      title: '归档',
    });
    expect(parsed.is_folder).toBe(true);
    expect(parsed.parent_id).toBe('00000000-0000-0000-0000-000000000001');
  });

  it('CreateDocRequest 不传 parent_id 时建成顶层项', () => {
    const parsed = CreateDocRequest.parse({
      scope: 'team',
      kind: 'wiki',
      is_folder: true,
      title: '顶层文件夹',
    });
    expect(parsed.parent_id).toBeUndefined();
  });

  it('UpdateDocRequest 支持 is_folder 可选字段', () => {
    const parsed = UpdateDocRequest.parse({ title: '改名', is_folder: true });
    expect(parsed.is_folder).toBe(true);
  });

  it('Document（列表/详情返回）必须携带 is_folder boolean', () => {
    const doc = Document.parse({
      id: '00000000-0000-0000-0000-000000000001',
      team_id: null,
      owner_id: '00000000-0000-0000-0000-000000000002',
      owner_name: null,
      parent_id: null,
      is_folder: true,
      kind: 'doc',
      title: '资料',
      content: '',
      icon: null,
      cover: null,
      last_viewed_at: null,
      is_favorite: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    expect(doc.is_folder).toBe(true);
  });
});