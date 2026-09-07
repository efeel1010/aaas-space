import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi, ApiError } from '../lib/api';
import { Spinner, useToast, ConfirmModal, Badge } from '../components/ui';
import { Search, Trash2, MessageSquare } from 'lucide-react';

export function CommentsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [keyword, setKeyword] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-comments', keyword],
    queryFn: () => adminApi.comments(keyword || undefined),
  });

  const remove = useMutation({
    mutationFn: (id: string) => adminApi.removeComment(id),
    onSuccess: () => {
      toast('已删除评论');
      setConfirmDelete(null);
      qc.invalidateQueries({ queryKey: ['admin-comments'] });
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
          <h2 className="font-display text-20px font-700 text-ink">评论审计</h2>
          <p className="mt-1 text-13px text-muted">平台内需求 / 任务评论的内容治理</p>
        </div>
        <form onSubmit={submitSearch} className="relative w-64">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            className="form-input !pl-9"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="按评论内容搜索"
          />
        </form>
      </div>

      <div className="mt-6 overflow-hidden rounded-2xl">
        {isLoading ? (
          <div className="flex justify-center py-20">
            <Spinner size={24} />
          </div>
        ) : (data ?? []).length === 0 ? (
          <p className="bg-white py-16 text-center text-13px text-muted">暂无评论</p>
        ) : (
          <table className="w-full border-collapse bg-white text-left">
            <thead>
              <tr className="border-b border-line text-12px text-muted">
                <th className="px-4 py-3 font-650">内容</th>
                <th className="px-4 py-3 font-650">作者</th>
                <th className="px-4 py-3 font-650">目标类型</th>
                <th className="px-4 py-3 font-650">时间</th>
                <th className="px-4 py-3 text-right font-650">操作</th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((c) => (
                <tr key={c.id} className="border-b border-line last:border-0 hover:bg-surface/60">
                  <td className="px-4 py-3">
                    <div className="flex max-w-md items-center gap-2.5">
                      <MessageSquare size={15} className="shrink-0 text-muted" />
                      <p className="truncate text-13px text-ink">{c.content}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-13px text-ink">{c.user_name}</p>
                    <p className="text-11px text-muted">{c.user_email}</p>
                  </td>
                  <td className="px-4 py-3">
                    <Badge value={c.target_type} />
                  </td>
                  <td className="px-4 py-3 text-12px text-muted">{new Date(c.created_at).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end">
                      <button
                        onClick={() => setConfirmDelete(c.id)}
                        className="rounded-lg p-1.5 text-muted transition hover:bg-coral/10 hover:text-coral"
                        title="删除评论"
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
        title="删除评论"
        message="确认删除该评论？删除后不可恢复。"
        loading={remove.isPending}
      />
    </div>
  );
}
