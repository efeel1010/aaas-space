import { createContext, useContext, useState, type ReactNode } from 'react';
import { ArrowLeft, X } from 'lucide-react';

// ===== 通用小组件 =====
export function Spinner({ size = 18, className = '' }: { size?: number; className?: string }) {
  return (
    <span
      className={`inline-block animate-spin rounded-full border-2 border-violet-200 border-t-violet ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

export function Empty({ icon, title, desc, action }: { icon?: string; title: string; desc?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center">
      {icon && <img src={icon} alt="" className="mb-3 h-14 w-14" />}
      <p className="text-15px font-650 text-ink">{title}</p>
      {desc && <p className="mt-1 text-13px text-muted">{desc}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

const badgeColors: Record<string, string> = {
  todo: 'bg-violet-light text-violet',
  doing: 'bg-cyan/15 text-cyan',
  review: 'bg-amber/15 text-amber',
  done: 'bg-green/12 text-green',
  open: 'bg-violet-light text-violet',
  in_progress: 'bg-cyan/15 text-cyan',
  cancelled: 'bg-line text-muted',
  planning: 'bg-violet-light text-violet',
  active: 'bg-green/12 text-green',
  paused: 'bg-amber/15 text-amber',
  completed: 'bg-cyan/15 text-cyan',
  archived: 'bg-line text-muted',
  high: 'bg-coral/12 text-coral',
  urgent: 'bg-coral/15 text-coral',
  medium: 'bg-amber/15 text-amber',
  low: 'bg-line text-muted',
  owner: 'bg-violet-light text-violet',
  admin: 'bg-cyan/15 text-cyan',
  member: 'bg-line text-muted',
  doc: 'bg-violet-light text-violet',
  wiki: 'bg-cyan/15 text-cyan',
};

export function Badge({ value }: { value: string }) {
  const color = badgeColors[value] ?? 'bg-violet-light text-violet';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-11px font-650 ${color}`}>
      {statusText(value)}
    </span>
  );
}

export function statusText(v: string): string {
  const map: Record<string, string> = {
    todo: '待办',
    doing: '进行中',
    review: '待评审',
    done: '已完成',
    open: '待处理',
    in_progress: '进行中',
    cancelled: '已取消',
    planning: '规划中',
    active: '进行中',
    paused: '已暂停',
    completed: '已完成',
    archived: '已归档',
    high: '高',
    urgent: '紧急',
    medium: '中',
    low: '低',
    owner: '创建者',
    admin: '管理员',
    member: '成员',
    doc: '文档',
    wiki: '知识库',
  };
  return map[v] ?? v;
}

export const priorityOrder: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

// ===== 弹窗 =====
export function Modal({
  open,
  onClose,
  title,
  children,
  width = 520,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  width?: number;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" onClick={onClose}>
      <div
        className="card w-full max-w-full overflow-hidden rounded-2xl"
        style={{ maxWidth: width }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <h3 className="font-display text-16px font-650 text-ink">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-muted hover:bg-surface hover:text-ink">
            <X size={18} />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

export function BackLink({ to, label }: { to: string; label: string }) {
  return (
    <a
      href={to}
      onClick={(e) => {
        if (to.startsWith('#')) return;
        e.preventDefault();
        window.history.back();
      }}
      className="inline-flex items-center gap-1 text-12px font-600 text-muted transition hover:text-violet"
    >
      <ArrowLeft size={14} /> {label}
    </a>
  );
}

export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  message,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  loading?: boolean;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} width={420}>
      <p className="text-13px text-muted">{message}</p>
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn btn-ghost" onClick={onClose}>
          取消
        </button>
        <button className="btn btn-danger" onClick={onConfirm} disabled={loading}>
          {loading ? <Spinner size={14} /> : null} 确认删除
        </button>
      </div>
    </Modal>
  );
}

// ===== Toast =====
interface Toast {
  id: number;
  type: 'success' | 'error' | 'info';
  message: string;
}
const ToastContext = createContext<{ toast: (message: string, type?: Toast['type']) => void }>({ toast: () => undefined });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toast = (message: string, type: Toast['type'] = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, type, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2800);
  };
  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed right-5 top-5 z-[100] flex w-80 flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`card flex items-start gap-2 px-4 py-3 text-13px font-600 ${
              t.type === 'error' ? 'text-coral' : t.type === 'info' ? 'text-cyan' : 'text-green'
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext).toast;
}

export function cn(...parts: (string | false | undefined)[]) {
  return parts.filter(Boolean).join(' ');
}
