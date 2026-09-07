import type { Hono } from 'hono';
import type { WSContext } from 'hono/ws';
import type { createNodeWebSocket } from '@hono/node-ws';
import { eq } from 'drizzle-orm';
import { db } from './db/connection';
import { documents } from './db/schema';
import { isTeamMember } from './middleware/session';
import type { AppVariables } from './types';

// ===== 实时协同（MVP）：房间广播内容同步 + 在线状态 =====
// 说明：当前为「保存驱动」的广播同步（last-write-wins），
// 字符级 OT/CRDT 合并是后续演进方向。

type CollabUser = { id: string; name: string };
type Client = { ws: WSContext; user: CollabUser };

const rooms = new Map<string, Set<Client>>();

function broadcast(room: Set<Client>, msg: unknown, except?: Client) {
  const data = JSON.stringify(msg);
  for (const c of room) {
    if (c === except) continue;
    try {
      c.ws.send(data);
    } catch {
      // 忽略发送失败（连接可能正在关闭）
    }
  }
}

function presenceList(room: Set<Client>): CollabUser[] {
  const seen = new Map<string, CollabUser>();
  for (const c of room) seen.set(c.user.id, c.user);
  return [...seen.values()];
}

type UpgradeFn = ReturnType<typeof createNodeWebSocket>['upgradeWebSocket'];

export function registerRealtime(app: Hono<{ Variables: AppVariables }>, upgradeWebSocket: UpgradeFn) {
  app.get(
    '/api/ws/docs/:id',
    upgradeWebSocket((c) => {
      const user = c.get('user');
      const docId = c.req.param('id')!;
      let client: Client | null = null;

      return {
        onOpen: async (_evt, ws) => {
          if (!user) {
            ws.close(4001, '未登录');
            return;
          }
          // 校验文档访问权限
          const [doc] = await db.select().from(documents).where(eq(documents.id, docId)).limit(1);
          const allowed =
            doc && !doc.deleted_at && (doc.team_id ? await isTeamMember(user.id, doc.team_id) : doc.owner_id === user.id);
          if (!allowed) {
            ws.close(4003, '无权访问');
            return;
          }
          client = { ws, user: { id: user.id, name: user.name } };
          let room = rooms.get(docId);
          if (!room) {
            room = new Set();
            rooms.set(docId, room);
          }
          room.add(client);
          broadcast(room, { type: 'presence', users: presenceList(room) });
        },
        onMessage(evt, ws) {
          const room = rooms.get(docId);
          if (!room || !client) return;
          try {
            const msg = JSON.parse(String(evt.data));
            if (msg.type === 'content' && typeof msg.md === 'string') {
              broadcast(room, { type: 'content', md: msg.md, from: client.user }, client);
            }
          } catch {
            // 非法消息忽略
          }
        },
        onClose() {
          const room = rooms.get(docId);
          if (!room || !client) return;
          room.delete(client);
          if (room.size === 0) rooms.delete(docId);
          else broadcast(room, { type: 'presence', users: presenceList(room) });
        },
      };
    }),
  );
}
