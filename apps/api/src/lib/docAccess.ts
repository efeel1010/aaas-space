import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db/connection';
import { teamMembers, documentAccess } from '../db/schema';
import type { EffectivePermission, DocAccessPermission } from '@pulse-space/contracts';

// 权限分级（越大越强）
const RANK: Record<string, number> = { none: 0, read: 1, edit: 2, manage: 3 };

const maxPerm = (best: EffectivePermission, cand: EffectivePermission): EffectivePermission =>
  RANK[cand] > RANK[best] ? cand : best;

// 预加载的访问上下文：批量加载团队成员角色 + 逐成员授权（防 N+1）
export type DocAccessCtx = {
  teamRoleByTeam: Map<string, string>;
  aclByDoc: Map<string, Map<string, string>>;
};

type DocRow = {
  id: string;
  owner_id: string;
  team_id: string | null;
  visibility: 'private' | 'team' | 'public';
  base_permission: 'read' | 'edit';
};

// 批量加载访问上下文，供 list / wiki-toc 等批量场景使用
export async function loadDocAccessCtx(userId: string, docIds: string[], teamIds: string[]): Promise<DocAccessCtx> {
  const teamRoleByTeam = new Map<string, string>();
  if (teamIds.length) {
    const rows = await db
      .select({ team_id: teamMembers.team_id, role: teamMembers.role })
      .from(teamMembers)
      .where(and(inArray(teamMembers.team_id, teamIds), eq(teamMembers.user_id, userId)));
    for (const r of rows) teamRoleByTeam.set(r.team_id, r.role);
  }

  const aclByDoc = new Map<string, Map<string, string>>();
  if (docIds.length) {
    const rows = await db.select().from(documentAccess).where(inArray(documentAccess.doc_id, docIds));
    for (const r of rows) {
      let m = aclByDoc.get(r.doc_id);
      if (!m) aclByDoc.set(r.doc_id, (m = new Map()));
      m.set(r.user_id, r.permission);
    }
  }

  return { teamRoleByTeam, aclByDoc };
}

// 单篇/批量共用：在给定访问上下文内解析某用户的生效权限
// 解析顺序：owner→manage；团队 owner/admin→manage；命中 document_access→其权限；
// private→none（仅 owner+白名单）；team 成员→base_permission；public→base_permission；否则 none。取最大。
export async function resolveDocAccess(
  userId: string,
  doc: DocRow,
  ctx?: DocAccessCtx,
): Promise<EffectivePermission> {
  let best: EffectivePermission = 'none';
  if (doc.owner_id === userId) best = maxPerm(best, 'manage');

  let teamRole: string | null = null;
  if (doc.team_id) {
    teamRole = ctx?.teamRoleByTeam.get(doc.team_id) ?? null;
  }
  if (teamRole === 'owner' || teamRole === 'admin') best = maxPerm(best, 'manage');

  const acl = ctx?.aclByDoc.get(doc.id)?.get(userId);
  if (acl) best = maxPerm(best, acl as EffectivePermission);
  if (acl === 'manage') return best;

  if (doc.visibility === 'team') {
    if (teamRole) best = maxPerm(best, doc.base_permission);
  } else if (doc.visibility === 'public') {
    best = maxPerm(best, doc.base_permission);
  }
  return best;
}

// 列表过滤核心（注入 ctx，供纯逻辑单元测试）
export async function filterAccessibleWithCtx<T extends DocRow>(
  userId: string,
  docs: T[],
  ctx: DocAccessCtx,
): Promise<{ doc: T; effective: EffectivePermission }[]> {
  const out: { doc: T; effective: EffectivePermission }[] = [];
  for (const doc of docs) {
    const eff = await resolveDocAccess(userId, doc, ctx);
    if (eff !== 'none') out.push({ doc, effective: eff });
  }
  return out;
}

// 列表过滤：剔除无效权限的文档，并返回每篇的 effective_permission
export async function filterAccessible<T extends DocRow>(
  userId: string,
  docs: T[],
): Promise<{ doc: T; effective: EffectivePermission }[]> {
  if (!docs.length) return [];
  const teamIds = [...new Set(docs.map((d) => d.team_id).filter((x): x is string => !!x))];
  const docIds = docs.map((d) => d.id);
  const ctx = await loadDocAccessCtx(userId, docIds, teamIds);
  return filterAccessibleWithCtx(userId, docs, ctx);
}

// 导出单篇授权权限类型，供路由复用
export type { DocAccessPermission };