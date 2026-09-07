import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq, and, desc, count } from 'drizzle-orm';
import { db } from '../db/connection';
import { teams, teamMembers, users, documents, projects, aiConversations } from '../db/schema';
import { requireAuth, canManageTeam, getTeamRole } from '../middleware/session';
import { AddMemberRequest, CreateTeamRequest } from '@pulse-space/contracts';
import type { AppVariables } from '../types';

export const teamsRouter = new Hono<{ Variables: AppVariables }>();
teamsRouter.use('*', requireAuth);

// 我的团队列表
teamsRouter.get('/', async (c) => {
  const user = c.get('user');
  const rows = await db
    .select({
      team: teams,
      role: teamMembers.role,
    })
    .from(teamMembers)
    .innerJoin(teams, eq(teamMembers.team_id, teams.id))
    .where(eq(teamMembers.user_id, user.id))
    .orderBy(desc(teams.created_at));

  const list = await Promise.all(
    rows.map(async (r) => {
      const [cnt] = await db
        .select({ n: count(teamMembers.user_id) })
        .from(teamMembers)
        .where(eq(teamMembers.team_id, r.team.id));
      return {
        id: r.team.id,
        name: r.team.name,
        description: r.team.description,
        owner_id: r.team.owner_id,
        member_count: cnt.n,
        my_role: r.role,
        created_at: r.team.created_at.toISOString(),
        updated_at: r.team.updated_at.toISOString(),
      };
    }),
  );
  return c.json({ code: 0, message: 'ok', data: list, timestamp: new Date().toISOString() });
});

// 创建团队
teamsRouter.post('/', zValidator('json', CreateTeamRequest), async (c) => {
  const user = c.get('user');
  const body = c.req.valid('json');

  const [team] = await db
    .insert(teams)
    .values({ name: body.name, description: body.description, owner_id: user.id })
    .returning();
  await db.insert(teamMembers).values({ team_id: team.id, user_id: user.id, role: 'owner' });

  return c.json({
    code: 0,
    message: '创建成功',
    data: { id: team.id, name: team.name, description: team.description, owner_id: team.owner_id },
    timestamp: new Date().toISOString(),
  });
});

// 团队详情（含成员）
teamsRouter.get('/:id', async (c) => {
  const user = c.get('user');
  const teamId = c.req.param('id');

  const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
  if (!team) return c.json({ code: 404, message: '团队不存在', timestamp: new Date().toISOString() }, 404);

  const myRole = await getTeamRole(user.id, teamId);
  if (!myRole) {
    return c.json({ code: 403, message: '你不是该团队成员', timestamp: new Date().toISOString() }, 403);
  }

  const memberRows = await db
    .select({
      user_id: teamMembers.user_id,
      email: users.email,
      name: users.name,
      avatar_url: users.avatar_url,
      role: teamMembers.role,
      joined_at: teamMembers.joined_at,
    })
    .from(teamMembers)
    .innerJoin(users, eq(teamMembers.user_id, users.id))
    .where(eq(teamMembers.team_id, teamId));

  const [{ n }] = await db
    .select({ n: count(teamMembers.user_id) })
    .from(teamMembers)
    .where(eq(teamMembers.team_id, teamId));

  return c.json({
    code: 0,
    message: 'ok',
    data: {
      id: team.id,
      name: team.name,
      description: team.description,
      owner_id: team.owner_id,
      member_count: n,
      my_role: myRole,
      created_at: team.created_at.toISOString(),
      updated_at: team.updated_at.toISOString(),
      members: memberRows.map((m) => ({
        user_id: m.user_id,
        email: m.email,
        name: m.name,
        avatar_url: m.avatar_url,
        role: m.role,
        joined_at: m.joined_at.toISOString(),
      })),
    },
    timestamp: new Date().toISOString(),
  });
});

// 更新团队
teamsRouter.patch('/:id', zValidator('json', CreateTeamRequest.partial()), async (c) => {
  const user = c.get('user');
  const teamId = c.req.param('id');
  const body = c.req.valid('json');

  if (!(await canManageTeam(user.id, teamId))) {
    return c.json({ code: 403, message: '无权限操作团队', timestamp: new Date().toISOString() }, 403);
  }
  await db.update(teams).set(body).where(eq(teams.id, teamId));
  return c.json({ code: 0, message: '已更新', timestamp: new Date().toISOString() });
});

// 删除团队
teamsRouter.delete('/:id', async (c) => {
  const user = c.get('user');
  const teamId = c.req.param('id');

  const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
  if (!team) return c.json({ code: 404, message: '团队不存在', timestamp: new Date().toISOString() }, 404);
  if (team.owner_id !== user.id) {
    return c.json({ code: 403, message: '仅创建者可删除团队', timestamp: new Date().toISOString() }, 403);
  }
  await db.delete(teams).where(eq(teams.id, teamId));
  return c.json({ code: 0, message: '已删除', timestamp: new Date().toISOString() });
});

// 添加成员（按邮箱邀请）
teamsRouter.post('/:id/members', zValidator('json', AddMemberRequest), async (c) => {
  const user = c.get('user');
  const teamId = c.req.param('id');
  const body = c.req.valid('json');

  if (!(await canManageTeam(user.id, teamId))) {
    return c.json({ code: 403, message: '无权限添加成员', timestamp: new Date().toISOString() }, 403);
  }
  const [target] = await db.select().from(users).where(eq(users.email, body.email)).limit(1);
  if (!target) {
    return c.json({ code: 404, message: '该邮箱未注册', timestamp: new Date().toISOString() }, 404);
  }

  const [existing] = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.team_id, teamId), eq(teamMembers.user_id, target.id)))
    .limit(1);
  if (existing) {
    return c.json({ code: 400, message: '该成员已在团队中', timestamp: new Date().toISOString() }, 400);
  }

  await db.insert(teamMembers).values({ team_id: teamId, user_id: target.id, role: body.role });
  return c.json({ code: 0, message: '已添加成员', timestamp: new Date().toISOString() });
});

// 调整成员角色
teamsRouter.patch('/:id/members/:userId', async (c) => {
  const user = c.get('user');
  const teamId = c.req.param('id');
  const userId = c.req.param('userId');
  const role = c.req.query('role') as 'owner' | 'admin' | 'member';

  if (!(await canManageTeam(user.id, teamId))) {
    return c.json({ code: 403, message: '无权限操作成员', timestamp: new Date().toISOString() }, 403);
  }
  if (!['owner', 'admin', 'member'].includes(role)) {
    return c.json({ code: 400, message: '角色不合法', timestamp: new Date().toISOString() }, 400);
  }
  await db
    .update(teamMembers)
    .set({ role })
    .where(and(eq(teamMembers.team_id, teamId), eq(teamMembers.user_id, userId)));
  return c.json({ code: 0, message: '已更新角色', timestamp: new Date().toISOString() });
});

// 移除成员
teamsRouter.delete('/:id/members/:userId', async (c) => {
  const user = c.get('user');
  const teamId = c.req.param('id');
  const userId = c.req.param('userId');

  if (!(await canManageTeam(user.id, teamId))) {
    return c.json({ code: 403, message: '无权限移除成员', timestamp: new Date().toISOString() }, 403);
  }
  await db
    .delete(teamMembers)
    .where(and(eq(teamMembers.team_id, teamId), eq(teamMembers.user_id, userId)));
  return c.json({ code: 0, message: '已移除成员', timestamp: new Date().toISOString() });
});

// 团队统计（供团队空间展示）
teamsRouter.get('/:id/stats', async (c) => {
  const user = c.get('user');
  const teamId = c.req.param('id');
  if (!(await getTeamRole(user.id, teamId))) {
    return c.json({ code: 403, message: '无权限访问', timestamp: new Date().toISOString() }, 403);
  }
  const docs = await db.select({ id: documents.id }).from(documents).where(eq(documents.team_id, teamId));
  const projs = await db.select({ id: projects.id }).from(projects).where(eq(projects.team_id, teamId));
  const convs = await db.select({ id: aiConversations.id }).from(aiConversations).where(eq(aiConversations.team_id, teamId));
  return c.json({
    code: 0,
    message: 'ok',
    data: { doc_count: docs.length, project_count: projs.length, ai_conversation_count: convs.length },
    timestamp: new Date().toISOString(),
  });
});
