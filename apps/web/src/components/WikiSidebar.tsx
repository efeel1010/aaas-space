import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { docApi } from '../lib/api';
import { cn, Spinner, ConfirmModal, useToast } from './ui';
import { ChevronRight, ChevronDown, BookOpen, Plus, Pencil, Move, Trash2, Lock } from 'lucide-react';
import type { Document, WikiRef, WikiTocItem } from '@pulse-space/contracts';

// 收集某节点的所有后代 id（用于移动时排除自己及后代）
function descendantsOf(list: WikiTocItem[], id: string): Set<string> {
  const out = new Set<string>();
  const walk = (pid: string) => {
    for (const it of list) {
      if (it.parent_id === pid && !out.has(it.id)) {
        out.add(it.id);
        walk(it.id);
      }
    }
  };
  walk(id);
  return out;
}

// 计算节点层级深度（根为 0），用于移动目标列表缩进
function depthOf(list: WikiTocItem[], id: string | null): number {
  let depth = 0;
  let curId = id;
  const seen = new Set<string>();
  while (curId && !seen.has(curId)) {
    seen.add(curId);
    const cur = list.find((it) => it.id === curId);
    if (!cur?.parent_id) break;
    depth++;
    curId = cur.parent_id;
  }
  return depth;
}

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
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [kidCache, setKidCache] = useState<Record<string, Document[]>>({});

  // ===== 树结构的增删改查 =====
  const [newModal, setNewModal] = useState(false);
  const [newParent, setNewParent] = useState<Document | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [renaming, setRenaming] = useState<Document | null>(null);
  const [renameTitle, setRenameTitle] = useState('');
  const [moving, setMoving] = useState<Document | null>(null);
  const [moveTarget, setMoveTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Document | null>(null);

  const roots = useQuery({
    queryKey: ['wiki-sidebar', scope, teamId],
    queryFn: () => docApi.list({ scope, teamId, kind: 'wiki' }),
  });

  // 全量平铺目录（移动目标候选）
  const toc = useQuery({
    queryKey: ['wiki-sidebar-toc', scope, teamId],
    queryFn: () => docApi.wikiToc({ scope, teamId }),
  });

  const resetTree = () => {
    setExpanded(new Set());
    setKidCache({});
  };

  const refreshTree = () => {
    qc.invalidateQueries({ queryKey: ['wiki-sidebar'] });
    qc.invalidateQueries({ queryKey: ['wiki-sidebar-toc'] });
    resetTree();
  };

  const loadChildren = async (parentId: string) => {
    if (kidCache[parentId]) return;
    const data = await docApi.list({ scope, teamId, kind: 'wiki', parent: parentId });
    setKidCache((prev) => ({ ...prev, [parentId]: data }));
  };

  const create = useMutation({
    mutationFn: ({ title, parent_id }: { title: string; parent_id?: string }) =>
      docApi.create({ scope, team_id: scope === 'team' ? teamId : undefined, kind: 'wiki', parent_id, title, content: '' }),
    onSuccess: (doc) => {
      toast('已创建知识页');
      setNewModal(false);
      setNewParent(null);
      setNewTitle('');
      refreshTree();
      navigate(`/wiki/${doc.id}`);
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });

  const del = useMutation({
    mutationFn: (id: string) => docApi.remove(id),
    onSuccess: () => {
      toast('已删除');
      setDeleting(null);
      refreshTree();
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });

  const rename = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => docApi.update(id, { title }),
    onSuccess: () => {
      toast('已重命名');
      setRenaming(null);
      refreshTree();
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });

  const move = useMutation({
    mutationFn: ({ id, parentId }: { id: string; parentId: string | null }) => docApi.update(id, { parent_id: parentId }),
    onSuccess: () => {
      toast('已移动');
      setMoving(null);
      refreshTree();
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });

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

  // 移动弹窗的目标候选（排除自己及后代）
  const moveCandidates = useMemo(() => {
    if (!moving) return [];
    const exclude = descendantsOf(toc.data ?? [], moving.id);
    exclude.add(moving.id);
    return (toc.data ?? []).filter((it) => !exclude.has(it.id));
  }, [moving, toc.data]);

  const busy = create.isPending || del.isPending || rename.isPending || move.isPending;

  const renderNode = (doc: Document, depth: number): ReactNode => {
    const kids = kidCache[doc.id] ?? [];
    const isOpen = expanded.has(doc.id);
    const isCurrent = doc.id === currentId;
    return (
      <div key={doc.id}>
        <div
          className={cn(
            'group flex items-center gap-0.5 rounded-lg py-1.5 pr-1.5 transition hover:bg-surface',
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
            {(doc.visibility === 'private' || doc.effective_permission === 'read') && (
              <span title={doc.effective_permission === 'read' ? '仅可阅读' : '仅本人可见'} className="flex shrink-0 items-center">
                <Lock size={11} className="text-muted" />
              </span>
            )}
            <span className="truncate">{doc.title}</span>
          </Link>
          <button
            onClick={() => { setNewParent(doc); setNewModal(true); }}
            className="rounded p-0.5 text-muted opacity-0 transition hover:bg-violet-light hover:text-violet group-hover:opacity-100"
            title="添加子页面"
          >
            <Plus size={13} />
          </button>
          <button
            onClick={() => { setRenaming(doc); setRenameTitle(doc.title); }}
            className="rounded p-0.5 text-muted opacity-0 transition hover:bg-violet-light hover:text-violet group-hover:opacity-100"
            title="重命名"
          >
            <Pencil size={13} />
          </button>
          <button
            onClick={() => { setMoving(doc); setMoveTarget(doc.parent_id); }}
            className="rounded p-0.5 text-muted opacity-0 transition hover:bg-violet-light hover:text-violet group-hover:opacity-100"
            title="移动"
          >
            <Move size={13} />
          </button>
          <button
            onClick={() => setDeleting(doc)}
            className="rounded p-0.5 text-muted opacity-0 transition hover:bg-coral/10 hover:text-coral group-hover:opacity-100"
            title="删除"
          >
            <Trash2 size={13} />
          </button>
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
    <aside className="relative flex w-60 shrink-0 flex-col overflow-hidden border-r border-line bg-white/80">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5 text-11px font-650 text-muted">
        <span>知识库目录</span>
        <button
          onClick={() => { setNewParent(null); setNewModal(true); }}
          className="rounded p-0.5 text-muted transition hover:bg-violet-light hover:text-violet"
          title="新建根页面"
          disabled={busy}
        >
          <Plus size={14} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">{(roots.data ?? []).map((r) => renderNode(r, 0))}</div>

      {/* 新建页面弹窗 */}
      {newModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" onClick={() => setNewModal(false)}>
          <div className="card w-full max-w-[460px] rounded-2xl p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-4 font-display text-16px font-650 text-ink">
              新建{newParent ? `「${newParent.title}」的子页面` : '根页面'}
            </h3>
            <div className="form-group">
              <label>页面标题</label>
              <input className="form-input" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="页面标题" autoFocus />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn btn-ghost" onClick={() => setNewModal(false)}>取消</button>
              <button
                className="btn btn-primary"
                disabled={!newTitle.trim() || create.isPending}
                onClick={() => create.mutate({ title: newTitle.trim(), parent_id: newParent?.id })}
              >
                {create.isPending ? <Spinner size={14} /> : null} 创建
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 重命名弹窗 */}
      {renaming !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" onClick={() => setRenaming(null)}>
          <div className="card w-full max-w-[340px] rounded-2xl p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-4 font-display text-16px font-650 text-ink">重命名</h3>
            <div className="form-group">
              <label>页面标题</label>
              <input className="form-input" value={renameTitle} onChange={(e) => setRenameTitle(e.target.value)} placeholder="页面标题" autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') rename.mutate({ id: renaming.id, title: renameTitle.trim() }); }} />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn btn-ghost" onClick={() => setRenaming(null)}>取消</button>
              <button className="btn btn-primary" disabled={!renameTitle.trim() || rename.isPending} onClick={() => rename.mutate({ id: renaming.id, title: renameTitle.trim() })}>
                {rename.isPending ? <Spinner size={14} /> : null} 保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 移动弹窗 */}
      {moving !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" onClick={() => setMoving(null)}>
          <div className="card flex max-h-[70vh] w-full max-w-[460px] flex-col rounded-2xl p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-1 font-display text-16px font-650 text-ink">移动「{moving.title}」</h3>
            <p className="mb-4 text-12px text-muted">选择目标父页面</p>
            <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
              <button
                onClick={() => setMoveTarget(null)}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-13px transition ${moveTarget === null ? 'bg-violet-light font-650 text-violet' : 'text-ink hover:bg-surface'}`}
              >
                <BookOpen size={14} className="text-violet" /> 根页面
              </button>
              {moveCandidates.map((it) => {
                const d = depthOf(toc.data ?? [], it.id);
                return (
                  <button
                    key={it.id}
                    onClick={() => setMoveTarget(it.id)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-13px transition ${moveTarget === it.id ? 'bg-violet-light font-650 text-violet' : 'text-ink hover:bg-surface'}`}
                    style={{ paddingLeft: 8 + d * 16 }}
                  >
                    <BookOpen size={14} className={moveTarget === it.id ? 'text-violet' : 'text-muted'} />
                    <span className="truncate">{it.title}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn btn-ghost" onClick={() => setMoving(null)}>取消</button>
              <button className="btn btn-primary" disabled={move.isPending} onClick={() => move.mutate({ id: moving.id, parentId: moveTarget })}>
                {move.isPending ? <Spinner size={14} /> : null} 移动
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && del.mutate(deleting.id)}
        title="删除知识页"
        message={`将删除「${deleting?.title}」及其所有子页面，确定吗？`}
        loading={del.isPending}
      />
    </aside>
  );
}