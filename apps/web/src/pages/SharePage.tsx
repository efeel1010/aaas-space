import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { renderMarkdown } from '../lib/docmd';
import { Spinner, useToast } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { FileText } from 'lucide-react';

type SharedDoc = {
  title: string;
  content: string;
  kind: string;
  permission: 'read' | 'edit';
  updated_at: string;
};

// 分享页：无需登录即可阅读；可编辑分享登录后可编辑
export function SharePage() {
  const { token } = useParams<{ token: string }>();
  const { user } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const doc = useQuery({
    queryKey: ['share', token],
    queryFn: async () => {
      const res = await fetch(`/api/share/${token}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body?.message ?? '分享不存在');
      return body.data as SharedDoc;
    },
    retry: false,
  });

  useEffect(() => {
    if (doc.data) setDraft(doc.data.content);
  }, [doc.data]);

  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/share/${token}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: draft }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.message ?? '保存失败');
    },
    onSuccess: () => {
      toast('已保存');
      setEditing(false);
      qc.invalidateQueries({ queryKey: ['share', token] });
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });

  if (doc.isLoading) {
    return <div className="flex h-screen items-center justify-center"><Spinner size={24} /></div>;
  }
  if (doc.isError || !doc.data) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3">
        <FileText size={40} className="text-muted" />
        <p className="text-14px font-650 text-ink">{(doc.error as Error)?.message ?? '分享不存在或已关闭'}</p>
        <Link to="/" className="text-13px font-600 text-violet hover:underline">回到 Pulse Space</Link>
      </div>
    );
  }

  const d = doc.data;
  const canEdit = d.permission === 'edit' && !!user;

  return (
    <div className="min-h-screen bg-surface">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-white/90 px-6 py-3 backdrop-blur">
        <div className="flex items-center gap-2.5">
          <img src="/pulse-space-logo.svg" alt="Pulse Space" className="h-7" />
          <span className="text-11px text-muted">通过链接分享</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-violet-light px-2 py-0.5 text-10px font-650 text-violet">
            {d.permission === 'edit' ? '可编辑' : '只读'}
          </span>
          {d.permission === 'edit' && !user && (
            <Link to="/login" className="btn btn-primary !py-1.5 text-12px">登录后编辑</Link>
          )}
          {canEdit && !editing && (
            <button className="btn btn-primary !py-1.5 text-12px" onClick={() => setEditing(true)}>编辑</button>
          )}
          {editing && (
            <>
              <button className="btn btn-ghost !py-1.5 text-12px" onClick={() => { setEditing(false); setDraft(d.content); }}>取消</button>
              <button className="btn btn-primary !py-1.5 text-12px" onClick={() => save.mutate()} disabled={save.isPending}>
                {save.isPending ? <Spinner size={13} /> : null} 保存
              </button>
            </>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="mb-1 font-display text-30px font-700 text-ink">{d.title}</h1>
        <p className="mb-6 text-11px text-muted">更新于 {new Date(d.updated_at).toLocaleString()}</p>
        {editing ? (
          <textarea
            className="form-input min-h-[60vh] w-full resize-y font-mono text-13px leading-7"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        ) : (
          <div className="md-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(d.content) }} />
        )}
      </div>
    </div>
  );
}
