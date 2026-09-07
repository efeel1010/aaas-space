import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../db/connection';
import { documents, documentShares } from '../db/schema';
import type { AppVariables } from '../types';

// 公开分享访问（通过 token，无需登录即可阅读；编辑需要登录）
export const shareRouter = new Hono<{ Variables: AppVariables }>();

async function findShare(token: string) {
  const [share] = await db.select().from(documentShares).where(eq(documentShares.token, token)).limit(1);
  if (!share) return null;
  const [doc] = await db.select().from(documents).where(eq(documents.id, share.doc_id)).limit(1);
  if (!doc || doc.deleted_at || doc.is_folder) return null;
  return { share, doc };
}

// 读取分享内容（匿名可读）
shareRouter.get('/:token', async (c) => {
  const found = await findShare(c.req.param('token'));
  if (!found) return c.json({ code: 404, message: '分享不存在或已关闭', timestamp: new Date().toISOString() }, 404);
  const { share, doc } = found;
  return c.json({
    code: 0,
    message: 'ok',
    data: {
      title: doc.title,
      content: doc.content,
      kind: doc.kind,
      permission: share.permission,
      updated_at: doc.updated_at.toISOString(),
    },
    timestamp: new Date().toISOString(),
  });
});

// 通过分享链接编辑（permission=edit 且已登录）
shareRouter.patch('/:token', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ code: 401, message: '登录后才能编辑', timestamp: new Date().toISOString() }, 401);
  const found = await findShare(c.req.param('token'));
  if (!found) return c.json({ code: 404, message: '分享不存在或已关闭', timestamp: new Date().toISOString() }, 404);
  if (found.share.permission !== 'edit') {
    return c.json({ code: 403, message: '该分享为只读', timestamp: new Date().toISOString() }, 403);
  }
  const body = (await c.req.json().catch(() => null)) as { title?: string; content?: string } | null;
  const patch: Record<string, unknown> = { updated_at: new Date() };
  if (typeof body?.title === 'string' && body.title.trim()) patch.title = body.title.trim();
  if (typeof body?.content === 'string') patch.content = body.content;
  await db.update(documents).set(patch).where(eq(documents.id, found.doc.id));
  return c.json({ code: 0, message: '已保存', timestamp: new Date().toISOString() });
});
