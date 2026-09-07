import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi, ApiError } from '../lib/api';
import { Spinner, useToast, ConfirmModal, cn } from '../components/ui';
import { Search, ShieldCheck, ShieldOff, Trash2 } from 'lucide-react';

export function UsersPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [keyword, setKeyword] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-users', keyword],
    queryFn: () => adminApi.users(keyword || undefined),
  });

  const toggleAdmin = useMutation({
    mutationFn: ({ id, is_admin }: { id: string; is_admin: boolean }) => adminApi.setUserAdmin(id, is_admin),
    onSuccess: (_d, v) => {
      toast(v.is_admin ? '已设为管理员' : '已取消管理员');
      qc.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: (e) => toast((e as ApiError).message, 'error'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => adminApi.removeUser(id),
    onSuccess: () => {
      toast('已删除用户');
      setConfirmDelete(null);
      qc.invalidateQueries({ queryKey: ['admin-users'] });
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
          <h2 className="font-display text-20px font-700 text-ink">用户管理</h2>
          <p className="mt-1 text-13px text-muted">管理全部平台用户与管理员权限</p>
        </div>
        <form onSubmit={submitSearch} className="relative w-64">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            className="form-input !pl-9"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="按姓名或邮箱搜索"
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
                <th className="px-4 py-3 font-650">用户</th>
                <th className="px-4 py-3 font-650">角色</th>
                <th className="px-4 py-3 font-650">注册时间</th>
                <th className="px-4 py-3 text-right font-650">操作</th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((u, i) => (
                <tr key={u.id} className="border-b border-line last:border-0 hover:bg-surface/60">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet to-violet-dark text-12px font-650 text-white">
                        {u.name.charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <p className="text-13px font-650 text-ink">{u.name}</p>
                        <p className="text-11px text-muted">{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {u.is_admin ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-violet-light px-2 py-0.5 text-11px font-650 text-violet">
                        <ShieldCheck size={12} /> 管理员
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-line px-2 py-0.5 text-11px font-650 text-muted">
                        普通用户
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-12px text-muted">{new Date(u.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => toggleAdmin.mutate({ id: u.id, is_admin: !u.is_admin })}
                        disabled={toggleAdmin.isPending}
                        className={cn(
                          'rounded-lg p-1.5 transition',
                          u.is_admin ? 'text-amber hover:bg-amber/10' : 'text-violet hover:bg-violet-light',
                        )}
                        title={u.is_admin ? '取消管理员' : '设为管理员'}
                      >
                        {u.is_admin ? <ShieldOff size={15} /> : <ShieldCheck size={15} />}
                      </button>
                      <button
                        onClick={() => setConfirmDelete(u.id)}
                        className="rounded-lg p-1.5 text-muted transition hover:bg-coral/10 hover:text-coral"
                        title="删除用户"
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
        title="删除用户"
        message="确认删除该用户？将级联删除其会话、团队成员关系、文档与项目等数据，且不可恢复。"
        loading={remove.isPending}
      />
    </div>
  );
}