import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { docApi, teamApi, aiApi } from '../lib/api';
import { Empty, Spinner, useToast, ConfirmModal, Modal } from '../components/ui';
import { FileText, Folder, FolderOpen, Plus, Trash2, ChevronRight, Home, ChevronDown, Upload, Sparkles, Table2, LayoutTemplate } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { parseDocFile, IMPORT_ACCEPT } from '../lib/docimport';
import type { Document, AiOrganizeNode, AiOrganizeFileInput } from '@pulse-space/contracts';

// 读取文件供 AI 分类：优先用解析得到的 markdown 作为内容，失败则回退原始文本
async function readFileForAI(file: File): Promise<AiOrganizeFileInput> {
  let content = '';
  try {
    content = (await parseDocFile(file)).markdown;
  } catch {
    content = await file.text().catch(() => '');
  }
  // 服务端会再截断，此处提前限量以控制请求体
  return { name: file.name, content: content.slice(0, 4000) };
}

interface PathItem {
  id: string;
  title: string;
}

export function DocumentsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const toast = useToast();
  const qc = useQueryClient();

  // 支持从 /docs?team=<id> 进入团队文档作用域
  const teamFromQuery = searchParams.get('team') ?? undefined;
  const [scope, setScope] = useState<'personal' | 'team'>('personal');
  const [teamId, setTeamId] = useState<string | undefined>(undefined);
  const [path, setPath] = useState<PathItem[]>([]);
  const [deleting, setDeleting] = useState<Document | null>(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [folderModalOpen, setFolderModalOpen] = useState(false);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const organizeAbortRef = useRef<AbortController | null>(null);

  // 卸载（含刷新页面 / 关闭浏览器）时自动取消未完成的上传给 AI 分析
  useEffect(() => () => organizeAbortRef.current?.abort(), []);
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [isOrganizing, setIsOrganizing] = useState(false);
  const [organizeModalOpen, setOrganizeModalOpen] = useState(false);
  const [organizeTree, setOrganizeTree] = useState<AiOrganizeNode[]>([]);
  const [organizeFiles, setOrganizeFiles] = useState<AiOrganizeFileInput[]>([]);
  const uploadRef = useRef<HTMLInputElement | null>(null);
  const aiUploadRef = useRef<HTMLInputElement | null>(null);

  const currentFolderId = path.length > 0 ? path[path.length - 1].id : undefined;
  const currentFolderTitle = path.length > 0 ? path[path.length - 1].title : '我的文档';

  const teams = useQuery({ queryKey: ['teams'], queryFn: () => teamApi.list() });
  const docs = useQuery({
    queryKey: ['docs', scope, teamId, currentFolderId ?? 'root'],
    // doc + sheet 在同一文档列表展示（kind 支持逗号分隔）
    queryFn: () => docApi.list({ scope, teamId, kind: 'doc,sheet', parent: currentFolderId }),
  });

  const createDoc = useMutation({
    mutationFn: (title: string) =>
      docApi.create({
        scope,
        team_id: scope === 'team' ? teamId : undefined,
        kind: 'doc',
        parent_id: currentFolderId,
        title,
        content: '',
      }),
    onSuccess: (doc) => {
      toast('已创建文档');
      qc.invalidateQueries({ queryKey: ['docs'] });
      navigate(`/docs/${doc.id}`);
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });

  // 新建表格：type=sheet 的文档，进入表格编辑器
  const createSheet = useMutation({
    mutationFn: (title: string) =>
      docApi.create({
        scope,
        team_id: scope === 'team' ? teamId : undefined,
        kind: 'sheet',
        parent_id: currentFolderId,
        title,
        content: '',
      }),
    onSuccess: (doc) => {
      toast('已创建表格');
      qc.invalidateQueries({ queryKey: ['docs'] });
      navigate(`/sheets/${doc.id}`);
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });

  const createFolder = useMutation({
    mutationFn: (title: string) =>
      docApi.create({
        scope,
        team_id: scope === 'team' ? teamId : undefined,
        kind: 'doc',
        parent_id: currentFolderId,
        title,
        content: '',
        is_folder: true,
      }),
    onSuccess: () => {
      toast('已创建文件夹');
      setFolderModalOpen(false);
      qc.invalidateQueries({ queryKey: ['docs'] });
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });

  const del = useMutation({
    mutationFn: (id: string) => docApi.remove(id),
    onSuccess: () => {
      toast(deleting?.is_folder ? '已删除文件夹' : '已删除文档');
      // 若删除的是当前所在文件夹（路径中的某个节点），退回该节点的上级
      if (deleting) {
        const idx = path.findIndex((p) => p.id === deleting.id);
        if (idx >= 0) setPath(path.slice(0, idx));
      }
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ['docs'] });
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });

  const switchScope = (s: 'personal' | 'team') => {
    setScope(s);
    setTeamId(s === 'team' ? teamFromQuery : undefined);
    setPath([]);
  };

  const enter = (d: Document) => {
    if (d.is_folder) {
      setPath((p) => [...p, { id: d.id, title: d.title }]);
    } else {
      // 表格类型进入表格编辑器，否则进入文档编辑器
      navigate(d.kind === 'sheet' ? `/sheets/${d.id}` : `/docs/${d.id}`);
    }
  };

  // 批量上传：逐个解析文件并创建为当前目录下的文档
  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(files.length);
    let ok = 0;
    let fail = 0;
    for (const file of Array.from(files)) {
      try {
        const r = await parseDocFile(file);
        await docApi.create({
          scope,
          team_id: scope === 'team' ? teamId : undefined,
          kind: 'doc',
          parent_id: currentFolderId,
          title: r.title,
          content: r.markdown,
        });
        ok++;
      } catch {
        fail++;
      }
    }
    setUploading(0);
    qc.invalidateQueries({ queryKey: ['docs'] });
    if (uploadRef.current) uploadRef.current.value = '';
    if (fail === 0) {
      toast(`已上传并解析 ${ok} 个文件`);
    } else {
      toast(`已上传 ${ok} 个，${fail} 个解析失败`, 'error');
    }
  };

  // 上传给 AI：选文件（≤10）→ 发送给 AI 分类 → 弹出可确认的文件夹树
  const handleAiFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    if (aiUploadRef.current) aiUploadRef.current.value = '';
    if (files.length > 10) {
      toast('上传给 AI 每次最多选择 10 个文件', 'error');
      return;
    }
    setIsOrganizing(true);
    const aborter = new AbortController();
    organizeAbortRef.current = aborter;
    try {
      const inputs = await Promise.all(files.map(readFileForAI));
      const res = await aiApi.organize(
        {
          scope,
          team_id: scope === 'team' ? teamId : undefined,
          parent_id: currentFolderId,
          files: inputs,
        },
        aborter.signal,
      );
      if (!res.tree.length) throw new Error('AI 未返回可整理的文件夹结构');
      setOrganizeFiles(inputs); // 供确认后按文件名匹配原始内容
      setOrganizeTree(res.tree);
      setOrganizeModalOpen(true);
    } catch (e) {
      // 用户点击「取消」或刷新/关闭页面导致的取消，不当作错误提示
      if ((e as Error).name === 'AbortError') {
        toast('已取消本次整理', 'info');
      } else {
        toast((e as Error).message || 'AI 整理失败，请稍后重试', 'error');
      }
    } finally {
      organizeAbortRef.current = null;
      setIsOrganizing(false);
    }
  };

  // 取消当前上传给 AI 的分析
  const cancelOrganize = () => organizeAbortRef.current?.abort();

  // 按 AI 返回的文件夹树递归创建（文件夹 is_folder=true，文件 is_folder=false）
  const createNodes = async (
    nodes: AiOrganizeNode[],
    parentId: string | undefined,
    contentMap: Map<string, string>,
    onOk: () => void,
    onFail: () => void,
  ) => {
    for (const node of nodes) {
      try {
        if (node.type === 'folder') {
          const folder = await docApi.create({
            scope,
            team_id: scope === 'team' ? teamId : undefined,
            kind: 'doc',
            parent_id: parentId,
            title: node.name,
            is_folder: true,
          });
          onOk();
          await createNodes(node.children ?? [], folder.id, contentMap, onOk, onFail);
        } else {
          await docApi.create({
            scope,
            team_id: scope === 'team' ? teamId : undefined,
            kind: 'doc',
            parent_id: parentId,
            title: node.name,
            content: contentMap.get(node.name) ?? '',
          });
          onOk();
        }
      } catch {
        onFail();
      }
    }
  };

  const confirmOrganize = useMutation({
    mutationFn: async () => {
      const contentMap = new Map(organizeFiles.map((f) => [f.name, f.content]));
      let ok = 0;
      let fail = 0;
      await createNodes(organizeTree, currentFolderId, contentMap, () => ok++, () => fail++);
      return { ok, fail };
    },
    onSuccess: ({ ok, fail }) => {
      qc.invalidateQueries({ queryKey: ['docs'] });
      setOrganizeModalOpen(false);
      setOrganizeTree([]);
      setOrganizeFiles([]);
      if (fail === 0) toast(`已按 AI 整理创建 ${ok} 个文件夹/文件`);
      else toast(`已创建 ${ok} 个，${fail} 个失败`, 'error');
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });

  const rows = docs.data ?? [];

  return (
    <div className="mx-auto max-w-1100 px-8 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-26px font-700 text-ink">我的文档</h1>
          <p className="mt-1 text-13px text-muted">在线编写 Markdown，用文件夹整理你的文档</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
          <button
            className="btn"
            onClick={() => setUploadMenuOpen((o) => !o)}
            disabled={uploading > 0 || isOrganizing}
            title="上传文件，或用 AI 将文件整理到文件夹"
          >
            {uploading > 0 ? <Spinner size={14} /> : isOrganizing ? <Spinner size={14} /> : <Upload size={15} />}
            {uploading > 0 ? `上传中（剩余 ${uploading}）` : isOrganizing ? 'AI 分析中…' : '上传'}
            <ChevronDown size={14} className={`transition-transform ${uploadMenuOpen ? 'rotate-180' : ''}`} />
          </button>
          {uploadMenuOpen && (
            <>
              {/* 点击外部关闭 */}
              <div className="fixed inset-0 z-10" onClick={() => setUploadMenuOpen(false)} />
              <div className="absolute right-0 top-full z-20 mt-1 w-52 overflow-hidden rounded-xl border border-line bg-white py-1 shadow-card">
                <button
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-13px font-650 text-ink transition hover:bg-violet-light hover:text-violet"
                  onClick={() => { setUploadMenuOpen(false); uploadRef.current?.click(); }}
                >
                  <Upload size={15} className="text-violet" /> 上传文件
                </button>
                <button
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-13px font-650 text-ink transition hover:bg-violet-light hover:text-violet"
                  onClick={() => { setUploadMenuOpen(false); aiUploadRef.current?.click(); }}
                >
                  <Sparkles size={15} className="text-violet" /> 上传给 AI
                </button>
              </div>
            </>
          )}
        </div>
          <input
            ref={uploadRef}
            type="file"
            accept={IMPORT_ACCEPT}
            multiple
            className="hidden"
            onChange={(e) => handleUpload(e.target.files)}
            disabled={uploading > 0}
          />
          <input
            ref={aiUploadRef}
            type="file"
            accept={IMPORT_ACCEPT}
            multiple
            className="hidden"
            onChange={(e) => handleAiFiles(e.target.files)}
            disabled={isOrganizing}
          />
          <div className="relative">
          <button
            className="btn btn-primary"
            onClick={() => setCreateMenuOpen((o) => !o)}
            disabled={createDoc.isPending}
          >
            {createDoc.isPending ? <Spinner size={14} /> : <Plus size={15} />} 新建
            <ChevronDown size={14} className={`transition-transform ${createMenuOpen ? 'rotate-180' : ''}`} />
          </button>
          {createMenuOpen && (
            <>
              {/* 点击外部关闭 */}
              <div className="fixed inset-0 z-10" onClick={() => setCreateMenuOpen(false)} />
              <div className="absolute right-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-xl border border-line bg-white py-1 shadow-card">
                <button
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-13px font-650 text-ink transition hover:bg-violet-light hover:text-violet"
                  onClick={() => { setCreateMenuOpen(false); createDoc.mutate('未命名文档'); }}
                >
                  <FileText size={15} className="text-violet" /> 新建文档
                </button>
                <button
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-13px font-650 text-ink transition hover:bg-violet-light hover:text-violet"
                  onClick={() => { setCreateMenuOpen(false); createSheet.mutate('未命名表格'); }}
                >
                  <Table2 size={15} className="text-violet" /> 新建表格
                </button>
                <button
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-13px font-650 text-ink transition hover:bg-violet-light hover:text-violet"
                  onClick={() => { setCreateMenuOpen(false); setFolderModalOpen(true); }}
                >
                  <Folder size={15} className="text-violet" /> 新增文件夹
                </button>
                <button
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-13px font-650 text-ink transition hover:bg-violet-light hover:text-violet"
                  onClick={() => { setCreateMenuOpen(false); setTemplateOpen(true); }}
                >
                  <LayoutTemplate size={15} className="text-violet" /> 从模板新建
                </button>
              </div>
            </>
          )}
        </div>
        </div>
      </div>

      {/* 作用域切换 */}
      <div className="mb-5 flex items-center gap-2">
        {(['personal', 'team'] as const).map((s) => (
          <button
            key={s}
            onClick={() => switchScope(s)}
            className={`rounded-full px-4 py-1.5 text-12px font-650 transition ${
              scope === s ? 'bg-violet text-white' : 'bg-white text-muted border border-line hover:text-violet'
            }`}
          >
            {s === 'personal' ? '个人文档' : '团队文档'}
          </button>
        ))}
        {scope === 'team' && (
          <select
            className="form-input ml-2 w-52 py-1.5"
            value={teamId ?? ''}
            onChange={(e) => {
              setTeamId(e.target.value || undefined);
              setPath([]);
            }}
          >
            <option value="">选择团队</option>
            {(teams.data ?? []).map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* 面包屑导航：可逐级返回上级 */}
      <div className="mb-4 flex items-center gap-1 text-13px">
        <button
          onClick={() => setPath([])}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1 font-600 text-muted transition hover:bg-surface hover:text-violet"
          title="返回顶层"
        >
          <Home size={14} /> 我的文档
        </button>
        {path.map((p, i) => (
          <span key={p.id} className="flex items-center gap-1">
            <ChevronRight size={13} className="text-line" />
            <button
              onClick={() => {
                if (i < path.length - 1) setPath(path.slice(0, i + 1));
              }}
              title={i < path.length - 1 ? '返回上级' : '当前文件夹'}
              className={`rounded-lg px-2 py-1 font-600 transition hover:bg-surface hover:text-violet ${
                i === path.length - 1 ? 'text-ink' : 'text-muted'
              }`}
            >
              <span className="flex items-center gap-1.5">
                {i === path.length - 1 ? (
                  <FolderOpen size={14} className="text-violet" />
                ) : (
                  <Folder size={14} className="text-violet" />
                )}
                {p.title}
              </span>
            </button>
          </span>
        ))}
      </div>

      {docs.isLoading ? (
        <div className="py-16 text-center"><Spinner size={22} /></div>
      ) : rows.length === 0 ? (
        <div className="card px-6 py-14">
          <Empty
            icon="/pulse-documents.svg"
            title={`「${currentFolderTitle}」里还没有内容`}
            desc="点击右上角「新建文档」或「新增文件夹」开始整理"
          />
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-line text-12px font-650 text-muted">
                <th className="px-5 py-3 font-650">名称</th>
                <th className="w-32 px-5 py-3 font-650">类型</th>
                <th className="w-44 px-5 py-3 font-650">更新时间</th>
                <th className="w-16 px-5 py-3 text-right font-650">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((d) => (
                <tr key={d.id} onClick={() => enter(d)} className="group cursor-pointer transition hover:bg-surface">
                  <td className="px-5 py-3">
                    <span className="flex items-center gap-3 text-14px font-600 text-ink">
                      {d.is_folder ? (
                        <Folder size={17} className="shrink-0 text-violet" />
                      ) : d.kind === 'sheet' ? (
                        <Table2 size={17} className="shrink-0 text-teal" />
                      ) : (
                        <FileText size={17} className="shrink-0 text-violet" />
                      )}
                      <span className="truncate">{d.title}</span>
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <span className={
                      d.is_folder
                        ? 'inline-flex items-center rounded-full bg-violet-light px-2 py-0.5 text-11px font-650 text-violet'
                        : d.kind === 'sheet'
                          ? 'inline-flex items-center rounded-full bg-teal/15 px-2 py-0.5 text-11px font-650 text-teal'
                          : 'inline-flex items-center rounded-full bg-cyan/15 px-2 py-0.5 text-11px font-650 text-cyan'
                    }>
                      {d.is_folder ? '文件夹' : d.kind === 'sheet' ? '表格' : '文档'}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-12px text-muted">{new Date(d.updated_at).toLocaleString()}</td>
                  <td className="px-5 py-3 text-right">
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeleting(d); }}
                      className="rounded-lg p-1.5 text-muted transition hover:bg-coral/10 hover:text-coral"
                      title={d.is_folder ? '删除文件夹' : '删除文档'}
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 新增文件夹命名弹窗 */}
      <FolderNameModal
        open={folderModalOpen}
        submitting={createFolder.isPending}
        onClose={() => { setFolderModalOpen(false); }}
        onCreate={(name) => createFolder.mutate(name)}
      />

      {/* 模板中心 */}
      <TemplatesModal open={templateOpen} onClose={() => setTemplateOpen(false)} />

      {/* 上传给 AI 分析中的全屏 loading：阻塞其他文档操作，可取消 */}
      {isOrganizing && (
        <div className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-5 bg-black/40">
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-line bg-white px-10 py-8 shadow-2xl">
            <Spinner size={36} className="text-violet" />
            <p className="text-14px font-650 text-ink">AI 正在分析文件并整理文件夹结构…</p>
            <p className="text-12px text-muted">本过程将持续一段时间，期间请勿进行其他操作</p>
            <button
              className="btn mt-1"
              onClick={cancelOrganize}
            >
              取消此次上传
            </button>
          </div>
        </div>
      )}

      {/* AI 整理结果确认弹窗 */}
      <Modal
        open={organizeModalOpen}
        width={620}
        onClose={() => {
          if (confirmOrganize.isPending) return;
          setOrganizeModalOpen(false);
          setOrganizeTree([]);
          setOrganizeFiles([]);
        }}
        title="AI 整理结果确认"
      >
        <p className="text-13px text-muted">
          AI 建议按以下结构整理 {organizeFiles.length} 个文件，确认后将在此目录批量创建文件夹与文档。
        </p>
        <div className="mt-3 max-h-80 overflow-auto rounded-xl border border-line bg-white p-2">
          <OrganizeTree nodes={organizeTree} />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            className="btn btn-ghost"
            disabled={confirmOrganize.isPending}
            onClick={() => { setOrganizeModalOpen(false); setOrganizeTree([]); setOrganizeFiles([]); }}
          >
            取消
          </button>
          <button
            className="btn btn-primary"
            disabled={confirmOrganize.isPending}
            onClick={() => confirmOrganize.mutate()}
          >
            {confirmOrganize.isPending ? <Spinner size={14} /> : null} 确认整理
          </button>
        </div>
      </Modal>

      <ConfirmModal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && del.mutate(deleting.id)}
        title={deleting?.is_folder ? '删除文件夹' : '删除文档'}
        message={
          deleting?.is_folder
            ? `将删除文件夹「${deleting.title}」及其中所有内容，删除后不可恢复，确定吗？`
            : '删除后不可恢复，确定删除这篇文档吗？'
        }
        loading={del.isPending}
      />
    </div>
  );
}

// ===== 模板中心弹窗 =====
function TemplatesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const templates = useQuery({ queryKey: ['doc-templates'], queryFn: () => docApi.templates(), enabled: open });

  const useTemplate = useMutation({
    mutationFn: (tid: string) => docApi.useTemplate(tid),
    onSuccess: (doc) => {
      toast('已从模板创建');
      qc.invalidateQueries({ queryKey: ['docs'] });
      onClose();
      navigate(doc.kind === 'sheet' ? `/sheets/${doc.id}` : doc.kind === 'wiki' ? `/wiki/${doc.id}` : `/docs/${doc.id}`);
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });

  const removeTemplate = useMutation({
    mutationFn: (tid: string) => docApi.removeTemplate(tid),
    onSuccess: () => {
      toast('模板已删除');
      qc.invalidateQueries({ queryKey: ['doc-templates'] });
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });

  return (
    <Modal open={open} onClose={onClose} title="从模板新建" width={520}>
      {templates.isLoading ? (
        <div className="py-10 text-center"><Spinner size={18} /></div>
      ) : (templates.data ?? []).length === 0 ? (
        <p className="py-10 text-center text-13px text-muted">
          还没有模板。在文档编辑器的「更多」菜单中可将当前文档「另存为模板」
        </p>
      ) : (
        <div className="max-h-96 space-y-2 overflow-y-auto">
          {(templates.data ?? []).map((t) => (
            <div key={t.id} className="group flex items-center gap-3 rounded-xl border border-line p-3 transition hover:border-violet-border">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-light text-violet">
                <LayoutTemplate size={16} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-13px font-650 text-ink">{t.title}</p>
                <p className="text-10px text-muted">{t.kind === 'sheet' ? '表格' : t.kind === 'wiki' ? '知识库' : '文档'} · {new Date(t.created_at).toLocaleDateString()}</p>
              </div>
              <button
                className="btn btn-soft shrink-0"
                disabled={useTemplate.isPending}
                onClick={() => useTemplate.mutate(t.id)}
              >
                使用
              </button>
              <button
                className="shrink-0 rounded p-1.5 text-muted opacity-0 transition hover:text-coral group-hover:opacity-100"
                title="删除模板"
                onClick={() => removeTemplate.mutate(t.id)}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

function FolderNameModal({
  open,
  submitting,
  onClose,
  onCreate,
}: {
  open: boolean;
  submitting: boolean;
  onClose: () => void;
  onCreate: (name: string) => void;
}) {
  const [name, setName] = useState('');
  const submit = () => {
    if (!name.trim() || submitting) return;
    onCreate(name.trim());
    setName('');
  };
  return (
    <Modal open={open} onClose={onClose} title="新增文件夹">
      <div className="form-group">
        <label>文件夹名称</label>
        <input
          className="form-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          placeholder="未命名文件夹"
          autoFocus
        />
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn btn-ghost" onClick={onClose}>取消</button>
        <button className="btn btn-primary" disabled={!name.trim() || submitting} onClick={submit}>
          {submitting ? <Spinner size={14} /> : null} 创建
        </button>
      </div>
    </Modal>
  );
}

// AI 整理结果：缩进树形展示（文件夹 Folder 图标、文件 FileText 图标）
function OrganizeTree({ nodes, depth = 0 }: { nodes: AiOrganizeNode[]; depth?: number }) {
  if (!nodes || nodes.length === 0) {
    return <p className="px-2 py-3 text-13px text-muted">尚未生成整理结果</p>;
  }
  return (
    <ul className="space-y-0.5">
      {nodes.map((n, i) => (
        <li key={`${depth}-${i}`}>
          <div
            className="flex items-center gap-2 rounded-lg px-2 py-1 text-13px transition hover:bg-surface"
            style={{ paddingLeft: 8 + depth * 18 }}
          >
            {n.type === 'folder' ? (
              <Folder size={15} className="shrink-0 text-violet" />
            ) : (
              <FileText size={15} className="shrink-0 text-cyan" />
            )}
            <span className="truncate font-600 text-ink">{n.name}</span>
          </div>
          {n.type === 'folder' && n.children && n.children.length > 0 && (
            <OrganizeTree nodes={n.children} depth={depth + 1} />
          )}
        </li>
      ))}
    </ul>
  );
}