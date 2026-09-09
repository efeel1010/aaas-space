import { describe, it, expect } from 'vitest';
import {
  CreateDocRequest,
  UpdateDocRequest,
  Document,
  AdminDocument,
  WikiTocItem,
  SetDocAccessRequest,
  DocumentAccessItem,
} from '@pulse-space/contracts';

// 文档权限功能契约验证：visibility/base_permission/effective_permission 字段
// 与 SetDocAccessRequest / DocumentAccessItem 枚举约束
describe('documents 契约 - 权限', () => {
  it('CreateDocRequest 的 visibility/base_permission 为可选，缺省时不被写入', () => {
    const parsed = CreateDocRequest.parse({
      scope: 'personal',
      kind: 'doc',
      title: '未命名文档',
    });
    expect(parsed.visibility).toBeUndefined();
    expect(parsed.base_permission).toBeUndefined();
  });

  it('CreateDocRequest 支持显式 visibility/base_permission', () => {
    const parsed = CreateDocRequest.parse({
      scope: 'team',
      kind: 'wiki',
      title: '团队文档',
      visibility: 'team',
      base_permission: 'read',
    });
    expect(parsed.visibility).toBe('team');
    expect(parsed.base_permission).toBe('read');
  });

  it('UpdateDocRequest 支持可选 visibility/base_permission', () => {
    const parsed = UpdateDocRequest.parse({ visibility: 'private', base_permission: 'edit' });
    expect(parsed.visibility).toBe('private');
    expect(parsed.base_permission).toBe('edit');
  });

  it('visibility 仅允许 private/team/public', () => {
    expect(() => CreateDocRequest.parse({ scope: 'personal', kind: 'doc', visibility: 'all' })).toThrow();
  });

  it('base_permission 仅允许 read/edit', () => {
    expect(() => UpdateDocRequest.parse({ base_permission: 'manage' })).toThrow();
  });

  it('Document 必须携带 visibility/base_permission/effective_permission', () => {
    const doc = Document.parse({
      id: '00000000-0000-0000-0000-000000000001',
      team_id: null,
      owner_id: '00000000-0000-0000-0000-000000000002',
      owner_name: null,
      parent_id: null,
      is_folder: false,
      kind: 'wiki',
      title: '文档',
      content: '',
      icon: null,
      cover: null,
      last_viewed_at: null,
      is_favorite: false,
      visibility: 'team',
      base_permission: 'edit',
      effective_permission: 'manage',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    expect(doc.visibility).toBe('team');
    expect(doc.base_permission).toBe('edit');
    expect(doc.effective_permission).toBe('manage');
  });

  it('effective_permission 是 none/read/edit/manage 之一', () => {
    expect(() => Document.parse({
      id: '00000000-0000-0000-0000-000000000001',
      team_id: null,
      owner_id: '00000000-0000-0000-0000-000000000002',
      owner_name: null,
      parent_id: null,
      is_folder: false,
      kind: 'doc',
      title: 'd',
      content: '',
      icon: null,
      cover: null,
      last_viewed_at: null,
      is_favorite: false,
      visibility: 'private',
      base_permission: 'edit',
      effective_permission: 'super',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })).toThrow();
  });

  it('AdminDocument 携带 visibility/base_permission', () => {
    const doc = AdminDocument.parse({
      id: '00000000-0000-0000-0000-000000000001',
      owner_id: '00000000-0000-0000-0000-000000000002',
      owner_name: 'Alice',
      team_id: null,
      is_folder: false,
      title: '管理端文档',
      kind: 'doc',
      visibility: 'team',
      base_permission: 'read',
      deleted_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    expect(doc.visibility).toBe('team');
    expect(doc.base_permission).toBe('read');
  });

  it('WikiTocItem 携带 visibility/effective_permission', () => {
    const item = WikiTocItem.parse({
      id: '00000000-0000-0000-0000-000000000001',
      title: '目录节点',
      parent_id: null,
      updated_at: new Date().toISOString(),
      visibility: 'private',
      effective_permission: 'read',
    });
    expect(item.visibility).toBe('private');
    expect(item.effective_permission).toBe('read');
  });

  it('SetDocAccessRequest 约束 user_id 与 permission(read/edit/manage)', () => {
    const parsed = SetDocAccessRequest.parse({ user_id: '00000000-0000-0000-0000-000000000001', permission: 'manage' });
    expect(parsed.permission).toBe('manage');
    expect(() => SetDocAccessRequest.parse({ user_id: 'x', permission: 'owner' })).toThrow();
  });

  it('DocumentAccessItem 携带 user_id/permission 并可带只读 team_role', () => {
    const item = DocumentAccessItem.parse({
      user_id: '00000000-0000-0000-0000-000000000001',
      name: 'Bob',
      email: 'bob@example.com',
      avatar_url: null,
      permission: 'edit',
      team_role: null,
    });
    expect(item.permission).toBe('edit');
    expect(item.team_role).toBeNull();
  });
});