import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { teamApi, docApi, projectApi } from '../lib/api';
import { Badge, Spinner, Modal, useToast, Empty } from '../components/ui';
import { ArrowLeft, UserPlus, Users, FileText, FolderKanban, Trash2, Shield, User } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

export function TeamDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();

  const [openInvite, setOpenInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');

  const team = useQuery({ queryKey: ['team', id], queryFn: () => teamApi.detail(id!) });
  const stats = useQuery({ queryKey: ['team-stats', id], queryFn: () => teamApi.stats(id!) });
  const docs = useQuery({
    queryKey: ['docs', 'team', id],
    queryFn: () => docApi.list({ scope: 'team', teamId: id, kind: 'doc' }),
    enabled: !!id,
  });
  const projects = useQuery({
    queryKey: ['projects', 'team', id],
    queryFn: () => projectApi.list({ scope: 'team', teamId: id }),
    enabled: !!id,
  });

  const canManage = team.data?.my_role === 'owner' || team.data?.my_role === 'admin';

  const invite = useMutation({
    mutationFn: () => teamApi.addMember(id!, inviteEmail, inviteRole),
    onSuccess: () => {
      toast('已邀请成员');
      setOpenInvite(false);
      setInviteEmail('');
      qc.invalidateQueries({ queryKey: ['team', id] });
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });

  const removeMember = useMutation({
    mutationFn: (userId: string) => teamApi.removeMember(id!, userId),
    onSuccess: () => {
      toast('已移除成员');
      qc.invalidateQueries({ queryKey: ['team', id] });
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });

  const setRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) => teamApi.setRole(id!, userId, role),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team', id] });
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });

  if (team.isLoading) return <div className="flex h-full items-center justify-center"><Spinner size={24} /></div>;
  if (team.isError) return <Empty icon="/pulse-team.svg" title="团队不存在或无权访问" />;
  const t = team.data!;

  return (
    <div className="mx-auto max-w-1100 px-8 py-8">
      <button onClick={() => navigate('/teams')} className="mb-4 flex items-center gap-1 text-12px font-600 text-muted transition hover:text-violet">
        <ArrowLeft size={14} /> 返回团队列表
      </button>

      {/* 头部 */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-26px font-700 text-ink">{t.name}</h1>
            <Badge value={t.my_role ?? 'member'} />
          </div>
          <p className="mt-1.5 text-13px text-muted">{t.description || '暂无描述'}</p>
        </div>
        {canManage && (
          <button className="btn btn-primary" onClick={() => setOpenInvite(true)}>
            <UserPlus size={15} /> 邀请成员
          </button>
        )}
      </div>

      {/* 统计 */}
      <div className="mb-6 grid grid-cols-3 gap-4">
        <div className="card p-5 text-center">
          <p className="text-24px font-700 text-violet">{stats.data?.project_count ?? 0}</p>
          <p className="text-12px text-muted">项目</p>
        </div>
        <div className="card p-5 text-center">
          <p className="text-24px font-700 text-cyan">{stats.data?.doc_count ?? 0}</p>
          <p className="text-12px text-muted">文档</p>
        </div>
        <div className="card p-5 text-center">
          <p className="text-24px font-700 text-green">{stats.data?.ai_conversation_count ?? 0}</p>
          <p className="text-12px text-muted">AI 会话</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* 成员 */}
        <div className="card p-6">
          <h2 className="mb-4 flex items-center gap-2 font-display text-16px font-650 text-ink">
            <Users size={17} className="text-violet" /> 成员（{t.members.length}）
          </h2>
          <ul className="divide-y divide-line">
            {t.members.map((m) => (
              <li key={m.user_id} className="flex items-center gap-3 py-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-violet to-violet-dark text-white">
                  <span className="text-13px font-650">{m.name?.charAt(0) ?? 'U'}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-13px font-600 text-ink">{m.name} {m.user_id === user?.id && <span className="text-11px text-violet">(我)</span>}</p>
                  <p className="truncate text-11px text-muted">{m.email}</p>
                </div>
                {canManage && m.role !== 'owner' ? (
                  <div className="flex items-center gap-1.5">
                    <select
                      className="form-input w-24 py-1 text-11px"
                      value={m.role}
                      onChange={(e) => setRole.mutate({ userId: m.user_id, role: e.target.value })}
                    >
                      <option value="admin">管理员</option>
                      <option value="member">成员</option>
                    </select>
                    <button onClick={() => removeMember.mutate(m.user_id)} className="rounded-lg p-1.5 text-muted transition hover:bg-coral/10 hover:text-coral">
                      <Trash2 size={14} />
                    </button>
                  </div>
                ) : (
                  <span className="flex items-center gap-1 text-11px text-muted">
                    {m.role === 'owner' ? <Shield size={12} className="text-violet" /> : <User size={12} />}
                    {m.role === 'owner' ? '创建者' : '成员'}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>

        {/* 团队文档 */}
        <div className="card p-6">
          <h2 className="mb-4 flex items-center justify-between font-display text-16px font-650 text-ink">
            <span className="flex items-center gap-2"><FileText size={17} className="text-cyan" /> 团队文档</span>
            <a href={`/docs?team=${id}`} className="text-12px font-600 text-violet hover:underline">管理</a>
          </h2>
          {docs.isLoading ? (
            <div className="py-8 text-center"><Spinner /></div>
          ) : (docs.data ?? []).length === 0 ? (
            <p className="py-8 text-center text-13px text-muted">暂无团队文档</p>
          ) : (
            <ul className="divide-y divide-line">
              {(docs.data ?? []).filter((d) => !d.is_folder).slice(0, 6).map((d) => (
                <li key={d.id}>
                  <a href={`/docs/${d.id}`} className="flex items-center justify-between py-2.5 transition hover:text-violet">
                    <span className="flex items-center gap-2 text-13px font-600 text-ink">
                      <FileText size={14} className="text-cyan" /> {d.title}
                    </span>
                    <span className="text-11px text-muted">{new Date(d.updated_at).toLocaleDateString()}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}

          <h2 className="mb-4 mt-6 flex items-center gap-2 font-display text-16px font-650 text-ink">
            <FolderKanban size={17} className="text-green" /> 团队项目
          </h2>
          {projects.isLoading ? (
            <div className="py-6 text-center"><Spinner /></div>
          ) : (projects.data ?? []).length === 0 ? (
            <p className="py-6 text-center text-13px text-muted">暂无团队项目</p>
          ) : (
            <ul className="divide-y divide-line">
              {(projects.data ?? []).slice(0, 6).map((p) => (
                <li key={p.id}>
                  <a href={`/projects/${p.id}`} className="flex items-center justify-between py-2.5 transition hover:text-violet">
                    <span className="flex items-center gap-2 text-13px font-600 text-ink">
                      <FolderKanban size={14} className="text-green" /> {p.name}
                    </span>
                    <Badge value={p.status} />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* 邀请 */}
      <Modal open={openInvite} onClose={() => setOpenInvite(false)} title="邀请成员">
        <div className="form-group">
          <label>成员邮箱</label>
          <input className="form-input" type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="member@example.com" autoFocus />
          <p className="mt-1 text-11px text-muted">需为该邮箱注册过 Pulse Space 账号</p>
        </div>
        <div className="form-group">
          <label>角色</label>
          <select className="form-input" value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
            <option value="admin">管理员</option>
            <option value="member">成员</option>
          </select>
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={() => setOpenInvite(false)}>取消</button>
          <button className="btn btn-primary" disabled={!inviteEmail.trim() || invite.isPending} onClick={() => invite.mutate()}>
            {invite.isPending ? <Spinner size={14} /> : null} 邀请
          </button>
        </div>
      </Modal>
    </div>
  );
}
