import { useEffect, useRef, useState } from 'react';
import { authApi } from '../lib/api';
import { Search, X } from 'lucide-react';
import { cn } from './ui';

export type PickedUser = { id: string; name: string; email: string; avatar_url: string | null };

type Props = {
  value: PickedUser[];
  onChange: (users: PickedUser[]) => void;
  multiple?: boolean;
  placeholder?: string;
  max?: number;
};

/**
 * 复用用户选择器：输入关键字搜索系统用户 → 下拉勾选。
 * - multiple=false：单选（负责人/执行人）
 * - multiple=true：多选（协作人，上限 max，允许清空传空数组）
 */
export function UserPicker({ value, onChange, multiple = true, placeholder, max = 20 }: Props) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<PickedUser[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const selectedIds = new Set(value.map((u) => u.id));
  const isFull = multiple && value.length >= max;
  const inputPlaceholder =
    value.length === 0
      ? placeholder ?? (multiple ? '搜索并选择协作人' : '搜索并选择负责人')
      : multiple
        ? isFull
          ? `最多 ${max} 人`
          : '继续添加…'
        : '';

  const search = (keyword: string) => {
    setOpen(true);
    const k = keyword.trim();
    if (!k) {
      setResults([]);
      return;
    }
    window.clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const list = await authApi.searchUsers(k);
        setResults(
          list.map((u) => ({ id: u.id, name: u.name, email: u.email, avatar_url: u.avatar_url })),
        );
      } catch {
        /* 搜索失败忽略 */
      }
    }, 250);
  };

  const toggle = (u: PickedUser) => {
    if (multiple) {
      if (selectedIds.has(u.id)) onChange(value.filter((x) => x.id !== u.id));
      else if (value.length < max) onChange([...value, u]);
    } else {
      onChange(selectedIds.has(u.id) ? [] : [u]);
      setOpen(false);
    }
    setQ('');
    setResults([]);
  };

  return (
    <div ref={boxRef} className="relative">
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-line bg-white px-2 py-1.5 focus-within:border-violet">
        {value.map((u) => (
          <span
            key={u.id}
            className="inline-flex items-center gap-1 rounded-full bg-violet-light px-2 py-0.5 text-11px font-600 text-violet"
          >
            {u.name}
            <button type="button" onClick={() => toggle(u)} className="text-violet/70 transition hover:text-violet">
              <X size={12} />
            </button>
          </span>
        ))}
        <div className="flex min-w-24 flex-1 items-center gap-1 text-12px">
          <Search size={13} className="text-muted" />
          <input
            className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-muted/60"
            placeholder={inputPlaceholder}
            value={q}
            disabled={isFull}
            onChange={(e) => {
              setQ(e.target.value);
              search(e.target.value);
            }}
          />
        </div>
      </div>
      {open && results.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-auto rounded-lg border border-line bg-white p-1 shadow-md">
          {results.map((u) => (
            <button
              key={u.id}
              type="button"
              onClick={() => toggle(u)}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-12px transition hover:bg-surface',
                selectedIds.has(u.id) ? 'text-violet' : 'text-ink',
              )}
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-light text-11px font-650 text-violet">
                {u.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0">
                <span className="block truncate font-600">{u.name}</span>
                <span className="block truncate text-10px text-muted">{u.email}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}