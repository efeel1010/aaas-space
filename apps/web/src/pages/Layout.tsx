import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import { cn } from '../components/ui';
import { notifApi } from '../lib/api';
import { useEffect, useRef, useState } from 'react';
import {
  LayoutDashboard,
  FileText,
  Library,
  FolderKanban,
  Bot,
  Users,
  LogOut,
  Bell,
  MessageSquare,
  UserPlus,
  Trash2,
  AtSign,
} from 'lucide-react';

const navs = [
  { to: '/', label: '工作台', icon: LayoutDashboard, end: true },
  { to: '/docs', label: '我的文档', icon: FileText },
  { to: '/wiki', label: '知识库', icon: Library },
  { to: '/projects', label: '项目中心', icon: FolderKanban },
  { to: '/teams', label: '团队空间', icon: Users },
  { to: '/trash', label: '回收站', icon: Trash2 },
  { to: '/ai', label: 'AI 助手', icon: Bot },
];

// ===== 通知铃铛 =====
function NotificationBell() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const notifs = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notifApi.list(),
    refetchInterval: 30000,
  });

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  const markRead = useMutation({ mutationFn: (id: string) => notifApi.markRead(id), onSuccess: invalidate });
  const markAll = useMutation({ mutationFn: () => notifApi.markAllRead(), onSuccess: invalidate });

  const unread = notifs.data?.unread_count ?? 0;
  const list = notifs.data?.list ?? [];

  return (
    <div ref={boxRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'relative flex h-9 w-9 items-center justify-center rounded-xl transition',
          open ? 'bg-violet-light text-violet' : 'text-muted hover:bg-surface hover:text-ink',
        )}
        title="通知"
      >
        <Bell size={17} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-coral px-1 text-10px font-700 text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="card absolute bottom-0 left-full z-30 ml-2 w-80 p-2 shadow-lg">
          <div className="mb-1 flex items-center justify-between px-2 pt-1">
            <p className="text-13px font-650 text-ink">通知</p>
            {unread > 0 && (
              <button onClick={() => markAll.mutate()} className="text-11px font-600 text-violet hover:underline">
                全部已读
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {list.length === 0 ? (
              <p className="py-8 text-center text-12px text-muted">暂无通知</p>
            ) : (
              list.map((n) => (
                <button
                  key={n.id}
                  onClick={() => {
                    if (!n.read_at) markRead.mutate(n.id);
                    setOpen(false);
                    if (n.link) navigate(n.link);
                  }}
                  className={cn(
                    'flex w-full items-start gap-2.5 rounded-lg px-2 py-2.5 text-left transition hover:bg-surface',
                    !n.read_at && 'bg-violet-light/40',
                  )}
                >
                  <span className={cn('mt-0.5 shrink-0', n.type === 'task_assigned' ? 'text-cyan' : n.type === 'mention' ? 'text-amber' : 'text-violet')}>
                    {n.type === 'task_assigned' ? <UserPlus size={14} /> : n.type === 'mention' ? <AtSign size={14} /> : <MessageSquare size={14} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-12px font-600 leading-5 text-ink">{n.title}</span>
                    {n.content && <span className="mt-0.5 block truncate text-11px text-muted">{n.content}</span>}
                    <span className="mt-0.5 block text-10px text-muted">{new Date(n.created_at).toLocaleString()}</span>
                  </span>
                  {!n.read_at && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-violet" />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="flex h-full min-h-screen">
      {/* 侧边栏 */}
      <aside className="flex w-60 flex-shrink-0 flex-col border-r border-line bg-white/80 px-3 py-4 backdrop-blur">
        <div className="mb-6 flex items-center justify-between px-2">
          <img src="/pulse-space-logo.svg" alt="Pulse Space" className="h-9" />
          <NotificationBell />
        </div>

        <nav className="flex-1 space-y-0.5">
          {navs.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={(item as { end?: boolean }).end}
              className={({ isActive }) =>
                cn(
                  'group flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-13px font-600 transition-all duration-200',
                  isActive
                    ? 'bg-violet-light text-violet'
                    : 'text-muted hover:bg-surface hover:text-ink',
                )
              }
            >
              <item.icon size={17} strokeWidth={2.2} />
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* 用户区 */}
        <div className="mt-4 border-t border-line pt-3">
          <div className="flex items-center gap-2.5 rounded-xl px-2 py-2">
            <div className="relative">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-violet to-violet-dark text-white">
                <span className="font-650 text-13px">{user?.name?.charAt(0) ?? 'U'}</span>
              </div>
              <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white bg-green" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-13px font-650 text-ink">{user?.name}</p>
              <p className="truncate text-11px text-muted">{user?.email}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="mt-1 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-13px font-600 text-muted transition hover:bg-surface hover:text-coral"
          >
            <LogOut size={16} /> 退出登录
          </button>
        </div>
      </aside>

      {/* 主内容 */}
      <main className="flex-1 overflow-y-auto bg-surface">
        <Outlet />
      </main>
    </div>
  );
}
