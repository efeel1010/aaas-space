import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Send, Trash2 } from 'lucide-react';
import { projectApi } from '../lib/api';
import { Spinner, useToast } from './ui';
import type { CommentTargetType } from '@pulse-space/contracts';

function AvatarBubble({ name, url }: { name: string; url: string | null }) {
  if (url) {
    return <img src={url} alt={name} className="h-6 w-6 shrink-0 rounded-full object-cover" />;
  }
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-light text-10px font-650 text-violet">
      {(name || '?').slice(0, 1)}
    </span>
  );
}

export function CommentThread({ targetType, targetId }: { targetType: CommentTargetType; targetId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState('');

  const comments = useQuery({
    queryKey: ['comments', targetType, targetId],
    queryFn: () => projectApi.comments(targetType, targetId),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['comments', targetType, targetId] });

  const create = useMutation({
    mutationFn: () => projectApi.createComment({ target_type: targetType, target_id: targetId, content: draft.trim() }),
    onSuccess: () => {
      setDraft('');
      invalidate();
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => projectApi.removeComment(id),
    onSuccess: () => {
      toast('评论已删除');
      invalidate();
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });

  return (
    <div className="border-t border-line pt-3">
      <p className="mb-2 text-12px font-650 text-muted">评论（{comments.data?.length ?? 0}）</p>

      {comments.isLoading ? (
        <div className="py-3 text-center"><Spinner size={14} /></div>
      ) : (comments.data ?? []).length === 0 ? (
        <p className="mb-2 text-11px text-muted">暂无评论，来发表第一条吧</p>
      ) : (
        <div className="mb-3 max-h-48 space-y-2.5 overflow-y-auto pr-1">
          {(comments.data ?? []).map((c) => (
            <div key={c.id} className="group flex items-start gap-2">
              <AvatarBubble name={c.user_name} url={c.avatar_url} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-11px font-650 text-ink">{c.user_name}</span>
                  <span className="text-10px text-muted">{new Date(c.created_at).toLocaleString()}</span>
                </div>
                <p className="whitespace-pre-wrap text-12px leading-5 text-ink">{c.content}</p>
              </div>
              <button
                onClick={() => remove.mutate(c.id)}
                className="shrink-0 rounded p-1 text-muted opacity-0 transition hover:text-coral group-hover:opacity-100"
                title="删除评论"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        <textarea
          className="form-input min-h-9 flex-1 resize-none py-2 text-12px"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="写下你的评论…"
          rows={1}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (draft.trim() && !create.isPending) create.mutate();
            }
          }}
        />
        <button
          className="btn btn-primary shrink-0"
          disabled={!draft.trim() || create.isPending}
          onClick={() => create.mutate()}
        >
          {create.isPending ? <Spinner size={13} /> : <Send size={13} />} 发送
        </button>
      </div>
    </div>
  );
}
