import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { projectApi, teamApi } from '../lib/api';
import { Empty, Spinner, Badge, Modal, useToast, ConfirmModal, priorityOrder, cn } from '../components/ui';
import { UserPicker, type PickedUser } from '../components/UserPicker';
import { fromLocalInput, toLocalInput, rangeSummary } from '../lib/datetime';
import { FolderKanban, Plus, Trash2, ListTodo, Pencil, Users, CheckCircle2, Play, Clock, Target } from 'lucide-react';
import { useState } from 'react';
import type { Project } from '@pulse-space/contracts';

type ProjectForm = {
  name: string;
  description: string;
  status: string;
  planStart: string;
  planEnd: string;
  actualStart: string;
  actualEnd: string;
  collaborators: PickedUser[];
};

const emptyForm: ProjectForm = {
  name: '',
  description: '',
  status: 'planning',
  planStart: '',
  planEnd: '',
  actualStart: '',
  actualEnd: '',
  collaborators: [],
};

function buildCollaborators(list: Project['collaborators']) {
  return (list ?? []).map((c) => ({ id: c.user_id, name: c.name, email: '', avatar_url: c.avatar_url }));
}

const TIME_LABELS: { key: 'planStart' | 'planEnd' | 'actualStart' | 'actualEnd'; label: string }[] = [
  { key: 'planStart', label: '计划开始' },
  { key: 'planEnd', label: '计划结束' },
  { key: 'actualStart', label: '实际开始' },
  { key: 'actualEnd', label: '实际结束' },
];

export function ProjectsPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const [scope, setScope] = useState<'personal' | 'team'>('personal');
  const [teamId, setTeamId] = useState<string | undefined>(undefined);
  const [openCreate, setOpenCreate] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<ProjectForm>(emptyForm);
  const [deleting, setDeleting] = useState<string | null>(null);

  const teams = useQuery({ queryKey: ['teams'], queryFn: () => teamApi.list() });
  const projects = useQuery({
    queryKey: ['projects', scope, teamId],
    queryFn: () => projectApi.list({ scope, teamId }),
  });

  const editTarget = editId ? (projects.data?.find((p) => p.id === editId) ?? null) : null;

  const resetCreate = () => {
    setForm(emptyForm);
    setOpenCreate(false);
  };

  const create = useMutation({
    mutationFn: () =>
      projectApi.create({
        scope,
        team_id: scope === 'team' ? teamId : undefined,
        name: form.name,
        description: form.description || undefined,
        plan_start_at: fromLocalInput(form.planStart),
        plan_end_at: fromLocalInput(form.planEnd),
        actual_start_at: fromLocalInput(form.actualStart),
        actual_end_at: fromLocalInput(form.actualEnd),
        collaborator_ids: form.collaborators.map((u) => u.id),
      }),
    onSuccess: () => {
      toast('项目创建成功');
      resetCreate();
      qc.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });

  const update = useMutation({
    mutationFn: () =>
      projectApi.update(editId!, {
        name: form.name,
        description: form.description,
        status: form.status,
        plan_start_at: fromLocalInput(form.planStart),
        plan_end_at: fromLocalInput(form.planEnd),
        actual_start_at: fromLocalInput(form.actualStart),
        actual_end_at: fromLocalInput(form.actualEnd),
        collaborator_ids: form.collaborators.map((u) => u.id),
      }),
    onSuccess: () => {
      toast('项目已更新');
      setEditId(null);
      setForm(emptyForm);
      qc.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });

  const del = useMutation({
    mutationFn: (id: string) => projectApi.remove(id),
    onSuccess: () => {
      toast('已删除');
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });

  const set = (k: keyof ProjectForm, v: ProjectForm[typeof k]) => setForm((f) => ({ ...f, [k]: v }));

  // 项目仪表盘统计
  const stats = (() => {
    const list = projects.data ?? [];
    const total = list.length;
    const active = list.filter((p) => p.status === 'active').length;
    const done = list.filter((p) => p.status === 'completed').length;
    const totalTasks = list.reduce((s, p) => s + p.task_count, 0);
    const doneTasks = list.reduce((s, p) => s + p.done_task_count, 0);
    const doneRate = totalTasks ? Math.round((doneTasks / totalTasks) * 100) : 0;
    return { total, active, done, doneRate };
  })();

  const openEdit = (p: Project) => {
    setEditId(p.id);
    setForm({
      name: p.name,
      description: p.description,
      status: p.status,
      planStart: toLocalInput(p.plan_start_at),
      planEnd: toLocalInput(p.plan_end_at),
      actualStart: toLocalInput(p.actual_start_at),
      actualEnd: toLocalInput(p.actual_end_at),
      collaborators: buildCollaborators(p.collaborators),
    });
  };

  return (
    <div className="mx-auto max-w-1100 px-8 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 font-display text-26px font-700 text-ink">
            <FolderKanban size={24} className="text-violet" /> 项目中心
          </h1>
          <p className="mt-1 text-13px text-muted">项目 → 需求 → 任务，全链路管理</p>
        </div>
        <button className="btn btn-primary" onClick={() => { setForm(emptyForm); setOpenCreate(true); }}>
          <Plus size={15} /> 新建项目
        </button>
      </div>

      <div className="mb-5 flex items-center gap-2">
        {(['personal', 'team'] as const).map((s) => (
          <button
            key={s}
            onClick={() => { setScope(s); setTeamId(undefined); }}
            className={cn(
              'rounded-full px-4 py-1.5 text-12px font-650 transition',
              scope === s ? 'bg-violet text-white' : 'bg-white text-muted border border-line hover:text-violet',
            )}
          >
            {s === 'personal' ? '个人项目' : '团队项目'}
          </button>
        ))}
        {scope === 'team' && (
          <select className="form-input ml-2 w-52 py-1.5" value={teamId ?? ''} onChange={(e) => setTeamId(e.target.value || undefined)}>
            <option value="">选择团队</option>
            {(teams.data ?? []).map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* 仪表盘 */}
      {!projects.isLoading && (projects.data ?? []).length > 0 && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="card flex items-center gap-3 p-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-light text-violet">
              <FolderKanban size={17} />
            </div>
            <div>
              <p className="text-20px font-700 text-ink">{stats.total}</p>
              <p className="text-11px text-muted">项目总数</p>
            </div>
          </div>
          <div className="card flex items-center gap-3 p-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cyan/15 text-cyan">
              <Play size={17} />
            </div>
            <div>
              <p className="text-20px font-700 text-ink">{stats.active}</p>
              <p className="text-11px text-muted">进行中</p>
            </div>
          </div>
          <div className="card flex items-center gap-3 p-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-green/15 text-green">
              <CheckCircle2 size={17} />
            </div>
            <div>
              <p className="text-20px font-700 text-ink">{stats.done}</p>
              <p className="text-11px text-muted">已完成</p>
            </div>
          </div>
          <div className="card flex items-center gap-3 p-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber/15 text-amber">
              <Target size={17} />
            </div>
            <div>
              <p className="text-20px font-700 text-ink">{stats.doneRate}%</p>
              <p className="text-11px text-muted">任务完成率</p>
            </div>
          </div>
        </div>
      )}

      {projects.isLoading ? (
        <div className="py-16 text-center"><Spinner size={22} /></div>
      ) : (projects.data ?? []).length === 0 ? (
        <Empty icon="/pulse-projects.svg" title="暂无项目" desc="创建项目，开启需求与任务管理" />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(projects.data ?? []).sort((a, b) => priorityOrder[a.status] - priorityOrder[b.status]).map((p) => {
            const pct = p.task_count ? Math.round((p.done_task_count / p.task_count) * 100) : 0;
            const range = rangeSummary(p.plan_start_at, p.plan_end_at);
            return (
              <div key={p.id} className="card card-hover group relative p-5">
                <Link to={`/projects/${p.id}`} className="block">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-light text-violet">
                      <FolderKanban size={18} />
                    </div>
                    <Badge value={p.status} />
                  </div>
                  <p className="text-14px font-650 text-ink">{p.name}</p>
                  <p className="mt-1 line-clamp-2 min-h-9 text-12px text-muted">{p.description || '暂无描述'}</p>
                  <div className="mt-3 flex items-center gap-3">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
                      <div className="h-full rounded-full bg-gradient-to-r from-violet to-violet-dark" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-11px text-muted">{p.done_task_count}/{p.task_count}</span>
                  </div>
                  <div className="mt-3 flex items-center gap-3 text-11px text-muted">
                    <span className="flex items-center gap-1"><ListTodo size={12} /> {p.requirement_count} 需求</span>
                    <span className="flex items-center gap-1"><ListTodo size={12} /> {p.task_count} 任务</span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-10px text-muted">
                    <span className="flex items-center gap-1">👤 {p.owner_name || '我'}</span>
                    {(p.collaborators ?? []).length > 0 && (
                      <span className="flex items-center gap-1"><Users size={11} /> {p.collaborators.length} 协作</span>
                    )}
                    {range && <span className="text-violet/70">{range}</span>}
                  </div>
                </Link>
                <div className="absolute right-3 top-3 flex gap-1">
                  <button
                    onClick={() => openEdit(p)}
                    className="rounded-lg p-1.5 text-muted opacity-0 transition hover:bg-violet-light hover:text-violet group-hover:opacity-100"
                    title="编辑"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => setDeleting(p.id)}
                    className="rounded-lg p-1.5 text-muted opacity-0 transition hover:bg-coral/10 hover:text-coral group-hover:opacity-100"
                    title="删除"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 新建 / 编辑项目 */}
      <Modal
        open={openCreate || !!editTarget}
        onClose={() => { resetCreate(); setEditId(null); }}
        title={editTarget ? `编辑项目 — ${editTarget.name}` : '新建项目'}
        width={560}
      >
        <div className="form-group">
          <label>项目名称</label>
          <input className="form-input" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="项目名称" autoFocus />
        </div>
        <div className="form-group">
          <label>项目描述</label>
          <textarea className="form-input min-h-20 resize-none" value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="项目目标、范围…" />
        </div>
        {editTarget && (
          <div className="form-group">
            <label>状态</label>
            <select className="form-input" value={form.status} onChange={(e) => set('status', e.target.value)}>
              <option value="planning">规划中</option>
              <option value="active">进行中</option>
              <option value="paused">已暂停</option>
              <option value="completed">已完成</option>
              <option value="archived">已归档</option>
            </select>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          {TIME_LABELS.map(({ key, label }) => (
            <div key={key} className="form-group">
              <label>{label}</label>
              <input type="datetime-local" className="form-input" value={form[key]} onChange={(e) => set(key, e.target.value)} />
            </div>
          ))}
        </div>
        <div className="form-group">
          <label>协作人</label>
          <UserPicker value={form.collaborators} onChange={(users) => set('collaborators', users)} placeholder="搜索系统用户并选择协作人" max={20} />
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={() => { resetCreate(); setEditId(null); }}>取消</button>
          <button
            className="btn btn-primary"
            disabled={!form.name.trim() || create.isPending || update.isPending}
            onClick={() => (editTarget ? update.mutate() : create.mutate())}
          >
            {(create.isPending || update.isPending) ? <Spinner size={14} /> : null} {editTarget ? '保存' : '创建'}
          </button>
        </div>
      </Modal>

      <ConfirmModal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && del.mutate(deleting)}
        title="删除项目"
        message="删除项目将同时删除其下所有需求与任务，确定吗？"
        loading={del.isPending}
      />
    </div>
  );
}