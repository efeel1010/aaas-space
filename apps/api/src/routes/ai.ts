import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq, desc } from 'drizzle-orm';
import { db } from '../db/connection';
import { aiConversations, aiMessages, teams } from '../db/schema';
import { requireAuth } from '../middleware/session';
import { config } from '../config';
import {
  AiChatRequest,
  AiDocRequest,
  AiBreakdownRequest,
  AiBreakdownItem,
  AiTranslateRequest,
  AiOrganizeRequest,
  AiGenRequirementsRequest,
  AiGenTasksRequest,
} from '@pulse-space/contracts';
import { buildOrganizeMessages, parseOrganize } from './organize';
import type { AppVariables } from '../types';

export const aiRouter = new Hono<{ Variables: AppVariables }>();
aiRouter.use('*', requireAuth);

// ===== Qwen 底层调用 =====
function qwenUrl() {
  return `${config.QWEN_BASE_URL}/chat/completions`;
}

async function qwenFetch(messages: { role: string; content: string }[], stream = true) {
  return fetch(qwenUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.QWEN_API_KEY}`,
    },
    body: JSON.stringify({ model: config.QWEN_MODEL, messages, stream }),
  });
}

// 从 SSE 文本中抽取增量内容
function extractDeltas(raw: string): string {
  let content = '';
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const j = JSON.parse(payload);
      content += j.choices?.[0]?.delta?.content ?? '';
    } catch {
      // 忽略无法解析的行
    }
  }
  return content;
}

function sseHeaders() {
  return {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  };
}

// ===== 会话管理 =====
aiRouter.get('/conversations', async (c) => {
  const user = c.get('user');
  const rows = await db
    .select({
      conv: aiConversations,
      cnt: aiMessages.id,
    })
    .from(aiConversations)
    .leftJoin(aiMessages, eq(aiMessages.conversation_id, aiConversations.id))
    .where(eq(aiConversations.user_id, user.id))
    .orderBy(desc(aiConversations.updated_at));

  const map = new Map<string, { conv: (typeof aiConversations.$inferSelect); count: number }>();
  for (const r of rows) {
    const e = map.get(r.conv.id);
    if (e) e.count += 1;
    else map.set(r.conv.id, { conv: r.conv, count: r.cnt ? 1 : 0 });
  }
  const list = [...map.values()].map((e) => ({
    id: e.conv.id,
    title: e.conv.title,
    team_id: e.conv.team_id,
    message_count: e.count,
    created_at: e.conv.created_at.toISOString(),
    updated_at: e.conv.updated_at.toISOString(),
  }));
  return c.json({ code: 0, message: 'ok', data: list, timestamp: new Date().toISOString() });
});

aiRouter.post('/conversations', async (c) => {
  const user = c.get('user');
  const body = (await c.req.json().catch(() => ({}))) as { title?: string; team_id?: string };
  const [conv] = await db
    .insert(aiConversations)
    .values({
      user_id: user.id,
      title: body.title?.slice(0, 100) || '新对话',
      team_id: body.team_id ?? null,
    })
    .returning();
  return c.json({
    code: 0,
    message: 'ok',
    data: {
      id: conv.id,
      title: conv.title,
      team_id: conv.team_id,
      message_count: 0,
      created_at: conv.created_at.toISOString(),
      updated_at: conv.updated_at.toISOString(),
    },
    timestamp: new Date().toISOString(),
  });
});

aiRouter.get('/conversations/:id/messages', async (c) => {
  const user = c.get('user');
  const [conv] = await db.select().from(aiConversations).where(eq(aiConversations.id, c.req.param('id'))).limit(1);
  if (!conv || conv.user_id !== user.id) {
    return c.json({ code: 404, message: '会话不存在', timestamp: new Date().toISOString() }, 404);
  }
  const rows = await db
    .select()
    .from(aiMessages)
    .where(eq(aiMessages.conversation_id, conv.id))
    .orderBy(desc(aiMessages.created_at))
    .limit(200);
  const list = rows.reverse().map((m) => ({
    id: m.id,
    conversation_id: m.conversation_id,
    role: m.role,
    content: m.content,
    created_at: m.created_at.toISOString(),
  }));
  return c.json({ code: 0, message: 'ok', data: list, timestamp: new Date().toISOString() });
});

aiRouter.delete('/conversations/:id', async (c) => {
  const user = c.get('user');
  const [conv] = await db.select().from(aiConversations).where(eq(aiConversations.id, c.req.param('id'))).limit(1);
  if (!conv || conv.user_id !== user.id) {
    return c.json({ code: 404, message: '会话不存在', timestamp: new Date().toISOString() }, 404);
  }
  await db.delete(aiConversations).where(eq(aiConversations.id, conv.id));
  return c.json({ code: 0, message: '已删除', timestamp: new Date().toISOString() });
});

// ===== 对话（流式） =====
aiRouter.post('/chat', zValidator('json', AiChatRequest), async (c) => {
  const user = c.get('user');
  const body = c.req.valid('json');

  // 取/建会话
  let convId = body.conversation_id ?? null;
  let isNew = false;
  if (convId) {
    const [conv] = await db.select().from(aiConversations).where(eq(aiConversations.id, convId)).limit(1);
    if (!conv || conv.user_id !== user.id) {
      return c.json({ code: 404, message: '会话不存在', timestamp: new Date().toISOString() }, 404);
    }
  } else {
    const [conv] = await db
      .insert(aiConversations)
      .values({ user_id: user.id, title: body.message.slice(0, 20) || '新对话' })
      .returning();
    convId = conv.id;
    isNew = true;
  }

  // 持久化用户消息
  await db.insert(aiMessages).values({ conversation_id: convId, role: 'user', content: body.message });

  // 组装上下文（最近 10 条）
  const history = await db
    .select()
    .from(aiMessages)
    .where(eq(aiMessages.conversation_id, convId))
    .orderBy(desc(aiMessages.created_at))
    .limit(10);
  const messages: { role: string; content: string }[] = [
    {
      role: 'system',
      content:
        '你是 Pulse Space 的 AI 助手，帮助用户在文档写作、项目管理和知识库协作中高效工作。请用简洁、专业、结构化的中文回答。',
    },
  ];
  if (body.context) {
    messages.push({
      role: 'system',
      content: `以下是用户当前正在查看的文档/上下文，回答时可参考：\n${body.context.slice(0, 8000)}`,
    });
  }
  for (const m of history.reverse()) {
    messages.push({ role: m.role, content: m.content });
  }

  const upstream = await qwenFetch(messages, true);
  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text().catch(() => '');
    return c.json(
      { code: 502, message: `AI 服务调用失败: ${errText.slice(0, 300)}`, timestamp: new Date().toISOString() },
      502,
    );
  }

  let raw = '';
  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      raw += new TextDecoder().decode(chunk, { stream: true });
      controller.enqueue(chunk);
    },
    flush: async () => {
      const content = extractDeltas(raw);
      if (content) {
        await db.insert(aiMessages).values({ conversation_id: convId!, role: 'assistant', content });
        await db
          .update(aiConversations)
          .set({ updated_at: new Date() })
          .where(eq(aiConversations.id, convId!));
      }
    },
  });

  return new Response(upstream.body.pipeThrough(transform), {
    status: 200,
    headers: sseHeaders(),
  });
});

// ===== 文档 AI（流式） =====
const NO_FENCE = '直接输出 Markdown 正文，不要用任何代码围栏（```）包裹输出，不要输出解释性前言。';
const DOC_PROMPTS: Record<string, (title: string, content: string) => { system: string; user: string }> = {
  generate: (title, _content) => ({
    system: '你是一位资深文档写作者，请输出 Markdown 格式的完整文档内容，结构清晰、内容专业。',
    user: `请围绕主题「${title}」撰写一篇完整的 Markdown 文档，包含：标题、引言、主体分节（含小标题与要点）、总结。${NO_FENCE}`,
  }),
  continue: (title, content) => ({
    system: '你是一位文档续写助手，请接续用户已有内容，保持同样的语言与 Markdown 风格。',
    user: `文档主题：${title}\n已有内容：\n${content || '(空)'}\n\n请自然续写后续内容，输出 Markdown 格式。${NO_FENCE}`,
  }),
  polish: (title, content) => ({
    system: '你是一位文字润色专家，请优化表达、修正语病、提升专业性，保持原意不变。',
    user: `文档主题：${title}\n原文：\n${content}\n\n请输出润色后的 Markdown 版本。${NO_FENCE}`,
  }),
  summarize: (title, content) => ({
    system: '你是一位文档摘要专家，请提取核心观点。',
    user: `文档主题：${title}\n内容：\n${content}\n\n请输出：1) 一句话摘要 2) 要点列表（Markdown）。${NO_FENCE}`,
  }),
};

aiRouter.post('/doc', zValidator('json', AiDocRequest), async (c) => {
  const body = c.req.valid('json');
  const p = DOC_PROMPTS[body.action];
  if (!p) return c.json({ code: 400, message: '不支持的动作', timestamp: new Date().toISOString() }, 400);
  const { system, user } = p(body.title ?? '', body.content ?? '');

  const upstream = await qwenFetch([{ role: 'system', content: system }, { role: 'user', content: user }], true);
  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text().catch(() => '');
    return c.json(
      { code: 502, message: `AI 服务调用失败: ${errText.slice(0, 300)}`, timestamp: new Date().toISOString() },
      502,
    );
  }
  return new Response(upstream.body, { status: 200, headers: sseHeaders() });
});

// ===== 需求拆解（非流式 JSON） =====
aiRouter.post('/breakdown', zValidator('json', AiBreakdownRequest), async (c) => {
  const body = c.req.valid('json');

  const upstream = await qwenFetch(
    [
      {
        role: 'system',
        content:
          '你是产品经理与项目管理专家。请把用户给出的需求拆解为可执行的任务清单。' +
          '严格输出 JSON 数组，不要输出任何其他文字或 markdown 代码块标记。' +
          '数组元素格式：[{"title":"任务标题","description":"任务描述","priority":"low|medium|high|urgent"}]',
      },
      {
        role: 'user',
        content: `项目名称：${body.project_name}\n需求描述：${body.requirement}`,
      },
    ],
    false,
  );

  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => '');
    return c.json(
      { code: 502, message: `AI 服务调用失败: ${errText.slice(0, 300)}`, timestamp: new Date().toISOString() },
      502,
    );
  }

  const data = (await upstream.json()) as { choices?: { message?: { content?: string } }[] };
  const raw = data.choices?.[0]?.message?.content ?? '';
  const tasks = parseBreakdown(raw);
  if (tasks.length === 0) {
    return c.json({ code: 502, message: 'AI 未返回可解析的任务清单', timestamp: new Date().toISOString() }, 502);
  }
  return c.json({ code: 0, message: 'ok', data: { tasks }, timestamp: new Date().toISOString() });
});

function parseBreakdown(raw: string): AiBreakdownItem[] {
  const cleaned = raw
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
  try {
    const arr = JSON.parse(cleaned);
    if (Array.isArray(arr)) {
      return arr
        .filter((t) => t && typeof t.title === 'string' && t.title.trim())
        .slice(0, 30)
        .map((t) => ({
          title: t.title.trim(),
          description: String(t.description ?? '').trim(),
          priority: ['low', 'medium', 'high', 'urgent'].includes(t.priority) ? t.priority : 'medium',
        }));
    }
  } catch {
    // 尝试抽取对象数组
  }
  const m = raw.match(/\{[^}]*"title"[^}]*\}/g);
  if (m) {
    return m
      .map((s) => {
        try {
          const t = JSON.parse(s);
          return {
            title: String(t.title ?? '').trim(),
            description: String(t.description ?? '').trim(),
            priority: ['low', 'medium', 'high', 'urgent'].includes(t.priority) ? t.priority : 'medium',
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean) as AiBreakdownItem[];
  }
  return [];
}

// ===== 文档翻译（非流式） =====
aiRouter.post('/translate', zValidator('json', AiTranslateRequest), async (c) => {
  const body = c.req.valid('json');
  const isFull = body.mode === 'full';

  const system = isFull
    ? '你是一位专业翻译。请将整篇文档翻译为目标语言，严格保留 Markdown 语法（# 标题、- 列表、**加粗**、> 引用、```代码块、表格等），不要翻译代码块内部内容，只输出翻译结果。'
    : '你是一位专业翻译。请将下面这段文本翻译为目标语言，只输出译文本身，不要任何解释或额外内容。';

  const upstream = await qwenFetch(
    [
      { role: 'system', content: system },
      { role: 'user', content: `目标语言：${body.target_lang}\n\n待翻译内容：\n${body.text}` },
    ],
    false,
  );
  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => '');
    return c.json(
      { code: 502, message: `AI 翻译失败: ${errText.slice(0, 300)}`, timestamp: new Date().toISOString() },
      502,
    );
  }
  const data = (await upstream.json()) as { choices?: { message?: { content?: string } }[] };
  const translated = (data.choices?.[0]?.message?.content ?? '').trim();
  if (!translated) {
    return c.json({ code: 502, message: 'AI 未返回翻译结果', timestamp: new Date().toISOString() }, 502);
  }
  return c.json({
    code: 0,
    message: 'ok',
    data: { translated, target_lang: body.target_lang },
    timestamp: new Date().toISOString(),
  });
});

// ===== AI 整理文件到文件夹（非流式） =====
aiRouter.post('/organize', zValidator('json', AiOrganizeRequest), async (c) => {
  const body = c.req.valid('json');
  const messages = buildOrganizeMessages(body.files);

  const upstream = await qwenFetch(messages, false);
  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => '');
    return c.json(
      { code: 502, message: `AI 服务调用失败: ${errText.slice(0, 300)}`, timestamp: new Date().toISOString() },
      502,
    );
  }

  const data = (await upstream.json()) as { choices?: { message?: { content?: string } }[] };
  const raw = data.choices?.[0]?.message?.content ?? '';
  const tree = parseOrganize(raw);
  if (tree.length === 0) {
    return c.json({ code: 502, message: 'AI 未返回可解析的整理结果', timestamp: new Date().toISOString() }, 502);
  }
  return c.json({ code: 0, message: 'ok', data: { tree }, timestamp: new Date().toISOString() });
});

// ===== AI 生成需求（非流式 JSON） =====
aiRouter.post('/gen-requirements', zValidator('json', AiGenRequirementsRequest), async (c) => {
  const body = c.req.valid('json');

  const upstream = await qwenFetch(
    [
      {
        role: 'system',
        content:
          '你是产品经理与项目管理专家。请根据项目信息与用户要求，生成可落地执行的需求清单。' +
          '严格输出 JSON 对象，不要输出任何其他文字或 markdown 代码块标记。' +
          '格式：{"requirements":[{"title":"需求标题","description":"需求描述","priority":"low|medium|high|urgent"}]}',
      },
      {
        role: 'user',
        content: `项目名称：${body.project_name}\n项目描述：${body.project_description || '（未提供）'}\n用户要求：${body.request}`,
      },
    ],
    false,
  );

  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => '');
    return c.json(
      { code: 502, message: `AI 服务调用失败: ${errText.slice(0, 300)}`, timestamp: new Date().toISOString() },
      502,
    );
  }

  const data = (await upstream.json()) as { choices?: { message?: { content?: string } }[] };
  const raw = data.choices?.[0]?.message?.content ?? '';
  const requirements = parseGenItems(raw);
  if (requirements.length === 0) {
    return c.json({ code: 502, message: 'AI 未返回可解析的需求清单', timestamp: new Date().toISOString() }, 502);
  }
  return c.json({ code: 0, message: 'ok', data: { requirements }, timestamp: new Date().toISOString() });
});

// ===== AI 生成任务（非流式 JSON） =====
aiRouter.post('/gen-tasks', zValidator('json', AiGenTasksRequest), async (c) => {
  const body = c.req.valid('json');

  const upstream = await qwenFetch(
    [
      {
        role: 'system',
        content:
          '你是项目管理专家。请根据需求信息与用户要求，把该需求拆解为可执行的任务清单。' +
          '严格输出 JSON 对象，不要输出任何其他文字或 markdown 代码块标记。' +
          '格式：{"tasks":[{"title":"任务标题","description":"任务描述","priority":"low|medium|high|urgent"}]}',
      },
      {
        role: 'user',
        content: `需求标题：${body.requirement_title}\n需求描述：${body.requirement_description || '（未提供）'}\n用户要求：${body.request}`,
      },
    ],
    false,
  );

  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => '');
    return c.json(
      { code: 502, message: `AI 服务调用失败: ${errText.slice(0, 300)}`, timestamp: new Date().toISOString() },
      502,
    );
  }

  const data = (await upstream.json()) as { choices?: { message?: { content?: string } }[] };
  const raw = data.choices?.[0]?.message?.content ?? '';
  const tasks = parseGenItems(raw);
  if (tasks.length === 0) {
    return c.json({ code: 502, message: 'AI 未返回可解析的任务清单', timestamp: new Date().toISOString() }, 502);
  }
  return c.json({ code: 0, message: 'ok', data: { tasks }, timestamp: new Date().toISOString() });
});

// 解析 AI 返回的需求/任务数组（承载顶层对象 { requirements|tasks: [...] } 或裸数组）
function parseGenItems(raw: string): { title: string; description: string; priority: string }[] {
  const cleaned = raw
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
  try {
    const obj = JSON.parse(cleaned);
    const arr = Array.isArray(obj) ? obj : (obj?.requirements ?? obj?.tasks);
    if (Array.isArray(arr)) {
      return arr
        .filter((t) => t && typeof t.title === 'string' && t.title.trim())
        .slice(0, 30)
        .map((t) => ({
          title: t.title.trim(),
          description: String(t.description ?? '').trim(),
          priority: ['low', 'medium', 'high', 'urgent'].includes(t.priority) ? t.priority : 'medium',
        }));
    }
  } catch {
    // 尝试抽取对象数组
  }
  const m = raw.match(/\{[^}]*"title"[^}]*\}/g);
  if (m) {
    return m
      .map((s) => {
        try {
          const t = JSON.parse(s);
          return {
            title: String(t.title ?? '').trim(),
            description: String(t.description ?? '').trim(),
            priority: ['low', 'medium', 'high', 'urgent'].includes(t.priority) ? t.priority : 'medium',
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean) as { title: string; description: string; priority: string }[];
  }
  return [];
}

// ===== AI 表格操作（自然语言 → 公式 / 高亮条件格式，非流式 JSON） =====
aiRouter.post('/sheet', async (c) => {
  const body = await c.req.json().catch(() => null);
  const instruction = body?.instruction;
  if (!instruction || typeof instruction !== 'string' || !instruction.trim()) {
    return c.json({ code: 400, message: '缺少指令', timestamp: new Date().toISOString() }, 400);
  }
  const headers = Array.isArray(body?.headers) ? body.headers.slice(0, 30) : [];
  const sample = Array.isArray(body?.sample) ? body.sample.slice(0, 10) : [];

  const upstream = await qwenFetch(
    [
      {
        role: 'system',
        content:
          '你是电子表格操作助手。根据用户指令与表格数据，判断用户想要「生成公式」还是「高亮单元格（条件格式）」，输出一个 JSON 操作对象。' +
          '严格输出 JSON，不要输出任何其他文字或 markdown 代码块标记。格式（二选一）：\n' +
          '公式：{"action":"formula","formula":"=SUM(A1:A10)"}\n' +
          '高亮：{"action":"highlight","column":0,"operator":">","value":"10","bg":"#fde68a"}\n' +
          '其中 column 为列索引（从 0 开始），operator 为 > < >= <= = between，bg 为高亮背景色（十六进制）。',
      },
      {
        role: 'user',
        content: `表格列名：${JSON.stringify(headers)}\n表格采样数据：${JSON.stringify(sample)}\n用户指令：${instruction}`,
      },
    ],
    false,
  );

  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => '');
    return c.json(
      { code: 502, message: `AI 服务调用失败: ${errText.slice(0, 300)}`, timestamp: new Date().toISOString() },
      502,
    );
  }

  const data = (await upstream.json()) as { choices?: { message?: { content?: string } }[] };
  const raw = data.choices?.[0]?.message?.content ?? '';
  const action = parseSheetAction(raw);
  if (!action) {
    return c.json({ code: 502, message: 'AI 未返回可解析的操作', timestamp: new Date().toISOString() }, 502);
  }
  return c.json({ code: 0, message: 'ok', data: action, timestamp: new Date().toISOString() });
});

type SheetAction =
  | { action: 'formula'; formula: string }
  | { action: 'highlight'; column: number; operator: string; value: string; bg: string };

function normalizeSheetAction(obj: unknown): SheetAction | null {
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  if (o.action === 'formula' && typeof o.formula === 'string' && o.formula.trim()) {
    return { action: 'formula', formula: o.formula.trim() };
  }
  if (o.action === 'highlight') {
    return {
      action: 'highlight',
      column: typeof o.column === 'number' && Number.isInteger(o.column) ? o.column : 0,
      operator: ['>', '<', '>=', '<=', '=', 'between'].includes(String(o.operator)) ? String(o.operator) : '>',
      value: String(o.value ?? ''),
      bg: typeof o.bg === 'string' && /^#[0-9a-fA-F]{6}$/.test(o.bg) ? o.bg : '#fde68a',
    };
  }
  return null;
}

function parseSheetAction(raw: string): SheetAction | null {
  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  try {
    return normalizeSheetAction(JSON.parse(cleaned));
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return normalizeSheetAction(JSON.parse(m[0]));
      } catch {
        return null;
      }
    }
  }
  return null;
}
