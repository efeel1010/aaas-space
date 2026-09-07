import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq, and, or, asc, desc, isNull, inArray, sql } from 'drizzle-orm';
import { db } from '../db/connection';
import {
  projects,
  requirements,
  tasks,
  users,
  milestones,
  projectComments,
  projectCollaborators,
  requirementCollaborators,
  taskCollaborators,
  teamMembers,
  notifications,
} from '../db/schema';
import { requireAuth, isTeamMember } from '../middleware/session';
import {
  CreateProjectRequest,
  UpdateProjectRequest,
  CreateRequirementRequest,
  UpdateRequirementRequest,
  CreateTaskRequest,
  UpdateTaskRequest,
  CreateMilestoneRequest,
  CreateProjectCommentRequest,
} from '@pulse-space/contracts';
import type { Collaborator } from '@pulse-space/contracts';
import type { AppVariables } from '../types';

export const projectsRouter = new Hono<{ Variables: AppVariables }>();
projectsRouter.use('*', requireAuth);

// ===== 权限助手 =====
async function canAccessProject(user: { id: string }, projectId: string): Promise<boolean> {
  const [p] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!p) return false;
  if (p.team_id) return isTeamMember(user.id, p.team_id);
  return p.owner_id === user.id;
}

async function getProjectOr403(
  user: { id: string },
  projectId: string,
): Promise<{ p: typeof projects.$inferSelect | null; err: 0 | 403 | 404 }> {
  const [p] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!p || p.deleted_at) return { p: null, err: 404 };
  if (p.team_id) {
    if (!(await isTeamMember(user.id, p.team_id))) return { p: null, err: 403 };
  } else if (p.owner_id !== user.id) {
    return { p: null, err: 403 };
  }
  return { p, err: 0 };
}

// ===== 通用助手 =====
const toIso = (d: Date | null) => (d ? d.toISOString() : null);

// 通知助手：自己触发的动作不通知自己
async function notify(
  recipientId: string | null | undefined,
  actorId: string,
  n: { type: 'comment' | 'task_assigned'; title: string; content?: string; link?: string },
) {
  if (!recipientId || recipientId === actorId) return;
  await db.insert(notifications).values({
    user_id: recipientId,
    type: n.type,
    title: n.title,
    content: n.content ?? '',
    link: n.link ?? null,
  });
}

function groupByFk(rows: { fk: string; id: string; name: string; avatar_url: string | null }[]): Map<string, Collaborator[]> {
  const m = new Map<string, Collaborator[]>();
  for (const r of rows) {
    const arr = m.get(r.fk) ?? [];
    arr.push({ user_id: r.id, name: r.name, avatar_url: r.avatar_url });
    m.set(r.fk, arr);
  }
  return m;
}

async function userNamesByIds(ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids));
  return new Map(rows.map((r) => [r.id, r.name]));
}

// 校验协作人 id 均为系统用户（去重；invalid 返 false，避免写入废 id）
async function assertUsersExist(ids: string[]): Promise<boolean> {
  if (!ids.length) return true;
  const rows = await db.select({ id: users.id }).from(users).where(inArray(users.id, ids));
  return rows.length === ids.length;
}

async function projectCollaboratorMap(ids: string[]): Promise<Map<string, Collaborator[]>> {
  if (!ids.length) return new Map();
  const rows = await db
    .select({ fk: projectCollaborators.project_id, id: users.id, name: users.name, avatar_url: users.avatar_url })
    .from(projectCollaborators)
    .innerJoin(users, eq(users.id, projectCollaborators.user_id))
    .where(inArray(projectCollaborators.project_id, ids));
  return groupByFk(rows);
}
async function requirementCollaboratorMap(ids: string[]): Promise<Map<string, Collaborator[]>> {
  if (!ids.length) return new Map();
  const rows = await db
    .select({ fk: requirementCollaborators.requirement_id, id: users.id, name: users.name, avatar_url: users.avatar_url })
    .from(requirementCollaborators)
    .innerJoin(users, eq(users.id, requirementCollaborators.user_id))
    .where(inArray(requirementCollaborators.requirement_id, ids));
  return groupByFk(rows);
}
async function taskCollaboratorMap(ids: string[]): Promise<Map<string, Collaborator[]>> {
  if (!ids.length) return new Map();
  const rows = await db
    .select({ fk: taskCollaborators.task_id, id: users.id, name: users.name, avatar_url: users.avatar_url })
    .from(taskCollaborators)
    .innerJoin(users, eq(users.id, taskCollaborators.user_id))
    .where(inArray(taskCollaborators.task_id, ids));
  return groupByFk(rows);
}

type ProjectCounts = { requirement_count: number; task_count: number; done_task_count: number };
async function projectCounts(ids: string[]): Promise<Map<string, ProjectCounts>> {
  const m = new Map<string, ProjectCounts>();
  if (!ids.length) return m;
  const reqRows = await db
    .select({ id: requirements.id, project_id: requirements.project_id })
    .from(requirements)
    .where(inArray(requirements.project_id, ids));
  const reqIds = reqRows.map((r) => r.id);
  const taskRows = reqIds.length
    ? await db
        .select({ requirement_id: tasks.requirement_id, status: tasks.status })
        .from(tasks)
        .where(inArray(tasks.requirement_id, reqIds))
    : [];
  for (const id of ids) {
    const reqCount = reqRows.filter((r) => r.project_id === id).length;
    const t = taskRows.filter((r) => reqRows.some((x) => x.id === r.requirement_id && x.project_id === id));
    m.set(id, {
      requirement_count: reqCount,
      task_count: t.length,
      done_task_count: t.filter((x) => x.status === 'done').length,
    });
  }
  return m;
}

async function requirementTaskCounts(ids: string[]): Promise<Map<string, { task_count: number; done_task_count: number }>> {
  const m = new Map<string, { task_count: number; done_task_count: number }>();
  if (!ids.length) return m;
  const rows = await db
    .select({ requirement_id: tasks.requirement_id, status: tasks.status })
    .from(tasks)
    .where(inArray(tasks.requirement_id, ids));
  for (const id of ids) {
    const t = rows.filter((r) => r.requirement_id === id);
    m.set(id, { task_count: t.length, done_task_count: t.filter((x) => x.status === 'done').length });
  }
  return m;
}

// ===== DTO 构建 =====
function projectDto(
  p: typeof projects.$inferSelect,
  ownerName: string | null,
  collaborators: Collaborator[],
  counts: ProjectCounts,
) {
  return {
    id: p.id,
    team_id: p.team_id,
    owner_id: p.owner_id,
    owner_name: ownerName,
    name: p.name,
    description: p.description,
    status: p.status,
    plan_start_at: toIso(p.plan_start_at),
    plan_end_at: toIso(p.plan_end_at),
    actual_start_at: toIso(p.actual_start_at),
    actual_end_at: toIso(p.actual_end_at),
    collaborators,
    requirement_count: counts.requirement_count,
    task_count: counts.task_count,
    done_task_count: counts.done_task_count,
    created_at: p.created_at.toISOString(),
    updated_at: p.updated_at.toISOString(),
  };
}

function requirementDto(
  r: typeof requirements.$inferSelect,
  ownerName: string | null,
  collaborators: Collaborator[],
  counts: { task_count: number; done_task_count: number },
) {
  return {
    id: r.id,
    project_id: r.project_id,
    title: r.title,
    description: r.description,
    status: r.status,
    priority: r.priority,
    owner_id: r.owner_id,
    owner_name: ownerName,
    plan_start_at: toIso(r.plan_start_at),
    plan_end_at: toIso(r.plan_end_at),
    actual_start_at: toIso(r.actual_start_at),
    actual_end_at: toIso(r.actual_end_at),
    collaborators,
    task_count: counts.task_count,
    done_task_count: counts.done_task_count,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}

function taskDto(
  t: typeof tasks.$inferSelect,
  assigneeName: string | null,
  collaborators: Collaborator[],
) {
  return {
    id: t.id,
    requirement_id: t.requirement_id,
    title: t.title,
    description: t.description,
    status: t.status,
    priority: t.priority,
    assignee_id: t.assignee_id,
    assignee_name: assigneeName,
    owner_name: assigneeName,
    due_date: toIso(t.due_date),
    plan_start_at: toIso(t.plan_start_at),
    plan_end_at: toIso(t.plan_end_at),
    actual_start_at: toIso(t.actual_start_at),
    actual_end_at: toIso(t.actual_end_at),
    collaborators,
    created_at: t.created_at.toISOString(),
    updated_at: t.updated_at.toISOString(),
  };
}

// ===== 项目 =====
projectsRouter.get('/', async (c) => {
  const user = c.get('user');
  const scope = c.req.query('scope') ?? 'personal';
  const teamId = c.req.query('teamId');

  let rows;
  if (scope === 'team' && teamId) {
    if (!(await isTeamMember(user.id, teamId))) {
      return c.json({ code: 403, message: '无权访问', timestamp: new Date().toISOString() }, 403);
    }
    rows = await db.select().from(projects).where(and(eq(projects.team_id, teamId), isNull(projects.deleted_at))).orderBy(desc(projects.updated_at));
  } else {
    rows = await db
      .select()
      .from(projects)
      .where(and(eq(projects.owner_id, user.id), isNull(projects.team_id), isNull(projects.deleted_at)))
      .orderBy(desc(projects.updated_at));
  }

  const ids = rows.map((p) => p.id);
  const ownerNames = await userNamesByIds(rows.map((p) => p.owner_id));
  const collabMap = await projectCollaboratorMap(ids);
  const countsMap = await projectCounts(ids);

  const list = rows.map((p) => {
    const counts = countsMap.get(p.id) ?? { requirement_count: 0, task_count: 0, done_task_count: 0 };
    const collabs = collabMap.get(p.id) ?? [];
    return projectDto(p, ownerNames.get(p.owner_id) ?? null, collabs, counts);
  });

  return c.json({ code: 0, message: 'ok', data: list, timestamp: new Date().toISOString() });
});

projectsRouter.post('/', zValidator('json', CreateProjectRequest), async (c) => {
  const user = c.get('user');
  const body = c.req.valid('json');

  let teamId: string | null = null;
  if (body.scope === 'team') {
    if (!body.team_id) return c.json({ code: 400, message: '缺少 team_id', timestamp: new Date().toISOString() }, 400);
    if (!(await isTeamMember(user.id, body.team_id))) {
      return c.json({ code: 403, message: '无权在该团队创建项目', timestamp: new Date().toISOString() }, 403);
    }
    teamId = body.team_id;
  }

  const collaboratorIds = Array.from(new Set(body.collaborator_ids ?? []));
  if (!(await assertUsersExist(collaboratorIds))) {
    return c.json({ code: 400, message: '包含不存在的协作人', timestamp: new Date().toISOString() }, 400);
  }

  const p = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(projects)
      .values({
        team_id: teamId,
        owner_id: user.id,
        name: body.name,
        description: body.description,
        plan_start_at: body.plan_start_at ? new Date(body.plan_start_at) : null,
        plan_end_at: body.plan_end_at ? new Date(body.plan_end_at) : null,
        actual_start_at: body.actual_start_at ? new Date(body.actual_start_at) : null,
        actual_end_at: body.actual_end_at ? new Date(body.actual_end_at) : null,
      })
      .returning();
    if (collaboratorIds.length) {
      await tx
        .insert(projectCollaborators)
        .values(collaboratorIds.map((user_id) => ({ project_id: created.id, user_id })));
    }
    return created;
  });

  const ownerNames = await userNamesByIds([p.owner_id]);
  return c.json({
    code: 0,
    message: '创建成功',
    data: projectDto(
      p,
      ownerNames.get(p.owner_id) ?? null,
      p.id ? (await projectCollaboratorMap([p.id])).get(p.id) ?? [] : [],
      { requirement_count: 0, task_count: 0, done_task_count: 0 },
    ),
    timestamp: new Date().toISOString(),
  });
});

// ===== 评论（需求 / 任务，多态目标） =====
// 注意：静态路由 /comments 必须注册在 /:id 之前，避免被抢占

// 解析评论目标所属项目
async function projectIdForTarget(targetType: 'requirement' | 'task', targetId: string): Promise<string | null> {
  if (targetType === 'requirement') {
    const [r] = await db.select({ project_id: requirements.project_id }).from(requirements).where(eq(requirements.id, targetId)).limit(1);
    return r?.project_id ?? null;
  }
  const [t] = await db.select({ requirement_id: tasks.requirement_id }).from(tasks).where(eq(tasks.id, targetId)).limit(1);
  if (!t) return null;
  const [r] = await db.select({ project_id: requirements.project_id }).from(requirements).where(eq(requirements.id, t.requirement_id)).limit(1);
  return r?.project_id ?? null;
}

// 列表
projectsRouter.get('/comments', async (c) => {
  const user = c.get('user');
  const targetType = c.req.query('target_type');
  const targetId = c.req.query('target_id');
  if ((targetType !== 'requirement' && targetType !== 'task') || !targetId) {
    return c.json({ code: 400, message: '参数错误', timestamp: new Date().toISOString() }, 400);
  }
  const projectId = await projectIdForTarget(targetType, targetId);
  if (!projectId) return c.json({ code: 404, message: '目标不存在', timestamp: new Date().toISOString() }, 404);
  const { err } = await getProjectOr403(user, projectId);
  if (err) return c.json({ code: err, message: err === 404 ? '项目不存在' : '无权访问', timestamp: new Date().toISOString() }, err);
  const rows = await db
    .select({
      id: projectComments.id,
      target_type: projectComments.target_type,
      target_id: projectComments.target_id,
      user_id: projectComments.user_id,
      user_name: users.name,
      avatar_url: users.avatar_url,
      content: projectComments.content,
      created_at: projectComments.created_at,
    })
    .from(projectComments)
    .innerJoin(users, eq(users.id, projectComments.user_id))
    .where(and(eq(projectComments.target_type, targetType), eq(projectComments.target_id, targetId)))
    .orderBy(projectComments.created_at);
  return c.json({
    code: 0,
    message: 'ok',
    data: rows.map((r) => ({ ...r, created_at: r.created_at.toISOString() })),
    timestamp: new Date().toISOString(),
  });
});

// 创建
projectsRouter.post('/comments', zValidator('json', CreateProjectCommentRequest), async (c) => {
  const user = c.get('user');
  const body = c.req.valid('json');
  const projectId = await projectIdForTarget(body.target_type, body.target_id);
  if (!projectId) return c.json({ code: 404, message: '目标不存在', timestamp: new Date().toISOString() }, 404);
  const { err } = await getProjectOr403(user, projectId);
  if (err) return c.json({ code: err, message: err === 404 ? '项目不存在' : '无权访问', timestamp: new Date().toISOString() }, err);
  const [row] = await db
    .insert(projectComments)
    .values({ target_type: body.target_type, target_id: body.target_id, user_id: user.id, content: body.content })
    .returning();

  // 通知：评论需求 → 通知需求负责人；评论任务 → 通知任务负责人
  if (body.target_type === 'requirement') {
    const [r] = await db.select().from(requirements).where(eq(requirements.id, body.target_id)).limit(1);
    await notify(r?.owner_id, user.id, {
      type: 'comment',
      title: `${user.name} 评论了需求「${r?.title ?? ''}」`,
      content: body.content.slice(0, 200),
      link: `/projects/${projectId}`,
    });
  } else {
    const [t] = await db.select().from(tasks).where(eq(tasks.id, body.target_id)).limit(1);
    await notify(t?.assignee_id, user.id, {
      type: 'comment',
      title: `${user.name} 评论了任务「${t?.title ?? ''}」`,
      content: body.content.slice(0, 200),
      link: `/projects/${projectId}`,
    });
  }

  return c.json({ code: 0, message: '已评论', data: { id: row.id }, timestamp: new Date().toISOString() });
});

// 删除（仅作者）
projectsRouter.delete('/comments/:cid', async (c) => {
  const user = c.get('user');
  const [row] = await db.select().from(projectComments).where(eq(projectComments.id, c.req.param('cid'))).limit(1);
  if (!row) return c.json({ code: 404, message: '评论不存在', timestamp: new Date().toISOString() }, 404);
  if (row.user_id !== user.id) return c.json({ code: 403, message: '只能删除自己的评论', timestamp: new Date().toISOString() }, 403);
  await db.delete(projectComments).where(eq(projectComments.id, row.id));
  return c.json({ code: 0, message: '已删除', timestamp: new Date().toISOString() });
});

// ===== 回收站（仅本人删除的个人项目）：必须注册在 /:id 之前 =====
projectsRouter.get('/trash', async (c) => {
  const user = c.get('user');
  const rows = await db
    .select()
    .from(projects)
    .where(and(eq(projects.owner_id, user.id), isNull(projects.team_id), sql`${projects.deleted_at} is not null`))
    .orderBy(desc(projects.deleted_at))
    .limit(100);
  return c.json({
    code: 0,
    message: 'ok',
    data: rows.map((p) => ({ id: p.id, name: p.name, deleted_at: p.deleted_at!.toISOString() })),
    timestamp: new Date().toISOString(),
  });
});

// ===== 我的待办（首页工作台）：必须注册在 /:id 之前 =====
// 聚合「我负责的未完成任务」+「14 天内到期 / 已逾期的未完成里程碑」
projectsRouter.get('/my/todos', async (c) => {
  const user = c.get('user');
  const myTeams = await db.select({ team_id: teamMembers.team_id }).from(teamMembers).where(eq(teamMembers.user_id, user.id));
  const teamIds = myTeams.map((t) => t.team_id);
  const projectCond = and(
    teamIds.length
      ? or(eq(projects.owner_id, user.id), inArray(projects.team_id, teamIds))
      : eq(projects.owner_id, user.id),
    isNull(projects.deleted_at),
  );

  const taskRows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      priority: tasks.priority,
      due_date: tasks.due_date,
      requirement_id: requirements.id,
      requirement_title: requirements.title,
      project_id: projects.id,
      project_name: projects.name,
    })
    .from(tasks)
    .innerJoin(requirements, eq(requirements.id, tasks.requirement_id))
    .innerJoin(projects, eq(projects.id, requirements.project_id))
    .where(and(eq(tasks.assignee_id, user.id), sql`${tasks.status} != 'done'`, projectCond))
    .orderBy(asc(tasks.due_date))
    .limit(20);

  const milestoneRows = await db
    .select({
      id: milestones.id,
      title: milestones.title,
      due_date: milestones.due_date,
      project_id: projects.id,
      project_name: projects.name,
    })
    .from(milestones)
    .innerJoin(projects, eq(projects.id, milestones.project_id))
    .where(
      and(
        isNull(milestones.completed_at),
        sql`${milestones.due_date} is not null`,
        sql`${milestones.due_date} <= now() + interval '14 days'`,
        projectCond,
      ),
    )
    .orderBy(asc(milestones.due_date))
    .limit(10);

  return c.json({
    code: 0,
    message: 'ok',
    data: {
      tasks: taskRows.map((t) => ({ ...t, due_date: toIso(t.due_date) })),
      milestones: milestoneRows.map((m) => ({ ...m, due_date: toIso(m.due_date) })),
    },
    timestamp: new Date().toISOString(),
  });
});

projectsRouter.get('/:id', async (c) => {
  const user = c.get('user');
  const { p, err } = await getProjectOr403(user, c.req.param('id'));
  if (err) return c.json({ code: err, message: err === 404 ? '项目不存在' : '无权访问', timestamp: new Date().toISOString() }, err);
  const ownerName = p!.owner_id ? (await userNamesByIds([p!.owner_id])).get(p!.owner_id) ?? null : null;
  const collabs = (await projectCollaboratorMap([p!.id])).get(p!.id) ?? [];
  const counts = (await projectCounts([p!.id])).get(p!.id) ?? { requirement_count: 0, task_count: 0, done_task_count: 0 };
  return c.json({
    code: 0,
    message: 'ok',
    data: projectDto(p!, ownerName, collabs, counts),
    timestamp: new Date().toISOString(),
  });
});

projectsRouter.patch('/:id', zValidator('json', UpdateProjectRequest), async (c) => {
  const user = c.get('user');
  const { p, err } = await getProjectOr403(user, c.req.param('id'));
  if (err) return c.json({ code: err, message: err === 404 ? '项目不存在' : '无权访问', timestamp: new Date().toISOString() }, err);
  const body = c.req.valid('json');

  const collaboratorIds =
    body.collaborator_ids !== undefined ? Array.from(new Set(body.collaborator_ids)) : undefined;
  if (collaboratorIds !== undefined && !(await assertUsersExist(collaboratorIds))) {
    return c.json({ code: 400, message: '包含不存在的协作人', timestamp: new Date().toISOString() }, 400);
  }

  const updated = await db.transaction(async (tx) => {
    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (body.name !== undefined) patch.name = body.name;
    if (body.description !== undefined) patch.description = body.description;
    if (body.status !== undefined) patch.status = body.status;
    if (body.plan_start_at !== undefined) patch.plan_start_at = body.plan_start_at ? new Date(body.plan_start_at) : null;
    if (body.plan_end_at !== undefined) patch.plan_end_at = body.plan_end_at ? new Date(body.plan_end_at) : null;
    if (body.actual_start_at !== undefined) patch.actual_start_at = body.actual_start_at ? new Date(body.actual_start_at) : null;
    if (body.actual_end_at !== undefined) patch.actual_end_at = body.actual_end_at ? new Date(body.actual_end_at) : null;
    const [row] = await tx.update(projects).set(patch).where(eq(projects.id, p!.id)).returning();
    if (collaboratorIds !== undefined) {
      await tx.delete(projectCollaborators).where(eq(projectCollaborators.project_id, p!.id));
      if (collaboratorIds.length) {
        await tx.insert(projectCollaborators).values(collaboratorIds.map((user_id) => ({ project_id: p!.id, user_id })));
      }
    }
    return row;
  });

  const ownerNames = await userNamesByIds([updated.owner_id]);
  const collabs = (await projectCollaboratorMap([updated.id])).get(updated.id) ?? [];
  const counts = (await projectCounts([updated.id])).get(updated.id) ?? { requirement_count: 0, task_count: 0, done_task_count: 0 };
  return c.json({
    code: 0,
    message: '已更新',
    data: projectDto(updated, ownerNames.get(updated.owner_id) ?? null, collabs, counts),
    timestamp: new Date().toISOString(),
  });
});

// 删除（软删除：进入回收站）
projectsRouter.delete('/:id', async (c) => {
  const user = c.get('user');
  const { p, err } = await getProjectOr403(user, c.req.param('id'));
  if (err) return c.json({ code: err, message: err === 404 ? '项目不存在' : '无权访问', timestamp: new Date().toISOString() }, err);
  await db.update(projects).set({ deleted_at: new Date() }).where(eq(projects.id, p!.id));
  return c.json({ code: 0, message: '已移入回收站', timestamp: new Date().toISOString() });
});

// 恢复
projectsRouter.post('/:id/restore', async (c) => {
  const user = c.get('user');
  const [p] = await db.select().from(projects).where(eq(projects.id, c.req.param('id'))).limit(1);
  if (!p || !p.deleted_at) return c.json({ code: 404, message: '项目不存在或不在回收站', timestamp: new Date().toISOString() }, 404);
  if (p.owner_id !== user.id) return c.json({ code: 403, message: '无权恢复', timestamp: new Date().toISOString() }, 403);
  await db.update(projects).set({ deleted_at: null }).where(eq(projects.id, p.id));
  return c.json({ code: 0, message: '已恢复', timestamp: new Date().toISOString() });
});

// 彻底删除（级联删除需求/任务/里程碑/评论）
projectsRouter.delete('/:id/permanent', async (c) => {
  const user = c.get('user');
  const [p] = await db.select().from(projects).where(eq(projects.id, c.req.param('id'))).limit(1);
  if (!p || !p.deleted_at) return c.json({ code: 404, message: '项目不存在或不在回收站', timestamp: new Date().toISOString() }, 404);
  if (p.owner_id !== user.id) return c.json({ code: 403, message: '无权删除', timestamp: new Date().toISOString() }, 403);
  await db.delete(projects).where(eq(projects.id, p.id));
  return c.json({ code: 0, message: '已彻底删除', timestamp: new Date().toISOString() });
});

// ===== 需求 =====
projectsRouter.get('/:id/requirements', async (c) => {
  const user = c.get('user');
  const { p, err } = await getProjectOr403(user, c.req.param('id'));
  if (err) return c.json({ code: err, message: err === 404 ? '项目不存在' : '无权访问', timestamp: new Date().toISOString() }, err);
  const rows = await db.select().from(requirements).where(eq(requirements.project_id, p!.id)).orderBy(desc(requirements.updated_at));
  const ids = rows.map((r) => r.id);
  const ownerIds = rows.map((r) => r.owner_id).filter((x): x is string => Boolean(x));
  const ownerNames = await userNamesByIds(ownerIds);
  const collabMap = await requirementCollaboratorMap(ids);
  const countsMap = await requirementTaskCounts(ids);
  const list = rows.map((r) => {
    const counts = countsMap.get(r.id) ?? { task_count: 0, done_task_count: 0 };
    return requirementDto(r, r.owner_id ? ownerNames.get(r.owner_id) ?? null : null, collabMap.get(r.id) ?? [], counts);
  });
  return c.json({ code: 0, message: 'ok', data: list, timestamp: new Date().toISOString() });
});

projectsRouter.post('/:id/requirements', zValidator('json', CreateRequirementRequest), async (c) => {
  const user = c.get('user');
  const { p, err } = await getProjectOr403(user, c.req.param('id'));
  if (err) return c.json({ code: err, message: err === 404 ? '项目不存在' : '无权访问', timestamp: new Date().toISOString() }, err);
  const body = c.req.valid('json');

  const collaboratorIds = Array.from(new Set(body.collaborator_ids ?? []));
  if (body.owner_id && !(await assertUsersExist([body.owner_id]))) {
    return c.json({ code: 400, message: '负责人不存在', timestamp: new Date().toISOString() }, 400);
  }
  if (!(await assertUsersExist(collaboratorIds))) {
    return c.json({ code: 400, message: '包含不存在的协作人', timestamp: new Date().toISOString() }, 400);
  }

  const r = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(requirements)
      .values({
        project_id: p!.id,
        title: body.title,
        description: body.description,
        priority: body.priority,
        owner_id: body.owner_id ?? null,
        plan_start_at: body.plan_start_at ? new Date(body.plan_start_at) : null,
        plan_end_at: body.plan_end_at ? new Date(body.plan_end_at) : null,
        actual_start_at: body.actual_start_at ? new Date(body.actual_start_at) : null,
        actual_end_at: body.actual_end_at ? new Date(body.actual_end_at) : null,
      })
      .returning();
    if (collaboratorIds.length) {
      await tx
        .insert(requirementCollaborators)
        .values(collaboratorIds.map((user_id) => ({ requirement_id: created.id, user_id })));
    }
    return created;
  });

  const ownerName = r.owner_id ? (await userNamesByIds([r.owner_id])).get(r.owner_id) ?? null : null;
  const collabs = (await requirementCollaboratorMap([r.id])).get(r.id) ?? [];
  return c.json({
    code: 0,
    message: '已创建需求',
    data: requirementDto(r, ownerName, collabs, { task_count: 0, done_task_count: 0 }),
    timestamp: new Date().toISOString(),
  });
});

projectsRouter.patch('/requirements/:id', zValidator('json', UpdateRequirementRequest), async (c) => {
  const user = c.get('user');
  const [r] = await db.select().from(requirements).where(eq(requirements.id, c.req.param('id'))).limit(1);
  if (!r) return c.json({ code: 404, message: '需求不存在', timestamp: new Date().toISOString() }, 404);
  const { p, err } = await getProjectOr403(user, r.project_id);
  if (err) return c.json({ code: err, message: err === 404 ? '项目不存在' : '无权访问', timestamp: new Date().toISOString() }, err);
  const body = c.req.valid('json');

  const collaboratorIds =
    body.collaborator_ids !== undefined ? Array.from(new Set(body.collaborator_ids)) : undefined;
  if (body.owner_id && !(await assertUsersExist([body.owner_id]))) {
    return c.json({ code: 400, message: '负责人不存在', timestamp: new Date().toISOString() }, 400);
  }
  if (collaboratorIds !== undefined && !(await assertUsersExist(collaboratorIds))) {
    return c.json({ code: 400, message: '包含不存在的协作人', timestamp: new Date().toISOString() }, 400);
  }

  const updated = await db.transaction(async (tx) => {
    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (body.title !== undefined) patch.title = body.title;
    if (body.description !== undefined) patch.description = body.description;
    if (body.status !== undefined) patch.status = body.status;
    if (body.priority !== undefined) patch.priority = body.priority;
    if (body.owner_id !== undefined) patch.owner_id = body.owner_id ?? null;
    if (body.plan_start_at !== undefined) patch.plan_start_at = body.plan_start_at ? new Date(body.plan_start_at) : null;
    if (body.plan_end_at !== undefined) patch.plan_end_at = body.plan_end_at ? new Date(body.plan_end_at) : null;
    if (body.actual_start_at !== undefined) patch.actual_start_at = body.actual_start_at ? new Date(body.actual_start_at) : null;
    if (body.actual_end_at !== undefined) patch.actual_end_at = body.actual_end_at ? new Date(body.actual_end_at) : null;
    const [row] = await tx.update(requirements).set(patch).where(eq(requirements.id, r.id)).returning();
    if (collaboratorIds !== undefined) {
      await tx.delete(requirementCollaborators).where(eq(requirementCollaborators.requirement_id, r.id));
      if (collaboratorIds.length) {
        await tx.insert(requirementCollaborators).values(collaboratorIds.map((user_id) => ({ requirement_id: r.id, user_id })));
      }
    }
    return row;
  });

  const ownerName = updated.owner_id ? (await userNamesByIds([updated.owner_id])).get(updated.owner_id) ?? null : null;
  const collabs = (await requirementCollaboratorMap([updated.id])).get(updated.id) ?? [];
  const counts = (await requirementTaskCounts([updated.id])).get(updated.id) ?? { task_count: 0, done_task_count: 0 };
  return c.json({
    code: 0,
    message: '已更新',
    data: requirementDto(updated, ownerName, collabs, counts),
    timestamp: new Date().toISOString(),
  });
});

projectsRouter.delete('/requirements/:id', async (c) => {
  const user = c.get('user');
  const [r] = await db.select().from(requirements).where(eq(requirements.id, c.req.param('id'))).limit(1);
  if (!r) return c.json({ code: 404, message: '需求不存在', timestamp: new Date().toISOString() }, 404);
  const { p, err } = await getProjectOr403(user, r.project_id);
  if (err) return c.json({ code: err, message: err === 404 ? '项目不存在' : '无权访问', timestamp: new Date().toISOString() }, err);
  await db.delete(requirements).where(eq(requirements.id, r.id));
  return c.json({ code: 0, message: '已删除', timestamp: new Date().toISOString() });
});

// ===== 任务 =====
projectsRouter.get('/requirements/:id/tasks', async (c) => {
  const user = c.get('user');
  const [r] = await db.select().from(requirements).where(eq(requirements.id, c.req.param('id'))).limit(1);
  if (!r) return c.json({ code: 404, message: '需求不存在', timestamp: new Date().toISOString() }, 404);
  const { p, err } = await getProjectOr403(user, r.project_id);
  if (err) return c.json({ code: err, message: err === 404 ? '项目不存在' : '无权访问', timestamp: new Date().toISOString() }, err);

  const rows = await db
    .select({ task: tasks, assignee_name: users.name })
    .from(tasks)
    .leftJoin(users, eq(tasks.assignee_id, users.id))
    .where(eq(tasks.requirement_id, r.id))
    .orderBy(desc(tasks.created_at));
  const ids = rows.map((row) => row.task.id);
  const collabMap = await taskCollaboratorMap(ids);
  return c.json({
    code: 0,
    message: 'ok',
    data: rows.map((row) => taskDto(row.task, row.assignee_name, collabMap.get(row.task.id) ?? [])),
    timestamp: new Date().toISOString(),
  });
});

projectsRouter.post('/requirements/:id/tasks', zValidator('json', CreateTaskRequest), async (c) => {
  const user = c.get('user');
  const [r] = await db.select().from(requirements).where(eq(requirements.id, c.req.param('id'))).limit(1);
  if (!r) return c.json({ code: 404, message: '需求不存在', timestamp: new Date().toISOString() }, 404);
  const { p, err } = await getProjectOr403(user, r.project_id);
  if (err) return c.json({ code: err, message: err === 404 ? '项目不存在' : '无权访问', timestamp: new Date().toISOString() }, err);
  const body = c.req.valid('json');

  const collaboratorIds = Array.from(new Set(body.collaborator_ids ?? []));
  if (body.assignee_id && !(await assertUsersExist([body.assignee_id]))) {
    return c.json({ code: 400, message: '负责人不存在', timestamp: new Date().toISOString() }, 400);
  }
  if (!(await assertUsersExist(collaboratorIds))) {
    return c.json({ code: 400, message: '包含不存在的协作人', timestamp: new Date().toISOString() }, 400);
  }

  const t = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(tasks)
      .values({
        requirement_id: r.id,
        title: body.title,
        description: body.description,
        priority: body.priority,
        assignee_id: body.assignee_id ?? null,
        due_date: body.due_date ? new Date(body.due_date) : null,
        plan_start_at: body.plan_start_at ? new Date(body.plan_start_at) : null,
        plan_end_at: body.plan_end_at ? new Date(body.plan_end_at) : null,
        actual_start_at: body.actual_start_at ? new Date(body.actual_start_at) : null,
        actual_end_at: body.actual_end_at ? new Date(body.actual_end_at) : null,
      })
      .returning();
    if (collaboratorIds.length) {
      await tx.insert(taskCollaborators).values(collaboratorIds.map((user_id) => ({ task_id: created.id, user_id })));
    }
    return created;
  });

  const assigneeName = t.assignee_id ? (await userNamesByIds([t.assignee_id])).get(t.assignee_id) ?? null : null;
  const collabs = (await taskCollaboratorMap([t.id])).get(t.id) ?? [];

  // 通知：任务分配给负责人
  await notify(t.assignee_id, user.id, {
    type: 'task_assigned',
    title: `${user.name} 将任务「${t.title}」分配给你`,
    link: `/projects/${r.project_id}`,
  });

  return c.json({ code: 0, message: '已创建任务', data: taskDto(t, assigneeName, collabs), timestamp: new Date().toISOString() });
});

projectsRouter.patch('/tasks/:id', zValidator('json', UpdateTaskRequest), async (c) => {
  const user = c.get('user');
  const [t] = await db.select().from(tasks).where(eq(tasks.id, c.req.param('id'))).limit(1);
  if (!t) return c.json({ code: 404, message: '任务不存在', timestamp: new Date().toISOString() }, 404);
  const [r] = await db.select().from(requirements).where(eq(requirements.id, t.requirement_id)).limit(1);
  const { p, err } = await getProjectOr403(user, r.project_id);
  if (err) return c.json({ code: err, message: err === 404 ? '项目不存在' : '无权访问', timestamp: new Date().toISOString() }, err);
  const body = c.req.valid('json');

  const collaboratorIds =
    body.collaborator_ids !== undefined ? Array.from(new Set(body.collaborator_ids)) : undefined;
  if (body.assignee_id && !(await assertUsersExist([body.assignee_id]))) {
    return c.json({ code: 400, message: '负责人不存在', timestamp: new Date().toISOString() }, 400);
  }
  if (collaboratorIds !== undefined && !(await assertUsersExist(collaboratorIds))) {
    return c.json({ code: 400, message: '包含不存在的协作人', timestamp: new Date().toISOString() }, 400);
  }

  const updated = await db.transaction(async (tx) => {
    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (body.title !== undefined) patch.title = body.title;
    if (body.description !== undefined) patch.description = body.description;
    if (body.status !== undefined) patch.status = body.status;
    if (body.priority !== undefined) patch.priority = body.priority;
    if (body.due_date !== undefined) patch.due_date = body.due_date ? new Date(body.due_date) : null;
    if (body.assignee_id !== undefined) patch.assignee_id = body.assignee_id ?? null;
    if (body.plan_start_at !== undefined) patch.plan_start_at = body.plan_start_at ? new Date(body.plan_start_at) : null;
    if (body.plan_end_at !== undefined) patch.plan_end_at = body.plan_end_at ? new Date(body.plan_end_at) : null;
    if (body.actual_start_at !== undefined) patch.actual_start_at = body.actual_start_at ? new Date(body.actual_start_at) : null;
    if (body.actual_end_at !== undefined) patch.actual_end_at = body.actual_end_at ? new Date(body.actual_end_at) : null;
    const [row] = await tx.update(tasks).set(patch).where(eq(tasks.id, t.id)).returning();
    if (collaboratorIds !== undefined) {
      await tx.delete(taskCollaborators).where(eq(taskCollaborators.task_id, t.id));
      if (collaboratorIds.length) {
        await tx.insert(taskCollaborators).values(collaboratorIds.map((user_id) => ({ task_id: t.id, user_id })));
      }
    }
    return row;
  });

  const assigneeName = updated.assignee_id ? (await userNamesByIds([updated.assignee_id])).get(updated.assignee_id) ?? null : null;
  const collabs = (await taskCollaboratorMap([updated.id])).get(updated.id) ?? [];

  // 通知：负责人变更时通知新负责人
  if (updated.assignee_id && updated.assignee_id !== t.assignee_id) {
    await notify(updated.assignee_id, user.id, {
      type: 'task_assigned',
      title: `${user.name} 将任务「${updated.title}」分配给你`,
      link: `/projects/${r.project_id}`,
    });
  }

  return c.json({
    code: 0,
    message: '已更新',
    data: taskDto(updated, assigneeName, collabs),
    timestamp: new Date().toISOString(),
  });
});

projectsRouter.delete('/tasks/:id', async (c) => {
  const user = c.get('user');
  const [t] = await db.select().from(tasks).where(eq(tasks.id, c.req.param('id'))).limit(1);
  if (!t) return c.json({ code: 404, message: '任务不存在', timestamp: new Date().toISOString() }, 404);
  const [r] = await db.select().from(requirements).where(eq(requirements.id, t.requirement_id)).limit(1);
  const { p, err } = await getProjectOr403(user, r.project_id);
  if (err) return c.json({ code: err, message: err === 404 ? '项目不存在' : '无权访问', timestamp: new Date().toISOString() }, err);
  await db.delete(tasks).where(eq(tasks.id, t.id));
  return c.json({ code: 0, message: '已删除', timestamp: new Date().toISOString() });
});

// ===== 里程碑 =====

// 列表
projectsRouter.get('/:id/milestones', async (c) => {
  const user = c.get('user');
  const { p, err } = await getProjectOr403(user, c.req.param('id'));
  if (err) return c.json({ code: err, message: err === 404 ? '项目不存在' : '无权访问', timestamp: new Date().toISOString() }, err);
  const rows = await db.select().from(milestones).where(eq(milestones.project_id, p!.id)).orderBy(milestones.created_at);
  return c.json({
    code: 0,
    message: 'ok',
    data: rows.map((m) => ({
      id: m.id,
      project_id: m.project_id,
      title: m.title,
      description: m.description,
      due_date: m.due_date?.toISOString() ?? null,
      completed_at: m.completed_at?.toISOString() ?? null,
      created_at: m.created_at.toISOString(),
    })),
    timestamp: new Date().toISOString(),
  });
});

// 创建
projectsRouter.post('/:id/milestones', zValidator('json', CreateMilestoneRequest), async (c) => {
  const user = c.get('user');
  const { p, err } = await getProjectOr403(user, c.req.param('id'));
  if (err) return c.json({ code: err, message: err === 404 ? '项目不存在' : '无权访问', timestamp: new Date().toISOString() }, err);
  const body = c.req.valid('json');
  const [m] = await db
    .insert(milestones)
    .values({
      project_id: p!.id,
      title: body.title,
      description: body.description,
      due_date: body.due_date ? new Date(body.due_date) : null,
    })
    .returning();
  return c.json({ code: 0, message: '已创建', data: { id: m.id }, timestamp: new Date().toISOString() });
});

// 标记完成 / 取消完成
projectsRouter.post('/milestones/:mid/toggle', async (c) => {
  const user = c.get('user');
  const [m] = await db.select().from(milestones).where(eq(milestones.id, c.req.param('mid'))).limit(1);
  if (!m) return c.json({ code: 404, message: '里程碑不存在', timestamp: new Date().toISOString() }, 404);
  const { p, err } = await getProjectOr403(user, m.project_id);
  if (err) return c.json({ code: err, message: err === 404 ? '项目不存在' : '无权访问', timestamp: new Date().toISOString() }, err);
  const completed = m.completed_at ? null : new Date();
  await db.update(milestones).set({ completed_at: completed }).where(eq(milestones.id, m.id));
  return c.json({ code: 0, message: completed ? '已标记完成' : '已取消完成', timestamp: new Date().toISOString() });
});

// 删除
projectsRouter.delete('/milestones/:mid', async (c) => {
  const user = c.get('user');
  const [m] = await db.select().from(milestones).where(eq(milestones.id, c.req.param('mid'))).limit(1);
  if (!m) return c.json({ code: 404, message: '里程碑不存在', timestamp: new Date().toISOString() }, 404);
  const { p, err } = await getProjectOr403(user, m.project_id);
  if (err) return c.json({ code: err, message: err === 404 ? '项目不存在' : '无权访问', timestamp: new Date().toISOString() }, err);
  await db.delete(milestones).where(eq(milestones.id, m.id));
  return c.json({ code: 0, message: '已删除', timestamp: new Date().toISOString() });
});

