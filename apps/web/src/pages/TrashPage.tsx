import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { docApi, projectApi } from '../lib/api';
import { Spinner, Empty, ConfirmModal, useToast, cn } from '../components/ui';
import { Trash2, FileText, FolderKanban, RotateCcw, Table, Library, Folder } from 'lucide-react';

type Tab = 'docs' | 'projects';

const kindIcon = (kind: string, isFolder: boolean) =>
  isFolder ? Folder : kind === 'sheet' ? Table : kind === 'wiki' ? Library : FileText;

export function TrashPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('docs');
  const [confirm, setConfirm] = useState<{ tab: Tab; id: string; name: string } | null>(null);

  const docs = useQuery({ queryKey: ['trash', 'docs'], queryFn: () => docApi.trash() });
  const projects = useQuery({ queryKey: ['trash', 'projects'], queryFn: () => projectApi.trash() });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['trash'] });
    qc.invalidateQueries({ queryKey: ['docs'] });
    qc.invalidateQueries({ queryKey: ['projects'] });
  };

  const restoreDoc = useMutation({
    mutationFn: (id: string) => docApi.restore(id),
    onSuccess: () => { toast('已恢复'); invalidate(); },
    onError: (e) => toast((e as Error).message, 'error'),
  });
  const restoreProject = useMutation({
    mutationFn: (id: string) => projectApi.restore(id),
    onSuccess: () => { toast('已恢复'); invalidate(); },
    onError: (e) => toast((e as Error).message, 'error'),
  });
  const purgeDoc = useMutation({
    mutationFn: (id: string) => docApi.permanentDelete(id),
    onSuccess: () => { toast('已彻底删除'); setConfirm(null); invalidate(); },
    onError: (e) => toast((e as Error).message, 'error'),
  });
  const purgeProject = useMutation({
    mutationFn: (id: string) => projectApi.permanentDelete(id),
    onSuccess: () => { toast('已彻底删除'); setConfirm(null); invalidate(); },
    onError: (e) => toast((e as Error).message, 'error'),
  });

  const list = tab === 'docs' ? docs.data : projects.data;
  const loading = tab === 'docs' ? docs.isLoading : projects.isLoading;

  return (
    <div className="mx-auto max-w-1100 px-8 py-8">
      <div className="mb-6">
        <h1 className="flex items-center gap-2 font-display text-26px font-700 text-ink">
          <Trash2 size={22} className="text-coral" /> 回收站
        </h1>
        <p className="mt-1 text-13px text-muted">删除的内容会保留在这里，可恢复或彻底删除</p>
      </div>

      <div className="mb-4 flex gap-2">
        {([{ key: 'docs', label: `文档（${docs.data?.length ?? 0}）` }, { key: 'projects', label: `项目（${projects.data?.length ?? 0}）` }] as const).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'rounded-lg px-3 py-1.5 text-12px font-650 transition',
              tab === t.key ? 'bg-violet-light text-violet' : 'text-muted hover:bg-surface hover:text-ink',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-16 text-center"><Spinner size={20} /></div>
      ) : (list ?? []).length === 0 ? (
        <Empty icon="/pulse-delete.svg" title="回收站是空的" desc="删除的文档和项目会出现在这里" />
      ) : (
        <div className="card divide-y divide-line">
          {tab === 'docs'
            ? (docs.data ?? []).map((d) => {
                const Icon = kindIcon(d.kind, d.is_folder);
                return (
                  <div key={d.id} className="flex items-center justify-between px-5 py-3.5">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Icon size={16} className="shrink-0 text-violet" />
                      <span className="truncate text-13px font-600 text-ink">{d.title}</span>
                      <span className="shrink-0 text-11px text-muted">删除于 {new Date(d.deleted_at).toLocaleString()}</span>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button className="btn btn-soft" onClick={() => restoreDoc.mutate(d.id)} disabled={restoreDoc.isPending}>
                        <RotateCcw size={13} /> 恢复
                      </button>
                      <button className="btn btn-ghost text-coral" onClick={() => setConfirm({ tab: 'docs', id: d.id, name: d.title })}>
                        <Trash2 size={13} /> 彻底删除
                      </button>
                    </div>
                  </div>
                );
              })
            : (projects.data ?? []).map((p) => (
                <div key={p.id} className="flex items-center justify-between px-5 py-3.5">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <FolderKanban size={16} className="shrink-0 text-cyan" />
                    <span className="truncate text-13px font-600 text-ink">{p.name}</span>
                    <span className="shrink-0 text-11px text-muted">删除于 {new Date(p.deleted_at).toLocaleString()}</span>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button className="btn btn-soft" onClick={() => restoreProject.mutate(p.id)} disabled={restoreProject.isPending}>
                      <RotateCcw size={13} /> 恢复
                    </button>
                    <button className="btn btn-ghost text-coral" onClick={() => setConfirm({ tab: 'projects', id: p.id, name: p.name })}>
                      <Trash2 size={13} /> 彻底删除
                    </button>
                  </div>
                </div>
              ))}
        </div>
      )}

      <ConfirmModal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={() => (confirm?.tab === 'docs' ? purgeDoc.mutate(confirm.id) : purgeProject.mutate(confirm!.id))}
        title="彻底删除"
        message={`「${confirm?.name}」将被永久删除，无法恢复。确定继续吗？`}
        loading={purgeDoc.isPending || purgeProject.isPending}
      />
    </div>
  );
}
