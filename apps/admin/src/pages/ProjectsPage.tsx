import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi, ApiError } from '../lib/api';
import { Spinner, useToast, ConfirmModal, Badge } from '../components/ui';
import { Search, Trash2, FolderKanban } from 'lucide-react';

export function ProjectsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [keyword, setKeyword] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-projects', keyword],
    queryFn: () => adminApi.projects(keyword || undefined),
  });

  const remove = useMutation({
    mutationFn: (id: string) => adminApi.removeProject(id),
    onSuccess: () => {
      toast('已删除项目');
      setConfirmDelete(null);
      qc.invalidateQueries({ queryKey: ['admin-projects'] });
      qc.invalidateQueries({ queryKey: ['admin-stats'] });
    },
    onError: (e) => toast((e as ApiError).message, 'error'),
  });

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setKeyword(q.trim());
  };

  return (
    <div className="px-8 py-8">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="font-display text-20px font-700 text-ink">项目管理</h2>
          <p className="mt-1 text-13px text-muted">查看并管理平台内全部项目</p>
        </div>
        <form onSubmit={submitSearch} className="relative w-64">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            className="form-input !pl-9"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="按项目名称搜索"
          />
        </form>
      </div>

      <div className="mt-6 overflow-hidden rounded-2xl">
        {isLoading ? (
          <div className="flex justify-center py-20">
            <Spinner size={24} />
          </div>
        ) : (
          <table className="w-full border-collapse bg-white text-left">
            <thead>
              <tr className="border-b border-line text-12px text-muted">
                <th className="px-4 py-3 font-650">项目</th>
                <th className="px-4 py-3 font-650">状态</th>
                <th className="px-4 py-3 font-650">所有者</th>
                <th className="px-4 py-3 font-650">更新时间</th>
                <th className="px-4 py-3 text-right font-650">操作</th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((p) => (
                <tr key={p.id} className="border-b border-line last:border-0 hover:bg-surface/60">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-light text-violet">
                        <FolderKanban size={15} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-13px font-650 text-ink">{p.name}</p>
                          {p.deleted_at && <span className="shrink-0 rounded bg-coral/10 px-1.5 py-0.5 text-10px font-650 text-coral">回收站</span>}
                        </div>
                        {p.description && <p className="max-w-sm truncate text-11px text-muted">{p.description}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge value={p.status} />
                  </td>
                  <td className="px-4 py-3 text-13px text-ink">{p.owner_name}</td>
                  <td className="px-4 py-3 text-12px text-muted">{new Date(p.updated_at).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end">
                      <button
                        onClick={() => setConfirmDelete(p.id)}
                        className="rounded-lg p-1.5 text-muted transition hover:bg-coral/10 hover:text-coral"
                        title="删除项目"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <ConfirmModal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && remove.mutate(confirmDelete)}
        title="删除项目"
        message="确认删除该项目？将级联删除其需求、任务与协作关系，且不可恢复。"
        loading={remove.isPending}
      />
    </div>
  );
}