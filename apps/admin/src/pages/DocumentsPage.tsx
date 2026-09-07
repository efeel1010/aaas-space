import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi, ApiError } from '../lib/api';
import { Spinner, useToast, ConfirmModal, Badge } from '../components/ui';
import { Search, Trash2, Folder, FileText } from 'lucide-react';

export function DocumentsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [keyword, setKeyword] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-documents', keyword],
    queryFn: () => adminApi.documents(keyword || undefined),
  });

  const remove = useMutation({
    mutationFn: (id: string) => adminApi.removeDocument(id),
    onSuccess: () => {
      toast('已删除文档');
      setConfirmDelete(null);
      qc.invalidateQueries({ queryKey: ['admin-documents'] });
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
          <h2 className="font-display text-20px font-700 text-ink">文档管理</h2>
          <p className="mt-1 text-13px text-muted">查看并管理平台内全部文档与知识库</p>
        </div>
        <form onSubmit={submitSearch} className="relative w-64">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            className="form-input !pl-9"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="按文档标题搜索"
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
                <th className="px-4 py-3 font-650">标题</th>
                <th className="px-4 py-3 font-650">类型</th>
                <th className="px-4 py-3 font-650">所有者</th>
                <th className="px-4 py-3 font-650">更新时间</th>
                <th className="px-4 py-3 text-right font-650">操作</th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((d) => (
                <tr key={d.id} className="border-b border-line last:border-0 hover:bg-surface/60">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      {d.is_folder ? (
                        <Folder size={15} className="shrink-0 text-amber" />
                      ) : (
                        <FileText size={15} className="shrink-0 text-muted" />
                      )}
                      <p className="max-w-sm truncate text-13px font-650 text-ink">{d.title}</p>
                      {d.deleted_at && <span className="shrink-0 rounded bg-coral/10 px-1.5 py-0.5 text-10px font-650 text-coral">回收站</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge value={d.kind} />
                  </td>
                  <td className="px-4 py-3 text-13px text-ink">{d.owner_name}</td>
                  <td className="px-4 py-3 text-12px text-muted">{new Date(d.updated_at).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end">
                      <button
                        onClick={() => setConfirmDelete(d.id)}
                        className="rounded-lg p-1.5 text-muted transition hover:bg-coral/10 hover:text-coral"
                        title="删除文档"
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
        title="删除文档"
        message="确认删除该文档/文件夹？将级联删除其版本历史与评论，且不可恢复。"
        loading={remove.isPending}
      />
    </div>
  );
}