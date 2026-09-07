import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq, ilike, or, count, desc, sql } from 'drizzle-orm';
import { db } from '../db/connection';
import {
  users,
  teams,
  teamMembers,
  documents,
  projects,
  requirements,
  tasks,
  aiConversations,
  milestones,
  projectComments,
  notifications,
} from '../db/schema';
import { requireAdmin } from '../middleware/session';
import { AdminSetUserRequest } from '@pulse-space/contracts';
import type { AppVariables } from '../types';

export const adminRouter = new Hono<{ Variables: AppVariables }>();
adminRouter.use('*', requireAdmin);

const ok = (data: unknown, message = 'ok') => ({
  code: 0,
  message,
  data,
  timestamp: new Date().toISOString(),
});

// ===== 平台概览统计 =====
adminRouter.get('/stats', async (c) => {
  const [uc] = await db.select({ n: count(users.id) }).from(users);
  const [tc] = await db.select({ n: count(teams.id) }).from(teams);
  const [dc] = await db.select({ n: count(documents.id) }).from(documents);
  const [pc] = await db.select({ n: count(projects.id) }).from(projects);
  const [rc] = await db.select({ n: count(requirements.id) }).from(requirements);
  const [kc] = await db.select({ n: count(tasks.id) }).from(tasks);
  const [ac] = await db.select({ n: count(aiConversations.id) }).from(aiConversations);
  const [mc] = await db.select({ n: count(milestones.id) }).from(milestones);
  const [cc] = await db.select({ n: count(projectComments.id) }).from(projectComments);
  const [nc] = await db.select({ n: count(notifications.id) }).from(notifications);
  const [dd] = await db.select({ n: count(documents.id) }).from(documents).where(sql`${documents.deleted_at} is not null`);
  const [dp] = await db.select({ n: count(projects.id) }).from(projects).where(sql`${projects.deleted_at} is not null`);

  return c.json(
    ok({
      user_count: uc.n,
      team_count: tc.n,
      document_count: dc.n,
      project_count: pc.n,
      requirement_count: rc.n,
      task_count: kc.n,
      ai_conversation_count: ac.n,
      milestone_count: mc.n,
      comment_count: cc.n,
      notification_count: nc.n,
      deleted_document_count: dd.n,
      deleted_project_count: dp.n,
    }),
  );
});

// ===== 用户管理 =====
adminRouter.get('/users', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      avatar_url: users.avatar_url,
      is_admin: users.is_admin,
      created_at: users.created_at,
    })
    .from(users)
    .where(q ? or(ilike(users.email, `%${q}%`), ilike(users.name, `%${q}%`)) : undefined)
    .orderBy(desc(users.created_at));

  return c.json(ok(rows.map((r) => ({ ...r, created_at: r.created_at.toISOString() }))));
});

// 设为 / 取消管理员
adminRouter.patch('/users/:id', zValidator('json', AdminSetUserRequest), async (c) => {
  const admin = c.get('user');
  const userId = c.req.param('id');
  const body = c.req.valid('json');

  if (userId === admin.id) {
    return c.json({ code: 400, message: '不能修改自己的管理员状态', timestamp: new Date().toISOString() }, 400);
  }
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  if (!u) return c.json({ code: 404, message: '用户不存在', timestamp: new Date().toISOString() }, 404);

  await db.update(users).set({ is_admin: body.is_admin }).where(eq(users.id, userId));
  return c.json(ok(null, body.is_admin ? '已设为管理员' : '已取消管理员'));
});

// 删除用户
adminRouter.delete('/users/:id', async (c) => {
  const admin = c.get('user');
  const userId = c.req.param('id');

  if (userId === admin.id) {
    return c.json({ code: 400, message: '不能删除当前登录账号', timestamp: new Date().toISOString() }, 400);
  }
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  if (!u) return c.json({ code: 404, message: '用户不存在', timestamp: new Date().toISOString() }, 404);

  await db.delete(users).where(eq(users.id, userId));
  return c.json(ok(null, '已删除用户'));
});

// ===== 团队管理 =====
adminRouter.get('/teams', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  const rows = await db
    .select({
      id: teams.id,
      name: teams.name,
      description: teams.description,
      owner_id: teams.owner_id,
      owner_name: users.name,
      member_count: count(teamMembers.user_id),
      created_at: teams.created_at,
    })
    .from(teams)
    .innerJoin(users, eq(teams.owner_id, users.id))
    .leftJoin(teamMembers, eq(teamMembers.team_id, teams.id))
    .where(q ? ilike(teams.name, `%${q}%`) : undefined)
    .groupBy(teams.id, teams.name, teams.description, teams.owner_id, users.name, teams.created_at)
    .orderBy(desc(teams.created_at));

  return c.json(ok(rows.map((r) => ({ ...r, created_at: r.created_at.toISOString() }))));
});

// 解散团队
adminRouter.delete('/teams/:id', async (c) => {
  const teamId = c.req.param('id');
  const [t] = await db.select({ id: teams.id }).from(teams).where(eq(teams.id, teamId)).limit(1);
  if (!t) return c.json({ code: 404, message: '团队不存在', timestamp: new Date().toISOString() }, 404);

  await db.delete(teams).where(eq(teams.id, teamId));
  return c.json(ok(null, '已解散团队'));
});

// ===== 文档管理 =====
adminRouter.get('/documents', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  const rows = await db
    .select({
      id: documents.id,
      title: documents.title,
      kind: documents.kind,
      owner_id: documents.owner_id,
      owner_name: users.name,
      team_id: documents.team_id,
      is_folder: documents.is_folder,
      deleted_at: documents.deleted_at,
      created_at: documents.created_at,
      updated_at: documents.updated_at,
    })
    .from(documents)
    .innerJoin(users, eq(documents.owner_id, users.id))
    .where(q ? ilike(documents.title, `%${q}%`) : undefined)
    .orderBy(desc(documents.updated_at));

  return c.json(
    ok(
      rows.map((r) => ({
        ...r,
        deleted_at: r.deleted_at ? r.deleted_at.toISOString() : null,
        created_at: r.created_at.toISOString(),
        updated_at: r.updated_at.toISOString(),
      })),
    ),
  );
});

// 删除文档
adminRouter.delete('/documents/:id', async (c) => {
  const docId = c.req.param('id');
  const [d] = await db.select({ id: documents.id }).from(documents).where(eq(documents.id, docId)).limit(1);
  if (!d) return c.json({ code: 404, message: '文档不存在', timestamp: new Date().toISOString() }, 404);

  await db.delete(documents).where(eq(documents.id, docId));
  return c.json(ok(null, '已删除文档'));
});

// ===== 项目管理 =====
adminRouter.get('/projects', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      description: projects.description,
      status: projects.status,
      owner_id: projects.owner_id,
      owner_name: users.name,
      team_id: projects.team_id,
      deleted_at: projects.deleted_at,
      created_at: projects.created_at,
      updated_at: projects.updated_at,
    })
    .from(projects)
    .innerJoin(users, eq(projects.owner_id, users.id))
    .where(q ? ilike(projects.name, `%${q}%`) : undefined)
    .orderBy(desc(projects.updated_at));

  return c.json(
    ok(
      rows.map((r) => ({
        ...r,
        deleted_at: r.deleted_at ? r.deleted_at.toISOString() : null,
        created_at: r.created_at.toISOString(),
        updated_at: r.updated_at.toISOString(),
      })),
    ),
  );
});

// 删除项目
adminRouter.delete('/projects/:id', async (c) => {
  const projectId = c.req.param('id');
  const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!p) return c.json({ code: 404, message: '项目不存在', timestamp: new Date().toISOString() }, 404);

  await db.delete(projects).where(eq(projects.id, projectId));
  return c.json(ok(null, '已删除项目'));
});

// ===== 评论审计 =====
adminRouter.get('/comments', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  const rows = await db
    .select({
      id: projectComments.id,
      target_type: projectComments.target_type,
      target_id: projectComments.target_id,
      content: projectComments.content,
      created_at: projectComments.created_at,
      user_id: users.id,
      user_name: users.name,
      user_email: users.email,
    })
    .from(projectComments)
    .innerJoin(users, eq(projectComments.user_id, users.id))
    .where(q ? ilike(projectComments.content, `%${q}%`) : undefined)
    .orderBy(desc(projectComments.created_at))
    .limit(200);

  return c.json(
    ok(rows.map((r) => ({ ...r, created_at: r.created_at.toISOString() }))),
  );
});

// 删除评论（内容治理）
adminRouter.delete('/comments/:id', async (c) => {
  const [row] = await db.select({ id: projectComments.id }).from(projectComments).where(eq(projectComments.id, c.req.param('id'))).limit(1);
  if (!row) return c.json({ code: 404, message: '评论不存在', timestamp: new Date().toISOString() }, 404);
  await db.delete(projectComments).where(eq(projectComments.id, row.id));
  return c.json(ok(null, '已删除评论'));
});