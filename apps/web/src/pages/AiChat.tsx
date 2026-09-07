import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { aiApi, streamJson } from '../lib/api';
import { Spinner, useToast, cn, Empty } from '../components/ui';
import { Bot, Plus, Trash2, SendHorizonal, Sparkles, User } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { AiMessage, AiConversation } from '@pulse-space/contracts';

marked.setOptions({ gfm: true, breaks: true });

interface ChatItem {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export function AiChat() {
  const toast = useToast();
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatItem[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const conversations = useQuery({
    queryKey: ['convs'],
    queryFn: () => aiApi.conversations(),
  });

  // 加载会话消息
  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    aiApi.messages(activeId).then((rows) => {
      if (!cancelled) setMessages(rows.map((m) => ({ id: m.id, role: m.role, content: m.content })));
    });
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  const createConv = useMutation({
    mutationFn: () => aiApi.createConversation(),
    onSuccess: (c) => {
      setActiveId(c.id);
      setMessages([]);
      qc.invalidateQueries({ queryKey: ['convs'] });
    },
  });

  const delConv = useMutation({
    mutationFn: (id: string) => aiApi.removeConversation(id),
    onSuccess: () => {
      if (activeId) setActiveId(null);
      qc.invalidateQueries({ queryKey: ['convs'] });
      toast('已删除会话');
    },
  });

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    setSending(true);
    const userMsg: ChatItem = { id: `u-${Date.now()}`, role: 'user', content: text };
    const asstMsg: ChatItem = { id: `a-${Date.now()}`, role: 'assistant', content: '' };
    setMessages((prev) => [...prev, userMsg, asstMsg]);

    try {
      let acc = '';
      await streamJson('/ai/chat', { conversation_id: activeId, message: text }, (delta) => {
        acc += delta;
        setMessages((prev) => prev.map((m) => (m.id === asstMsg.id ? { ...m, content: acc } : m)));
      });
      setSending(false);
      // 若为新会话，刷新会话列表
      if (!activeId) {
        qc.invalidateQueries({ queryKey: ['convs'] });
      }
    } catch (e) {
      setSending(false);
      toast((e as Error).message, 'error');
    }
  };

  const render = (content: string) => DOMPurify.sanitize(marked.parse(content || '') as string);

  return (
    <div className="flex h-full">
      {/* 会话列表 */}
      <aside className="flex w-60 flex-shrink-0 flex-col border-r border-line bg-white/80 px-3 py-4">
        <button className="btn btn-primary mb-4 w-full" onClick={() => createConv.mutate()} disabled={createConv.isPending}>
          <Plus size={15} /> 新对话
        </button>
        {conversations.isLoading ? (
          <div className="py-8 text-center"><Spinner /></div>
        ) : (conversations.data ?? []).length === 0 ? (
          <p className="py-8 text-center text-12px text-muted">暂无历史会话</p>
        ) : (
          <ul className="space-y-0.5 overflow-y-auto">
            {(conversations.data ?? []).map((c: AiConversation) => (
              <li key={c.id} className={cn('group flex items-center gap-1 rounded-xl px-2.5 py-2 transition cursor-pointer', activeId === c.id ? 'bg-violet-light' : 'hover:bg-surface')}>
                <button className="min-w-0 flex-1 text-left" onClick={() => setActiveId(c.id)}>
                  <p className={cn('truncate text-13px font-600', activeId === c.id ? 'text-violet' : 'text-ink')}>{c.title}</p>
                  <p className="text-10px text-muted">{c.message_count} 条 · {new Date(c.updated_at).toLocaleDateString()}</p>
                </button>
                <button
                  onClick={() => delConv.mutate(c.id)}
                  className="rounded p-1 text-muted opacity-0 transition hover:text-coral group-hover:opacity-100"
                >
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      {/* 聊天区 */}
      <div className="flex min-w-0 flex-1 flex-col bg-surface">
        <div className="flex items-center gap-2 border-b border-line bg-white/90 px-6 py-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-violet to-violet-dark text-white">
            <Bot size={16} />
          </div>
          <div>
            <p className="text-13px font-650 text-ink">Pulse Space AI 助手</p>
            <p className="text-11px text-muted">写作、拆解需求、项目管理问答</p>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          {messages.length === 0 && !sending ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <img src="/pulse-ai-experiment.svg" alt="" className="mb-4 h-20 w-20" />
              <h3 className="font-display text-18px font-650 text-ink">你好，我是 Pulse Space AI 助手</h3>
              <p className="mt-1 max-w-sm text-13px text-muted">
                我可以帮你撰写文档、润色文字、拆解需求为任务清单、解答项目管理问题。
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {['帮我写一篇产品需求文档', '把「用户登录」拆解成任务', '本周项目如何推进？'].map((s) => (
                  <button key={s} className="rounded-full border border-violet-border bg-violet-light px-3.5 py-1.5 text-12px font-600 text-violet transition hover:bg-violet hover:text-white" onClick={() => setInput(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-5">
              {messages.map((m) => (
                <div key={m.id} className={cn('flex gap-3', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                  {m.role === 'assistant' && (
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet to-violet-dark text-white">
                      <Bot size={15} />
                    </div>
                  )}
                  <div className={cn('max-w-[75%] rounded-2xl px-4 py-3', m.role === 'user' ? 'bg-violet text-white rounded-tr-sm' : 'card rounded-tl-sm')}>
                    {m.role === 'assistant' ? (
                      m.content ? (
                        <div className="md-body !text-13px" dangerouslySetInnerHTML={{ __html: render(m.content) }} />
                      ) : (
                        <div className="flex items-center gap-2">
                          <Spinner size={14} className="!border-violet-200 !border-t-violet" />
                          <span className="text-12px text-muted">思考中…</span>
                        </div>
                      )
                    ) : (
                      <p className="text-13px leading-6 whitespace-pre-wrap">{m.content}</p>
                    )}
                  </div>
                  {m.role === 'user' && (
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-violet shadow-sm">
                      <User size={15} />
                    </div>
                  )}
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* 输入区 */}
        <div className="border-t border-line bg-white/90 px-6 py-4">
          <div className="mx-auto flex max-w-3xl items-end gap-3">
            <textarea
              className="form-input min-h-11 flex-1 resize-none"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="输入问题，Enter 发送，Shift+Enter 换行"
              rows={1}
            />
            <button className="btn btn-primary h-11 w-11 !px-0" onClick={send} disabled={!input.trim() || sending} title="发送">
              <SendHorizonal size={17} />
            </button>
          </div>
          <p className="mt-2 text-center text-10px text-muted">AI 生成内容仅供参考，请核对后使用</p>
        </div>
      </div>
    </div>
  );
}
