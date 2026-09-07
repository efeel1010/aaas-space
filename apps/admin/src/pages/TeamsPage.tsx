import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi, ApiError } from '../lib/api';
import { Spinner, useToast, ConfirmModal } from '../components/ui';
import { Search, Trash2, Users } from 'lucide-react';

export function TeamsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [keyword, setKeyword] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-teams', keyword],
    queryFn: () => adminApi.teams(keyword || undefined),
  });

  const remove = useMutation({
    mutationFn: (id: string) => adminApi.removeTeam(id),
    onSuccess: () => {
      toast('已解散团队');
      setConfirmDelete(null);
      qc.invalidateQueries({ queryKey: ['admin-teams'] });
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
          <h2 className="font-display text-20px font-700 text-ink">团队管理</h2>
          <p className="mt-1 text-13px text-muted">查看并管理平台内全部团队</p>
        </div>
        <form onSubmit={submitSearch} className="relative w-64">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            className="form-input !pl-9"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="按团队名称搜索"
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
                <th className="px-4 py-3 font-650">团队</th>
                <th className="px-4 py-3 font-650">所有者</th>
                <th className="px-4 py-3 font-650">成员数</th>
                <th className="px-4 py-3 font-650">创建时间</th>
                <th className="px-4 py-3 text-right font-650">操作</th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((t) => (
                <tr key={t.id} className="border-b border-line last:border-0 hover:bg-surface/60">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyan/15 text-cyan">
                        <Users size={15} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-13px font-650 text-ink">{t.name}</p>
                        {t.description && <p className="max-w-xs truncate text-11px text-muted">{t.description}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-13px text-ink">{t.owner_name}</td>
                  <td className="px-4 py-3 text-12px text-muted">{t.member_count}</td>
                  <td className="px-4 py-3 text-12px text-muted">{new Date(t.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end">
                      <button
                        onClick={() => setConfirmDelete(t.id)}
                        className="rounded-lg p-1.5 text-muted transition hover:bg-coral/10 hover:text-coral"
                        title="解散团队"
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
        title="解散团队"
        message="确认解散该团队？将级联删除团队下的文档、项目与成员关系，且不可恢复。"
        loading={remove.isPending}
      />
    </div>
  );
}