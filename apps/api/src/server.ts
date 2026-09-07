import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import { app } from './app';
import { config } from './config';
import { registerRealtime } from './realtime';

const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

// 实时协同（/api/ws/docs/:id）
registerRealtime(app, upgradeWebSocket);

const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(`✅ Pulse-Space API 已启动: http://localhost:${info.port}`);
});
injectWebSocket(server);
