import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq, ilike, or } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { db } from '../db/connection';
import { users } from '../db/schema';
import { createSession, destroySession, requireAuth } from '../middleware/session';
import { LoginRequest, RegisterRequest, UserPublic } from '@pulse-space/contracts';
import type { AppVariables } from '../types';

export const authRouter = new Hono<{ Variables: AppVariables }>();

const toPublic = (u: typeof users.$inferSelect) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  avatar_url: u.avatar_url,
  is_admin: u.is_admin,
  created_at: u.created_at.toISOString(),
});

// 注册
authRouter.post('/register', zValidator('json', RegisterRequest), async (c) => {
  const body = c.req.valid('json');

  const [exists] = await db.select({ id: users.id }).from(users).where(eq(users.email, body.email)).limit(1);
  if (exists) {
    return c.json({ code: 400, message: '该邮箱已注册', timestamp: new Date().toISOString() }, 400);
  }

  const hash = await bcrypt.hash(body.password, 10);
  const [user] = await db
    .insert(users)
    .values({ email: body.email, name: body.name, password_hash: hash })
    .returning();

  const session = await createSession(user.id, c);
  return c.json({
    code: 0,
    message: '注册成功',
    data: { user: toPublic(user), expires_at: session.expires_at },
    timestamp: new Date().toISOString(),
  });
});

// 登录
authRouter.post('/login', zValidator('json', LoginRequest), async (c) => {
  const body = c.req.valid('json');

  const [user] = await db.select().from(users).where(eq(users.email, body.email)).limit(1);
  if (!user || !(await bcrypt.compare(body.password, user.password_hash))) {
    return c.json({ code: 400, message: '邮箱或密码错误', timestamp: new Date().toISOString() }, 400);
  }

  const session = await createSession(user.id, c);
  return c.json({
    code: 0,
    message: '登录成功',
    data: { user: toPublic(user), expires_at: session.expires_at },
    timestamp: new Date().toISOString(),
  });
});

// 退出
authRouter.post('/logout', requireAuth, async (c) => {
  await destroySession(c);
  return c.json({ code: 0, message: '已退出', timestamp: new Date().toISOString() });
});

// 当前会话
authRouter.get('/session', requireAuth, async (c) => {
  const user = c.get('user');
  return c.json({
    code: 0,
    message: 'ok',
    data: { user: toPublic(user) as unknown as UserPublic },
    timestamp: new Date().toISOString(),
  });
});

// 搜索用户（用于 @ 提及）
authRouter.get('/search', requireAuth, async (c) => {
  const q = c.req.query('q') ?? '';
  if (!q.trim()) {
    return c.json({ code: 0, message: 'ok', data: [], timestamp: new Date().toISOString() });
  }
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      avatar_url: users.avatar_url,
    })
    .from(users)
    .where(or(ilike(users.email, `%${q}%`), ilike(users.name, `%${q}%`)))
    .limit(10);
  return c.json({ code: 0, message: 'ok', data: rows, timestamp: new Date().toISOString() });
});
