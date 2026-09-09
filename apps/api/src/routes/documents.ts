import { Hono } from 'hono';
import type { Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq, and, desc, isNull, inArray, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/connection';
import {
  documents,
  documentVersions,
  documentComments,
  documentFavorites,
  documentShares,
  documentAccess,
  docTemplates,
  notifications,
  users,
  teamMembers,
} from '../db/schema';
import { requireAuth, isTeamMember } from '../middleware/session';
import {
  CreateDocRequest,
  UpdateDocRequest,
  CreateVersionRequest,
  CreateCommentRequest,
  SetDocAccessRequest,
} from '@pulse-space/contracts';
import type { EffectivePermission } from '@pulse-space/contracts';
import { loadDocAccessCtx, filterAccessible, resolveDocAccess } from '../lib/docAccess';
import type { AppVariables } from '../types';

export const documentsRouter = new Hono<{ Variables: AppVariables }>();
documentsRouter.use('*', requireAuth);

type DocKindRow = typeof documents.$inferSelect['kind'];
// 列表 kind 过滤：支持英文逗号分隔（如 kind=doc,sheet）。
// 多个时用 inArray；单个或缺失时用 eq（默认 'doc'，保持向后兼容）。
const kindFilter = (raw: string | undefined): SQL[] => {
  const kinds = (raw ?? 'doc')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean) as DocKindRow[];
  return kinds.length > 1 ? [inArray(documents.kind, kinds)] : [eq(documents.kind, kinds[0] ?? 'doc')];
};

const toDto = (
  d: typeof documents.$inferSelect,
  ownerName: string | null = null,
  isFavorite = false,
  effective: EffectivePermission | null = null,
) => ({
  id: d.id,
  team_id: d.team_id,
  owner_id: d.owner_id,
  owner_name: ownerName,
  parent_id: d.parent_id,
  is_folder: d.is_folder,
  kind: d.kind,
  title: d.title,
  content: d.content,
  icon: d.icon,
  cover: d.cover,
  last_viewed_at: d.last_viewed_at ? d.last_viewed_at.toISOString() : null,
  is_favorite: isFavorite,
  visibility: d.visibility,
  base_permission: d.base_permission,
  effective_permission: effective,
  created_at: d.created_at.toISOString(),
  updated_at: d.updated_at.toISOString(),
});

// 校验文档存在（含未删除）+ 解析生效权限；none 统一 403
async function findDoc(c: Context<{ Variables: AppVariables }>, id: string) {
  const [doc] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  if (!doc || doc.deleted_at) return { error: c.json({ code: 404, message: '文档不存在', timestamp: new Date().toISOString() }, 404) };
  const user = c.get('user');
  const ctx = await loadDocAccessCtx(user.id, [doc.id], doc.team_id ? [doc.team_id] : []);
  const effective = await resolveDocAccess(user.id, doc, ctx);
  if (effective === 'none') {
    return { error: c.json({ code: 403, message: '无权访问', timestamp: new Date().toISOString() }, 403) };
  }
  return { doc, effective };
}

// 列表：scope=personal|team&teamId=&kind=doc|wiki|sheet（支持逗号分隔，如 doc,sheet）&parent=<parentId>
// 传 parent 返回该父下的直属子项；未传返回顶层（parent_id IS NULL）
// 排序：文件夹优先，其余按 updated_at 倒序
documentsRouter.get('/', async (c) => {
  const user = c.get('user');
  const scope = c.req.query('scope') ?? 'personal';
  const teamId = c.req.query('teamId');
  const parent = c.req.query('parent');

  let rows;
  if (scope === 'team' && teamId) {
    if (!(await isTeamMember(user.id, teamId))) {
      return c.json({ code: 403, message: '无权访问该团队文档', timestamp: new Date().toISOString() }, 403);
    }
    const conds = [eq(documents.team_id, teamId), isNull(documents.deleted_at), ...kindFilter(c.req.query('kind'))];
    conds.push(parent ? eq(documents.parent_id, parent) : isNull(documents.parent_id));
    rows = await db
      .select()
      .from(documents)
      .where(and(...conds))
      .orderBy(desc(documents.is_folder), desc(documents.updated_at));
  } else {
    const conds = [eq(documents.owner_id, user.id), ...kindFilter(c.req.query('kind')), isNull(documents.team_id), isNull(documents.deleted_at)];
    conds.push(parent ? eq(documents.parent_id, parent) : isNull(documents.parent_id));
    rows = await db
      .select()
      .from(documents)
      .where(and(...conds))
      .orderBy(desc(documents.is_folder), desc(documents.updated_at));
  }

  const accessible = await filterAccessible(user.id, rows);
  return c.json({
    code: 0,
    message: 'ok',
    data: accessible.map(({ doc, effective }) => toDto(doc, null, false, effective)),
    timestamp: new Date().toISOString(),
  });
});

// 知识库目录（全量平铺，供概览 / 搜索 / 移动目标选择）
documentsRouter.get('/wiki-toc', async (c) => {
  const user = c.get('user');
  const scope = c.req.query('scope') ?? 'personal';
  const teamId = c.req.query('teamId');

  let rows: (typeof documents.$inferSelect)[];
  if (scope === 'team' && teamId) {
    if (!(await isTeamMember(user.id, teamId))) {
      return c.json({ code: 403, message: '无权访问该团队文档', timestamp: new Date().toISOString() }, 403);
    }
    rows = await db
      .select()
      .from(documents)
      .where(and(eq(documents.team_id, teamId), eq(documents.kind, 'wiki'), isNull(documents.deleted_at)))
      .orderBy(desc(documents.updated_at));
  } else {
    rows = await db
      .select()
      .from(documents)
      .where(and(eq(documents.owner_id, user.id), isNull(documents.team_id), eq(documents.kind, 'wiki'), isNull(documents.deleted_at)))
      .orderBy(desc(documents.updated_at));
  }

  const accessible = await filterAccessible(user.id, rows);
  return c.json({
    code: 0,
    message: 'ok',
    data: accessible.map(({ doc, effective }) => ({
      id: doc.id,
      title: doc.title,
      parent_id: doc.parent_id,
      updated_at: doc.updated_at.toISOString(),
      visibility: doc.visibility,
      effective_permission: effective,
    })),
    timestamp: new Date().toISOString(),
  });
});

// 首页「最近文档」：必须注册在 /:id 之前
// tab=viewed（最近访问）| created（我创建的）| favorite（收藏）
documentsRouter.get('/recent', async (c) => {
  const user = c.get('user');
  const tab = c.req.query('tab') ?? 'viewed';
  const baseConds: SQL[] = [eq(documents.owner_id, user.id), isNull(documents.team_id), eq(documents.is_folder, false), isNull(documents.deleted_at)];

  let rows: (typeof documents.$inferSelect)[] = [];
  if (tab === 'favorite') {
    const joined = await db
      .select({ doc: documents })
      .from(documents)
      .innerJoin(
        documentFavorites,
        and(eq(documentFavorites.doc_id, documents.id), eq(documentFavorites.user_id, user.id)),
      )
      .where(and(...baseConds))
      .orderBy(desc(documentFavorites.created_at))
      .limit(20);
    rows = joined.map((r) => r.doc);
  } else if (tab === 'created') {
    rows = await db.select().from(documents).where(and(...baseConds)).orderBy(desc(documents.created_at)).limit(20);
  } else {
    rows = await db
      .select()
      .from(documents)
      .where(and(...baseConds))
      .orderBy(sql`${documents.last_viewed_at} desc nulls last`, desc(documents.updated_at))
      .limit(20);
  }

  const favRows = rows.length
    ? await db
        .select({ doc_id: documentFavorites.doc_id })
        .from(documentFavorites)
        .where(and(eq(documentFavorites.user_id, user.id), inArray(documentFavorites.doc_id, rows.map((r) => r.id))))
    : [];
  const favSet = new Set(favRows.map((f) => f.doc_id));

  return c.json({
    code: 0,
    message: 'ok',
    data: rows.map((d) => toDto(d, null, favSet.has(d.id))),
    timestamp: new Date().toISOString(),
  });
});

// 回收站列表（仅本人删除的文档）：必须注册在 /:id 之前
documentsRouter.get('/trash', async (c) => {
  const user = c.get('user');
  const rows = await db
    .select()
    .from(documents)
    .where(and(eq(documents.owner_id, user.id), isNull(documents.team_id), sql`${documents.deleted_at} is not null`))
    .orderBy(desc(documents.deleted_at))
    .limit(100);
  return c.json({
    code: 0,
    message: 'ok',
    data: rows.map((d) => ({
      id: d.id,
      title: d.title,
      kind: d.kind,
      is_folder: d.is_folder,
      deleted_at: d.deleted_at!.toISOString(),
    })),
    timestamp: new Date().toISOString(),
  });
});

// ===== 模板中心：必须注册在 /:id 之前 =====

// 模板列表（我的）
documentsRouter.get('/templates', async (c) => {
  const user = c.get('user');
  const rows = await db
    .select()
    .from(docTemplates)
    .where(eq(docTemplates.owner_id, user.id))
    .orderBy(desc(docTemplates.created_at));
  return c.json({
    code: 0,
    message: 'ok',
    data: rows.map((t) => ({
      id: t.id,
      title: t.title,
      content: t.content,
      kind: t.kind,
      created_at: t.created_at.toISOString(),
    })),
    timestamp: new Date().toISOString(),
  });
});

// 用模板创建文档
documentsRouter.post('/templates/:tid/use', async (c) => {
  const user = c.get('user');
  const [t] = await db.select().from(docTemplates).where(eq(docTemplates.id, c.req.param('tid'))).limit(1);
  if (!t) return c.json({ code: 404, message: '模板不存在', timestamp: new Date().toISOString() }, 404);
  const [doc] = await db
    .insert(documents)
    .values({ team_id: null, owner_id: user.id, kind: t.kind, title: t.title, content: t.content })
    .returning();
  return c.json({ code: 0, message: '已创建', data: toDto(doc, user.name), timestamp: new Date().toISOString() });
});

// 删除模板
documentsRouter.delete('/templates/:tid', async (c) => {
  const user = c.get('user');
  const [t] = await db.select().from(docTemplates).where(eq(docTemplates.id, c.req.param('tid'))).limit(1);
  if (!t) return c.json({ code: 404, message: '模板不存在', timestamp: new Date().toISOString() }, 404);
  if (t.owner_id !== user.id) return c.json({ code: 403, message: '无权删除', timestamp: new Date().toISOString() }, 403);
  await db.delete(docTemplates).where(eq(docTemplates.id, t.id));
  return c.json({ code: 0, message: '已删除', timestamp: new Date().toISOString() });
});

// 另存为模板
documentsRouter.post('/:id/save-as-template', async (c) => {
  const user = c.get('user');
  const { doc, error } = await findDoc(c, c.req.param('id'));
  if (error) return error;
  const body = (await c.req.json().catch(() => null)) as { title?: string } | null;
  const [t] = await db
    .insert(docTemplates)
    .values({ owner_id: user.id, title: body?.title?.trim() || `${doc!.title}（模板）`, content: doc!.content, kind: doc!.kind })
    .returning();
  return c.json({ code: 0, message: '已保存为模板', data: { id: t.id }, timestamp: new Date().toISOString() });
});

// ===== 分享链接管理（文档所有者） =====

// 开启/更新分享
documentsRouter.post('/:id/share', async (c) => {
  const user = c.get('user');
  const { doc, error } = await findDoc(c, c.req.param('id'));
  if (error) return error;
  const body = (await c.req.json().catch(() => null)) as { permission?: string } | null;
  const permission = body?.permission === 'edit' ? 'edit' : 'read';
  const [share] = await db
    .insert(documentShares)
    .values({ doc_id: doc!.id, permission, created_by: user.id })
    .onConflictDoUpdate({ target: documentShares.doc_id, set: { permission } })
    .returning();
  return c.json({
    code: 0,
    message: '已开启分享',
    data: { token: share.token, permission: share.permission },
    timestamp: new Date().toISOString(),
  });
});

// 查询分享状态
documentsRouter.get('/:id/share', async (c) => {
  const { doc, error } = await findDoc(c, c.req.param('id'));
  if (error) return error;
  const [share] = await db.select().from(documentShares).where(eq(documentShares.doc_id, doc!.id)).limit(1);
  return c.json({
    code: 0,
    message: 'ok',
    data: share ? { token: share.token, permission: share.permission } : null,
    timestamp: new Date().toISOString(),
  });
});

// 关闭分享
documentsRouter.delete('/:id/share', async (c) => {
  const { doc, error } = await findDoc(c, c.req.param('id'));
  if (error) return error;
  await db.delete(documentShares).where(eq(documentShares.doc_id, doc!.id));
  return c.json({ code: 0, message: '已关闭分享', timestamp: new Date().toISOString() });
});

// ===== 逐成员授权管理（需 manage） =====

// 授权成员列表（join users + teamMembers 取团队角色）
documentsRouter.get('/:id/access', async (c) => {
  const user = c.get('user');
  const { doc, error, effective } = await findDoc(c, c.req.param('id'));
  if (error) return error;
  if (effective !== 'manage') {
    return c.json({ code: 403, message: '需要管理权限', timestamp: new Date().toISOString() }, 403);
  }
  const rows = await db
    .select({
      user_id: documentAccess.user_id,
      name: users.name,
      email: users.email,
      avatar_url: users.avatar_url,
      permission: documentAccess.permission,
      role: teamMembers.role,
    })
    .from(documentAccess)
    .innerJoin(users, eq(documentAccess.user_id, users.id))
    .leftJoin(teamMembers, and(eq(teamMembers.user_id, users.id), doc!.team_id ? eq(teamMembers.team_id, doc!.team_id) : sql`false`))
    .where(eq(documentAccess.doc_id, doc!.id))
    .orderBy(desc(documentAccess.created_at));
  return c.json({
    code: 0,
    message: 'ok',
    data: rows.map((r) => ({
      user_id: r.user_id,
      name: r.name,
      email: r.email,
      avatar_url: r.avatar_url,
      permission: r.permission,
      team_role: r.role,
    })),
    timestamp: new Date().toISOString(),
  });
});

// upsert 单成员授权
documentsRouter.put('/:id/access', zValidator('json', SetDocAccessRequest), async (c) => {
  const user = c.get('user');
  const { doc, error, effective } = await findDoc(c, c.req.param('id'));
  if (error) return error;
  if (effective !== 'manage') {
    return c.json({ code: 403, message: '需要管理权限', timestamp: new Date().toISOString() }, 403);
  }
  const body = c.req.valid('json');
  const targetUser = body.user_id;
  if (targetUser === doc!.owner_id) {
    return c.json({ code: 400, message: '所有者无需授权', timestamp: new Date().toISOString() }, 400);
  }
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, targetUser)).limit(1);
  if (!u) return c.json({ code: 404, message: '目标用户不存在', timestamp: new Date().toISOString() }, 404);

  // 团队文档限团队内成员；个人文档可授权任意系统用户
  if (doc!.team_id) {
    const [tm] = await db
      .select({ user_id: teamMembers.user_id })
      .from(teamMembers)
      .where(and(eq(teamMembers.team_id, doc!.team_id), eq(teamMembers.user_id, targetUser)))
      .limit(1);
    if (!tm) {
      return c.json({ code: 403, message: '团队文档仅可授权本团队成员', timestamp: new Date().toISOString() }, 403);
    }
  }

  await db
    .insert(documentAccess)
    .values({ doc_id: doc!.id, user_id: targetUser, permission: body.permission, granted_by: user.id })
    .onConflictDoUpdate({
      target: [documentAccess.doc_id, documentAccess.user_id],
      set: { permission: body.permission, updated_at: new Date() },
    });
  return c.json({ code: 0, message: '已设置权限', timestamp: new Date().toISOString() });
});

// 移除授权
documentsRouter.delete('/:id/access/:userId', async (c) => {
  const { doc, error, effective } = await findDoc(c, c.req.param('id'));
  if (error) return error;
  if (effective !== 'manage') {
    return c.json({ code: 403, message: '需要管理权限', timestamp: new Date().toISOString() }, 403);
  }
  await db
    .delete(documentAccess)
    .where(and(eq(documentAccess.doc_id, doc!.id), eq(documentAccess.user_id, c.req.param('userId'))));
  return c.json({ code: 0, message: '已移除授权', timestamp: new Date().toISOString() });
});

// 反向链接：哪些文档通过 [[本文档标题]] 引用了本文档
documentsRouter.get('/:id/backlinks', async (c) => {
  const { doc, error } = await findDoc(c, c.req.param('id'));
  if (error) return error;
  const safeTitle = doc!.title.replace(/[%_\\]/g, '');
  if (!safeTitle) return c.json({ code: 0, message: 'ok', data: [], timestamp: new Date().toISOString() });
  const rows = await db
    .select({ id: documents.id, title: documents.title, kind: documents.kind, updated_at: documents.updated_at })
    .from(documents)
    .where(
      and(
        eq(documents.owner_id, doc!.owner_id),
        isNull(documents.deleted_at),
        eq(documents.is_folder, false),
        sql`${documents.id} != ${doc!.id}`,
        sql`${documents.content} ilike ${'%[[' + safeTitle + ']]%'}`,
      ),
    )
    .orderBy(desc(documents.updated_at))
    .limit(50);
  return c.json({
    code: 0,
    message: 'ok',
    data: rows.map((r) => ({ ...r, updated_at: r.updated_at.toISOString() })),
    timestamp: new Date().toISOString(),
  });
});

// 详情
documentsRouter.get('/:id', async (c) => {
  const { doc, error, effective } = await findDoc(c, c.req.param('id'));
  if (error) return error;
  const d = doc!;
  // 记录访问时间（用于首页「最近访问」排序）
  if (!d.is_folder) {
    await db.update(documents).set({ last_viewed_at: new Date() }).where(eq(documents.id, d.id));
  }
  // 查询创作者姓名 + 当前用户是否收藏
  const [owner] = await db.select({ name: users.name }).from(users).where(eq(users.id, d.owner_id)).limit(1);
  const user = c.get('user');
  const [fav] = await db
    .select({ doc_id: documentFavorites.doc_id })
    .from(documentFavorites)
    .where(and(eq(documentFavorites.doc_id, d.id), eq(documentFavorites.user_id, user.id)))
    .limit(1);
  return c.json({
    code: 0,
    message: 'ok',
    data: toDto(d, owner?.name ?? null, !!fav, effective!),
    timestamp: new Date().toISOString(),
  });
});

// 收藏 / 取消收藏（开关）
documentsRouter.post('/:id/favorite', async (c) => {
  const { doc, error } = await findDoc(c, c.req.param('id'));
  if (error) return error;
  const user = c.get('user');
  const cond = and(eq(documentFavorites.doc_id, doc!.id), eq(documentFavorites.user_id, user.id));
  const [existing] = await db.select().from(documentFavorites).where(cond).limit(1);
  if (existing) {
    await db.delete(documentFavorites).where(cond);
    return c.json({ code: 0, message: '已取消收藏', data: { favorited: false }, timestamp: new Date().toISOString() });
  }
  await db.insert(documentFavorites).values({ doc_id: doc!.id, user_id: user.id });
  return c.json({ code: 0, message: '已收藏', data: { favorited: true }, timestamp: new Date().toISOString() });
});

// 祖先链（面包屑）：返回从根到当前文档（含自身）的链
documentsRouter.get('/:id/ancestors', async (c) => {
  const { doc, error } = await findDoc(c, c.req.param('id'));
  if (error) return error;

  const chain: { id: string; title: string; parent_id: string | null }[] = [];
  let cur: typeof documents.$inferSelect | undefined = doc;
  while (cur) {
    chain.unshift({ id: cur.id, title: cur.title, parent_id: cur.parent_id });
    if (!cur.parent_id) break;
    const [p] = await db.select().from(documents).where(eq(documents.id, cur.parent_id)).limit(1);
    cur = p;
  }
  return c.json({ code: 0, message: 'ok', data: chain, timestamp: new Date().toISOString() });
});

// 创建
documentsRouter.post('/', zValidator('json', CreateDocRequest), async (c) => {
  const user = c.get('user');
  const body = c.req.valid('json');

  let teamId: string | null = null;
  if (body.scope === 'team') {
    if (!body.team_id) {
      return c.json({ code: 400, message: '缺少 team_id', timestamp: new Date().toISOString() }, 400);
    }
    if (!(await isTeamMember(user.id, body.team_id))) {
      return c.json({ code: 403, message: '无权在该团队创建文档', timestamp: new Date().toISOString() }, 403);
    }
    teamId = body.team_id;
  }

  const isFolder = body.is_folder ?? false;

  // 子级继承：优先 body 显式值，其次父级，最后按 scope 默认（team→team，personal→private）
  let visibility = body.visibility;
  let basePermission = body.base_permission;
  if (body.parent_id) {
    const [parent] = await db
      .select({ visibility: documents.visibility, base_permission: documents.base_permission })
      .from(documents)
      .where(eq(documents.id, body.parent_id))
      .limit(1);
    if (visibility === undefined && parent) visibility = parent.visibility;
    if (basePermission === undefined && parent) basePermission = parent.base_permission;
  }
  if (visibility === undefined) visibility = body.scope === 'team' ? 'team' : 'private';
  if (basePermission === undefined) basePermission = 'edit';

  const [doc] = await db
    .insert(documents)
    .values({
      team_id: teamId,
      owner_id: user.id,
      parent_id: body.parent_id ?? null,
      is_folder: isFolder,
      kind: body.kind,
      title: body.title,
      content: isFolder ? '' : (body.content ?? ''),
      icon: body.icon ?? null,
      cover: body.cover ?? null,
      visibility,
      base_permission: basePermission,
    })
    .returning();

  return c.json({ code: 0, message: '创建成功', data: toDto(doc, user.name), timestamp: new Date().toISOString() });
});

// 更新（自动版本快照：内容变化且距上个版本 >60s 时打点）
documentsRouter.patch('/:id', zValidator('json', UpdateDocRequest), async (c) => {
  const user = c.get('user');
  const body = c.req.valid('json');
  const { doc, error, effective } = await findDoc(c, c.req.param('id'));
  if (error) return error;

  // 变更可见范围 / 基础权限需 manage 权限
  if (body.visibility !== undefined || body.base_permission !== undefined) {
    if (effective !== 'manage') {
      return c.json({ code: 403, message: '需要管理权限', timestamp: new Date().toISOString() }, 403);
    }
  }

  // 内容/标题/结构等编辑操作需至少 edit 权限
  const editFields = ['title', 'content', 'parent_id', 'is_folder', 'icon', 'cover'];
  if (editFields.some((f) => f in body) && effective === 'read') {
    return c.json({ code: 403, message: '需要编辑权限', timestamp: new Date().toISOString() }, 403);
  }

  const patch: Record<string, unknown> = { ...body, updated_at: new Date() };
  const [updated] = await db.update(documents).set(patch).where(eq(documents.id, doc!.id)).returning();

  // 自动版本快照（防抖 60s，内容有变化才打点）
  if (body.content !== undefined && body.content !== doc!.content) {
    const [last] = await db
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.doc_id, doc!.id))
      .orderBy(desc(documentVersions.created_at))
      .limit(1);
    const should = !last || last.content !== body.content || Date.now() - last.created_at.getTime() > 60_000;
    if (should) {
      await db.insert(documentVersions).values({
        doc_id: doc!.id,
        created_by: user.id,
        title: (body.title ?? doc!.title),
        content: body.content,
        note: '自动保存版本',
      });
    }
  }

  return c.json({ code: 0, message: '已保存', data: toDto(updated), timestamp: new Date().toISOString() });
});

// 删除（软删除：进入回收站，子树一并标记）
documentsRouter.delete('/:id', async (c) => {
  const user = c.get('user');
  const [doc] = await db.select().from(documents).where(eq(documents.id, c.req.param('id'))).limit(1);
  if (!doc || doc.deleted_at) return c.json({ code: 404, message: '文档不存在', timestamp: new Date().toISOString() }, 404);

  const ctx = await loadDocAccessCtx(user.id, [doc.id], doc.team_id ? [doc.team_id] : []);
  const effective = await resolveDocAccess(user.id, doc, ctx);
  if (effective !== 'manage') {
    return c.json({ code: 403, message: '需要管理权限', timestamp: new Date().toISOString() }, 403);
  }

  // 级联标记子文档（知识库树 / 文件夹递归子树）
  const ids: string[] = [doc.id];
  const collect = async (parentId: string) => {
    const children = await db.select().from(documents).where(eq(documents.parent_id, parentId));
    for (const child of children) {
      ids.push(child.id);
      await collect(child.id);
    }
  };
  await collect(doc.id);
  await db.update(documents).set({ deleted_at: new Date() }).where(inArray(documents.id, ids));
  return c.json({ code: 0, message: '已移入回收站', timestamp: new Date().toISOString() });
});

// 从回收站恢复（父级已删则放到顶层）
documentsRouter.post('/:id/restore', async (c) => {
  const user = c.get('user');
  const [doc] = await db.select().from(documents).where(eq(documents.id, c.req.param('id'))).limit(1);
  if (!doc || !doc.deleted_at) return c.json({ code: 404, message: '文档不存在或不在回收站', timestamp: new Date().toISOString() }, 404);

  const ctx = await loadDocAccessCtx(user.id, [doc.id], doc.team_id ? [doc.team_id] : []);
  const effective = await resolveDocAccess(user.id, doc, ctx);
  if (effective !== 'manage') {
    return c.json({ code: 403, message: '需要管理权限', timestamp: new Date().toISOString() }, 403);
  }

  // 恢复整个子树
  const ids: string[] = [doc.id];
  const collect = async (parentId: string) => {
    const children = await db.select().from(documents).where(eq(documents.parent_id, parentId));
    for (const child of children) {
      ids.push(child.id);
      await collect(child.id);
    }
  };
  await collect(doc.id);

  // 父级不在线（已删除/不存在）则回顶层
  let parentId = doc.parent_id;
  if (parentId) {
    const [parent] = await db.select().from(documents).where(eq(documents.id, parentId)).limit(1);
    if (!parent || parent.deleted_at) parentId = null;
  }
  await db.update(documents).set({ deleted_at: null, parent_id: parentId }).where(eq(documents.id, doc.id));
  await db.update(documents).set({ deleted_at: null }).where(and(inArray(documents.id, ids), sql`${documents.id} != ${doc.id}`));
  return c.json({ code: 0, message: '已恢复', timestamp: new Date().toISOString() });
});

// 彻底删除（不可恢复）
documentsRouter.delete('/:id/permanent', async (c) => {
  const user = c.get('user');
  const [doc] = await db.select().from(documents).where(eq(documents.id, c.req.param('id'))).limit(1);
  if (!doc || !doc.deleted_at) return c.json({ code: 404, message: '文档不存在或不在回收站', timestamp: new Date().toISOString() }, 404);

  const ctx = await loadDocAccessCtx(user.id, [doc.id], doc.team_id ? [doc.team_id] : []);
  const effective = await resolveDocAccess(user.id, doc, ctx);
  if (effective !== 'manage') {
    return c.json({ code: 403, message: '需要管理权限', timestamp: new Date().toISOString() }, 403);
  }
  await db.delete(documents).where(eq(documents.id, doc.id));
  return c.json({ code: 0, message: '已彻底删除', timestamp: new Date().toISOString() });
});

// ===== 版本历史 =====

// 版本列表
documentsRouter.get('/:id/versions', async (c) => {
  const { doc, error } = await findDoc(c, c.req.param('id'));
  if (error) return error;

  const rows = await db
    .select({
      v: documentVersions,
      name: users.name,
    })
    .from(documentVersions)
    .leftJoin(users, eq(documentVersions.created_by, users.id))
    .where(eq(documentVersions.doc_id, doc!.id))
    .orderBy(desc(documentVersions.created_at));

  return c.json({
    code: 0,
    message: 'ok',
    data: rows.map(({ v, name }) => ({
      id: v.id,
      doc_id: v.doc_id,
      created_by: v.created_by,
      created_by_name: name ?? null,
      title: v.title,
      content: v.content,
      note: v.note,
      created_at: v.created_at.toISOString(),
    })),
    timestamp: new Date().toISOString(),
  });
});

// 手动创建版本快照
documentsRouter.post('/:id/versions', zValidator('json', CreateVersionRequest), async (c) => {
  const user = c.get('user');
  const body = c.req.valid('json');
  const { doc, error } = await findDoc(c, c.req.param('id'));
  if (error) return error;

  const [v] = await db
    .insert(documentVersions)
    .values({
      doc_id: doc!.id,
      created_by: user.id,
      title: doc!.title,
      content: doc!.content,
      note: body.note ?? '手动保存版本',
    })
    .returning();

  return c.json({
    code: 0,
    message: '已保存版本',
    data: {
      id: v.id,
      doc_id: v.doc_id,
      created_by: v.created_by,
      created_by_name: user.name,
      title: v.title,
      content: v.content,
      note: v.note,
      created_at: v.created_at.toISOString(),
    },
    timestamp: new Date().toISOString(),
  });
});

// 恢复版本（把版本内容写回文档）
documentsRouter.post('/:id/versions/:vid/restore', async (c) => {
  const user = c.get('user');
  const { doc, error } = await findDoc(c, c.req.param('id'));
  if (error) return error;

  const [v] = await db
    .select()
    .from(documentVersions)
    .where(and(eq(documentVersions.id, c.req.param('vid')), eq(documentVersions.doc_id, doc!.id)))
    .limit(1);
  if (!v) return c.json({ code: 404, message: '版本不存在', timestamp: new Date().toISOString() }, 404);

  const [updated] = await db
    .update(documents)
    .set({ title: v.title, content: v.content, updated_at: new Date() })
    .where(eq(documents.id, doc!.id))
    .returning();

  // 恢复也留一个快照，避免不可逆
  await db.insert(documentVersions).values({
    doc_id: doc!.id,
    created_by: user.id,
    title: doc!.title,
    content: doc!.content,
    note: '恢复版本前快照',
  });

  return c.json({ code: 0, message: '已恢复该版本', data: toDto(updated), timestamp: new Date().toISOString() });
});

// 评论 / 提及通知开关（避免重复代码）
async function notifyDocOwnerOrUser(
  recipientId: string | null,
  actor: { id: string; name: string },
  doc: { id: string; title: string; kind: string },
  n: { type: 'doc_comment' | 'mention'; content?: string },
) {
  if (!recipientId || recipientId === actor.id) return;
  const link = doc.kind === 'sheet' ? `/sheets/${doc.id}` : doc.kind === 'wiki' ? `/wiki/${doc.id}` : `/docs/${doc.id}`;
  const title = n.type === 'mention' ? `${actor.name} 在文档「${doc.title}」中提到了你` : `${actor.name} 评论了文档「${doc.title}」`;
  await db.insert(notifications).values({
    user_id: recipientId,
    type: n.type,
    title,
    content: (n.content ?? '').slice(0, 200),
    link,
  });
}

// ===== 评论 =====

// 提及通知（编辑器中 @成员 时调用）
documentsRouter.post('/:id/mentions', async (c) => {
  const user = c.get('user');
  const { doc, error } = await findDoc(c, c.req.param('id'));
  if (error) return error;
  const body = await c.req.json().catch(() => null) as { user_id?: string } | null;
  if (!body?.user_id) return c.json({ code: 400, message: '缺少 user_id', timestamp: new Date().toISOString() }, 400);
  await notifyDocOwnerOrUser(body.user_id, user, doc!, { type: 'mention' });
  return c.json({ code: 0, message: 'ok', timestamp: new Date().toISOString() });
});

// 评论列表
documentsRouter.get('/:id/comments', async (c) => {
  const { doc, error } = await findDoc(c, c.req.param('id'));
  if (error) return error;

  const rows = await db
    .select({
      cm: documentComments,
      name: users.name,
      email: users.email,
      avatar_url: users.avatar_url,
    })
    .from(documentComments)
    .innerJoin(users, eq(documentComments.user_id, users.id))
    .where(eq(documentComments.doc_id, doc!.id))
    .orderBy(desc(documentComments.created_at));

  return c.json({
    code: 0,
    message: 'ok',
    data: rows.map(({ cm, name, email, avatar_url }) => ({
      id: cm.id,
      doc_id: cm.doc_id,
      user_id: cm.user_id,
      user_name: name,
      user_email: email,
      avatar_url,
      content: cm.content,
      selection_start: cm.selection_start,
      selection_text: cm.selection_text,
      resolved: cm.resolved,
      created_at: cm.created_at.toISOString(),
    })),
    timestamp: new Date().toISOString(),
  });
});

// 发表评论
documentsRouter.post('/:id/comments', zValidator('json', CreateCommentRequest), async (c) => {
  const user = c.get('user');
  const body = c.req.valid('json');
  const { doc, error } = await findDoc(c, c.req.param('id'));
  if (error) return error;

  const [cm] = await db
    .insert(documentComments)
    .values({
      doc_id: doc!.id,
      user_id: user.id,
      content: body.content,
      selection_start: body.selection_start ?? 0,
      selection_text: body.selection_text ?? '',
    })
    .returning();

  // 通知：评论文档 → 通知文档所有者（自己不通知自己）
  await notifyDocOwnerOrUser(doc!.owner_id, user, doc!, { type: 'doc_comment', content: body.content });

  return c.json({
    code: 0,
    message: '评论成功',
    data: {
      id: cm.id,
      doc_id: cm.doc_id,
      user_id: cm.user_id,
      user_name: user.name,
      user_email: user.email,
      avatar_url: user.avatar_url,
      content: cm.content,
      selection_start: cm.selection_start,
      selection_text: cm.selection_text,
      resolved: cm.resolved,
      created_at: cm.created_at.toISOString(),
    },
    timestamp: new Date().toISOString(),
  });
});

// 删除评论（作者本人）
documentsRouter.delete('/:id/comments/:cid', async (c) => {
  const user = c.get('user');
  const { doc, error } = await findDoc(c, c.req.param('id'));
  if (error) return error;

  const [cm] = await db
    .select()
    .from(documentComments)
    .where(and(eq(documentComments.id, c.req.param('cid')), eq(documentComments.doc_id, doc!.id)))
    .limit(1);
  if (!cm) return c.json({ code: 404, message: '评论不存在', timestamp: new Date().toISOString() }, 404);
  if (cm.user_id !== user.id) {
    return c.json({ code: 403, message: '只能删除自己的评论', timestamp: new Date().toISOString() }, 403);
  }

  await db.delete(documentComments).where(eq(documentComments.id, cm.id));
  return c.json({ code: 0, message: '已删除评论', timestamp: new Date().toISOString() });
});

// 标记解决 / 取消解决（评论作者或文档拥有者）
documentsRouter.post('/:id/comments/:cid/resolve', async (c) => {
  const user = c.get('user');
  const { doc, error } = await findDoc(c, c.req.param('id'));
  if (error) return error;

  const [cm] = await db
    .select()
    .from(documentComments)
    .where(and(eq(documentComments.id, c.req.param('cid')), eq(documentComments.doc_id, doc!.id)))
    .limit(1);
  if (!cm) return c.json({ code: 404, message: '评论不存在', timestamp: new Date().toISOString() }, 404);

  const can = cm.user_id === user.id || doc!.owner_id === user.id;
  if (!can) {
    return c.json({ code: 403, message: '无权操作该评论', timestamp: new Date().toISOString() }, 403);
  }

  const [updated] = await db
    .update(documentComments)
    .set({ resolved: !cm.resolved })
    .where(eq(documentComments.id, cm.id))
    .returning();
  return c.json({
    code: 0,
    message: updated.resolved ? '已标记为解决' : '已重新打开',
    timestamp: new Date().toISOString(),
  });
});
