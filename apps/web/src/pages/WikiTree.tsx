import { useMemo, useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { docApi, teamApi } from '../lib/api';
import { Empty, Spinner, useToast, ConfirmModal } from '../components/ui';
import {
  Library,
  Plus,
  ChevronRight,
  ChevronDown,
  Trash2,
  BookOpen,
  Pencil,
  Move,
  Search,
  Users,
} from 'lucide-react';
import type { Document, WikiTocItem } from '@pulse-space/contracts';

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

export function WikiTree() {
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [scope, setScope] = useState<'personal' | 'team'>('personal');
  const [teamId, setTeamId] = useState<string | undefined>(undefined);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<Document | null>(null);
  const [newModal, setNewModal] = useState(false);
  const [newParent, setNewParent] = useState<Document | null>(null);
  const [newTitle, setNewTitle] = useState('');
  // 重命名 / 移动
  const [renaming, setRenaming] = useState<Document | null>(null);
  const [renameTitle, setRenameTitle] = useState('');
  const [moving, setMoving] = useState<Document | null>(null);
  const [moveTarget, setMoveTarget] = useState<string | null>(null);
  // 搜索
  const [search, setSearch] = useState('');

  const teams = useQuery({ queryKey: ['teams'], queryFn: () => teamApi.list() });

  // 团队 Tab 下默认选中排名第一的团队（未手动选择时）
  useEffect(() => {
    if (scope === 'team' && !teamId && (teams.data ?? []).length > 0) {
      setTeamId(teams.data![0].id);
      resetTree();
    }
  }, [scope, teamId, teams.data]);
  // 顶层（树结构，懒加载）
  const roots = useQuery({
    queryKey: ['wiki', scope, teamId],
    queryFn: () => docApi.list({ scope, teamId, kind: 'wiki' }),
  });
  // 全量平铺目录（概览 / 搜索 / 移动目标）
  const toc = useQuery({
    queryKey: ['wiki-toc', scope, teamId],
    queryFn: () => docApi.wikiToc({ scope, teamId }),
  });

  const [kidCache, setKidCache] = useState<Record<string, Document[]>>({});
  const [loadingKids, setLoadingKids] = useState<Set<string>>(new Set());

  const resetTree = () => {
    setExpanded(new Set());
    setKidCache({});
    setLoadingKids(new Set());
  };

  const loadChildren = async (parentId: string) => {
    if (kidCache[parentId] || loadingKids.has(parentId)) return;
    setLoadingKids((prev) => new Set(prev).add(parentId));
    try {
      const data = await docApi.list({ scope, teamId, kind: 'wiki', parent: parentId });
      setKidCache((prev) => ({ ...prev, [parentId]: data }));
    } finally {
      setLoadingKids((prev) => {
        const next = new Set(prev);
        next.delete(parentId);
        return next;
      });
    }
  };

  const create = useMutation({
    mutationFn: ({ title, parent_id }: { title: string; parent_id?: string }) =>
      docApi.create({ scope, team_id: scope === 'team' ? teamId : undefined, kind: 'wiki', parent_id, title, content: '' }),
    onSuccess: (doc) => {
      toast('已创建知识页');
      setNewModal(false);
      setNewParent(null);
      setNewTitle('');
      qc.invalidateQueries({ queryKey: ['wiki'] });
      qc.invalidateQueries({ queryKey: ['wiki-toc'] });
      resetTree();
      navigate(`/wiki/${doc.id}`);
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });

  const del = useMutation({
    mutationFn: (id: string) => docApi.remove(id),
    onSuccess: () => {
      toast('已删除');
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ['wiki'] });
      qc.invalidateQueries({ queryKey: ['wiki-toc'] });
      resetTree();
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });

  const rename = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => docApi.update(id, { title }),
    onSuccess: () => {
      toast('已重命名');
      setRenaming(null);
      qc.invalidateQueries({ queryKey: ['wiki'] });
      qc.invalidateQueries({ queryKey: ['wiki-toc'] });
      resetTree();
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });

  const move = useMutation({
    mutationFn: ({ id, parentId }: { id: string; parentId: string | null }) => docApi.update(id, { parent_id: parentId }),
    onSuccess: () => {
      toast('已移动');
      setMoving(null);
      qc.invalidateQueries({ queryKey: ['wiki'] });
      qc.invalidateQueries({ queryKey: ['wiki-toc'] });
      resetTree();
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });

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

  const renderNode = (doc: Document, depth: number) => {
    const kids = kidCache[doc.id] ?? [];
    const isOpen = expanded.has(doc.id);
    const isLoading = loadingKids.has(doc.id);
    return (
      <div key={doc.id}>
        <div
          className="group flex items-center gap-1 rounded-lg py-1.5 pr-2 transition hover:bg-surface"
          style={{ paddingLeft: depth * 16 + 8 }}
        >
          <button onClick={() => toggle(doc.id)} className="rounded p-0.5 text-muted hover:text-violet" title={isOpen ? '折叠' : '展开'}>
            {isLoading ? (
              <span className="inline-block h-3 w-3 animate-spin rounded-full border border-violet border-t-transparent" />
            ) : isOpen ? (
              <ChevronDown size={13} />
            ) : (
              <ChevronRight size={13} />
            )}
          </button>
          <Link to={`/wiki/${doc.id}`} className="flex min-w-0 flex-1 items-center gap-1.5 text-13px font-600 text-ink hover:text-violet">
            <BookOpen size={14} className="shrink-0 text-violet" />
            <span className="truncate">{doc.title}</span>
          </Link>
          <button
            onClick={() => { setNewParent(doc); setNewModal(true); }}
            className="rounded p-1 text-muted opacity-0 transition hover:bg-violet-light hover:text-violet group-hover:opacity-100"
            title="添加子页面"
          >
            <Plus size={13} />
          </button>
          <button
            onClick={() => { setRenaming(doc); setRenameTitle(doc.title); }}
            className="rounded p-1 text-muted opacity-0 transition hover:bg-violet-light hover:text-violet group-hover:opacity-100"
            title="重命名"
          >
            <Pencil size={13} />
          </button>
          <button
            onClick={() => { setMoving(doc); setMoveTarget(doc.parent_id); }}
            className="rounded p-1 text-muted opacity-0 transition hover:bg-violet-light hover:text-violet group-hover:opacity-100"
            title="移动"
          >
            <Move size={13} />
          </button>
          <button
            onClick={() => setDeleting(doc)}
            className="rounded p-1 text-muted opacity-0 transition hover:bg-coral/10 hover:text-coral group-hover:opacity-100"
            title="删除"
          >
            <Trash2 size={13} />
          </button>
        </div>
        {isOpen && kids.map((k) => renderNode(k, depth + 1))}
      </div>
    );
  };

  const keyword = search.trim().toLowerCase();
  const searchResults = useMemo(() => {
    if (!keyword) return [];
    return (toc.data ?? []).filter((it) => it.title.toLowerCase().includes(keyword));
  }, [keyword, toc.data]);

  // 移动弹窗的目标候选（排除自己及后代）
  const moveCandidates = useMemo(() => {
    if (!moving) return [];
    const exclude = descendantsOf(toc.data ?? [], moving.id);
    exclude.add(moving.id);
    return (toc.data ?? []).filter((it) => !exclude.has(it.id));
  }, [moving, toc.data]);

  const busy = create.isPending || del.isPending || rename.isPending || move.isPending;

  return (
    <div className="mx-auto max-w-1100 px-8 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 font-display text-26px font-700 text-ink">
            <Library size={24} className="text-violet" /> 知识库
          </h1>
          <p className="mt-1 text-13px text-muted">以树形结构沉淀团队与个人知识</p>
        </div>
        <button className="btn btn-primary" onClick={() => { setNewParent(null); setNewModal(true); }} disabled={busy}>
          {create.isPending ? <Spinner size={14} /> : <Plus size={15} />} 新建根页面
        </button>
      </div>

      <div className="mb-5 flex items-center gap-2">
        {(['personal', 'team'] as const).map((s) => (
          <button
            key={s}
            onClick={() => { setScope(s); setTeamId(undefined); setSearch(''); resetTree(); }}
            className={`rounded-full px-4 py-1.5 text-12px font-650 transition ${
              scope === s ? 'bg-violet text-white' : 'bg-white text-muted border border-line hover:text-violet'
            }`}
          >
            {s === 'personal' ? '个人知识库' : '团队知识库'}
          </button>
        ))}
      </div>

      {/* 团队选择：置于 Tab 下方，仅在团队 Tab 显示 */}
      {scope === 'team' && (
        <div className="mb-5 flex items-center gap-2">
          <Users size={15} className="shrink-0 text-muted" />
          <span className="shrink-0 whitespace-nowrap text-12px text-muted">团队</span>
          <select className="form-input min-w-0 flex-1 py-1.5 sm:w-44" value={teamId ?? ''} onChange={(e) => { setTeamId(e.target.value || undefined); setSearch(''); resetTree(); }}>
            {(teams.data ?? []).map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* 搜索框 */}
      <div className="relative mb-5">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input
          className="form-input !pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索知识页面标题…"
        />
      </div>

      {/* 搜索结果 */}
      {keyword ? (
        <div className="card p-4">
          <p className="mb-2 text-12px font-650 text-muted">共 {searchResults.length} 个匹配页面</p>
          {searchResults.length === 0 ? (
            <p className="py-8 text-center text-12px text-muted">未找到匹配的知识页面</p>
          ) : (
            <div className="space-y-0.5">
              {searchResults.map((it) => (
                <Link key={it.id} to={`/wiki/${it.id}`} className="flex items-center justify-between rounded-lg px-2 py-2 transition hover:bg-surface">
                  <span className="flex min-w-0 items-center gap-1.5 text-13px font-600 text-ink">
                    <BookOpen size={14} className="shrink-0 text-violet" />
                    <span className="truncate">{it.title}</span>
                  </span>
                  <span className="shrink-0 text-11px text-muted">{new Date(it.updated_at).toLocaleDateString()}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          {/* 概览：统计 + 最近更新 */}
          {(toc.data?.length ?? 0) > 0 && (
            <div className="mb-5">
              <div className="mb-2 text-12px font-650 text-muted">共 {toc.data!.length} 个知识页面</div>
              <div className="card p-4">
                <p className="mb-2 text-12px font-650 text-muted">最近更新</p>
                <div className="space-y-0.5">
                  {(toc.data ?? []).slice(0, 5).map((it) => (
                    <Link key={it.id} to={`/wiki/${it.id}`} className="flex items-center justify-between rounded-lg px-2 py-1.5 transition hover:bg-surface">
                      <span className="flex min-w-0 items-center gap-1.5 text-13px font-600 text-ink">
                        <BookOpen size={14} className="shrink-0 text-violet" />
                        <span className="truncate">{it.title}</span>
                      </span>
                      <span className="shrink-0 text-11px text-muted">{new Date(it.updated_at).toLocaleDateString()}</span>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          )}

          {roots.isLoading ? (
            <div className="py-16 text-center"><Spinner size={22} /></div>
          ) : (roots.data ?? []).length === 0 ? (
            <Empty icon="/pulse-organization.svg" title="知识库还是空的" desc="点击「新建根页面」开始沉淀知识" />
          ) : (
            <div className="card p-5">{(roots.data ?? []).map((r) => renderNode(r, 0))}</div>
          )}
        </>
      )}

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
      {(renaming !== null) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" onClick={() => setRenaming(null)}>
          <div className="card w-full max-w-[460px] rounded-2xl p-6" onClick={(e) => e.stopPropagation()}>
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
      {(moving !== null) && (
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
    </div>
  );
}