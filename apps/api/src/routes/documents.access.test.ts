import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// 用内存数据替代真实 postgres db，驱动 documentsRouter 运行时验证权限门禁
type Row = Record<string, any>;
type Tables = { [name: string]: Row[] };

function live(): Tables {
  return (globalThis as any).__TABLE_DATA__ ?? {};
}

vi.mock('../db/connection', async () => {
  const { getTableName } = await import('drizzle-orm');
  class FakeDb {
    private rows(table: string): Row[] {
      return live()[table] ?? [];
    }
    select() {
      const self = this;
      return {
        from(t: any) {
          const name = getTableName(t);
          const q: any = {
            where: () => q,
            innerJoin: () => q,
            leftJoin: () => q,
            groupBy: () => q,
            orderBy: () => q,
            limit: () => q,
            then: (resolve: any) => resolve(self.rows(name)),
          };
          return q;
        },
      };
    }
    insert() {
      return {
        values: (v: any) => ({
          onConflictDoUpdate: (opts: any) => ({
            returning: () => {
              live()['document_access'] = live()['document_access'] ?? [];
              const row = { ...v, ...(opts?.set ?? {}) };
              live()['document_access'].push(row);
              return [row];
            },
          }),
          returning: () => [{ ...v, created_at: new Date(), updated_at: new Date() }],
        }),
      };
    }
    update() {
      return {
        set: (s: any) => ({
          where: () => ({
            returning: () => [
              {
                ...s,
                id: 'x',
                team_id: null,
                owner_id: 'bob',
                parent_id: null,
                is_folder: false,
                kind: 'doc',
                title: s.title ?? 't',
                visibility: s.visibility ?? 'private',
                base_permission: s.base_permission ?? 'edit',
                created_at: new Date(),
                updated_at: new Date(),
              },
            ],
          }),
        }),
      };
    }
    delete() {
      return { where: () => ({}) };
    }
  }
  return { db: new FakeDb() };
});

// 需要先从 auth 会话拿 user 信息，这里直接引 schema 常量模拟 requireAuth 放行
vi.mock('../middleware/session', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    requireAuth: async (c: any, next: any) => {
      await next();
    },
  };
});

import { documentsRouter } from './documents';

async function makeApp() {
  const app = new Hono();
  app.use('*', (c: any, next: any) => {
    c.set('user', { id: 'bob', email: 'bob@pulse.space', name: 'Bob' });
    return next();
  });
  app.route('/documents', documentsRouter);
  return app;
}

beforeEach(() => {
  vi.resetModules();
});

// 构造内存表数据
function seed(tables: Tables) {
  (globalThis as any).__TABLE_DATA__ = tables;
}

describe('documents 权限路由：/access 与 PATCH 门禁', () => {
  it('PATCH 修改 visibility 时非 manage → 403', async () => {
    seed({
      documents: [
        {
          id: 'd1', owner_id: 'alice', team_id: null, visibility: 'private', base_permission: 'edit',
          parent_id: null, is_folder: false, kind: 'doc', title: 't', content: '',
          icon: null, cover: null, last_viewed_at: null, deleted_at: null,
          created_at: new Date(), updated_at: new Date(),
        },
      ],
      team_members: [],
      document_access: [
        { doc_id: 'd1', user_id: 'bob', permission: 'read', granted_by: 'alice', created_at: new Date(), updated_at: new Date() },
      ],
    });
    const app = await makeApp();
    const res = await app.request('/documents/d1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visibility: 'team' }),
    });
    expect(res.status).toBe(403);
  });

  it('PATCH 普通内容修改（edit 权限）可放行', async () => {
    seed({
      documents: [
        {
          id: 'd2', owner_id: 'bob', team_id: null, visibility: 'private', base_permission: 'edit',
          parent_id: null, is_folder: false, kind: 'doc', title: 't', content: '',
          icon: null, cover: null, last_viewed_at: null, deleted_at: null,
          created_at: new Date(), updated_at: new Date(),
        },
      ],
      team_members: [],
      document_access: [],
    });
    const app = await makeApp();
    const res = await app.request('/documents/d2', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'hello' }),
    });
    expect(res.status).toBe(200);
  });

  it('GET /:id/access 非 manage → 403', async () => {
    seed({
      documents: [
        {
          id: 'd1', owner_id: 'alice', team_id: null, visibility: 'private', base_permission: 'edit',
          parent_id: null, is_folder: false, kind: 'doc', title: 't', content: '',
          icon: null, cover: null, last_viewed_at: null, deleted_at: null,
          created_at: new Date(), updated_at: new Date(),
        },
      ],
      team_members: [],
      document_access: [{ doc_id: 'd1', user_id: 'bob', permission: 'read', granted_by: 'alice', created_at: new Date(), updated_at: new Date() }],
    });
    const app = await makeApp();
    const res = await app.request('/documents/d1/access');
    expect(res.status).toBe(403);
  });

  it('GET /:id/access（owner/manage）返回授权成员', async () => {
    seed({
      documents: [
        {
          id: 'd1', owner_id: 'bob', team_id: null, visibility: 'private', base_permission: 'edit',
          parent_id: null, is_folder: false, kind: 'doc', title: 't', content: '',
          icon: null, cover: null, last_viewed_at: null, deleted_at: null,
          created_at: new Date(), updated_at: new Date(),
        },
      ],
      team_members: [],
      users: [{ id: 'eve', name: 'Eve', email: 'eve@pulse.space', avatar_url: null }],
      document_access: [{ doc_id: 'd1', user_id: 'eve', permission: 'edit', granted_by: 'bob', created_at: new Date(), updated_at: new Date() }],
    });
    const app = await makeApp();
    const res = await app.request('/documents/d1/access');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.length).toBe(1);
    expect(json.data[0].permission).toBe('edit');
    expect(json.data[0].user_id).toBe('eve');
  });

  it('PUT /:id/access 非 manage → 403', async () => {
    seed({
      documents: [
        {
          id: 'd1', owner_id: 'alice', team_id: null, visibility: 'private', base_permission: 'edit',
          parent_id: null, is_folder: false, kind: 'doc', title: 't', content: '',
          icon: null, cover: null, last_viewed_at: null, deleted_at: null,
          created_at: new Date(), updated_at: new Date(),
        },
      ],
      team_members: [],
      document_access: [{ doc_id: 'd1', user_id: 'bob', permission: 'read', granted_by: 'alice', created_at: new Date(), updated_at: new Date() }],
    });
    const app = await makeApp();
    const res = await app.request('/documents/d1/access', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: 'eve', permission: 'edit' }),
    });
    expect(res.status).toBe(403);
  });

  it('PUT /:id/access（manage）可授权任意系统用户', async () => {
    seed({
      documents: [
        {
          id: 'd3', owner_id: 'bob', team_id: null, visibility: 'private', base_permission: 'edit',
          parent_id: null, is_folder: false, kind: 'doc', title: 't', content: '',
          icon: null, cover: null, last_viewed_at: null, deleted_at: null,
          created_at: new Date(), updated_at: new Date(),
        },
      ],
      team_members: [],
      users: [{ id: 'eve', name: 'Eve', email: 'eve@pulse.space', avatar_url: null }],
      document_access: [],
    });
    const app = await makeApp();
    const res = await app.request('/documents/d3/access', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: 'eve', permission: 'edit' }),
    });
    expect(res.status).toBe(200);
  });

  it('DELETE /:id/access/:userId 非 manage → 403', async () => {
    seed({
      documents: [
        {
          id: 'd1', owner_id: 'alice', team_id: null, visibility: 'private', base_permission: 'edit',
          parent_id: null, is_folder: false, kind: 'doc', title: 't', content: '',
          icon: null, cover: null, last_viewed_at: null, deleted_at: null,
          created_at: new Date(), updated_at: new Date(),
        },
      ],
      team_members: [],
      document_access: [
        { doc_id: 'd1', user_id: 'bob', permission: 'read', granted_by: 'alice', created_at: new Date(), updated_at: new Date() },
      ],
    });
    const app = await makeApp();
    const res = await app.request('/documents/d1/access/bob', { method: 'DELETE' });
    expect(res.status).toBe(403);
  });

  it('列表 GET 过滤 + effective_permission 正确返回', async () => {
    seed({
      documents: [
        {
          id: 'mine', owner_id: 'bob', team_id: null, visibility: 'private', base_permission: 'edit',
          parent_id: null, is_folder: false, kind: 'doc', title: 'mine', content: '',
          icon: null, cover: null, last_viewed_at: null, deleted_at: null,
          created_at: new Date(), updated_at: new Date(),
        },
        {
          id: 'granted', owner_id: 'alice', team_id: null, visibility: 'private', base_permission: 'edit',
          parent_id: null, is_folder: false, kind: 'doc', title: 'granted', content: '',
          icon: null, cover: null, last_viewed_at: null, deleted_at: null,
          created_at: new Date(), updated_at: new Date(),
        },
        {
          id: 'private-other', owner_id: 'alice', team_id: null, visibility: 'private', base_permission: 'edit',
          parent_id: null, is_folder: false, kind: 'doc', title: 'private-other', content: '',
          icon: null, cover: null, last_viewed_at: null, deleted_at: null,
          created_at: new Date(), updated_at: new Date(),
        },
      ],
      team_members: [],
      document_access: [
        { doc_id: 'granted', user_id: 'bob', permission: 'read', granted_by: 'alice', created_at: new Date(), updated_at: new Date() },
      ],
    });
    const app = await makeApp();
    const res = await app.request('/documents?scope=personal&kind=doc');
    expect(res.status).toBe(200);
    const json = await res.json();
    const ids = json.data.map((d: any) => d.id);
    expect(ids).toContain('mine');
    expect(ids).toContain('granted');
    expect(ids).not.toContain('private-other');
    const granted = json.data.find((d: any) => d.id === 'granted');
    expect(granted.effective_permission).toBe('read');
    const mine = json.data.find((d: any) => d.id === 'mine');
    expect(mine.effective_permission).toBe('manage');
  });
});