import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { authRouter } from './routes/auth';
import { teamsRouter } from './routes/teams';
import { documentsRouter } from './routes/documents';
import { projectsRouter } from './routes/projects';
import { aiRouter } from './routes/ai';
import { adminRouter } from './routes/admin';
import { searchRouter } from './routes/search';
import { notificationsRouter } from './routes/notifications';
import { shareRouter } from './routes/share';
import { sessionMiddleware } from './middleware/session';
import { config } from './config';
import type { AppVariables } from './types';

export const app = new Hono<{ Variables: AppVariables }>();

app.use('*', logger());
app.use(
  '*',
  cors({
    origin: [
      config.WEB_ORIGIN,
      config.ADMIN_ORIGIN,
      'http://localhost:5183',
      'http://127.0.0.1:5183',
      'http://localhost:5184',
      'http://127.0.0.1:5184',
    ],
    credentials: true,
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  }),
);

app.get('/api/health', (c) =>
  c.json({ code: 0, message: 'ok', data: { status: 'up', time: Date.now() } }),
);

// 全局会话中间件：解析 Cookie → c.set('user', ...)
app.use('*', sessionMiddleware);

app.route('/api/auth', authRouter);
app.route('/api/teams', teamsRouter);
app.route('/api/documents', documentsRouter);
app.route('/api/projects', projectsRouter);
app.route('/api/ai', aiRouter);
app.route('/api/admin', adminRouter);
app.route('/api/search', searchRouter);
app.route('/api/notifications', notificationsRouter);
app.route('/api/share', shareRouter);

app.notFound((c) => c.json({ code: 404, message: 'Not Found', data: null }, 404));
