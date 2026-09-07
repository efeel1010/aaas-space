import { createContext, useContext, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';

// ===== 通用小组件 =====
export function Spinner({ size = 18, className = '' }: { size?: number; className?: string }) {
  return (
    <span
      className={`inline-block animate-spin rounded-full border-2 border-violet-200 border-t-violet ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

const badgeColors: Record<string, string> = {
  planning: 'bg-violet-light text-violet',
  active: 'bg-green/12 text-green',
  paused: 'bg-amber/15 text-amber',
  completed: 'bg-cyan/15 text-cyan',
  archived: 'bg-line text-muted',
  doc: 'bg-violet-light text-violet',
  wiki: 'bg-cyan/15 text-cyan',
  sheet: 'bg-green/12 text-green',
  requirement: 'bg-amber/15 text-amber',
  task: 'bg-cyan/15 text-cyan',
};

export function statusText(v: string): string {
  const map: Record<string, string> = {
    planning: '规划中',
    active: '进行中',
    paused: '已暂停',
    completed: '已完成',
    archived: '已归档',
    doc: '文档',
    wiki: '知识库',
    sheet: '表格',
    requirement: '需求',
    task: '任务',
  };
  return map[v] ?? v;
}

export function Badge({ value }: { value: string }) {
  const color = badgeColors[value] ?? 'bg-violet-light text-violet';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-11px font-650 ${color}`}>
      {statusText(value)}
    </span>
  );
}

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