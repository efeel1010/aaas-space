import { type Context, type Next } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { db } from '../db/connection';
import { sessions, users, teamMembers } from '../db/schema';
import { eq, and, gt } from 'drizzle-orm';
import type { AppVariables } from '../types';

export const SESSION_COOKIE = 'pulse_space_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// 当前登录用户（无 cookie 时为 null）
export async function sessionMiddleware(c: Context, next: Next) {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) {
    c.set('user', null);
    await next();
    return;
  }

  const [row] = await db
    .select()
    .from(sessions)
    .innerJoin(users, eq(sessions.user_id, users.id))
    .where(and(eq(sessions.token, token), gt(sessions.expires_at, new Date())))
    .limit(1);

  if (!row) {
    c.set('user', null);
    await next();
    return;
  }

  const { password_hash, ...safeUser } = row.users;
  c.set('user', safeUser);
  c.set('sessionToken', token);
  await next();
}

export async function requireAuth(c: Context<{ Variables: AppVariables }>, next: Next): Promise<Response | void> {
  const user = c.get('user');
  if (!user) {
    return c.json(
      { code: 401, message: '请先登录', timestamp: new Date().toISOString() },
      401,
    );
  }
  await next();
}

export async function requireAdmin(c: Context<{ Variables: AppVariables }>, next: Next): Promise<Response | void> {
  const user = c.get('user');
  if (!user) {
    return c.json(
      { code: 401, message: '请先登录', timestamp: new Date().toISOString() },
      401,
    );
  }
  if (!user.is_admin) {
    return c.json(
      { code: 403, message: '需要管理员权限', timestamp: new Date().toISOString() },
      403,
    );
  }
  await next();
}

export async function createSession(userId: string, c: Context) {
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await db.insert(sessions).values({ user_id: userId, token, expires_at: expiresAt });

  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: false,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });

  return { expires_at: expiresAt.toISOString() };
}

export async function destroySession(c: Context) {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    await db.delete(sessions).where(eq(sessions.token, token));
  }
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
}

// ===== 团队权限助手 =====
export async function isTeamMember(userId: string, teamId: string): Promise<boolean> {
  const [m] = await db
    .select({ user_id: teamMembers.user_id })
    .from(teamMembers)
    .where(and(eq(teamMembers.team_id, teamId), eq(teamMembers.user_id, userId)))
    .limit(1);
  return Boolean(m);
}

export async function getTeamRole(userId: string, teamId: string) {
  const [m] = await db
    .select({ role: teamMembers.role })
    .from(teamMembers)
    .where(and(eq(teamMembers.team_id, teamId), eq(teamMembers.user_id, userId)))
    .limit(1);
  return m?.role ?? null;
}

export async function canManageTeam(userId: string, teamId: string): Promise<boolean> {
  const role = await getTeamRole(userId, teamId);
  return role === 'owner' || role === 'admin';
}
