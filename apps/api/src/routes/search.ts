import { Hono } from 'hono';
import { eq, and, or, desc, inArray, ilike, isNull, type SQL } from 'drizzle-orm';
import { db } from '../db/connection';
import { documents, projects, teamMembers, documentAccess } from '../db/schema';
import { requireAuth } from '../middleware/session';
import { filterAccessible } from '../lib/docAccess';
import type { AppVariables } from '../types';

export const searchRouter = new Hono<{ Variables: AppVariables }>();
searchRouter.use('*', requireAuth);

// 从正文提取关键词上下文片段
function makeSnippet(content: string, q: string): string {
  const idx = content.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return content.slice(0, 80).trim();
  const start = Math.max(0, idx - 30);
  const end = Math.min(content.length, idx + q.length + 50);
  return (start > 0 ? '…' : '') + content.slice(start, end).trim() + (end < content.length ? '…' : '');
}

// 全局搜索：文档（标题+正文）+ 项目（名称+描述），仅限当前用户可访问的范围
searchRouter.get('/', async (c) => {
  const user = c.get('user');
  const q = (c.req.query('q') ?? '').trim();
  if (!q) {
    return c.json({ code: 0, message: 'ok', data: { documents: [], projects: [] }, timestamp: new Date().toISOString() });
  }
  const pattern = `%${q}%`;

  const myTeams = await db.select({ team_id: teamMembers.team_id }).from(teamMembers).where(eq(teamMembers.user_id, user.id));
  const teamIds = myTeams.map((t) => t.team_id);
  // 文档可见候选：自己创建 / 所在团队 / 被明文授权（document_access）
  const aclSub = db.select({ doc_id: documentAccess.doc_id }).from(documentAccess).where(eq(documentAccess.user_id, user.id));
  const condsArr: SQL[] = [];
  if (teamIds.length) {
    condsArr.push(eq(documents.owner_id, user.id), inArray(documents.team_id, teamIds), inArray(documents.id, aclSub));
  } else {
    condsArr.push(eq(documents.owner_id, user.id), inArray(documents.id, aclSub));
  }
  const docAccess = or(...condsArr);
  const projAccess = teamIds.length
    ? or(eq(projects.owner_id, user.id), inArray(projects.team_id, teamIds))
    : eq(projects.owner_id, user.id);

  const [docRows, projRows] = await Promise.all([
    db
      .select()
      .from(documents)
      .where(
        and(
          or(ilike(documents.title, pattern), ilike(documents.content, pattern)),
          eq(documents.is_folder, false),
          isNull(documents.deleted_at),
          docAccess,
        ),
      )
      .orderBy(desc(documents.updated_at))
      .limit(8),
    db
      .select()
      .from(projects)
      .where(and(or(ilike(projects.name, pattern), ilike(projects.description, pattern)), isNull(projects.deleted_at), projAccess))
      .orderBy(desc(projects.updated_at))
      .limit(5),
  ]);

  // 精确解析生效权限，剔除 none（如 private 团队文档对普通成员不可见）
  const accessible = await filterAccessible(user.id, docRows);

  return c.json({
    code: 0,
    message: 'ok',
    data: {
      documents: accessible.map(({ doc: d }) => ({
        id: d.id,
        team_id: d.team_id,
        owner_id: d.owner_id,
        owner_name: null,
        parent_id: d.parent_id,
        is_folder: d.is_folder,
        kind: d.kind,
        title: d.title,
        content: '',
        icon: d.icon,
        cover: d.cover,
        last_viewed_at: d.last_viewed_at ? d.last_viewed_at.toISOString() : null,
        is_favorite: false,
        snippet: makeSnippet(d.content, q),
        created_at: d.created_at.toISOString(),
        updated_at: d.updated_at.toISOString(),
      })),
      projects: projRows.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        status: p.status,
        updated_at: p.updated_at.toISOString(),
      })),
    },
    timestamp: new Date().toISOString(),
  });
});
