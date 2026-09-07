import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { teamApi } from '../lib/api';
import { Empty, Spinner, Badge, Modal, useToast, ConfirmModal } from '../components/ui';
import { Users, Plus, Trash2, ChevronRight } from 'lucide-react';
import { useState } from 'react';

export function TeamsPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const [openCreate, setOpenCreate] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);

  const teams = useQuery({ queryKey: ['teams'], queryFn: () => teamApi.list() });

  const create = useMutation({
    mutationFn: () => teamApi.create(name, description),
    onSuccess: (t) => {
      toast('团队创建成功');
      setOpenCreate(false);
      setName('');
      setDescription('');
      qc.invalidateQueries({ queryKey: ['teams'] });
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });

  const del = useMutation({
    mutationFn: (id: string) => teamApi.remove(id),
    onSuccess: () => {
      toast('已解散团队');
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ['teams'] });
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });

  return (
    <div className="mx-auto max-w-1100 px-8 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 font-display text-26px font-700 text-ink">
            <Users size={24} className="text-violet" /> 团队空间
          </h1>
          <p className="mt-1 text-13px text-muted">创建团队、邀请成员，共享文档、项目与 AI 会话</p>
        </div>
        <button className="btn btn-primary" onClick={() => setOpenCreate(true)}>
          <Plus size={15} /> 创建团队
        </button>
      </div>

      {teams.isLoading ? (
        <div className="py-16 text-center"><Spinner size={22} /></div>
      ) : (teams.data ?? []).length === 0 ? (
        <Empty icon="/pulse-team.svg" title="还没有团队" desc="创建一个团队，与伙伴一起协作" />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(teams.data ?? []).map((t) => (
            <div key={t.id} className="card card-hover group relative p-5">
              <Link to={`/teams/${t.id}`} className="block">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-light text-violet">
                    <Users size={18} />
                  </div>
                  <Badge value={t.my_role ?? 'member'} />
                </div>
                <p className="text-14px font-650 text-ink">{t.name}</p>
                <p className="mt-1 line-clamp-2 min-h-9 text-12px text-muted">{t.description || '暂无描述'}</p>
                <div className="mt-3 flex items-center justify-between text-12px text-muted">
                  <span>{t.member_count} 位成员</span>
                  <span className="flex items-center gap-1 text-violet">进入 <ChevronRight size={13} /></span>
                </div>
              </Link>
              {t.my_role === 'owner' && (
                <button
                  onClick={() => setDeleting(t.id)}
                  className="absolute right-3 top-3 rounded-lg p-1.5 text-muted opacity-0 transition hover:bg-coral/10 hover:text-coral group-hover:opacity-100"
                  title="解散"
                >
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal open={openCreate} onClose={() => setOpenCreate(false)} title="创建团队">
        <div className="form-group">
          <label>团队名称</label>
          <input className="form-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="团队名称" autoFocus />
        </div>
        <div className="form-group">
          <label>团队描述</label>
          <textarea className="form-input min-h-20 resize-none" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="团队定位、目标…" />
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={() => setOpenCreate(false)}>取消</button>
          <button className="btn btn-primary" disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? <Spinner size={14} /> : null} 创建
          </button>
        </div>
      </Modal>

      <ConfirmModal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && del.mutate(deleting)}
        title="解散团队"
        message="解散后团队所有数据将删除，确定吗？"
        loading={del.isPending}
      />
    </div>
  );
}
