import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { docApi } from '../lib/api';
import { cn, Spinner } from './ui';
import { ChevronRight, ChevronDown, BookOpen } from 'lucide-react';
import type { Document, WikiRef } from '@pulse-space/contracts';

export function WikiSidebar({
  scope,
  teamId,
  currentId,
  ancestors,
}: {
  scope: 'personal' | 'team';
  teamId?: string;
  currentId: string;
  ancestors: WikiRef[];
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [kidCache, setKidCache] = useState<Record<string, Document[]>>({});

  const roots = useQuery({
    queryKey: ['wiki-sidebar', scope, teamId],
    queryFn: () => docApi.list({ scope, teamId, kind: 'wiki' }),
  });

  const loadChildren = async (parentId: string) => {
    if (kidCache[parentId]) return;
    const data = await docApi.list({ scope, teamId, kind: 'wiki', parent: parentId });
    setKidCache((prev) => ({ ...prev, [parentId]: data }));
  };

  // 自动展开当前文档的祖先路径，使树默认定位到当前页
  const ancestorKey = ancestors.map((a) => a.id).join(':');
  useEffect(() => {
    const ids = ancestors.slice(0, -1).map((a) => a.id);
    if (ids.length === 0) return;
    setExpanded((prev) => new Set([...prev, ...ids]));
    ids.forEach((pid) => loadChildren(pid));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ancestorKey, scope, teamId]);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        loadChildren(id);
      }
      return next;
    });
  };

  const renderNode = (doc: Document, depth: number): ReactNode => {
    const kids = kidCache[doc.id] ?? [];
    const isOpen = expanded.has(doc.id);
    const isCurrent = doc.id === currentId;
    return (
      <div key={doc.id}>
        <div
          className={cn(
            'group flex items-center gap-0.5 rounded-lg py-1.5 pr-2 transition hover:bg-surface',
            isCurrent && 'bg-violet-light',
          )}
          style={{ paddingLeft: depth * 14 + 6 }}
        >
          <button
            onClick={() => toggle(doc.id)}
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted hover:text-violet"
            title={isOpen ? '折叠' : '展开'}
          >
            {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
          <Link
            to={`/wiki/${doc.id}`}
            className={cn(
              'flex min-w-0 flex-1 items-center gap-1.5 text-13px font-600',
              isCurrent ? 'text-violet' : 'text-ink hover:text-violet',
            )}
          >
            <BookOpen size={13} className="shrink-0 opacity-70" />
            <span className="truncate">{doc.title}</span>
          </Link>
        </div>
        {isOpen && kids.map((k) => renderNode(k, depth + 1))}
      </div>
    );
  };

  if (roots.isLoading) {
    return (
      <aside className="flex w-60 shrink-0 items-center justify-center border-r border-line bg-white/60">
        <Spinner size={18} />
      </aside>
    );
  }

  return (
    <aside className="flex w-60 shrink-0 flex-col overflow-hidden border-r border-line bg-white/80">
      <div className="border-b border-line px-4 py-2.5 text-11px font-650 text-muted">知识库目录</div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">{(roots.data ?? []).map((r) => renderNode(r, 0))}</div>
    </aside>
  );
}