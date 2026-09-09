import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { projectApi, aiApi } from '../lib/api';
import { Badge, Spinner, Modal, useToast, cn, priorityOrder, Empty } from '../components/ui';
import { UserPicker, type PickedUser } from '../components/UserPicker';
import { CommentThread } from '../components/CommentThread';
import { fromLocalInput, toLocalInput, rangeSummary } from '../lib/datetime';
import { ArrowLeft, Plus, Sparkles, Trash2, ChevronDown, ChevronRight, ListTodo, Wand2, Check, Pencil, Users, ListTree, ChartGantt, Flag, CheckCircle2, Circle } from 'lucide-react';
import { useState, Fragment } from 'react';
import type { ReactNode } from 'react';
import type { Requirement, Task, Collaborator, Milestone } from '@pulse-space/contracts';

const TASK_COLUMNS = [
  { key: 'todo', label: '待办', color: 'text-violet', bg: 'bg-violet-light', ring: 'ring-violet/50' },
  { key: 'doing', label: '进行中', color: 'text-cyan', bg: 'bg-cyan/10', ring: 'ring-cyan/50' },
  { key: 'review', label: '待评审', color: 'text-amber', bg: 'bg-amber/10', ring: 'ring-amber/50' },
  { key: 'done', label: '已完成', color: 'text-green', bg: 'bg-green/10', ring: 'ring-green/50' },
];

type TabKey = 'milestone' | 'requirement' | 'task';

// ===== 飞书多维表格风格：紧凑表格基础样式 =====
const TH = 'px-2 py-1.5 text-left text-10px font-650 text-muted whitespace-nowrap';
const CELL = 'px-2 py-1.5 align-middle';
const ROW = 'border-b border-line transition-colors hover:bg-surface/60';
const TABLE = 'w-full border-collapse text-12px';

// 紧凑输入框
const compactInput =
  'h-7 rounded-md border border-line bg-white px-2 text-12px text-ink placeholder:text-muted focus:border-violet focus:outline-none';
const compactSelect =
  'h-7 rounded-md border border-line bg-white px-2 text-12px text-ink focus:border-violet focus:outline-none';
// 紧凑操作小按钮
const opBtn = 'rounded p-1 text-muted transition hover:bg-violet-light hover:text-violet';
const opBtnDanger = 'rounded p-1 text-muted transition hover:bg-coral-light hover:text-coral';

// 时间范围重叠过滤：item 的 [start,end] 与 [from,to] 是否有交集；无任何时间设值的项在启用范围时被排除
function inTimeRange(
  startIso: string | null | undefined,
  endIso: string | null | undefined,
  from: string,
  to: string,
): boolean {
  const start = startIso ? new Date(startIso).getTime() : null;
  const end = endIso ? new Date(endIso).getTime() : null;
  const f = from ? new Date(from).getTime() : null;
  const t = to ? new Date(to).getTime() : null;
  if (f === null && t === null) return true;
  if (start === null && end === null) return false;
  const lo = start ?? end ?? Number.NEGATIVE_INFINITY;
  const hi = end ?? start ?? Number.POSITIVE_INFINITY;
  if (f !== null && hi < f) return false;
  if (t !== null && lo > t) return false;
  return true;
}

function nameMatch(text: string | null | undefined, kw: string): boolean {
  const k = kw.trim().toLowerCase();
  if (!k) return true;
  return (text ?? '').toLowerCase().includes(k);
}

type ReqForm = {
  id: string | null;
  title: string;
  description: string;
  priority: string;
  status: string;
  owner: PickedUser[];
  milestoneId: string;
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
  milestoneId: string;
  dueDate: string;
  planStart: string;
  planEnd: string;
  actualStart: string;
  actualEnd: string;
  collaborators: PickedUser[];
};

const emptyReq: ReqForm = {
  id: null, title: '', description: '', priority: 'medium', status: 'open',
  owner: [], milestoneId: '', planStart: '', planEnd: '', actualStart: '', actualEnd: '', collaborators: [],
};
const emptyTask: TaskForm = {
  id: null, requirementId: '', title: '', description: '', priority: 'medium', status: 'todo',
  assignee: [], milestoneId: '', dueDate: '', planStart: '', planEnd: '', actualStart: '', actualEnd: '', collaborators: [],
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

// ===== 通用筛选条 =====
type SortOption = { value: string; label: string };
function FilterBar({
  nameLabel,
  name,
  timeLabel,
  from,
  to,
  sort,
  sortOptions,
  onName,
  onFrom,
  onTo,
  onSort,
}: {
  nameLabel: string;
  name: string;
  timeLabel: string;
  from: string;
  to: string;
  sort?: string;
  sortOptions?: SortOption[];
  onName: (v: string) => void;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  onSort?: (v: string) => void;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-white px-2 py-1.5">
      <input
        className={`${compactInput} w-48`}
        value={name}
        onChange={(e) => onName(e.target.value)}
        placeholder={`按${nameLabel}筛选`}
      />
      <div className="flex items-center gap-1">
        <span className="text-10px text-muted">{timeLabel}起</span>
        <input type="datetime-local" className={`${compactInput} w-38`} value={from} onChange={(e) => onFrom(e.target.value)} />
      </div>
      <div className="flex items-center gap-1">
        <span className="text-10px text-muted">止</span>
        <input type="datetime-local" className={`${compactInput} w-38`} value={to} onChange={(e) => onTo(e.target.value)} />
      </div>
      {sortOptions && sort !== undefined && onSort && (
        <select
          className={`${compactSelect} w-32`}
          value={sort}
          onChange={(e) => onSort(e.target.value)}
        >
          {sortOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      )}
    </div>
  );
}

export function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();

  const [tab, setTab] = useState<TabKey>('requirement');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [reqModalOpen, setReqModalOpen] = useState(false);
  const [reqForm, setReqForm] = useState<ReqForm>(emptyReq);
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [taskForm, setTaskForm] = useState<TaskForm>(emptyTask);
  // 看板拖拽
  const [draggingTask, setDraggingTask] = useState<Task | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  // 需求 Tab 内：列表 / 时间线子视图
  const [viewMode, setViewMode] = useState<'list' | 'timeline'>('list');
  // 里程碑：新建 + 编辑
  const [milestoneOpen, setMilestoneOpen] = useState(false);
  const [milestoneTitle, setMilestoneTitle] = useState('');
  const [milestoneDesc, setMilestoneDesc] = useState('');
  const [milestoneDue, setMilestoneDue] = useState('');
  const [milestoneEdit, setMilestoneEdit] = useState<
    { open: boolean; id: string | null; title: string; desc: string; due: string }
  >({ open: false, id: null, title: '', desc: '', due: '' });

  // 筛选状态（三个 Tab 各自独立）
  const [msFilter, setMsFilter] = useState({ name: '', from: '', to: '' });
  const [reqFilter, setReqFilter] = useState({ name: '', from: '', to: '', sort: 'priority' });
  const [taskFilter, setTaskFilter] = useState({ name: '', from: '', to: '', sort: 'updated' });

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
  // 任务 Tab：项目级任务列表（含 requirement_title / milestone_name）
  const projectTasks = useQuery({ queryKey: ['project-tasks', id], queryFn: () => projectApi.projectTasks(id!), enabled: !!id });
  // 需求 Tab 内嵌看板 / 时间线使用
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
    qc.invalidateQueries({ queryKey: ['project-tasks'] });
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

  const updateMilestone = useMutation({
    mutationFn: () =>
      milestoneEdit.id
        ? projectApi.updateMilestone(milestoneEdit.id, {
            title: milestoneEdit.title,
            description: milestoneEdit.desc || undefined,
            due_date: milestoneEdit.due ? new Date(milestoneEdit.due).toISOString() : null,
          })
        : Promise.reject(new Error('缺少里程碑 ID')),
    onSuccess: () => {
      toast('里程碑已更新');
      setMilestoneEdit({ open: false, id: null, title: '', desc: '', due: '' });
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
      milestoneId: r.milestone_id ?? '',
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
      milestoneId: t.milestone_id ?? '',
      dueDate: dateInputFor(t.due_date),
      planStart: dateInputFor(t.plan_start_at),
      planEnd: dateInputFor(t.plan_end_at),
      actualStart: dateInputFor(t.actual_start_at),
      actualEnd: dateInputFor(t.actual_end_at),
      collaborators: collabsToPicked(t.collaborators),
    });
    setTaskModalOpen(true);
  };
  const openEditMilestone = (m: Milestone) => {
    setMilestoneEdit({
      open: true,
      id: m.id,
      title: m.title,
      desc: m.description,
      due: dateInputFor(m.due_date),
    });
  };

  const createReq = useMutation({
    mutationFn: () =>
      projectApi.createRequirement(id!, {
        title: reqForm.title,
        description: reqForm.description,
        priority: reqForm.priority,
        owner_id: reqForm.owner[0]?.id ?? null,
        milestone_id: reqForm.milestoneId || null,
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
        milestone_id: reqForm.milestoneId || null,
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
        milestone_id: taskForm.milestoneId || null,
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
        milestone_id: taskForm.milestoneId || null,
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

  const delReq = useMutation({
    mutationFn: (rid: string) => projectApi.removeRequirement(rid),
    onSuccess: () => {
      toast('需求已删除');
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

  // ===== 三个 Tab 的筛选 + 排序结果 =====
  const filteredMilestones = (milestones.data ?? [])
    .filter(
      (m) =>
        nameMatch(m.title, msFilter.name) &&
        inTimeRange(m.due_date, m.due_date, msFilter.from, msFilter.to),
    )
    .sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? '') || a.created_at.localeCompare(b.created_at));

  const filteredReqs = (reqs.data ?? [])
    .filter(
      (r) =>
        nameMatch(r.title, reqFilter.name) &&
        inTimeRange(r.plan_start_at, r.plan_end_at, reqFilter.from, reqFilter.to),
    )
    .sort((a, b) => {
      if (reqFilter.sort === 'plan') return (a.plan_start_at ?? '').localeCompare(b.plan_start_at ?? '');
      if (reqFilter.sort === 'updated') return b.updated_at.localeCompare(a.updated_at);
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });

  const filteredTasks = (projectTasks.data ?? [])
    .filter(
      (t) =>
        nameMatch(t.title, taskFilter.name) &&
        inTimeRange(t.due_date, t.due_date, taskFilter.from, taskFilter.to),
    )
    .sort((a, b) => {
      if (taskFilter.sort === 'due') return (a.due_date ?? '').localeCompare(b.due_date ?? '');
      return b.updated_at.localeCompare(a.updated_at);
    });

  if (project.isLoading) return <div className="flex h-full items-center justify-center"><Spinner size={24} /></div>;
  if (project.isError) return <Empty icon="/pulse-projects.svg" title="项目不存在或无权访问" />;
  const p = project.data!;

  const TAB_ITEMS: { key: TabKey; label: string; icon: ReactNode }[] = [
    { key: 'milestone', label: '里程碑', icon: <Flag size={13} /> },
    { key: 'requirement', label: '需求', icon: <ListTree size={13} /> },
    { key: 'task', label: '任务', icon: <ListTodo size={13} /> },
  ];

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

      {/* 三 Tab 切换 */}
      <div className="mb-5 flex items-center gap-1 border-b border-line">
        {TAB_ITEMS.map((it) => (
          <button
            key={it.key}
            onClick={() => setTab(it.key)}
            className={cn(
              'flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-13px font-650 transition',
              tab === it.key
                ? 'border-violet text-violet'
                : 'border-transparent text-muted hover:text-ink',
            )}
          >
            {it.icon} {it.label}
            {it.key === 'milestone' && <span className="text-11px text-muted">{(milestones.data ?? []).length}</span>}
            {it.key === 'requirement' && <span className="text-11px text-muted">{(reqs.data ?? []).length}</span>}
            {it.key === 'task' && <span className="text-11px text-muted">{(projectTasks.data ?? []).length}</span>}
          </button>
        ))}
      </div>

      {/* ===== 里程碑 Tab ===== */}
      {tab === 'milestone' && (
        <div className="mb-6">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-11px text-muted">
                {(milestones.data ?? []).filter((m) => m.completed_at).length}/{(milestones.data ?? []).length} 已完成
              </span>
            </div>
            <button className="btn btn-soft" onClick={() => setMilestoneOpen(true)}>
              <Plus size={13} /> 添加里程碑
            </button>
          </div>

          {(milestones.data ?? []).length > 0 && (
            <FilterBar
              nameLabel="名称"
              name={msFilter.name}
              timeLabel="截止"
              from={msFilter.from}
              to={msFilter.to}
              onName={(v) => setMsFilter((s) => ({ ...s, name: v }))}
              onFrom={(v) => setMsFilter((s) => ({ ...s, from: v }))}
              onTo={(v) => setMsFilter((s) => ({ ...s, to: v }))}
            />
          )}

          {milestones.isLoading ? (
            <div className="py-4 text-center"><Spinner size={16} /></div>
          ) : filteredMilestones.length === 0 ? (
            <Empty icon="/pulse-projects.svg" title={(milestones.data ?? []).length === 0 ? '暂无里程碑' : '没有匹配的里程碑'} desc={(milestones.data ?? []).length === 0 ? '设置关键节点以跟踪项目进展' : '试试调整筛选条件'} />
          ) : (
            <div className="overflow-hidden rounded-lg border border-line bg-white">
              <table className={TABLE}>
                <thead>
                  <tr className="border-b border-line bg-surface/50">
                    <th className={TH}>完成</th>
                    <th className={TH}>标题</th>
                    <th className={TH}>状态</th>
                    <th className={TH}>截止日期</th>
                    <th className={TH}>完成日期</th>
                    <th className={TH}>需求 · 任务</th>
                    <th className={`${TH} text-right`}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMilestones.map((m) => {
                    const done = !!m.completed_at;
                    const overdue = !done && m.due_date && new Date(m.due_date).getTime() < Date.now();
                    const status = done ? '已完成' : overdue ? '已逾期' : '进行中';
                    const statusCls = done ? 'text-green' : overdue ? 'text-coral font-650' : 'text-ink';
                    return (
                      <tr key={m.id} className={ROW}>
                        <td className={CELL}>
                          <button
                            onClick={() => toggleMilestone.mutate(m.id)}
                            className={cn('transition', done ? 'text-green' : 'text-muted hover:text-green')}
                            title={done ? '取消完成' : '标记完成'}
                          >
                            {done ? <CheckCircle2 size={15} /> : <Circle size={15} />}
                          </button>
                        </td>
                        <td className={`${CELL} max-w-76 min-w-0`}>
                          <p className={cn('truncate font-650', done ? 'text-muted line-through' : 'text-ink')} title={m.title}>{m.title}</p>
                          {m.description && <p className="truncate text-11px text-muted" title={m.description}>{m.description}</p>}
                        </td>
                        <td className={`${CELL} whitespace-nowrap`}>
                          <span className={cn('flex items-center gap-1', statusCls)}>
                            <span className={cn('h-1.5 w-1.5 rounded-full', done ? 'bg-green' : overdue ? 'bg-coral' : 'bg-violet')} />
                            {status}
                          </span>
                        </td>
                        <td className={`${CELL} whitespace-nowrap`}>
                          {m.due_date ? (
                            <span className={overdue ? 'font-650 text-coral' : 'text-muted'}>{new Date(m.due_date).toLocaleDateString()}</span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td className={`${CELL} whitespace-nowrap`}>
                          {done && m.completed_at ? (
                            <span className="text-green">{new Date(m.completed_at).toLocaleDateString()}</span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td className={`${CELL} whitespace-nowrap text-violet/80`}>{m.requirement_count} · {m.task_count}</td>
                        <td className={`${CELL} whitespace-nowrap text-right`}>
                          <div className="inline-flex items-center gap-0.5">
                            <button onClick={() => openEditMilestone(m)} className={opBtn} title="编辑里程碑">
                              <Pencil size={13} />
                            </button>
                            <button onClick={() => removeMilestone.mutate(m.id)} className={opBtnDanger} title="删除里程碑">
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ===== 需求 Tab ===== */}
      {tab === 'requirement' && (
        <>
          {(reqs.data ?? []).length > 0 && (
            <FilterBar
              nameLabel="名称"
              name={reqFilter.name}
              timeLabel="计划"
              from={reqFilter.from}
              to={reqFilter.to}
              sort={reqFilter.sort}
              sortOptions={[
                { value: 'priority', label: '按优先级' },
                { value: 'plan', label: '按计划开始' },
                { value: 'updated', label: '按最近更新' },
              ]}
              onName={(v) => setReqFilter((s) => ({ ...s, name: v }))}
              onFrom={(v) => setReqFilter((s) => ({ ...s, from: v }))}
              onTo={(v) => setReqFilter((s) => ({ ...s, to: v }))}
              onSort={(v) => setReqFilter((s) => ({ ...s, sort: v }))}
            />
          )}

          {(reqs.data ?? []).length > 0 && (
            <div className="mb-4 flex items-center gap-2">
              <button
                onClick={() => setViewMode('list')}
                className={cn(
                  'flex items-center gap-1 rounded-lg px-3 py-1.5 text-12px font-650 transition',
                  viewMode === 'list' ? 'bg-violet-light text-violet' : 'text-muted hover:bg-surface hover:text-ink',
                )}
              >
                <ListTree size={13} /> 列表
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

          {reqs.isLoading ? (
            <div className="py-12 text-center"><Spinner size={20} /></div>
          ) : (reqs.data ?? []).length === 0 ? (
            <Empty icon="/pulse-projects.svg" title="还没有需求" desc="添加需求，或用 AI 一键拆解为任务" />
          ) : filteredReqs.length === 0 ? (
            <Empty icon="/pulse-projects.svg" title="没有匹配的需求" desc="试试调整筛选条件" />
          ) : viewMode === 'timeline' ? (
            <GanttView requirements={reqs.data ?? []} tasksByReq={tasksByReq.data ?? {}} />
          ) : (
            <div className="overflow-hidden rounded-lg border border-line bg-white">
              <table className={TABLE}>
                <thead>
                  <tr className="border-b border-line bg-surface/50">
                    <th className={TH}>标题</th>
                    <th className={TH}>负责</th>
                    <th className={TH}>优先级</th>
                    <th className={TH}>状态</th>
                    <th className={TH}>计划时间</th>
                    <th className={TH}>任务进度</th>
                    <th className={`${TH} text-right`}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredReqs.map((r) => {
                    const isOpen = expanded.has(r.id);
                    const tasks = tasksByReq.data?.[r.id] ?? [];
                    const total = r.task_count ?? tasks.length;
                    const doneCount = r.done_task_count ?? tasks.filter((t) => t.status === 'done').length;
                    const pct = total ? Math.round((doneCount / total) * 100) : 0;
                    return (
                      <Fragment key={r.id}>
                        <tr className={`${ROW} cursor-pointer`} onClick={() => toggle(r.id)}>
                          <td className={`${CELL} min-w-0 max-w-72`}>
                            <div className="flex items-center gap-1">
                              <span className="shrink-0 text-muted">{isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span>
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="truncate font-650 text-ink">{r.title}</span>
                                  {r.milestone_name && (
                                    <span className="inline-flex shrink-0 items-center gap-1 rounded bg-violet-light px-1.5 py-0.5 text-10px font-600 text-violet">
                                      <Flag size={9} /> {r.milestone_name}
                                    </span>
                                  )}
                                </div>
                                {r.description && <p className="truncate text-11px text-muted">{r.description}</p>}
                              </div>
                            </div>
                          </td>
                          <td className={`${CELL} whitespace-nowrap text-muted`}>{r.owner_name || '—'}</td>
                          <td className={`${CELL} whitespace-nowrap`}><Badge value={r.priority} /></td>
                          <td className={`${CELL} whitespace-nowrap`}><Badge value={r.status} /></td>
                          <td className={`${CELL} whitespace-nowrap`}>
                            {rangeSummary(r.plan_start_at, r.plan_end_at) ? (
                              <span className="text-violet/70">{rangeSummary(r.plan_start_at, r.plan_end_at)}</span>
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                          </td>
                          <td className={`${CELL} whitespace-nowrap`}>
                            <div className="flex items-center gap-1.5">
                              <div className="h-1.5 w-16 overflow-hidden rounded-full bg-line">
                                <div className="h-full rounded-full bg-gradient-to-r from-violet to-violet-dark" style={{ width: `${pct}%` }} />
                              </div>
                              <span className="text-11px text-muted">{doneCount}/{total}</span>
                            </div>
                          </td>
                          <td className={`${CELL} whitespace-nowrap text-right`}>
                            <div className="inline-flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                              <button onClick={() => openEditReq(r)} className={opBtn} title="编辑需求"><Pencil size={13} /></button>
                              <button onClick={() => delReq.mutate(r.id)} className={opBtnDanger} title="删除需求"><Trash2 size={13} /></button>
                              <button onClick={() => openNewTask(r.id)} className={opBtn} title="添加任务"><Plus size={13} /></button>
                            </div>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className="bg-surface/40">
                            <td className={`${CELL} px-3 py-3`} colSpan={7}>
                              <div>
                                <div className="mb-2 flex items-center justify-between">
                                  <span className="text-11px font-600 text-muted">任务看板</span>
                                  <button className="btn btn-soft" onClick={() => openAiGenTasks(r)}>
                                    <Sparkles size={12} /> AI 生成任务
                                  </button>
                                </div>
                                <div className="grid grid-cols-4 gap-2">
                                  {TASK_COLUMNS.map((col) => {
                                    const colTasks = tasks.filter((t) => t.status === col.key);
                                    const isDropTarget = dragOverCol === col.key;
                                    return (
                                      <div
                                        key={col.key}
                                        className={cn(
                                          'rounded-xl bg-white p-2 transition',
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
                                        <div className={cn('mb-2 flex items-center justify-between rounded-lg px-2 py-1', col.bg)}>
                                          <span className={cn('text-11px font-650', col.color)}>{col.label}</span>
                                          <span className={cn('text-10px font-650', col.color)}>{colTasks.length}</span>
                                        </div>
                                        <div className="space-y-1.5">
                                          {colTasks.map((t) => (
                                            <div
                                              key={t.id}
                                              draggable
                                              onDragStart={() => setDraggingTask(t)}
                                              onDragEnd={() => {
                                                setDraggingTask(null);
                                                setDragOverCol(null);
                                              }}
                                              className="group cursor-grab rounded-lg border border-line p-2 transition hover:border-violet-border hover:shadow-sm active:cursor-grabbing"
                                            >
                                              <div className="flex items-start justify-between gap-1">
                                                <p className="text-11px font-600 leading-5 text-ink">{t.title}</p>
                                                <div className="flex shrink-0 items-center gap-0.5">
                                                  <button
                                                    onClick={() => openEditTask(t)}
                                                    className="rounded p-0.5 text-muted opacity-0 transition hover:text-violet group-hover:opacity-100"
                                                    title="编辑任务"
                                                  >
                                                    <Pencil size={11} />
                                                  </button>
                                                  <button
                                                    onClick={() => delTask.mutate(t.id)}
                                                    className="rounded p-0.5 text-muted opacity-0 transition hover:text-coral group-hover:opacity-100"
                                                    title="删除"
                                                  >
                                                    <Trash2 size={11} />
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
                                            <div className="rounded-lg border border-dashed border-line py-2 text-center text-10px text-muted">空</div>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ===== 任务 Tab ===== */}
      {tab === 'task' && (
        <div className="mb-6">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-11px text-muted">{filteredTasks.length}/{projectTasks.data?.length ?? 0} 项</span>
            </div>
            <button className="btn btn-primary" onClick={() => openNewTask('')}>
              <Plus size={14} /> 添加任务
            </button>
          </div>

          {(projectTasks.data ?? []).length > 0 && (
            <FilterBar
              nameLabel="名称"
              name={taskFilter.name}
              timeLabel="截止"
              from={taskFilter.from}
              to={taskFilter.to}
              sort={taskFilter.sort}
              sortOptions={[
                { value: 'updated', label: '按最近更新' },
                { value: 'due', label: '按截止时间' },
              ]}
              onName={(v) => setTaskFilter((s) => ({ ...s, name: v }))}
              onFrom={(v) => setTaskFilter((s) => ({ ...s, from: v }))}
              onTo={(v) => setTaskFilter((s) => ({ ...s, to: v }))}
              onSort={(v) => setTaskFilter((s) => ({ ...s, sort: v }))}
            />
          )}

          {projectTasks.isLoading ? (
            <div className="py-12 text-center"><Spinner size={20} /></div>
          ) : (projectTasks.data ?? []).length === 0 ? (
            <Empty icon="/pulse-projects.svg" title="还没有任务" desc="添加任务，或用 AI 一键拆解" />
          ) : filteredTasks.length === 0 ? (
            <Empty icon="/pulse-projects.svg" title="没有匹配的任务" desc="试试调整筛选条件" />
          ) : (
            <div className="overflow-hidden rounded-lg border border-line bg-white">
              <table className={TABLE}>
                <thead>
                  <tr className="border-b border-line bg-surface/50">
                    <th className={TH}>标题</th>
                    <th className={TH}>负责人</th>
                    <th className={TH}>优先级</th>
                    <th className={TH}>状态</th>
                    <th className={TH}>截止</th>
                    <th className={TH}>计划 / 实际</th>
                    <th className={`${TH} text-right`}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTasks.map((t) => {
                    const overdue = t.due_date && new Date(t.due_date).getTime() < Date.now() && t.status !== 'done';
                    const plan = rangeSummary(t.plan_start_at, t.plan_end_at);
                    const actual = rangeSummary(t.actual_start_at, t.actual_end_at);
                    const timeText = [plan && `计划 ${plan}`, actual && `实际 ${actual}`].filter(Boolean).join('  ');
                    return (
                      <tr key={t.id} className={ROW}>
                        <td className={`${CELL} min-w-0 max-w-96`}>
                          <div className="flex items-center gap-1.5">
                            <span className="truncate font-600 text-ink" title={t.title}>{t.title}</span>
                            {t.status === 'done' && <Check size={12} className="shrink-0 text-green" />}
                          </div>
                          <div className="flex items-center gap-1">
                            {t.requirement_title && (
                              <span className="inline-flex items-center gap-1 rounded bg-surface px-1.5 py-0.5 text-10px text-muted"><ListTree size={9} /> {t.requirement_title}</span>
                            )}
                            {t.milestone_name && (
                              <span className="inline-flex items-center gap-1 rounded bg-violet-light px-1.5 py-0.5 text-10px text-violet"><Flag size={9} /> {t.milestone_name}</span>
                            )}
                          </div>
                        </td>
                        <td className={`${CELL} whitespace-nowrap text-muted`}>{t.assignee_name || '—'}</td>
                        <td className={`${CELL} whitespace-nowrap`}><Badge value={t.priority} /></td>
                        <td className={`${CELL} whitespace-nowrap`}><Badge value={t.status} /></td>
                        <td className={`${CELL} whitespace-nowrap`}>
                          {t.due_date ? (
                            <span className={overdue ? 'font-650 text-coral' : 'text-muted'}>{new Date(t.due_date).toLocaleDateString()}</span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td className={`${CELL} whitespace-nowrap`}>
                          {timeText ? <span className="text-violet/70">{timeText}</span> : <span className="text-muted">—</span>}
                        </td>
                        <td className={`${CELL} whitespace-nowrap text-right`}>
                          <div className="inline-flex items-center gap-0.5">
                            <button onClick={() => openEditTask(t)} className={opBtn} title="编辑任务"><Pencil size={13} /></button>
                            <button onClick={() => delTask.mutate(t.id)} className={opBtnDanger} title="删除任务"><Trash2 size={13} /></button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
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
          <label>归属里程碑</label>
          <select className="form-input" value={reqForm.milestoneId} onChange={(e) => setReqForm({ ...reqForm, milestoneId: e.target.value })}>
            <option value="">无里程碑</option>
            {(milestones.data ?? []).map((m) => (
              <option key={m.id} value={m.id}>{m.title}</option>
            ))}
          </select>
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
        {!taskForm.id && (
          <div className="form-group">
            <label>归属需求</label>
            <select className="form-input" value={taskForm.requirementId} onChange={(e) => setTaskForm({ ...taskForm, requirementId: e.target.value })}>
              <option value="">请选择需求</option>
              {(reqs.data ?? []).map((r) => (
                <option key={r.id} value={r.id}>{r.title}</option>
              ))}
            </select>
          </div>
        )}
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
        <div className="form-group">
          <label>归属里程碑</label>
          <select className="form-input" value={taskForm.milestoneId} onChange={(e) => setTaskForm({ ...taskForm, milestoneId: e.target.value })}>
            <option value="">无里程碑</option>
            {(milestones.data ?? []).map((m) => (
              <option key={m.id} value={m.id}>{m.title}</option>
            ))}
          </select>
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
          <button className="btn btn-primary" disabled={!taskForm.title.trim() || (taskForm.id ? false : !taskForm.requirementId) || createTask.isPending || updateTask.isPending} onClick={() => (taskForm.id ? updateTask.mutate() : createTask.mutate())}>
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

      {/* 编辑里程碑 */}
      <Modal open={milestoneEdit.open} onClose={() => setMilestoneEdit({ ...milestoneEdit, open: false })} title="编辑里程碑" width={480}>
        <div className="form-group">
          <label>里程碑标题</label>
          <input
            className="form-input"
            value={milestoneEdit.title}
            onChange={(e) => setMilestoneEdit({ ...milestoneEdit, title: e.target.value })}
            placeholder="例如：MVP 版本上线"
            autoFocus
          />
        </div>
        <div className="form-group">
          <label>描述</label>
          <textarea
            className="form-input min-h-16 resize-none"
            value={milestoneEdit.desc}
            onChange={(e) => setMilestoneEdit({ ...milestoneEdit, desc: e.target.value })}
            placeholder="里程碑范围、交付物…"
          />
        </div>
        <div className="form-group">
          <label>截止日期</label>
          <input
            type="datetime-local"
            className="form-input"
            value={milestoneEdit.due}
            onChange={(e) => setMilestoneEdit({ ...milestoneEdit, due: e.target.value })}
          />
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={() => setMilestoneEdit({ ...milestoneEdit, open: false })}>取消</button>
          <button
            className="btn btn-primary"
            disabled={!milestoneEdit.title.trim() || updateMilestone.isPending}
            onClick={() => updateMilestone.mutate()}
          >
            {updateMilestone.isPending ? <Spinner size={14} /> : null} 保存
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