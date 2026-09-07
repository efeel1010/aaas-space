import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { projectApi, aiApi } from '../lib/api';
import { Badge, Spinner, Modal, useToast, cn, priorityOrder, Empty } from '../components/ui';
import { UserPicker, type PickedUser } from '../components/UserPicker';
import { CommentThread } from '../components/CommentThread';
import { fromLocalInput, toLocalInput, rangeSummary } from '../lib/datetime';
import { ArrowLeft, Plus, Sparkles, Trash2, ChevronDown, ChevronRight, ListTodo, Wand2, Check, Pencil, Users, ListTree, ChartGantt, Flag, CheckCircle2, Circle } from 'lucide-react';
import { useState } from 'react';
import type { Requirement, Task, Collaborator, Milestone } from '@pulse-space/contracts';

const TASK_COLUMNS = [
  { key: 'todo', label: '待办', color: 'text-violet', bg: 'bg-violet-light', ring: 'ring-violet/50' },
  { key: 'doing', label: '进行中', color: 'text-cyan', bg: 'bg-cyan/10', ring: 'ring-cyan/50' },
  { key: 'review', label: '待评审', color: 'text-amber', bg: 'bg-amber/10', ring: 'ring-amber/50' },
  { key: 'done', label: '已完成', color: 'text-green', bg: 'bg-green/10', ring: 'ring-green/50' },
];

type ReqForm = {
  id: string | null;
  title: string;
  description: string;
  priority: string;
  status: string;
  owner: PickedUser[];
  planStart: string;
  planEnd: string;
  actualStart: string;
  actualEnd: string;
  collaborators: PickedUser[];
};

type TaskForm = {
  id: string | null;
  requirementId: string;
  title: string;
  description: string;
  priority: string;
  status: string;
  assignee: PickedUser[];
  dueDate: string;
  planStart: string;
  planEnd: string;
  actualStart: string;
  actualEnd: string;
  collaborators: PickedUser[];
};

const emptyReq: ReqForm = {
  id: null, title: '', description: '', priority: 'medium', status: 'open',
  owner: [], planStart: '', planEnd: '', actualStart: '', actualEnd: '', collaborators: [],
};
const emptyTask: TaskForm = {
  id: null, requirementId: '', title: '', description: '', priority: 'medium', status: 'todo',
  assignee: [], dueDate: '', planStart: '', planEnd: '', actualStart: '', actualEnd: '', collaborators: [],
};

function ownerToPicked(id: string | null, name: string | null): PickedUser[] {
  return id ? [{ id, name: name ?? '', email: '', avatar_url: null }] : [];
}
function collabsToPicked(list: Collaborator[]): PickedUser[] {
  return (list ?? []).map((c) => ({ id: c.user_id, name: c.name, email: '', avatar_url: c.avatar_url }));
}
function dateInputFor(iso: string | null | undefined) {
  return toLocalInput(iso ?? '');
}

const TIME_LABELS: { key: 'planStart' | 'planEnd' | 'actualStart' | 'actualEnd'; label: string }[] = [
  { key: 'planStart', label: '计划开始' },
  { key: 'planEnd', label: '计划结束' },
  { key: 'actualStart', label: '实际开始' },
  { key: 'actualEnd', label: '实际结束' },
];

// ===== 甘特图视图 =====
type GanttBar = {
  id: string;
  label: string;
  start: Date;
  end: Date;
  isDone: boolean;
  level: 0 | 1;
};

function toDate(s: string | null | undefined): Date | null {
  return s ? new Date(s) : null;
}

function GanttView({ requirements, tasksByReq }: { requirements: Requirement[]; tasksByReq: Record<string, Task[]> }) {
  const bars: GanttBar[] = [];
  let minTs = Infinity;
  let maxTs = -Infinity;

  for (const r of requirements) {
    let s = toDate(r.plan_start_at) ?? toDate(r.actual_start_at);
    let e = toDate(r.plan_end_at) ?? toDate(r.actual_end_at);
    const tasks = tasksByReq[r.id] ?? [];
    for (const t of tasks) {
      const ts = toDate(t.plan_start_at) ?? toDate(t.actual_start_at);
      const te = toDate(t.plan_end_at) ?? toDate(t.actual_end_at);
      if (ts && (!s || ts < s)) s = ts;
      if (te && (!e || te > e)) e = te;
    }
    if (!s || !e) continue;
    bars.push({ id: r.id, label: r.title, start: s, end: e, isDone: r.status === 'done', level: 0 });
    for (const t of tasks) {
      const ts = toDate(t.plan_start_at) ?? toDate(t.actual_start_at);
      const te = toDate(t.plan_end_at) ?? toDate(t.actual_end_at);
      if (ts && te) {
        bars.push({ id: t.id, label: t.title, start: ts, end: te, isDone: t.status === 'done', level: 1 });
      }
    }
  }

  if (bars.length === 0) {
    return (
      <div className="card flex flex-col items-center justify-center p-16 text-center">
        <p className="text-14px font-650 text-ink">暂无时间排程</p>
        <p className="mt-1 text-12px text-muted">为需求或任务设置「计划开始/结束时间」后，此处将显示甘特图</p>
      </div>
    );
  }

  for (const b of bars) {
    minTs = Math.min(minTs, b.start.getTime());
    maxTs = Math.max(maxTs, b.end.getTime());
  }
  const span = Math.max(maxTs - minTs, 1);

  // 时间刻度（按跨度的 4 等分）
  const ticks: string[] = [];
  for (let i = 0; i <= 4; i++) {
    const ts = minTs + (span * i) / 4;
    ticks.push(new Date(ts).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }));
  }

  return (
    <div className="card overflow-hidden p-5">
      {/* 时间刻度轴 */}
      <div className="mb-4 grid grid-cols-[180px_1fr] gap-4">
        <div className="text-11px font-650 text-muted">名称</div>
        <div className="flex justify-between text-11px text-muted">
          {ticks.map((t, i) => (
            <span key={i}>{t}</span>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        {bars.map((b) => {
          const left = ((b.start.getTime() - minTs) / span) * 100;
          const width = Math.max(((b.end.getTime() - b.start.getTime()) / span) * 100, 1.5);
          return (
            <div key={b.id} className={cn('group grid grid-cols-[180px_1fr] items-center gap-4', b.level === 1 && 'ml-4')}>
              <div className="flex items-center gap-1.5 min-w-0">
                <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', b.isDone ? 'bg-green' : 'bg-violet')} />
                <p className={cn('truncate text-12px', b.level === 0 ? 'font-650 text-ink' : 'text-muted')} title={b.label}>
                  {b.label}
                </p>
              </div>
              <div className="relative h-5 rounded-full bg-surface">
                <div
                  className={cn(
                    'absolute h-full rounded-full transition-all group-hover:opacity-80',
                    b.isDone ? 'bg-green/70' : 'bg-gradient-to-r from-violet to-violet-dark',
                    b.level === 1 && 'opacity-80',
                  )}
                  style={{ left: `${left}%`, width: `${width}%` }}
                  title={`${b.start.toLocaleDateString()} - ${b.end.toLocaleDateString()}`}
                />
              </div>
            </div>
          );
        })}
      </div>
      {/* 今日线 */}
      {(() => {
        const now = Date.now();
        if (now < minTs || now > maxTs) return null;
        const left = ((now - minTs) / span) * 100;
        return (
          <div className="mt-4 grid grid-cols-[180px_1fr] gap-4">
            <div className="text-11px font-650 text-coral">今天</div>
            <div className="relative h-0">
              <div className="absolute -top-[calc(100%+6px)] bottom-0 w-px bg-coral" style={{ left: `${left}%`, height: `${bars.length * 26 + 32}px` }} />
            </div>
          </div>
        );
      })()}
    </div>
  );
}

export function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [reqModalOpen, setReqModalOpen] = useState(false);
  const [reqForm, setReqForm] = useState<ReqForm>(emptyReq);
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [taskForm, setTaskForm] = useState<TaskForm>(emptyTask);
  // 看板拖拽
  const [draggingTask, setDraggingTask] = useState<Task | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  // 视图切换：需求列表 / 时间线
  const [viewMode, setViewMode] = useState<'list' | 'timeline'>('list');
  // 里程碑
  const [milestoneOpen, setMilestoneOpen] = useState(false);
  const [milestoneTitle, setMilestoneTitle] = useState('');
  const [milestoneDesc, setMilestoneDesc] = useState('');
  const [milestoneDue, setMilestoneDue] = useState('');

  // AI 生成需求（项目级别）
  const [openAi, setOpenAi] = useState(false);
  const [aiDesc, setAiDesc] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiReqs, setAiReqs] = useState<{ title: string; description: string; priority: string }[]>([]);
  const [selectedReqs, setSelectedReqs] = useState<Set<number>>(new Set());

  // AI 生成任务（需求级别）
  const [taskAiOpen, setTaskAiOpen] = useState(false);
  const [taskAiRequirementId, setTaskAiRequirementId] = useState('');
  const [taskAiRequirementTitle, setTaskAiRequirementTitle] = useState('');
  const [taskAiRequirementDesc, setTaskAiRequirementDesc] = useState('');
  const [taskAiDesc, setTaskAiDesc] = useState('');
  const [taskAiLoading, setTaskAiLoading] = useState(false);
  const [taskAiTasks, setTaskAiTasks] = useState<{ title: string; description: string; priority: string }[]>([]);
  const [selectedTasks, setSelectedTasks] = useState<Set<number>>(new Set());

  const project = useQuery({ queryKey: ['project', id], queryFn: () => projectApi.get(id!) });
  const reqs = useQuery({ queryKey: ['reqs', id], queryFn: () => projectApi.requirements(id!) });
  const milestones = useQuery({ queryKey: ['milestones', id], queryFn: () => projectApi.milestones(id!) });
  const tasksByReq = useQuery({
    queryKey: ['tasks-all', id],
    queryFn: async () => {
      const list = await projectApi.requirements(id!);
      const pairs = await Promise.all(list.map((r) => projectApi.tasks(r.id).then((ts) => [r.id, ts] as const)));
      return Object.fromEntries(pairs) as Record<string, Task[]>;
    },
    enabled: !!id && !!(reqs.data?.length),
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['reqs'] });
    qc.invalidateQueries({ queryKey: ['tasks-all'] });
    qc.invalidateQueries({ queryKey: ['project'] });
    qc.invalidateQueries({ queryKey: ['milestones'] });
  };

  const createMilestone = useMutation({
    mutationFn: () =>
      projectApi.createMilestone(id!, {
        title: milestoneTitle,
        description: milestoneDesc || undefined,
        due_date: milestoneDue ? new Date(milestoneDue).toISOString() : null,
      }),
    onSuccess: () => {
      toast('里程碑已创建');
      setMilestoneOpen(false);
      setMilestoneTitle('');
      setMilestoneDesc('');
      setMilestoneDue('');
      invalidateAll();
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });

  const toggleMilestone = useMutation({
    mutationFn: (mid: string) => projectApi.toggleMilestone(mid),
    onSuccess: () => {
      toast('已更新里程碑状态');
      invalidateAll();
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });

  const removeMilestone = useMutation({
    mutationFn: (mid: string) => projectApi.removeMilestone(mid),
    onSuccess: () => {
      toast('已删除里程碑');
      invalidateAll();
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });

  const openNewReq = () => {
    setReqForm({ ...emptyReq });
    setReqModalOpen(true);
  };
  const openEditReq = (r: Requirement) => {
    setReqForm({
      id: r.id,
      title: r.title,
      description: r.description,
      priority: r.priority,
      status: r.status,
      owner: ownerToPicked(r.owner_id, r.owner_name),
      planStart: dateInputFor(r.plan_start_at),
      planEnd: dateInputFor(r.plan_end_at),
      actualStart: dateInputFor(r.actual_start_at),
      actualEnd: dateInputFor(r.actual_end_at),
      collaborators: collabsToPicked(r.collaborators),
    });
    setReqModalOpen(true);
  };
  const openNewTask = (requirementId: string) => {
    setTaskForm({ ...emptyTask, requirementId });
    setTaskModalOpen(true);
  };
  const openEditTask = (t: Task) => {
    setTaskForm({
      id: t.id,
      requirementId: t.requirement_id,
      title: t.title,
      description: t.description,
      priority: t.priority,
      status: t.status,
      assignee: t.assignee_id ? [{ id: t.assignee_id, name: t.assignee_name ?? '', email: '', avatar_url: null }] : [],
      dueDate: dateInputFor(t.due_date),
      planStart: dateInputFor(t.plan_start_at),
      planEnd: dateInputFor(t.plan_end_at),
      actualStart: dateInputFor(t.actual_start_at),
      actualEnd: dateInputFor(t.actual_end_at),
      collaborators: collabsToPicked(t.collaborators),
    });
    setTaskModalOpen(true);
  };

  const createReq = useMutation({
    mutationFn: () =>
      projectApi.createRequirement(id!, {
        title: reqForm.title,
        description: reqForm.description,
        priority: reqForm.priority,
        owner_id: reqForm.owner[0]?.id ?? null,
        plan_start_at: fromLocalInput(reqForm.planStart),
        plan_end_at: fromLocalInput(reqForm.planEnd),
        actual_start_at: fromLocalInput(reqForm.actualStart),
        actual_end_at: fromLocalInput(reqForm.actualEnd),
        collaborator_ids: reqForm.collaborators.map((u) => u.id),
      }),
    onSuccess: () => {
      toast('需求已创建');
      setReqModalOpen(false);
      invalidateAll();
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });

  const updateReq = useMutation({
    mutationFn: () =>
      projectApi.updateRequirement(reqForm.id!, {
        title: reqForm.title,
        description: reqForm.description,
        priority: reqForm.priority,
        status: reqForm.status,
        owner_id: reqForm.owner[0]?.id ?? null,
        plan_start_at: fromLocalInput(reqForm.planStart),
        plan_end_at: fromLocalInput(reqForm.planEnd),
        actual_start_at: fromLocalInput(reqForm.actualStart),
        actual_end_at: fromLocalInput(reqForm.actualEnd),
        collaborator_ids: reqForm.collaborators.map((u) => u.id),
      }),
    onSuccess: () => {
      toast('需求已更新');
      setReqModalOpen(false);
      invalidateAll();
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });

  const createTask = useMutation({
    mutationFn: () =>
      projectApi.createTask(taskForm.requirementId, {
        title: taskForm.title,
        description: taskForm.description,
        priority: taskForm.priority,
        assignee_id: taskForm.assignee[0]?.id,
        due_date: fromLocalInput(taskForm.dueDate) ?? undefined,
        plan_start_at: fromLocalInput(taskForm.planStart),
        plan_end_at: fromLocalInput(taskForm.planEnd),
        actual_start_at: fromLocalInput(taskForm.actualStart),
        actual_end_at: fromLocalInput(taskForm.actualEnd),
        collaborator_ids: taskForm.collaborators.map((u) => u.id),
      }),
    onSuccess: () => {
      toast('任务已创建');
      setTaskModalOpen(false);
      invalidateAll();
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });

  const updateTask = useMutation({
    mutationFn: () =>
      projectApi.updateTask(taskForm.id!, {
        title: taskForm.title,
        description: taskForm.description,
        priority: taskForm.priority,
        status: taskForm.status,
        assignee_id: taskForm.assignee[0]?.id ?? null,
        due_date: fromLocalInput(taskForm.dueDate),
        plan_start_at: fromLocalInput(taskForm.planStart),
        plan_end_at: fromLocalInput(taskForm.planEnd),
        actual_start_at: fromLocalInput(taskForm.actualStart),
        actual_end_at: fromLocalInput(taskForm.actualEnd),
        collaborator_ids: taskForm.collaborators.map((u) => u.id),
      }),
    onSuccess: () => {
      toast('任务已更新');
      setTaskModalOpen(false);
      invalidateAll();
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });

  const moveTask = useMutation({
    mutationFn: ({ t, status }: { t: Task; status: string }) => projectApi.updateTask(t.id, { status }),
    onSuccess: invalidateAll,
    onError: (e) => toast((e as Error).message, 'error'),
  });

  const delTask = useMutation({
    mutationFn: (tid: string) => projectApi.removeTask(tid),
    onSuccess: () => {
      toast('任务已删除');
      invalidateAll();
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });

  // ===== AI 生成需求（项目级别） =====
  const openAiGenReqs = () => {
    setAiDesc('');
    setAiReqs([]);
    setSelectedReqs(new Set());
    setOpenAi(true);
  };

  const runGenRequirements = async () => {
    if (!aiDesc.trim() || aiLoading) return;
    setAiLoading(true);
    setAiReqs([]);
    try {
      const res = await aiApi.genRequirements({
        project_name: project.data?.name ?? '',
        project_description: project.data?.description ?? '',
        request: aiDesc,
      });
      setAiReqs(res.requirements);
      setSelectedReqs(new Set(res.requirements.map((_, i) => i)));
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setAiLoading(false);
    }
  };

  const toggleReq = (i: number) => {
    setSelectedReqs((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const applyGenRequirements = async () => {
    const items = aiReqs.filter((_, i) => selectedReqs.has(i));
    if (!id || items.length === 0) return;
    try {
      for (const it of items) {
        await projectApi.createRequirement(id!, { title: it.title, description: it.description, priority: it.priority });
      }
      toast(`已生成 ${items.length} 条需求`);
      setOpenAi(false);
      setAiDesc('');
      setAiReqs([]);
      invalidateAll();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  // ===== AI 生成任务（需求级别） =====
  const openAiGenTasks = (r: Requirement) => {
    setTaskAiRequirementId(r.id);
    setTaskAiRequirementTitle(r.title);
    setTaskAiRequirementDesc(r.description);
    setTaskAiDesc('');
    setTaskAiTasks([]);
    setSelectedTasks(new Set());
    setTaskAiOpen(true);
  };

  const runGenTasks = async () => {
    if (!taskAiDesc.trim() || taskAiLoading) return;
    setTaskAiLoading(true);
    setTaskAiTasks([]);
    try {
      const res = await aiApi.genTasks({
        requirement_title: taskAiRequirementTitle,
        requirement_description: taskAiRequirementDesc,
        request: taskAiDesc,
      });
      setTaskAiTasks(res.tasks);
      setSelectedTasks(new Set(res.tasks.map((_, i) => i)));
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setTaskAiLoading(false);
    }
  };

  const toggleTask = (i: number) => {
    setSelectedTasks((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const applyGenTasks = async () => {
    const items = taskAiTasks.filter((_, i) => selectedTasks.has(i));
    if (!taskAiRequirementId || items.length === 0) return;
    try {
      for (const it of items) {
        await projectApi.createTask(taskAiRequirementId, { title: it.title, description: it.description, priority: it.priority });
      }
      toast(`已生成 ${items.length} 个任务`);
      setTaskAiOpen(false);
      invalidateAll();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const toggle = (rid: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(rid)) next.delete(rid);
      else next.add(rid);
      return next;
    });
  };

  if (project.isLoading) return <div className="flex h-full items-center justify-center"><Spinner size={24} /></div>;
  if (project.isError) return <Empty icon="/pulse-projects.svg" title="项目不存在或无权访问" />;
  const p = project.data!;

  return (
    <div className="mx-auto max-w-1200 px-8 py-8">
      {/* 头部 */}
      <button onClick={() => navigate('/projects')} className="mb-4 flex items-center gap-1 text-12px font-600 text-muted transition hover:text-violet">
        <ArrowLeft size={14} /> 返回项目列表
      </button>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-26px font-700 text-ink">{p.name}</h1>
            <Badge value={p.status} />
          </div>
          <p className="mt-1.5 text-13px text-muted">{p.description || '暂无描述'}</p>
          <div className="mt-2 flex items-center gap-4 text-12px text-muted">
            <span className="flex items-center gap-1"><ListTodo size={13} className="text-violet" /> {p.requirement_count} 需求</span>
            <span className="flex items-center gap-1"><ListTodo size={13} className="text-cyan" /> {p.task_count} 任务</span>
            <span className="flex items-center gap-1"><ListTodo size={13} className="text-green" /> {p.done_task_count} 已完成</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-11px text-muted">
            <span>👤 负责人 {p.owner_name || '我'}</span>
            {(p.collaborators ?? []).length > 0 && (
              <span className="flex items-center gap-1"><Users size={12} /> 协作 {p.collaborators.map((c) => c.name).join('、')}</span>
            )}
            {rangeSummary(p.plan_start_at, p.plan_end_at) && (
              <span className="text-violet/70">计划 {rangeSummary(p.plan_start_at, p.plan_end_at)}</span>
            )}
            {rangeSummary(p.actual_start_at, p.actual_end_at) && (
              <span className="text-green/80">实际 {rangeSummary(p.actual_start_at, p.actual_end_at)}</span>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-soft" onClick={openAiGenReqs}>
            <Wand2 size={14} /> AI 生成需求
          </button>
          <button className="btn btn-primary" onClick={openNewReq}>
            <Plus size={15} /> 添加需求
          </button>
        </div>
      </div>

      {/* 里程碑 */}
      <div className="mb-6 card p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Flag size={15} className="text-violet" />
            <h2 className="text-14px font-650 text-ink">里程碑</h2>
            {(milestones.data ?? []).length > 0 && (
              <span className="text-11px text-muted">
                {(milestones.data ?? []).filter((m) => m.completed_at).length}/{(milestones.data ?? []).length} 已完成
              </span>
            )}
          </div>
          <button className="btn btn-soft" onClick={() => setMilestoneOpen(true)}>
            <Plus size={13} /> 添加里程碑
          </button>
        </div>
        {milestones.isLoading ? (
          <div className="py-4 text-center"><Spinner size={16} /></div>
        ) : (milestones.data ?? []).length === 0 ? (
          <p className="text-12px text-muted">暂无里程碑，设置关键节点以跟踪项目进展</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {(milestones.data ?? []).map((m: Milestone) => {
              const done = !!m.completed_at;
              const overdue = !done && m.due_date && new Date(m.due_date).getTime() < Date.now();
              return (
                <div
                  key={m.id}
                  className={cn(
                    'group flex items-start gap-2.5 rounded-xl border p-3 transition',
                    done ? 'border-green/30 bg-green/5' : overdue ? 'border-coral/30 bg-coral/5' : 'border-line',
                  )}
                >
                  <button
                    onClick={() => toggleMilestone.mutate(m.id)}
                    className={cn('mt-0.5 shrink-0 transition', done ? 'text-green' : 'text-muted hover:text-green')}
                    title={done ? '取消完成' : '标记完成'}
                  >
                    {done ? <CheckCircle2 size={16} /> : <Circle size={16} />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className={cn('text-13px font-650', done ? 'text-muted line-through' : 'text-ink')}>{m.title}</p>
                    {m.description && <p className="mt-0.5 line-clamp-2 text-11px text-muted">{m.description}</p>}
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-10px">
                      {m.due_date && (
                        <span className={cn(overdue ? 'text-coral font-650' : 'text-muted')}>
                          截止 {new Date(m.due_date).toLocaleDateString()}{overdue && '（已逾期）'}
                        </span>
                      )}
                      {done && m.completed_at && (
                        <span className="text-green">完成于 {new Date(m.completed_at).toLocaleDateString()}</span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => removeMilestone.mutate(m.id)}
                    className="shrink-0 rounded p-1 text-muted opacity-0 transition hover:text-coral group-hover:opacity-100"
                    title="删除里程碑"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 视图切换 */}
      {(reqs.data ?? []).length > 0 && (
        <div className="mb-4 flex items-center gap-2">
          <button
            onClick={() => setViewMode('list')}
            className={cn(
              'flex items-center gap-1 rounded-lg px-3 py-1.5 text-12px font-650 transition',
              viewMode === 'list' ? 'bg-violet-light text-violet' : 'text-muted hover:bg-surface hover:text-ink',
            )}
          >
            <ListTree size={13} /> 需求列表
          </button>
          <button
            onClick={() => setViewMode('timeline')}
            className={cn(
              'flex items-center gap-1 rounded-lg px-3 py-1.5 text-12px font-650 transition',
              viewMode === 'timeline' ? 'bg-violet-light text-violet' : 'text-muted hover:bg-surface hover:text-ink',
            )}
          >
            <ChartGantt size={13} /> 时间线
          </button>
        </div>
      )}

      {/* 需求列表 / 时间线 */}
      {reqs.isLoading ? (
        <div className="py-12 text-center"><Spinner size={20} /></div>
      ) : (reqs.data ?? []).length === 0 ? (
        <Empty icon="/pulse-projects.svg" title="还没有需求" desc="添加需求，或用 AI 一键拆解为任务" />
      ) : viewMode === 'timeline' ? (
        <GanttView requirements={reqs.data ?? []} tasksByReq={tasksByReq.data ?? {}} />
      ) : (
        <div className="space-y-4">
          {(reqs.data ?? []).sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]).map((r) => {
            const isOpen = expanded.has(r.id);
            const tasks = tasksByReq.data?.[r.id] ?? [];
            const pct = tasks.length ? Math.round((tasks.filter((t) => t.status === 'done').length / tasks.length) * 100) : 0;
            return (
              <div key={r.id} className="card overflow-hidden">
                <div className="flex cursor-pointer items-center gap-3 px-5 py-4 transition hover:bg-surface" onClick={() => toggle(r.id)}>
                  <button className="text-muted hover:text-violet">{isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-14px font-650 text-ink">{r.title}</span>
                      <Badge value={r.priority} />
                    </div>
                    <p className="mt-0.5 truncate text-12px text-muted">{r.description || '无描述'}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-10px text-muted">
                      {r.owner_name && <span>👤 {r.owner_name}</span>}
                      {(r.collaborators ?? []).length > 0 && (
                        <span className="flex items-center gap-1"><Users size={10} /> {r.collaborators.map((c) => c.name).join('、')}</span>
                      )}
                      {rangeSummary(r.plan_start_at, r.plan_end_at) && <span className="text-violet/70">{rangeSummary(r.plan_start_at, r.plan_end_at)}</span>}
                    </div>
                  </div>
                  <Badge value={r.status} />
                  <span className="text-12px text-muted">
                    {tasks.filter((t) => t.status === 'done').length}/{tasks.length} 任务
                  </span>
                  <div className="h-1.5 w-24 overflow-hidden rounded-full bg-line">
                    <div className="h-full rounded-full bg-gradient-to-r from-violet to-violet-dark" style={{ width: `${pct}%` }} />
                  </div>
                  <button
                    className="rounded-lg p-1.5 text-muted transition hover:bg-violet-light hover:text-violet"
                    onClick={(e) => { e.stopPropagation(); openEditReq(r); }}
                    title="编辑需求"
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    className="rounded-lg p-1.5 text-muted transition hover:bg-violet-light hover:text-violet"
                    onClick={(e) => { e.stopPropagation(); openNewTask(r.id); }}
                    title="添加任务"
                  >
                    <Plus size={15} />
                  </button>
                </div>

                {isOpen && (
                  <div className="border-t border-line bg-surface/50 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-12px font-600 text-muted">任务看板</span>
                      <button className="btn btn-soft" onClick={() => openAiGenTasks(r)}>
                        <Sparkles size={13} /> AI 生成任务
                      </button>
                    </div>
                    <div className="grid grid-cols-4 gap-3">
                      {TASK_COLUMNS.map((col) => {
                        const colTasks = tasks.filter((t) => t.status === col.key);
                        const isDropTarget = dragOverCol === col.key;
                        return (
                          <div
                            key={col.key}
                            className={cn(
                              'rounded-xl bg-white p-3 transition',
                              isDropTarget && `ring-2 ${col.ring}`,
                            )}
                            onDragOver={(e) => {
                              e.preventDefault();
                              setDragOverCol(col.key);
                            }}
                            onDragEnter={() => setDragOverCol(col.key)}
                            onDragLeave={() => setDragOverCol(null)}
                            onDrop={(e) => {
                              e.preventDefault();
                              setDragOverCol(null);
                              if (draggingTask && draggingTask.status !== col.key) {
                                moveTask.mutate({ t: draggingTask, status: col.key });
                              }
                              setDraggingTask(null);
                            }}
                          >
                            <div className={cn('mb-2 flex items-center justify-between rounded-lg px-2 py-1.5', col.bg)}>
                              <span className={cn('text-12px font-650', col.color)}>{col.label}</span>
                              <span className={cn('text-11px font-650', col.color)}>{colTasks.length}</span>
                            </div>
                            <div className="space-y-2">
                              {colTasks.map((t) => (
                                <div
                                  key={t.id}
                                  draggable
                                  onDragStart={() => setDraggingTask(t)}
                                  onDragEnd={() => {
                                    setDraggingTask(null);
                                    setDragOverCol(null);
                                  }}
                                  className="group cursor-grab rounded-lg border border-line p-2.5 transition hover:border-violet-border hover:shadow-sm active:cursor-grabbing"
                                >
                                  <div className="flex items-start justify-between gap-1">
                                    <p className="text-12px font-600 leading-5 text-ink">{t.title}</p>
                                    <div className="flex shrink-0 items-center gap-0.5">
                                      <button
                                        onClick={() => openEditTask(t)}
                                        className="rounded p-0.5 text-muted opacity-0 transition hover:text-violet group-hover:opacity-100"
                                        title="编辑任务"
                                      >
                                        <Pencil size={12} />
                                      </button>
                                      <button
                                        onClick={() => delTask.mutate(t.id)}
                                        className="rounded p-0.5 text-muted opacity-0 transition hover:text-coral group-hover:opacity-100"
                                        title="删除"
                                      >
                                        <Trash2 size={12} />
                                      </button>
                                    </div>
                                  </div>
                                  {t.assignee_name && <p className="mt-1 text-10px text-muted">👤 {t.assignee_name}</p>}
                                  {(t.collaborators ?? []).length > 0 && (
                                    <p className="mt-0.5 text-10px text-muted"><Users size={10} className="mr-0.5 inline" /> {t.collaborators.map((c) => c.name).join('、')}</p>
                                  )}
                                  {(() => {
                                    const plan = rangeSummary(t.plan_start_at, t.plan_end_at);
                                    const actual = rangeSummary(t.actual_start_at, t.actual_end_at);
                                    return (plan || actual) ? (
                                      <p className="mt-0.5 text-10px text-violet/70">{plan}{actual ? ` 实际 ${actual}` : ''}</p>
                                    ) : null;
                                  })()}
                                </div>
                              ))}
                              {colTasks.length === 0 && (
                                <div className="rounded-lg border border-dashed border-line py-3 text-center text-11px text-muted">空</div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 新建 / 编辑需求 */}
      <Modal open={reqModalOpen} onClose={() => setReqModalOpen(false)} title={reqForm.id ? '编辑需求' : '新建需求'} width={560}>
        <div className="form-group">
          <label>需求标题</label>
          <input className="form-input" value={reqForm.title} onChange={(e) => setReqForm({ ...reqForm, title: e.target.value })} placeholder="需求标题" autoFocus />
        </div>
        <div className="form-group">
          <label>需求描述</label>
          <textarea className="form-input min-h-20 resize-none" value={reqForm.description} onChange={(e) => setReqForm({ ...reqForm, description: e.target.value })} placeholder="需求背景、验收标准…" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="form-group">
            <label>优先级</label>
            <select className="form-input" value={reqForm.priority} onChange={(e) => setReqForm({ ...reqForm, priority: e.target.value })}>
              <option value="low">低</option>
              <option value="medium">中</option>
              <option value="high">高</option>
              <option value="urgent">紧急</option>
            </select>
          </div>
          {reqForm.id && (
            <div className="form-group">
              <label>状态</label>
              <select className="form-input" value={reqForm.status} onChange={(e) => setReqForm({ ...reqForm, status: e.target.value })}>
                <option value="open">待处理</option>
                <option value="in_progress">进行中</option>
                <option value="done">已完成</option>
                <option value="cancelled">已取消</option>
              </select>
            </div>
          )}
        </div>
        <div className="form-group">
          <label>负责人</label>
          <UserPicker value={reqForm.owner} onChange={(owner) => setReqForm({ ...reqForm, owner })} multiple={false} placeholder="搜索并选择负责人" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          {TIME_LABELS.map(({ key, label }) => (
            <div key={key} className="form-group">
              <label>{label}</label>
              <input type="datetime-local" className="form-input" value={reqForm[key]} onChange={(e) => setReqForm({ ...reqForm, [key]: e.target.value })} />
            </div>
          ))}
        </div>
        <div className="form-group">
          <label>协作人</label>
          <UserPicker value={reqForm.collaborators} onChange={(collaborators) => setReqForm({ ...reqForm, collaborators })} placeholder="搜索系统用户并选择协作人" max={20} />
        </div>
        {reqForm.id && <CommentThread targetType="requirement" targetId={reqForm.id} />}
        <div className="flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={() => setReqModalOpen(false)}>取消</button>
          <button className="btn btn-primary" disabled={!reqForm.title.trim() || createReq.isPending || updateReq.isPending} onClick={() => (reqForm.id ? updateReq.mutate() : createReq.mutate())}>
            {(createReq.isPending || updateReq.isPending) ? <Spinner size={14} /> : null} {reqForm.id ? '保存' : '创建'}
          </button>
        </div>
      </Modal>

      {/* 新建 / 编辑任务 */}
      <Modal open={taskModalOpen} onClose={() => setTaskModalOpen(false)} title={taskForm.id ? '编辑任务' : '添加任务'} width={560}>
        <div className="form-group">
          <label>任务标题</label>
          <input className="form-input" value={taskForm.title} onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })} placeholder="任务标题" autoFocus />
        </div>
        <div className="form-group">
          <label>任务描述</label>
          <textarea className="form-input min-h-16 resize-none" value={taskForm.description} onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })} placeholder="任务说明…" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="form-group">
            <label>优先级</label>
            <select className="form-input" value={taskForm.priority} onChange={(e) => setTaskForm({ ...taskForm, priority: e.target.value })}>
              <option value="low">低</option>
              <option value="medium">中</option>
              <option value="high">高</option>
              <option value="urgent">紧急</option>
            </select>
          </div>
          <div className="form-group">
            <label>截止时间</label>
            <input type="datetime-local" className="form-input" value={taskForm.dueDate} onChange={(e) => setTaskForm({ ...taskForm, dueDate: e.target.value })} />
          </div>
        </div>
        {taskForm.id && (
          <div className="form-group">
            <label>状态</label>
            <select className="form-input" value={taskForm.status} onChange={(e) => setTaskForm({ ...taskForm, status: e.target.value })}>
              <option value="todo">待办</option>
              <option value="doing">进行中</option>
              <option value="review">待评审</option>
              <option value="done">已完成</option>
            </select>
          </div>
        )}
        <div className="form-group">
          <label>负责人</label>
          <UserPicker value={taskForm.assignee} onChange={(assignee) => setTaskForm({ ...taskForm, assignee })} multiple={false} placeholder="搜索并选择负责人" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          {TIME_LABELS.map(({ key, label }) => (
            <div key={key} className="form-group">
              <label>{label}</label>
              <input type="datetime-local" className="form-input" value={taskForm[key]} onChange={(e) => setTaskForm({ ...taskForm, [key]: e.target.value })} />
            </div>
          ))}
        </div>
        <div className="form-group">
          <label>协作人</label>
          <UserPicker value={taskForm.collaborators} onChange={(collaborators) => setTaskForm({ ...taskForm, collaborators })} placeholder="搜索系统用户并选择协作人" max={20} />
        </div>
        {taskForm.id && <CommentThread targetType="task" targetId={taskForm.id} />}
        <div className="flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={() => setTaskModalOpen(false)}>取消</button>
          <button className="btn btn-primary" disabled={!taskForm.title.trim() || createTask.isPending || updateTask.isPending} onClick={() => (taskForm.id ? updateTask.mutate() : createTask.mutate())}>
            {(createTask.isPending || updateTask.isPending) ? <Spinner size={14} /> : null} {taskForm.id ? '保存' : '创建'}
          </button>
        </div>
      </Modal>

      {/* 新建里程碑 */}
      <Modal open={milestoneOpen} onClose={() => setMilestoneOpen(false)} title="添加里程碑" width={480}>
        <div className="form-group">
          <label>里程碑标题</label>
          <input
            className="form-input"
            value={milestoneTitle}
            onChange={(e) => setMilestoneTitle(e.target.value)}
            placeholder="例如：MVP 版本上线"
            autoFocus
          />
        </div>
        <div className="form-group">
          <label>描述</label>
          <textarea
            className="form-input min-h-16 resize-none"
            value={milestoneDesc}
            onChange={(e) => setMilestoneDesc(e.target.value)}
            placeholder="里程碑范围、交付物…"
          />
        </div>
        <div className="form-group">
          <label>截止日期</label>
          <input
            type="datetime-local"
            className="form-input"
            value={milestoneDue}
            onChange={(e) => setMilestoneDue(e.target.value)}
          />
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={() => setMilestoneOpen(false)}>取消</button>
          <button
            className="btn btn-primary"
            disabled={!milestoneTitle.trim() || createMilestone.isPending}
            onClick={() => createMilestone.mutate()}
          >
            {createMilestone.isPending ? <Spinner size={14} /> : null} 创建
          </button>
        </div>
      </Modal>

      {/* AI 生成需求（项目级别） */}
      <Modal open={openAi} onClose={() => setOpenAi(false)} title="AI 生成需求" width={560}>
        <p className="mb-3 text-12px text-muted">
          基于项目「{project.data?.name ?? ''}」生成需求，可补充你的具体要求。
        </p>
        <div className="form-group">
          <label>你的要求</label>
          <textarea
            className="form-input min-h-24 resize-none"
            value={aiDesc}
            onChange={(e) => setAiDesc(e.target.value)}
            placeholder="例如：围绕项目里程碑补充上线的关键需求…"
          />
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn btn-soft" onClick={runGenRequirements} disabled={!aiDesc.trim() || aiLoading}>
            {aiLoading ? <Spinner size={14} /> : <Sparkles size={14} />} 生成需求
          </button>
        </div>
        {aiReqs.length > 0 && (
          <>
            <div className="mt-4 max-h-64 space-y-2 overflow-y-auto">
              {aiReqs.map((r, i) => (
                <label
                  key={i}
                  className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 transition ${selectedReqs.has(i) ? 'border-violet-border bg-violet-light/40' : 'border-line'}`}
                >
                  <input type="checkbox" className="mt-0.5 accent-violet" checked={selectedReqs.has(i)} onChange={() => toggleReq(i)} />
                  <div className="min-w-0 flex-1">
                    <p className="text-13px font-600 text-ink">{r.title}</p>
                    {r.description && <p className="mt-0.5 text-11px text-muted">{r.description}</p>}
                  </div>
                  <Badge value={r.priority} />
                </label>
              ))}
            </div>
            <div className="mt-4 flex justify-end">
              <button
                className="btn btn-primary"
                onClick={applyGenRequirements}
                disabled={aiReqs.filter((_, i) => selectedReqs.has(i)).length === 0}
              >
                <Check size={14} /> 创建 {aiReqs.filter((_, i) => selectedReqs.has(i)).length} 条需求
              </button>
            </div>
          </>
        )}
      </Modal>

      {/* AI 生成任务（需求级别） */}
      <Modal open={taskAiOpen} onClose={() => setTaskAiOpen(false)} title="AI 生成任务" width={560}>
        <p className="mb-3 text-12px text-muted">
          基于需求「{taskAiRequirementTitle}」生成任务，可补充你的具体要求。
        </p>
        <div className="form-group">
          <label>你的要求</label>
          <textarea
            className="form-input min-h-24 resize-none"
            value={taskAiDesc}
            onChange={(e) => setTaskAiDesc(e.target.value)}
            placeholder="例如：把实现过程拆解为可并行的小任务…"
          />
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn btn-soft" onClick={runGenTasks} disabled={!taskAiDesc.trim() || taskAiLoading}>
            {taskAiLoading ? <Spinner size={14} /> : <Sparkles size={14} />} 生成任务
          </button>
        </div>
        {taskAiTasks.length > 0 && (
          <>
            <div className="mt-4 max-h-64 space-y-2 overflow-y-auto">
              {taskAiTasks.map((t, i) => (
                <label
                  key={i}
                  className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 transition ${selectedTasks.has(i) ? 'border-violet-border bg-violet-light/40' : 'border-line'}`}
                >
                  <input type="checkbox" className="mt-0.5 accent-violet" checked={selectedTasks.has(i)} onChange={() => toggleTask(i)} />
                  <div className="min-w-0 flex-1">
                    <p className="text-13px font-600 text-ink">{t.title}</p>
                    {t.description && <p className="mt-0.5 text-11px text-muted">{t.description}</p>}
                  </div>
                  <Badge value={t.priority} />
                </label>
              ))}
            </div>
            <div className="mt-4 flex justify-end">
              <button
                className="btn btn-primary"
                onClick={applyGenTasks}
                disabled={taskAiTasks.filter((_, i) => selectedTasks.has(i)).length === 0}
              >
                <Check size={14} /> 创建 {taskAiTasks.filter((_, i) => selectedTasks.has(i)).length} 个任务
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}