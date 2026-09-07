import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { cn } from '../components/ui';
import {
  LayoutDashboard,
  Users,
  Building2,
  FileText,
  FolderKanban,
  MessageSquare,
  LogOut,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';

const navs: { to: string; label: string; icon: LucideIcon; end?: boolean }[] = [
  { to: '/', label: '平台概览', icon: LayoutDashboard, end: true },
  { to: '/users', label: '用户管理', icon: Users },
  { to: '/teams', label: '团队管理', icon: Building2 },
  { to: '/documents', label: '文档管理', icon: FileText },
  { to: '/projects', label: '项目管理', icon: FolderKanban },
  { to: '/comments', label: '评论审计', icon: MessageSquare },
];

export function AdminLayout() {
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
        <div className="mb-6 flex items-center gap-2.5 px-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet to-violet-dark text-white">
            <ShieldCheck size={18} />
          </div>
          <div>
            <p className="text-13px font-700 text-ink">Pulse 管理后台</p>
            <p className="text-10px text-muted">platform</p>
          </div>
        </div>

        <nav className="flex-1 space-y-0.5">
          {navs.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'group flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-13px font-600 transition-all duration-200',
                  isActive ? 'bg-violet-light text-violet' : 'text-muted hover:bg-surface hover:text-ink',
                )
              }
            >
              <item.icon size={17} strokeWidth={2.2} />
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* 管理员区 */}
        <div className="mt-4 border-t border-line pt-3">
          <div className="flex items-center gap-2.5 rounded-xl px-2 py-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-violet to-violet-dark text-white">
              <span className="font-650 text-13px">{user?.name?.charAt(0) ?? 'A'}</span>
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