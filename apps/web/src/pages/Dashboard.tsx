import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { docApi, projectApi, teamApi, searchApi } from '../lib/api';
import { Badge, Spinner, cn, useToast } from '../components/ui';
import {
  FileText, FolderKanban, Library, Users, Bot, Plus, ArrowRight, Sparkles,
  Search, Table, Star, Flag, ListTodo, Clock, ChevronDown,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Document, DocKind, RecentDocsTab } from '@pulse-space/contracts';

const docPath = (d: { id: string; kind: string }) =>
  d.kind === 'sheet' ? `/sheets/${d.id}` : d.kind === 'wiki' ? `/wiki/${d.id}` : `/docs/${d.id}`;

const kindIcon = (kind: string) => (kind === 'sheet' ? Table : kind === 'wiki' ? Library : FileText);

// ===== 全局搜索框 =====
function GlobalSearch() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const result = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => searchApi.search(debounced),
    enabled: debounced.length > 0,
  });

  const docs = result.data?.documents ?? [];
  const projs = result.data?.projects ?? [];
  const showPanel = open && debounced.length > 0;

  return (
    <div ref={boxRef} className="relative mb-6">
      <div className="card flex items-center gap-2.5 px-4 py-3">
        <Search size={16} className="shrink-0 text-muted" />
        <input
          className="w-full bg-transparent text-13px text-ink outline-none placeholder:text-muted"
          placeholder="搜索文档、项目…"
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
        />
      </div>
      {showPanel && (
        <div className="card absolute left-0 right-0 top-full z-20 mt-2 max-h-80 overflow-y-auto p-2 shadow-lg">
          {result.isLoading ? (
            <div className="py-6 text-center"><Spinner size={16} /></div>
          ) : docs.length + projs.length === 0 ? (
            <p className="py-6 text-center text-12px text-muted">没有找到「{debounced}」相关内容</p>
          ) : (
            <>
              {docs.length > 0 && (
                <>
                  <p className="px-2 pb-1 pt-1.5 text-10px font-650 text-muted">文档</p>
                  {docs.map((d) => {
                    const Icon = kindIcon(d.kind);
                    return (
                      <button
                        key={d.id}
                        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition hover:bg-surface"
                        onClick={() => { setOpen(false); setQ(''); navigate(docPath(d)); }}
                      >
                        <Icon size={15} className="shrink-0 text-violet" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-13px font-600 text-ink">{d.title}</span>
                          {d.snippet && <span className="block truncate text-10px text-muted">{d.snippet}</span>}
                        </span>
                        <span className="text-10px text-muted">{new Date(d.updated_at).toLocaleDateString()}</span>
                      </button>
                    );
                  })}
                </>
              )}
              {projs.length > 0 && (
                <>
                  <p className="px-2 pb-1 pt-1.5 text-10px font-650 text-muted">项目</p>
                  {projs.map((p) => (
                    <button
                      key={p.id}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition hover:bg-surface"
                      onClick={() => { setOpen(false); setQ(''); navigate(`/projects/${p.id}`); }}
                    >
                      <FolderKanban size={15} className="shrink-0 text-cyan" />
                      <span className="min-w-0 flex-1 truncate text-13px font-600 text-ink">{p.name}</span>
                      <Badge value={p.status} />
                    </button>
                  ))}
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ===== 最近文档（Tab + 收藏） =====
const RECENT_TABS: { key: RecentDocsTab; label: string }[] = [
  { key: 'viewed', label: '最近访问' },
  { key: 'created', label: '我创建的' },
  { key: 'favorite', label: '收藏' },
];

function RecentDocs() {
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<RecentDocsTab>('viewed');
  const recent = useQuery({ queryKey: ['docs', 'recent', tab], queryFn: () => docApi.recent(tab) });

  const toggleFav = useMutation({
    mutationFn: (id: string) => docApi.toggleFavorite(id),
    onSuccess: (r) => {
      toast(r.favorited ? '已收藏' : '已取消收藏');
      qc.invalidateQueries({ queryKey: ['docs', 'recent'] });
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });

  return (
    <div className="card p-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-display text-16px font-650 text-ink">
          <FileText size={17} className="text-violet" /> 最近文档
        </h2>
        <Link to="/docs" className="flex items-center gap-1 text-12px font-600 text-violet hover:underline">
          全部 <ArrowRight size={13} />
        </Link>
      </div>
      <div className="mb-3 flex gap-1">
        {RECENT_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'rounded-lg px-2.5 py-1 text-12px font-650 transition',
              tab === t.key ? 'bg-violet-light text-violet' : 'text-muted hover:bg-surface hover:text-ink',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {recent.isLoading ? (
        <div className="py-8 text-center"><Spinner /></div>
      ) : (recent.data ?? []).length === 0 ? (
        <p className="py-8 text-center text-13px text-muted">
          {tab === 'favorite' ? '还没有收藏，点击文档右侧星标即可收藏' : tab === 'created' ? '还没有创建过文档' : '还没有访问过文档'}
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {(recent.data ?? []).slice(0, 8).map((d: Document) => {
            const Icon = kindIcon(d.kind);
            return (
              <li key={d.id} className="group flex items-center">
                <Link to={docPath(d)} className="flex min-w-0 flex-1 items-center justify-between py-3 pr-2 transition">
                  <span className="flex min-w-0 items-center gap-2.5 text-13px font-600 text-ink">
                    <Icon size={15} className="shrink-0 text-violet" />
                    <span className="truncate">{d.title}</span>
                  </span>
                  <span className="ml-3 shrink-0 text-11px text-muted">
                    {new Date(tab === 'viewed' && d.last_viewed_at ? d.last_viewed_at : d.updated_at).toLocaleDateString()}
                  </span>
                </Link>
                <button
                  onClick={() => toggleFav.mutate(d.id)}
                  className={cn(
                    'shrink-0 rounded p-1.5 transition hover:text-amber',
                    d.is_favorite ? 'text-amber' : 'text-muted opacity-0 group-hover:opacity-100',
                  )}
                  title={d.is_favorite ? '取消收藏' : '收藏'}
                >
                  <Star size={14} fill={d.is_favorite ? 'currentColor' : 'none'} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ===== 我的待办 + 临近里程碑 =====
function MyTodos() {
  const todos = useQuery({ queryKey: ['my-todos'], queryFn: () => projectApi.myTodos() });
  const tasks = todos.data?.tasks ?? [];
  const milestones = todos.data?.milestones ?? [];

  const dueLabel = (iso: string | null) => {
    if (!iso) return null;
    const diff = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
    if (diff < 0) return { text: `逾期 ${-diff} 天`, cls: 'text-coral' };
    if (diff === 0) return { text: '今天截止', cls: 'text-coral' };
    if (diff <= 3) return { text: `${diff} 天后截止`, cls: 'text-amber' };
    return { text: new Date(iso).toLocaleDateString(), cls: 'text-muted' };
  };

  return (
    <div className="card p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-display text-16px font-650 text-ink">
          <ListTodo size={17} className="text-violet" /> 我的待办
        </h2>
        <Link to="/projects" className="flex items-center gap-1 text-12px font-600 text-violet hover:underline">
          全部 <ArrowRight size={13} />
        </Link>
      </div>
      {todos.isLoading ? (
        <div className="py-8 text-center"><Spinner /></div>
      ) : tasks.length === 0 && milestones.length === 0 ? (
        <p className="py-8 text-center text-13px text-muted">太棒了，没有待办事项</p>
      ) : (
        <div className="space-y-1">
          {milestones.length > 0 && (
            <div className="mb-3">
              <p className="mb-1.5 flex items-center gap-1 text-11px font-650 text-muted"><Flag size={11} className="text-amber" /> 临近里程碑</p>
              {milestones.map((m) => {
                const due = dueLabel(m.due_date);
                return (
                  <Link key={m.id} to={`/projects/${m.project_id}`} className="flex items-center justify-between rounded-lg px-2 py-2 transition hover:bg-surface">
                    <span className="flex min-w-0 items-center gap-2 text-13px font-600 text-ink">
                      <Flag size={13} className="shrink-0 text-amber" />
                      <span className="truncate">{m.title}</span>
                      <span className="shrink-0 text-10px text-muted">{m.project_name}</span>
                    </span>
                    {due && <span className={cn('ml-2 shrink-0 text-11px', due.cls)}>{due.text}</span>}
                  </Link>
                );
              })}
            </div>
          )}
          {tasks.map((t) => {
            const due = dueLabel(t.due_date);
            return (
              <Link key={t.id} to={`/projects/${t.project_id}`} className="flex items-center justify-between rounded-lg px-2 py-2 transition hover:bg-surface">
                <span className="flex min-w-0 items-center gap-2">
                  <Badge value={t.status} />
                  <span className="min-w-0">
                    <span className="block truncate text-13px font-600 text-ink">{t.title}</span>
                    <span className="block truncate text-10px text-muted">{t.project_name} / {t.requirement_title}</span>
                  </span>
                </span>
                {due ? (
                  <span className={cn('ml-2 flex shrink-0 items-center gap-1 text-11px', due.cls)}>
                    <Clock size={11} /> {due.text}
                  </span>
                ) : (
                  <span className="ml-2 shrink-0 text-11px text-muted">无截止</span>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Dashboard() {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setDropdownOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const docs = useQuery({
    queryKey: ['docs', 'personal'],
    queryFn: () => docApi.list({ scope: 'personal', kind: 'doc' }),
  });
  const projects = useQuery({
    queryKey: ['projects', 'personal'],
    queryFn: () => projectApi.list({ scope: 'personal' }),
  });
  const teams = useQuery({
    queryKey: ['teams'],
    queryFn: () => teamApi.list(),
  });

  const docCount = (docs.data ?? []).filter((d) => !d.is_folder).length;
  const projectCount = projects.data?.length ?? 0;
  const taskCount = (projects.data ?? []).reduce((acc, p) => acc + p.task_count, 0);
  const doneTaskCount = (projects.data ?? []).reduce((acc, p) => acc + p.done_task_count, 0);
  const progress = taskCount ? Math.round((doneTaskCount / taskCount) * 100) : 0;

  const stats = [
    { label: '文档', value: docCount, icon: FileText, color: 'text-violet bg-violet-light', to: '/docs' },
    { label: '项目', value: projectCount, icon: FolderKanban, color: 'text-cyan bg-cyan/10', to: '/projects' },
    { label: '任务完成率', value: `${progress}%`, icon: Sparkles, color: 'text-amber bg-amber/10', to: '/projects' },
    { label: '团队', value: teams.data?.length ?? 0, icon: Users, color: 'text-green bg-green/10', to: '/teams' },
  ];

  const quickCreate = async (kind: DocKind, label: string) => {
    try {
      const doc = await docApi.create({ scope: 'personal', kind, title: `未命名${label}`, content: '' });
      toast(`已创建${label}`);
      navigate(docPath(doc));
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const quickNav = [
    { label: '新建文档', icon: FileText, desc: '开始一篇新文档', onClick: () => quickCreate('doc', '文档') },
    { label: '新建表格', icon: Table, desc: '结构化数据协作', onClick: () => quickCreate('sheet', '表格') },
    { label: '新建 Wiki', icon: Library, desc: '沉淀团队知识', onClick: () => quickCreate('wiki', 'Wiki') },
    { label: 'AI 助手', icon: Bot, desc: '写作 / 拆解 / 答疑', onClick: () => navigate('/ai') },
  ];

  // 顶部「新建」下拉：覆盖所有可新建类型
  const createMenu = [
    { label: '新建文档', icon: FileText, onClick: () => quickCreate('doc', '文档') },
    { label: '新建表格', icon: Table, onClick: () => quickCreate('sheet', '表格') },
    { label: '新建 Wiki', icon: Library, onClick: () => quickCreate('wiki', 'Wiki') },
    { label: 'AI 助手', icon: Bot, onClick: () => navigate('/ai') },
  ];

  return (
    <div className="mx-auto max-w-1100 px-8 py-8">
      {/* 欢迎横幅 */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="font-display text-26px font-700 text-ink">
            你好，{user?.name ?? '同学'}
            <span className="ml-1 text-violet">👋</span>
          </h1>
          <p className="mt-1 text-13px text-muted">今天想在 Pulse Space 完成点什么？</p>
        </div>
        <div ref={menuRef} className="relative">
          <button className="btn btn-primary" onClick={() => setDropdownOpen((v) => !v)}>
            <Plus size={15} /> 新建 <ChevronDown size={14} />
          </button>
          {dropdownOpen && (
            <div className="card absolute right-0 top-full z-20 mt-2 w-48 overflow-hidden p-1.5 shadow-lg">
              {createMenu.map((item) => (
                <button
                  key={item.label}
                  onClick={() => { setDropdownOpen(false); item.onClick(); }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-13px font-600 text-ink transition hover:bg-surface"
                >
                  <item.icon size={15} className="shrink-0 text-violet" />
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 全局搜索 */}
      <GlobalSearch />

      {/* 快捷入口 */}
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {quickNav.map((item) => (
          <button key={item.label} onClick={item.onClick} className="card card-hover group p-5 text-left">
            <div className="flex items-center justify-between">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-light text-violet transition group-hover:bg-violet group-hover:text-white">
                <item.icon size={19} />
              </div>
              <ArrowRight size={15} className="text-muted transition group-hover:translate-x-0.5 group-hover:text-violet" />
            </div>
            <p className="mt-3 text-14px font-650 text-ink">{item.label}</p>
            <p className="mt-0.5 text-12px text-muted">{item.desc}</p>
          </button>
        ))}
      </div>

      {/* 统计（可点击跳转） */}
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <Link key={s.label} to={s.to} className="card card-hover p-5">
            <div className="flex items-center gap-3">
              <div className={cn('flex h-10 w-10 items-center justify-center rounded-xl', s.color)}>
                <s.icon size={19} />
              </div>
              <div>
                <p className="text-22px font-700 text-ink">{s.value}</p>
                <p className="text-12px text-muted">{s.label}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <RecentDocs />
        <MyTodos />
      </div>

      {/* 项目进度 */}
      <div className="card mt-6 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-display text-16px font-650 text-ink">
            <FolderKanban size={17} className="text-cyan" /> 项目进度
          </h2>
          <Link to="/projects" className="flex items-center gap-1 text-12px font-600 text-violet hover:underline">
            全部 <ArrowRight size={13} />
          </Link>
        </div>
        {projects.isLoading ? (
          <div className="py-8 text-center"><Spinner /></div>
        ) : (projects.data ?? []).length === 0 ? (
          <p className="py-8 text-center text-13px text-muted">还没有项目</p>
        ) : (
          <ul className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
            {(projects.data ?? []).slice(0, 6).map((p) => {
              const pct = p.task_count ? Math.round((p.done_task_count / p.task_count) * 100) : 0;
              return (
                <li key={p.id}>
                  <Link to={`/projects/${p.id}`} className="block rounded-xl p-3 transition hover:bg-surface">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-13px font-650 text-ink">{p.name}</span>
                      <Badge value={p.status} />
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-violet to-violet-dark transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-11px text-muted">{p.done_task_count}/{p.task_count}</span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
