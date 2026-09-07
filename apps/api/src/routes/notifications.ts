import { Hono } from 'hono';
import { eq, and, desc, isNull, count } from 'drizzle-orm';
import { db } from '../db/connection';
import { notifications } from '../db/schema';
import { requireAuth } from '../middleware/session';
import type { AppVariables } from '../types';

export const notificationsRouter = new Hono<{ Variables: AppVariables }>();
notificationsRouter.use('*', requireAuth);

// 列表 + 未读数
notificationsRouter.get('/', async (c) => {
  const user = c.get('user');
  const [rows, [unread]] = await Promise.all([
    db.select().from(notifications).where(eq(notifications.user_id, user.id)).orderBy(desc(notifications.created_at)).limit(30),
    db.select({ n: count() }).from(notifications).where(and(eq(notifications.user_id, user.id), isNull(notifications.read_at))),
  ]);
  return c.json({
    code: 0,
    message: 'ok',
    data: {
      list: rows.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        content: n.content,
        link: n.link,
        read_at: n.read_at ? n.read_at.toISOString() : null,
        created_at: n.created_at.toISOString(),
      })),
      unread_count: unread.n,
    },
    timestamp: new Date().toISOString(),
  });
});

// 标记单条已读
notificationsRouter.post('/:id/read', async (c) => {
  const user = c.get('user');
  await db
    .update(notifications)
    .set({ read_at: new Date() })
    .where(and(eq(notifications.id, c.req.param('id')), eq(notifications.user_id, user.id), isNull(notifications.read_at)));
  return c.json({ code: 0, message: 'ok', timestamp: new Date().toISOString() });
});

// 全部已读
notificationsRouter.post('/read-all', async (c) => {
  const user = c.get('user');
  await db
    .update(notifications)
    .set({ read_at: new Date() })
    .where(and(eq(notifications.user_id, user.id), isNull(notifications.read_at)));
  return c.json({ code: 0, message: 'ok', timestamp: new Date().toISOString() });
});
