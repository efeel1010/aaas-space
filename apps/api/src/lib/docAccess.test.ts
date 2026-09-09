import { describe, it, expect } from 'vitest';
import { resolveDocAccess, filterAccessibleWithCtx, type DocAccessCtx } from './docAccess';

type Doc = {
  id: string;
  owner_id: string;
  team_id: string | null;
  visibility: 'private' | 'team' | 'public';
  base_permission: 'read' | 'edit';
};

function doc(over: Partial<Doc> = {}): Doc {
  return {
    id: 'doc1',
    owner_id: 'alice',
    team_id: null,
    visibility: 'private',
    base_permission: 'edit',
    ...over,
  };
}

// 构造注入式 ctx（不访问 DB）
function ctx(
  teamRoleByTeam: Record<string, string> = {},
  aclByDoc: Record<string, Record<string, string>> = {},
): DocAccessCtx {
  return {
    teamRoleByTeam: new Map(Object.entries(teamRoleByTeam)),
    aclByDoc: new Map(
      Object.entries(aclByDoc).map(([k, v]) => [k, new Map(Object.entries(v))] as [string, Map<string, string>]),
    ),
  };
}

describe('resolveDocAccess 权限解析矩阵', () => {
  it('owner → manage（个人私有文档）', async () => {
    expect(await resolveDocAccess('alice', doc({ owner_id: 'alice' }), ctx())).toBe('manage');
  });

  it('团队 owner/admin → manage（即使文档 private）', async () => {
    const d = doc({ team_id: 't1', visibility: 'private' });
    expect(await resolveDocAccess('bob', d, ctx({ t1: 'owner' }))).toBe('manage');
    expect(await resolveDocAccess('bob', d, ctx({ t1: 'admin' }))).toBe('manage');
  });

  it('团队普通成员 + 文档 private → 无权限（none）', async () => {
    const d = doc({ team_id: 't1', visibility: 'private' });
    expect(await resolveDocAccess('bob', d, ctx({ t1: 'member' }))).toBe('none');
  });

  it('private + 白名单：被授权后按授权权限可见（read/edit/manage）', async () => {
    const d = doc({ owner_id: 'alice', team_id: null, visibility: 'private' });
    expect(await resolveDocAccess('eve', d, ctx({}, { doc1: { eve: 'read' } }))).toBe('read');
    expect(await resolveDocAccess('eve', d, ctx({}, { doc1: { eve: 'edit' } }))).toBe('edit');
    expect(await resolveDocAccess('eve', d, ctx({}, { doc1: { eve: 'manage' } }))).toBe('manage');
  });

  it('未授权 + private + 非 owner → none', async () => {
    expect(await resolveDocAccess('eve', doc({ owner_id: 'alice', visibility: 'private' }), ctx())).toBe('none');
  });

  it('team visibility + 普通成员 → base_permission（edit）', async () => {
    const d = doc({ owner_id: 'alice', team_id: 't1', visibility: 'team', base_permission: 'edit' });
    expect(await resolveDocAccess('bob', d, ctx({ t1: 'member' }))).toBe('edit');
  });

  it('team visibility + 普通成员 + base read → read', async () => {
    const d = doc({ owner_id: 'alice', team_id: 't1', visibility: 'team', base_permission: 'read' });
    expect(await resolveDocAccess('bob', d, ctx({ t1: 'member' }))).toBe('read');
  });

  it('team visibility + 非团队成员 → none（除非白名单）', async () => {
    const d = doc({ owner_id: 'alice', team_id: 't1', visibility: 'team', base_permission: 'edit' });
    expect(await resolveDocAccess('eve', d, ctx())).toBe('none');
    expect(await resolveDocAccess('eve', d, ctx({}, { doc1: { eve: 'manage' } }))).toBe('manage');
  });

  it('public → base_permission（任意用户，不需团队）', async () => {
    const d = doc({ owner_id: 'alice', team_id: null, visibility: 'public', base_permission: 'read' });
    expect(await resolveDocAccess('eve', d, ctx())).toBe('read');
    const d2 = doc({ owner_id: 'alice', team_id: 't1', visibility: 'public', base_permission: 'edit' });
    expect(await resolveDocAccess('stranger', d2, ctx({ t1: 'alice' }))).toBe('edit');
  });

  it('白名单权限 + base 取最大（read 成员被授权 edit → edit）', async () => {
    const d = doc({ owner_id: 'alice', team_id: 't1', visibility: 'team', base_permission: 'read' });
    expect(await resolveDocAccess('bob', d, ctx({ t1: 'member' }, { doc1: { bob: 'edit' } }))).toBe('edit');
  });
});

describe('filterAccessible 列表过滤', () => {
  it('剔除 none，保留 owner/成员/白名单，并携带 effective', async () => {
    const docs: Doc[] = [
      doc({ id: 'a', owner_id: 'alice', team_id: 't1', visibility: 'team', base_permission: 'read' }), // member → keep read
      doc({ id: 'b', owner_id: 'bob', visibility: 'private' }), // owner → keep manage
      doc({ id: 'c', owner_id: 'charlie', visibility: 'private' }), // none → drop
    ];
    const out = await filterAccessibleWithCtx('bob', docs, ctx({ t1: 'member' }));
    const ids = out.map((o) => o.doc.id).sort();
    expect(ids).toEqual(['a', 'b']);
    const byId = Object.fromEntries(out.map((o) => [o.doc.id, o.effective]));
    expect(byId.a).toBe('read');
    expect(byId.b).toBe('manage');
  });

  it('私人白名单用户被保留（非 owner 但被授权）', async () => {
    const docs: Doc[] = [
      doc({ id: 'd', owner_id: 'alice', visibility: 'private' }),
    ];
    const out = await filterAccessibleWithCtx('eve', docs, ctx({}, { d: { eve: 'read' } }));
    expect(out.map((o) => o.doc.id)).toEqual(['d']);
    expect(out[0].effective).toBe('read');
  });
});