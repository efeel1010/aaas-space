import bcrypt from 'bcryptjs';
import { eq, and } from 'drizzle-orm';
import { db } from './connection';
import {
  users,
  teams,
  teamMembers,
  documents,
  projects,
  requirements,
  tasks,
  aiConversations,
  aiMessages,
} from './schema';

async function main() {
  console.log('开始写入种子数据...');

  // 用户（email 有唯一约束，onConflictDoNothing 有效）
  const hash = await bcrypt.hash('Passw0rd123', 10);
  const [alice] = await db
    .insert(users)
    .values({ email: 'alice@pulse.space', name: 'Alice 产品经理', password_hash: hash })
    .onConflictDoNothing()
    .returning();
  const [bob] = await db
    .insert(users)
    .values({ email: 'bob@pulse.space', name: 'Bob 前端工程师', password_hash: hash })
    .onConflictDoNothing()
    .returning();
  const [carol] = await db
    .insert(users)
    .values({ email: 'carol@pulse.space', name: 'Carol 设计师', password_hash: hash })
    .onConflictDoNothing()
    .returning();
  // 将 Alice 设为平台管理员（供管理端 platform 登录）
  await db.update(users).set({ is_admin: true }).where(eq(users.email, 'alice@pulse.space'));
  const owner = alice ?? (await db.select().from(users).where(eq(users.email, 'alice@pulse.space')).limit(1))[0];
  const memberBob = bob ?? (await db.select().from(users).where(eq(users.email, 'bob@pulse.space')).limit(1))[0];
  const memberCarol = carol ?? (await db.select().from(users).where(eq(users.email, 'carol@pulse.space')).limit(1))[0];

  // 团队（name 无唯一约束，需查-插保证幂等）
  let team = (await db.select().from(teams).where(eq(teams.name, 'Pulse 核心产品组')).limit(1))[0];
  if (!team) {
    [team] = await db
      .insert(teams)
      .values({
        name: 'Pulse 核心产品组',
        description: '负责 Pulse Space 产品研发的跨职能团队',
        owner_id: owner.id,
      })
      .returning();
  }

  // 团队成员（复合主键 team_id+user_id，onConflictDoNothing 有效）
  await db
    .insert(teamMembers)
    .values([
      { team_id: team.id, user_id: owner.id, role: 'owner' },
      { team_id: team.id, user_id: memberBob.id, role: 'admin' },
      { team_id: team.id, user_id: memberCarol.id, role: 'member' },
    ])
    .onConflictDoNothing();

  // 个人文档（title 无唯一约束，按 owner+title 查-插）
  const docSeeds: { kind: 'doc' | 'wiki'; title: string; content: string; icon?: string }[] = [
    {
      kind: 'doc',
      title: '产品愿景',
      content:
        '# 产品愿景\n\n## 我们是谁\nPulse Space 是一站式团队协作空间，融合在线文档、项目管理与知识库。\n\n## 我们要解决什么\n- 文档、任务、知识分散在不同工具\n- 团队协作上下文割裂\n\n## 目标\n让每个团队在一个空间内完成从想法到交付的全过程。',
    },
    {
      kind: 'doc',
      title: 'OKR 2026 Q3',
      content:
        '# OKR 2026 Q3\n\n## O1：打造行业领先的协作体验\n- KR1：文档编辑器留存率提升至 60%\n- KR2：项目交付周期缩短 20%\n\n## O2：构建 AI 原生能力\n- KR1：AI 助手周活跃使用率 40%\n- KR2：AI 拆解需求任务采纳率 70%',
    },
    {
      kind: 'wiki',
      title: '团队 Wiki 首页',
      icon: 'home',
      content: '# 团队 Wiki\n\n这里是团队知识库。\n\n- [[产品规范]]\n- [[研发流程]]\n- [[设计系统]]',
    },
    {
      kind: 'wiki',
      title: '产品规范',
      icon: 'book',
      content: '# 产品规范\n\n## 命名规范\n- 页面路由使用 kebab-case\n- 组件使用 PascalCase\n\n## 验收标准\n每个功能必须以用户旅程完成端到端验收。',
    },
    {
      kind: 'wiki',
      title: '研发流程',
      icon: 'code',
      content: '# 研发流程\n\n1. 需求评审\n2. 技术方案设计\n3. 前后端开发\n4. 自测与测试\n5. 发布与复盘',
    },
  ];
  for (const ds of docSeeds) {
    const exists = await db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.owner_id, owner.id), eq(documents.title, ds.title)))
      .limit(1);
    if (!exists.length) {
      await db.insert(documents).values({
        team_id: null,
        owner_id: owner.id,
        kind: ds.kind,
        title: ds.title,
        content: ds.content,
        icon: ds.icon ?? null,
        parent_id: null,
      });
    }
  }

  // 团队项目（name 无唯一约束，按 team+name 查-插）
  let proj = (
    await db
      .select()
      .from(projects)
      .where(and(eq(projects.team_id, team.id), eq(projects.name, 'Pulse Space v1.0')))
      .limit(1)
  )[0];
  if (!proj) {
    [proj] = await db
      .insert(projects)
      .values({
        team_id: team.id,
        owner_id: owner.id,
        name: 'Pulse Space v1.0',
        description: '首个可交付版本：文档 + 项目管理 + 知识库 + AI',
        status: 'active',
      })
      .returning();
  }

  // 需求（title 无唯一约束，按 project+title 查-插）
  const reqSeeds: { title: string; description: string; priority: string; status: 'open' | 'in_progress' | 'done' | 'cancelled' }[] = [
    {
      title: '在线文档编辑器',
      description: '支持 Markdown 编写与实时预览，具备 AI 写作能力。',
      priority: 'high',
      status: 'in_progress',
    },
    {
      title: '项目-需求-任务看板',
      description: '项目下可创建需求，需求下可拆分任务并支持看板流转。',
      priority: 'high',
      status: 'open',
    },
  ];
  const reqs = [];
  for (const rs of reqSeeds) {
    let r = (
      await db
        .select()
        .from(requirements)
        .where(and(eq(requirements.project_id, proj.id), eq(requirements.title, rs.title)))
        .limit(1)
    )[0];
    if (!r) {
      [r] = await db
        .insert(requirements)
        .values({ project_id: proj.id, title: rs.title, description: rs.description, priority: rs.priority, status: rs.status })
        .returning();
    }
    reqs.push(r);
  }

  // 任务（title 无唯一约束，按 requirement+title 查-插）
  const taskSeeds: { reqIdx: number; title: string; description: string; status: 'todo' | 'doing' | 'review' | 'done'; priority: string; assigneeId: string }[] = [
    { reqIdx: 0, title: '实现 Markdown 编辑器与预览', description: '左右分栏，支持常用语法', status: 'doing', priority: 'high', assigneeId: memberBob.id },
    { reqIdx: 0, title: '接入 AI 续写与润色', description: '调用 LLM 流式接口', status: 'todo', priority: 'high', assigneeId: memberBob.id },
    { reqIdx: 0, title: '文档自动保存', description: '防抖 1s 自动保存', status: 'done', priority: 'medium', assigneeId: memberBob.id },
    { reqIdx: 1, title: '设计看板数据模型', description: '任务状态流转 todo/doing/review/done', status: 'todo', priority: 'high', assigneeId: owner.id },
    { reqIdx: 1, title: '需求拆解 AI 提示词', description: '生成结构化任务 JSON', status: 'todo', priority: 'medium', assigneeId: memberCarol.id },
  ];
  for (const ts of taskSeeds) {
    const req = reqs[ts.reqIdx];
    const exists = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.requirement_id, req.id), eq(tasks.title, ts.title)))
      .limit(1);
    if (!exists.length) {
      await db.insert(tasks).values({
        requirement_id: req.id,
        title: ts.title,
        description: ts.description,
        status: ts.status,
        priority: ts.priority,
        assignee_id: ts.assigneeId,
      });
    }
  }

  // AI 示例会话（title 无唯一约束，按 user+title 查-插）
  let conv = (
    await db
      .select()
      .from(aiConversations)
      .where(and(eq(aiConversations.user_id, owner.id), eq(aiConversations.title, '如何设计 AI 助手入口？')))
      .limit(1)
  )[0];
  if (!conv) {
    [conv] = await db
      .insert(aiConversations)
      .values({ user_id: owner.id, team_id: team.id, title: '如何设计 AI 助手入口？' })
      .returning();
    // 仅新建会话时写入示例消息
    await db.insert(aiMessages).values([
      { conversation_id: conv.id, role: 'user', content: '如何设计 AI 助手在产品里的入口？' },
      {
        conversation_id: conv.id,
        role: 'assistant',
        content:
          '建议在侧边栏固定「AI 助手」入口，同时提供三种上下文入口：\n1. 全局浮窗（快捷键唤起）\n2. 文档内选中文本的「AI 操作」菜单\n3. 需求详情的「AI 拆解任务」\n这样既保证显性可用，又能贴近用户上下文。',
      },
    ]);
  }

  console.log('种子数据写入完成 ✅');
  console.log('演示账号：alice@pulse.space / Passw0rd123');
  process.exit(0);
}

main().catch((err) => {
  console.error('种子数据写入失败:', err);
  process.exit(1);
});