import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { docApi, streamJson, aiApi, authApi } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Spinner, useToast, Empty, ConfirmModal, Modal } from '../components/ui';
import { diffLines, diffStats } from '../lib/diff';
import type { DocumentVersion } from '@pulse-space/contracts';
import { WikiSidebar } from '../components/WikiSidebar';
import {
  ArrowLeft,
  Eye,
  Pencil,
  Trash2,
  Sparkles,
  FileDown,
  FileText,
  FilePlus,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Highlighter,
  Code,
  Code2,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  Minus,
  Link,
  Image,
  Table,
  Heading1,
  Heading2,
  Heading3,
  ListTree,
  MessageSquare,
  History,
  Share2,
  RotateCcw,
  Check,
  X,
  Search,
  Replace,
  Columns2,
  Sigma,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Presentation,
  Languages,
  GitCompare,
  LayoutPanelLeft,
  PanelLeftClose,
  PanelLeftOpen,
  Type,
  MessageSquareQuote,
  Copy,
  Scissors,
  MousePointer2,
  SquareCheckBig,
  Plus,
  ChevronRight,
  Eraser,
  CaseSensitive,
  Upload,
  MoreHorizontal,
  Send,
} from 'lucide-react';
import { parseDocFile, IMPORT_ACCEPT } from '../lib/docimport';
import { renderMarkdown, splitSlides, extractHeadings } from '../lib/docmd';
import {
  markdownToEditableHtml,
  editableHtmlToMarkdown,
  getCaretRect,
  wrapSelection,
  insertHtmlAtCaret,
  applyInlineStyle,
  richTextContent,
  escapeHtml,
  normalizePasteHtml,
  plainTextToHtml,
  RICH_BLOCK_TAGS,
  splitRichBlockAtCaret,
  getCurrentBlockTag,
  isInsideTableCell,
  tableHtml,
  currentTableCell,
  cellTable,
  tableColumnCount,
  cellColumnIndex,
  tableInsertColumn,
  tableRemoveColumn,
  tableInsertRow,
  tableRemoveRow,
  tableRemove,
  focusFirstCell,
  syncColgroup,
  stripInlineFontSize,
} from '../lib/richtext';
import {
  applyInline as applyInlineOp,
  applyBlock as applyBlockOp,
  insertAtCursor as insertAtCursorOp,
  toggleBlock as toggleBlockOp,
  toggleHeading as toggleHeadingOp,
  setAlign as setAlignOp,
  buildCommands,
  filterCommands,
  isMac,
  type SlashCommand,
} from '../lib/doctools';

const AI_ACTIONS: { key: string; label: string }[] = [
  { key: 'generate', label: 'AI 生成' },
  { key: 'continue', label: '续写' },
  { key: 'polish', label: '润色' },
  { key: 'summarize', label: '总结' },
];

const TRANSLATE_LANGS = ['英语', '日语', '韩语', '法语', '德语', '俄语', '西班牙语', '阿拉伯语', '中文'];

type RightTab = 'outline' | 'comments' | 'versions' | null;
type Heading = { level: number; text: string; index: number };
type UserHit = { id: string; name: string; email: string; avatar_url: string | null };

function ToolBtn({
  title,
  icon: Icon,
  active,
  danger,
  onClick,
}: {
  title: string;
  icon: typeof Bold;
  active?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-all duration-200 ${
        active
          ? 'bg-violet-light text-violet'
          : danger
            ? 'text-muted hover:bg-coral/10 hover:text-coral'
            : 'text-muted hover:bg-violet-light hover:text-violet'
      }`}
    >
      <Icon size={15} />
    </button>
  );
}

function Divider() {
  return <span className="mx-1 h-4 w-px shrink-0 bg-line" />;
}

function fmtTime(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ===== 文本域光标像素坐标（相对 textarea 外层容器） =====
function caretPositionIn(ta: HTMLTextAreaElement): { left: number; top: number } {
  const cs = getComputedStyle(ta);
  const mirror = document.createElement('div');
  mirror.style.cssText = `position:absolute;top:-9999px;left:-9999px;visibility:hidden;white-space:pre-wrap;overflow-wrap:break-word;font:${cs.font};font-size:${cs.fontSize};line-height:${cs.lineHeight};letter-spacing:${cs.letterSpacing};padding:${cs.padding};width:${ta.clientWidth}px;box-sizing:border-box;`;
  mirror.textContent = ta.value.slice(0, ta.selectionStart);
  document.body.appendChild(mirror);
  const span = document.createElement('span');
  span.textContent = '|';
  mirror.appendChild(span);
  const sr = span.getBoundingClientRect();
  const tr = ta.getBoundingClientRect();
  document.body.removeChild(mirror);
  const lh = parseFloat(cs.lineHeight) || 20;
  return { left: sr.left - tr.left, top: sr.top - tr.top + lh + 6 };
}

// ===== 行级 LCS 简易 diff（修订模式用） =====
function simpleDiff(oldText: string, newText: string): { type: 'same' | 'add' | 'del'; text: string }[] {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: { type: 'same' | 'add' | 'del'; text: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'same', text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: 'del', text: a[i] });
      i++;
    } else {
      out.push({ type: 'add', text: b[j] });
      j++;
    }
  }
  while (i < n) {
    out.push({ type: 'del', text: a[i] });
    i++;
  }
  while (j < m) {
    out.push({ type: 'add', text: b[j] });
    j++;
  }
  return out;
}

function SlashMenu({
  cmds,
  active,
  onSelect,
  style,
}: {
  cmds: SlashCommand[];
  active: number;
  onSelect: (c: SlashCommand) => void;
  style: React.CSSProperties;
}) {
  return (
    <div className="absolute z-30 w-64 overflow-hidden rounded-xl border border-line bg-white py-1 shadow-card" style={style}>
      <div className="border-b border-line px-3 py-1.5 text-11px font-650 text-muted">斜杠命令（支持拼音 / 缩写 / 英文）</div>
      <div className="max-h-72 overflow-y-auto py-1">
        {cmds.length === 0 && <div className="px-3 py-4 text-center text-12px text-muted">没有匹配的命令</div>}
        {cmds.map((c, i) => (
          <button
            key={c.key}
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(c);
            }}
            className={`flex w-full items-center gap-3 px-3 py-2 text-left text-12px transition ${i === active ? 'bg-violet-light text-violet' : 'text-ink hover:bg-surface'}`}
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-light text-13px font-700 text-violet">{c.icon}</span>
            <span className="min-w-0 flex-1">
              <span className="block font-650">{c.label}</span>
              <span className="block truncate font-mono text-10px text-muted">{c.hint}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function MentionMenu({
  users,
  active,
  onSelect,
  style,
}: {
  users: UserHit[];
  active: number;
  onSelect: (u: UserHit) => void;
  style: React.CSSProperties;
}) {
  return (
    <div className="absolute z-30 w-72 overflow-hidden rounded-xl border border-line bg-white py-1 shadow-card" style={style}>
      <div className="border-b border-line px-3 py-1.5 text-11px font-650 text-muted">@ 提及成员</div>
      <div className="max-h-72 overflow-y-auto py-1">
        {users.length === 0 && <div className="px-3 py-4 text-center text-12px text-muted">输入姓名 / 邮箱搜索成员</div>}
        {users.map((u, i) => (
          <button
            key={u.id}
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(u);
            }}
            className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition ${i === active ? 'bg-violet-light' : 'hover:bg-surface'}`}
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet to-violet-dark text-10px font-700 text-white">
              {u.name?.[0] ?? '?'}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-12px font-650 text-ink">{u.name}</span>
              <span className="block truncate text-10px text-muted">{u.email}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ===== 分享弹层 =====
function ShareMenu({ docId }: { docId: string }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  const share = useQuery({
    queryKey: ['doc-share', docId],
    queryFn: () => docApi.getShare(docId),
    enabled: open,
  });

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const setPermission = async (permission: 'read' | 'edit') => {
    try {
      await docApi.createShare(docId, permission);
      qc.invalidateQueries({ queryKey: ['doc-share', docId] });
      toast(permission === 'edit' ? '已开启分享（获得链接的人可编辑）' : '已开启分享（获得链接的人可阅读）');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const closeShare = async () => {
    try {
      await docApi.closeShare(docId);
      qc.invalidateQueries({ queryKey: ['doc-share', docId] });
      toast('已关闭分享');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const copyShareLink = async () => {
    const s = share.data;
    if (!s) return;
    const url = `${window.location.origin}/share/${s.token}`;
    try {
      await navigator.clipboard.writeText(url);
      toast('分享链接已复制');
    } catch {
      // 剪贴板不可用（如页面未聚焦）时降级提示
      toast(`复制失败，请手动复制：${url}`, 'error');
    }
  };

  const s = share.data;
  return (
    <div ref={ref} className="relative">
      <button
        className={`btn btn-ghost !px-2.5 ${s ? '!text-violet' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title="分享"
      >
        <Share2 size={15} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-72 rounded-xl border border-line bg-white p-4 shadow-card">
          <p className="mb-2 text-13px font-650 text-ink">链接分享</p>
          {share.isLoading ? (
            <div className="py-4 text-center"><Spinner size={16} /></div>
          ) : !s ? (
            <>
              <p className="mb-3 text-12px text-muted">开启后，获得链接的人无需加入团队即可访问此文档</p>
              <div className="flex gap-2">
                <button className="btn btn-soft flex-1" onClick={() => setPermission('read')}>开启（可阅读）</button>
                <button className="btn btn-soft flex-1" onClick={() => setPermission('edit')}>开启（可编辑）</button>
              </div>
            </>
          ) : (
            <>
              <div className="mb-2 flex items-center gap-2">
                <select
                  className="form-input flex-1 !py-1.5 text-12px"
                  value={s.permission}
                  onChange={(e) => setPermission(e.target.value as 'read' | 'edit')}
                >
                  <option value="read">获得链接的人可阅读</option>
                  <option value="edit">获得链接的人可编辑</option>
                </select>
              </div>
              <div className="flex gap-2">
                <button className="btn btn-primary flex-1 !py-1.5 text-12px" onClick={copyShareLink}>复制链接</button>
                <button className="btn btn-ghost !py-1.5 text-12px text-coral" onClick={closeShare}>关闭分享</button>
              </div>
              <p className="mt-2 break-all text-10px text-muted">{window.location.origin}/share/{s.token}</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ===== 反向链接弹窗 =====
function BacklinksModal({ docId, open, onClose }: { docId: string; open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const links = useQuery({
    queryKey: ['backlinks', docId],
    queryFn: () => docApi.backlinks(docId),
    enabled: open,
  });
  return (
    <Modal open={open} onClose={onClose} title="反向链接" width={480}>
      {links.isLoading ? (
        <div className="py-8 text-center"><Spinner size={18} /></div>
      ) : (links.data ?? []).length === 0 ? (
        <p className="py-8 text-center text-13px text-muted">暂无其他文档通过 [[双链]] 引用本文档</p>
      ) : (
        <div className="max-h-96 space-y-1 overflow-y-auto">
          {(links.data ?? []).map((d) => (
            <button
              key={d.id}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition hover:bg-surface"
              onClick={() => {
                onClose();
                navigate(d.kind === 'wiki' ? `/wiki/${d.id}` : d.kind === 'sheet' ? `/sheets/${d.id}` : `/docs/${d.id}`);
              }}
            >
              <FileText size={15} className="shrink-0 text-violet" />
              <span className="min-w-0 flex-1 truncate text-13px font-600 text-ink">{d.title}</span>
              <span className="text-10px text-muted">{new Date(d.updated_at).toLocaleDateString()}</span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

// ===== 版本对比视图（行级 diff） =====
function DiffView({ oldText, newText }: { oldText: string; newText: string }) {
  const lines = useMemo(() => diffLines(oldText, newText), [oldText, newText]);
  const stats = diffStats(lines);
  return (
    <div>
      <p className="mb-3 text-12px text-muted">
        <span className="font-650 text-green">+{stats.added} 行新增</span>
        <span className="mx-2">·</span>
        <span className="font-650 text-coral">-{stats.removed} 行删除</span>
        <span className="mx-2">·</span>
        左侧为历史版本，对比当前内容
      </p>
      <div className="max-h-[60vh] overflow-y-auto rounded-xl border border-line bg-surface/50 font-mono text-12px leading-6">
        {lines.map((l, i) => (
          <div
            key={i}
            className={
              l.type === 'add'
                ? 'bg-green/10 px-3 text-green'
                : l.type === 'del'
                  ? 'bg-coral/10 px-3 text-coral line-through'
                  : 'px-3 text-ink/80'
            }
          >
            <span className="mr-2 inline-block w-3 select-none text-muted">{l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' '}</span>
            {l.text || ' '}
          </div>
        ))}
      </div>
    </div>
  );
}

export function DocEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const isWiki = location.pathname.startsWith('/wiki');
  const [wikiTreeOpen, setWikiTreeOpen] = useState(true);

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [preview, setPreview] = useState(false);
  const [editStyle, setEditStyle] = useState<'rich' | 'md'>('rich');
  const [pageWide, setPageWide] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [aiRefDoc, setAiRefDoc] = useState(false); // 对话框「参考文档内容」开关：开启=基于整篇文档，关闭=仅基于选中文字
  // AI 对话对话框（单入口）
  const [aiChatOpen, setAiChatOpen] = useState(false);
  const [aiChatCtx, setAiChatCtx] = useState('');
  const [aiInput, setAiInput] = useState('');
  const [aiMsgs, setAiMsgs] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [aiChatBusy, setAiChatBusy] = useState(false);
  const aiChatInputRef = useRef<HTMLTextAreaElement | null>(null);
  const aiChatBodyRef = useRef<HTMLDivElement | null>(null);
  const [rightTab, setRightTab] = useState<RightTab>('outline');
  const [commentDraft, setCommentDraft] = useState('');
  const [commentSelection, setCommentSelection] = useState<{ start: number; text: string } | null>(null);
  const [versionNote, setVersionNote] = useState('');
  // 版本对比
  const [diffTarget, setDiffTarget] = useState<{ version: DocumentVersion; currentMd: string } | null>(null);
  // 反向链接
  const [backlinksOpen, setBacklinksOpen] = useState(false);

  // 斜杠命令
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState('');
  const [slashIdx, setSlashIdx] = useState(0);
  const [slashPos, setSlashPos] = useState({ left: 8, top: 8 });
  const slashRef = useRef<HTMLDivElement | null>(null);

  // 链接：内部弹窗配置（富文本 / markdown 两种模式共用）
  const linkModalRef = useRef<HTMLDivElement | null>(null);
  const linkSavedRangeRef = useRef<Range | null>(null);
  const [linkHover, setLinkHover] = useState<{ left: number; top: number; above: boolean } | null>(null);
  const linkHoverElRef = useRef<HTMLElement | null>(null);
  const linkEditElRef = useRef<HTMLElement | null>(null);
  const linkHoverTimer = useRef<number | undefined>(undefined);
  const linkBarRef = useRef<HTMLDivElement | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkMode, setLinkMode] = useState<'rich' | 'plain'>('rich');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkLabel, setLinkLabel] = useState('');

  // 表格：9×9 插入选择器
  const [tablePick, setTablePick] = useState<{ left: number; top: number } | null>(null);
  const [tablePickRC, setTablePickRC] = useState({ r: 3, c: 3 });
  const tablePickRef = useRef<HTMLDivElement | null>(null);

  // 表格：当前选中单元格（高亮 + 浮动工具条）
  const [activeCell, setActiveCell] = useState<HTMLElement | null>(null);
  const [tableBar, setTableBar] = useState(false);
  // 选中文字悬浮工具栏（飞书式）：位置（选区矩形几何）+ 当前展开的下拉菜单
  const [textBar, setTextBar] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [textBarMenu, setTextBarMenu] = useState<'format' | 'size' | 'color' | 'bg' | null>(null);
  const textBarRef = useRef<HTMLDivElement | null>(null);
  const textBarPosRef = useRef<{ left: number; top: number; width: number; height: number } | null>(null);

  // @ 提及
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionIdx, setMentionIdx] = useState(0);
  const [mentionPos, setMentionPos] = useState({ left: 8, top: 8 });
  const [mentionUsers, setMentionUsers] = useState<UserHit[]>([]);
  const mentionRef = useRef<HTMLDivElement | null>(null);

  // 查找替换
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [replaceQuery, setReplaceQuery] = useState('');
  const [findIdx, setFindIdx] = useState(0);
  const findRef = useRef<HTMLDivElement | null>(null);

  // 演示 / 修订 / 翻译
  const [presenting, setPresenting] = useState(false);
  const [presentIdx, setPresentIdx] = useState(0);
  const [revisionMode, setRevisionMode] = useState(false);
  const [translatePanel, setTranslatePanel] = useState<{
    text: string;
    target: string;
    translated: string;
    mode: 'full' | 'fragment';
    selStart: number;
    selEnd: number;
  } | null>(null);
  const [translating, setTranslating] = useState(false);

  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const commentInputRef = useRef<HTMLInputElement | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstLoad = useRef(true);
  const lastSaved = useRef('');
  // 富文本编辑
  const richRef = useRef<HTMLDivElement | null>(null);
  const richWrapRef = useRef<HTMLDivElement | null>(null);
  const richMdRef = useRef<string>('');
  const toolBarRef = useRef<HTMLDivElement | null>(null);
  const [richVer, setRichVer] = useState(0);
  // 选择性粘贴：右键菜单 + 当前粘贴方式（'keep' 保留原格式 / 'match' 匹配格式 / 'text' 仅文本）
  const pasteModeRef = useRef<'keep' | 'match' | 'text'>('keep');
  const [pasteMenu, setPasteMenu] = useState<{ x: number; y: number } | null>(null);
  const pasteRangeRef = useRef<Range | null>(null);

  const doc = useQuery({
    queryKey: ['doc', id],
    queryFn: () => docApi.get(id!),
    enabled: !!id,
  });

  const ancestors = useQuery({
    queryKey: ['doc-ancestors', id],
    queryFn: () => docApi.ancestors(id!),
    enabled: !!id && isWiki,
  });

  const versions = useQuery({
    queryKey: ['doc-versions', id],
    queryFn: () => docApi.versions(id!),
    enabled: !!id && rightTab === 'versions',
  });

  const comments = useQuery({
    queryKey: ['doc-comments', id],
    queryFn: () => docApi.comments(id!),
    enabled: !!id && rightTab === 'comments',
  });

  // 加载文档
  useEffect(() => {
    if (doc.data) {
      setTitle(doc.data.title);
      setContent(doc.data.content);
      lastSaved.current = doc.data.content;
      firstLoad.current = true;
    }
  }, [doc.data?.id]);

  // 文件夹不应在编辑器中打开，直接回到文档列表
  useEffect(() => {
    if (doc.data?.is_folder) {
      navigate('/docs');
    }
  }, [doc.data?.is_folder]);

  // ===== 自动保存（防抖 1s） =====
  const persist = (t: string, c: string) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await docApi.update(id!, { title: t, content: c });
        lastSaved.current = c;
        broadcastMd(c);
        qc.invalidateQueries({ queryKey: ['doc', id] });
        qc.invalidateQueries({ queryKey: ['docs'] });
      } catch (e) {
        toast((e as Error).message, 'error');
      }
    }, 1000);
  };

  const onTitle = (v: string) => {
    setTitle(v);
    if (!firstLoad.current) persist(v, content);
    else firstLoad.current = false;
  };
  const onContent = (v: string) => {
    setContent(v);
    if (!firstLoad.current) persist(title, v);
    else firstLoad.current = false;
  };

  // ===== 富文本编辑辅助 =====
  const readRichMd = () => editableHtmlToMarkdown(richRef.current?.innerHTML ?? '');
  const renderRich = (md: string) => {
    if (!richRef.current) return;
    richRef.current.innerHTML = markdownToEditableHtml(md);
    richMdRef.current = md;
  };
  // 实时内容：富文本模式取编辑器 DOM（DOM 尚未渲染时回退到 content 状态，避免给 AI 发送空内容）
  const getLiveMd = () => {
    if (editStyle === 'rich' && richRef.current) {
      const md = readRichMd();
      return md.trim() ? md : content;
    }
    return content;
  };
  // 同步富文本内容到 content 状态（预览/导出/翻译前调用）
  const syncFromRich = () => {
    if (editStyle !== 'rich' || !richRef.current) return;
    const md = readRichMd();
    if (md !== content) setContent(md);
  };
  const togglePreview = () => {
    if (!preview) syncFromRich();
    setPreview((p) => !p);
  };

  // 富文本 ↔ Markdown 源码切换
  const switchEditStyle = (s: 'rich' | 'md') => {
    if (s === editStyle) return;
    if (s === 'md') {
      const md = richRef.current ? readRichMd() : content;
      setContent(md);
    }
    setEditStyle(s);
  };

  // 富文本内容外部变化（AI/恢复版本/翻译）时重新渲染；从预览/Markdown 源码切回编辑时恢复内容到 DOM
  useEffect(() => {
    if (editStyle !== 'rich' || !richRef.current) return;
    // 编辑区被重新挂载（从预览/源码切回）且 DOM 为空时，把 content 渲染回编辑器，避免正文丢失
    if (richRef.current.childElementCount === 0 && !richRef.current.textContent?.trim()) {
      renderRich(content);
      setRichVer((v) => v + 1);
      return;
    }
    if (richMdRef.current === content) return;
    renderRich(content);
    setRichVer((v) => v + 1);
  }, [content, editStyle, preview]);

  // 富文本自动保存（防抖 1s，不重置光标）
  const richSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (editStyle !== 'rich' || !richRef.current) return;
    const el = richRef.current;
    const onInput = () => {
      // 首次编辑：清除 firstLoad 标记，不触发保存（与文本模式行为一致）
      if (firstLoad.current) {
        firstLoad.current = false;
        return;
      }
      setRichVer((v) => v + 1);
      if (richSaveTimer.current) clearTimeout(richSaveTimer.current);
      richSaveTimer.current = setTimeout(() => {
        const md = readRichMd();
        lastSaved.current = md;
        docApi
          .update(id!, { title, content: md })
          .then(() => {
            broadcastMd(md);
            qc.invalidateQueries({ queryKey: ['doc-versions', id] });
          })
          .catch(() => {});
      }, 1000);
    };
    el.addEventListener('input', onInput);
    return () => {
      el.removeEventListener('input', onInput);
      if (richSaveTimer.current) clearTimeout(richSaveTimer.current);
    };
  }, [editStyle, id, title]);

  const saveNow = async () => {
    setSaving(true);
    const md = getLiveMd();
    if (editStyle === 'rich' && md !== content) setContent(md);
    try {
      await docApi.update(id!, { title, content: md });
      lastSaved.current = md;
      broadcastMd(md);
      qc.invalidateQueries({ queryKey: ['doc-versions', id] });
      toast('已保存');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  // ===== 本地文档导入（md / pdf / docx） =====
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [importing, setImporting] = useState(false);
  const handleImport = async (f: File | undefined) => {
    if (!f) return;
    setImporting(true);
    try {
      const { title, markdown } = await parseDocFile(f);
      // 写入标题与内容并立即持久化；富文本受上方 effect 监听 content 变更自动重新渲染
      setTitle(title);
      setContent(markdown);
      if (firstLoad.current) firstLoad.current = false;
      persist(title, markdown);
      toast(`已导入「${f.name}」并解析为在线文档`);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setImporting(false);
      if (importInputRef.current) importInputRef.current.value = '';
    }
  };

  // ===== 选择性粘贴（右键菜单 + 原生粘贴拦截） =====

  // 右键：打开自定义粘贴菜单，同时记住当前光标选区
  const openPasteMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const sel = window.getSelection();
    pasteRangeRef.current = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
    setPasteMenu({
      x: Math.min(e.clientX, window.innerWidth - 200),
      y: Math.min(e.clientY, window.innerHeight - 170),
    });
  };

  // 恢复右键时记录的选区（保证粘贴落到正确位置）
  const restorePasteRange = () => {
    const sel = window.getSelection();
    if (!sel) return;
    if (pasteRangeRef.current) {
      sel.removeAllRanges();
      sel.addRange(pasteRangeRef.current);
    }
  };

  // 右键菜单的编辑类操作：复制 / 剪切 / 删除 / 选择所在块 / 全选
  const runEditCmd = (cmd: 'copy' | 'cut' | 'delete' | 'select' | 'selectAll') => {
    setPasteMenu(null);
    if (editStyle !== 'rich' || !richRef.current) return;
    restorePasteRange();
    const sel = window.getSelection();
    if (!sel) return;
    switch (cmd) {
      case 'copy':
        document.execCommand('copy');
        break;
      case 'cut':
        document.execCommand('cut');
        break;
      case 'delete':
        document.execCommand('delete');
        break;
      case 'select': {
        // 选择光标所在的整块内容（段落/标题/列表项等）
        const node = sel.anchorNode?.parentElement?.closest(
          'p,h1,h2,h3,h4,h5,h6,blockquote,li,pre,ul,ol'
        ) as HTMLElement | null;
        if (node && richRef.current.contains(node)) {
          const range = document.createRange();
          range.selectNodeContents(node);
          sel.removeAllRanges();
          sel.addRange(range);
        }
        break;
      }
      case 'selectAll': {
        const range = document.createRange();
        range.selectNodeContents(richRef.current);
        sel.removeAllRanges();
        sel.addRange(range);
        break;
      }
    }
  };

  // 统一的粘贴落库逻辑
  const applyPaste = (mode: 'keep' | 'match' | 'text', html: string, text: string) => {
    restorePasteRange();
    if (mode === 'text') {
      insertHtmlAtCaret(plainTextToHtml(text || html));
    } else if (mode === 'match') {
      insertHtmlAtCaret(normalizePasteHtml(html || plainTextToHtml(text)));
    } else {
      insertHtmlAtCaret(html || plainTextToHtml(text));
    }
    requestAnimationFrame(scanPopupsRich);
    // 粘贴会修改 DOM，强制刷新富文本版本号，让大纲实时跟随
    setRichVer((v) => v + 1);
  };

  // 菜单项点击：按所选方式从剪贴板读取并插入
  const pasteFromMenu = async (mode: 'keep' | 'match' | 'text') => {
    setPasteMenu(null);
    pasteModeRef.current = mode;
    if (!richRef.current) return;
    try {
      if (!navigator.clipboard?.read) throw new Error('unsupported');
      const items = await navigator.clipboard.read();
      let html = '';
      let text = '';
      for (const item of items) {
        if (item.types.includes('text/html')) {
          const blob = await item.getType('text/html');
          html = await blob.text();
        }
        if (item.types.includes('text/plain')) {
          const blob = await item.getType('text/plain');
          text = await blob.text();
        }
      }
      applyPaste(mode, html, text);
    } catch {
      // 无剪贴板读取权限/浏览器不支持：切换为该方式后引导用 Ctrl+V 粘贴
      richRef.current.focus();
      toast(mode === 'text' ? '点击后请按 Ctrl+V 粘贴（仅保留文本）' : '点击后请按 Ctrl+V 粘贴（将按所选格式处理）', 'info');
    }
  };

  // 原生粘贴（Ctrl+V）拦截：按当前 pasteModeRef 处理
  const onRichPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const mode = pasteModeRef.current;
    if (mode === 'keep') return; // 保留原格式：走浏览器默认行为
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    const html = e.clipboardData.getData('text/html');
    if (mode === 'text') {
      insertHtmlAtCaret(plainTextToHtml(text || html));
    } else {
      insertHtmlAtCaret(normalizePasteHtml(html || plainTextToHtml(text)));
    }
    requestAnimationFrame(scanPopupsRich);
    // 粘贴会修改 DOM，强制刷新富文本版本号，让大纲实时跟随
    setRichVer((v) => v + 1);
  };

  // 点击菜单外部 / Escape / 滚动时关闭粘贴菜单
  useEffect(() => {
    if (!pasteMenu) return;
    const onDown = (ev: MouseEvent) => {
      if (!(ev.target as HTMLElement).closest('.paste-menu')) setPasteMenu(null);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setPasteMenu(null);
    };
    const onScroll = () => setPasteMenu(null);
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [pasteMenu]);

  // ===== 文本编辑辅助（复用 doctools） =====
  const doInline = (b: string, a = b, p = '文本') => applyInlineOp(content, onContent, taRef.current, b, a, p);
  const doBlock = (fn: (b: string) => string) => applyBlockOp(content, onContent, taRef.current, fn);
  const doInsert = (t: string, off = 0) => insertAtCursorOp(content, onContent, taRef.current, t, off);
  const doToggle = (p: string) => toggleBlockOp(content, onContent, taRef.current, p);
  const doHeading = (n: number) => toggleHeadingOp(content, onContent, taRef.current, n);
  const doAlign = (a: 'left' | 'center' | 'right') => setAlignOp(content, onContent, taRef.current, a);

  const makeCodeBlock = () => {
    doBlock((b) => (b.startsWith('```') ? b : '```\n' + b + '\n```'));
  };

  const insertLink = () => openLinkModal('plain');

  const insertImage = () => {
    const url = window.prompt('请输入图片地址（URL）：', 'https://');
    if (!url) return;
    const alt = window.prompt('请输入图片描述：', '') || 'image';
    doInsert(`\n![${alt}](${url})\n`, -1);
  };

  const insertTable = () => {
    doInsert('\n| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n| 内容 | 内容 | 内容 |\n', -1);
  };

  const insertCallout = () => {
    doInsert('\n::: 💡 blue\n高亮块内容\n:::\n', -1);
  };

  const insertColumns = () => {
    doInsert('\n::: columns 2\n左栏内容\n===\n右栏内容\n:::\n', -1);
  };

  const insertFormula = () => {
    doInsert('\n$$E=mc^2$$\n', -1);
  };

  // ===== 富文本格式 / 插入操作 =====
  const execRich = (cmd: string, val?: string) => {
    richRef.current?.focus();
    document.execCommand(cmd, false, val);
  };
  // 把光标所在块替换为指定块级标签（h1/h2/h3/p/blockquote），比 execCommand('formatBlock') 更可靠
  const formatRichBlockTag = (tag: string) => {
    const el = richRef.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    // 向上找光标所在块（编辑区内），只读区域（特殊块）跳过
    let node: Node | null = range.startContainer;
    let block: HTMLElement | null = null;
    while (node && node !== el) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const e = node as HTMLElement;
        if (!e.isContentEditable) return;
        if (RICH_BLOCK_TAGS.includes(e.tagName)) {
          block = e;
          break;
        }
      }
      node = node.parentNode;
    }
    if (!block) return;
    const newTag = tag.toUpperCase();
    if (block.tagName === newTag) return; // 已是该块类型，幂等
    // 计算光标在块内文本偏移，替换后恢复光标
    const pre = range.cloneRange();
    pre.selectNodeContents(block);
    pre.setEnd(range.startContainer, range.startOffset);
    const offset = pre.toString().length;
    const nb = document.createElement(newTag);
    nb.innerHTML = block.innerHTML;
    if (block.style.textAlign && block.style.textAlign !== 'left') nb.style.textAlign = block.style.textAlign;
    // 最后一次选择的格式生效：转标题时清掉块内行内字号，让标题字号接管（见 stripInlineFontSize）
    if (/^H[1-6]$/.test(newTag)) stripInlineFontSize(nb);
    block.replaceWith(nb);
    // 恢复光标
    const walker = document.createTreeWalker(nb, NodeFilter.SHOW_TEXT);
    let remaining = offset;
    let tn = walker.nextNode();
    while (tn) {
      const len = (tn.textContent ?? '').length;
      if (remaining <= len) {
        const r = document.createRange();
        r.setStart(tn, remaining);
        r.collapse(true);
        const s = window.getSelection();
        s?.removeAllRanges();
        s?.addRange(r);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
      remaining -= len;
      tn = walker.nextNode();
    }
    const r = document.createRange();
    r.selectNodeContents(nb);
    r.collapse(false);
    const s = window.getSelection();
    s?.removeAllRanges();
    s?.addRange(r);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const insertRichBlock = (md: string) => {
    richRef.current?.focus();
    insertHtmlAtCaret('\n' + markdownToEditableHtml(md) + '\n');
  };
  const insertRichText = (t: string) => {
    richRef.current?.focus();
    document.execCommand('insertText', false, t);
  };
  const insertLinkRich = () => openLinkModal('rich');

  // 打开链接配置弹窗；mode 区分富文本 / markdown 编辑器
  const openLinkModal = (mode: 'rich' | 'plain') => {
    const sel =
      mode === 'rich'
        ? window.getSelection()?.toString().trim() || ''
        : (() => {
            const ta = taRef.current;
            if (!ta || ta.selectionStart == null || ta.selectionEnd == null) return '';
            return content.slice(ta.selectionStart, ta.selectionEnd).trim();
          })();
    // 保存富文本下当前光标/选区，插入时恢复，避免点击按钮后失焦导致插入失败
    if (mode === 'rich') {
      const g = window.getSelection();
      linkSavedRangeRef.current = g && g.rangeCount > 0 ? g.getRangeAt(0).cloneRange() : null;
    }
    setLinkMode(mode);
    setLinkUrl('https://');
    setLinkLabel(sel || '');
    setLinkOpen(true);
    setTimeout(() => linkModalRef.current?.querySelector('input')?.focus(), 0);
  };

  // 无协议 / 非特殊前缀的地址自动补 https://，避免 href 被洁净器移除导致链接失效
  const normalizeLinkUrl = (u: string) =>
    /^(https?:)?\/\//i.test(u) ||
    u.startsWith('/') ||
    u.startsWith('#') ||
    u.startsWith('mailto:') ||
    u.startsWith('tel:')
      ? u
      : `https://${u}`;

  const applyLink = () => {
    const url = normalizeLinkUrl(linkUrl.trim());
    const label = linkLabel.trim() || '链接';
    setLinkOpen(false);
    // 编辑模式：更新既有链接元素（从气泡「编辑」进入）
    const editing = linkEditElRef.current;
    linkEditElRef.current = null;
    setLinkHover(null);
    linkHoverElRef.current = null;
    if (editing && editing.isConnected) {
      editing.setAttribute('href', url);
      editing.textContent = label;
      const root = editing.closest('[contenteditable]') as HTMLElement | null;
      root?.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    // 插入模式
    if (linkMode === 'rich') {
      // 重新聚焦编辑器并恢复保存的光标/选区，保证 execCommand insertHTML 能插入到正确位置
      const el = richRef.current;
      if (el) el.focus();
      const g = window.getSelection();
      const saved = linkSavedRangeRef.current;
      if (saved && g) {
        g.removeAllRanges();
        g.addRange(saved);
      }
      insertHtmlAtCaret(`<a href="${url}" target="_blank" rel="noopener">${escapeHtml(label)}</a>`);
      el?.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    const ta = taRef.current;
    if (!ta) {
      onContent(content + `\n[${label}](${url})`);
      return;
    }
    const s = ta.selectionStart ?? content.length;
    const e = ta.selectionEnd ?? content.length;
    onContent(content.slice(0, s) + `[${label}](${url})` + content.slice(e));
  };
  const insertImageRich = () => {
    const url = window.prompt('请输入图片地址（URL）：', 'https://');
    if (!url) return;
    const alt = window.prompt('请输入图片描述：', '') || 'image';
    insertHtmlAtCaret(`<img src="${url}" alt="${escapeHtml(alt)}">`);
  };
  const insertTableRich = (rows: number, cols: number) => {
    setTablePick(null);
    if (!richRef.current) return;
    richRef.current.focus();
    insertHtmlAtCaret('\n' + tableHtml(rows, cols) + '\n');
    // 聚焦首个单元格，便于立即输入
    const tables = richRef.current.querySelectorAll('table');
    const t = tables[tables.length - 1];
    if (t) focusFirstCell(t);
    richRef.current.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const openTablePick = ({ left, top }: { left: number; top: number }) => {
    setTablePickRC({ r: 3, c: 3 });
    setTablePick({ left, top });
    setSlashOpen(false);
  };

  // ===== 表格编辑：工具条操作 + 列宽拖拽 =====
  const scanTableActive = useCallback(() => {
    const el = richRef.current;
    if (editStyle !== 'rich' || !el) {
      setActiveCell(null);
      setTableBar(false);
      return;
    }
    const cell = currentTableCell(el);
    if (cell) {
      setActiveCell((prev) => (prev === cell ? prev : cell));
      setTableBar(true);
    } else {
      setActiveCell(null);
      setTableBar(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editStyle]);

  const runTableOp = (op: () => void) => {
    op();
    const el = richRef.current;
    if (el) {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      requestAnimationFrame(scanTableActive);
    }
  };

  // 高亮当前单元格（仿飞书：蓝色描边出当前单元格）
  useEffect(() => {
    if (!richRef.current) return;
    richRef.current.querySelectorAll('.pulse-cell-active').forEach((el) => el.classList.remove('pulse-cell-active'));
    if (activeCell && richRef.current.contains(activeCell)) activeCell.classList.add('pulse-cell-active');
  }, [activeCell]);

  // 表格选择器：点击外部 / Esc 关闭
  useEffect(() => {
    if (!tablePick) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTablePick(null);
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (tablePickRef.current && !tablePickRef.current.contains(t)) setTablePick(null);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [tablePick]);

  // ===== 选中文字悬浮工具栏（飞书式） =====
  // 扫描浏览器选区：rich 模式 + 有非空文本被选中 + 在编辑器内 → 定位悬浮工具栏到选区上方
  const scanTextBar = useCallback(() => {
    const el = richRef.current;
    if (editStyle !== 'rich' || !el) {
      setTextBar(null);
      setTextBarMenu(null);
      return;
    }
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !sel.toString().trim()) {
      setTextBar(null);
      setTextBarMenu(null);
      return;
    }
    const range = sel.getRangeAt(0);
    // 选区必须位于编辑器内，且不跨越只读块（callout/pre 等不可编辑选中）
    if (!el.contains(range.commonAncestorContainer)) {
      setTextBar(null);
      setTextBarMenu(null);
      return;
    }
    let n: Node | null = range.commonAncestorContainer;
    while (n && n !== el) {
      if (n.nodeType === Node.ELEMENT_NODE && !(n as HTMLElement).isContentEditable) {
        setTextBar(null);
        setTextBarMenu(null);
        return;
      }
      n = n.parentNode;
    }
    const rect = range.getBoundingClientRect();
    if (!rect) return;
    const pos = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    const last = textBarPosRef.current;
    if (!last || Math.abs(last.left - pos.left) > 1 || Math.abs(last.top - pos.top) > 1 || Math.abs(last.width - pos.width) > 1) {
      textBarPosRef.current = pos;
      setTextBar(pos);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editStyle]);

  // ===== 空行占位提示：光标所在空块显示「请输入文档内容」，输入即消失 =====
  const updateRichEmptyPh = useCallback(() => {
    const el = richRef.current;
    if (!el || editStyle !== 'rich') return;
    // 清掉所有旧占位
    el.querySelectorAll('[data-ph]').forEach((n) => n.removeAttribute('data-ph'));
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!el.contains(range.commonAncestorContainer)) return;
    // 从选区向上找当前块；只读区域（表格/特殊块）不显示
    let node: Node | null = range.startContainer;
    let block: HTMLElement | null = null;
    while (node && node !== el) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const e = node as HTMLElement;
        if (!e.isContentEditable) return;
        if (RICH_BLOCK_TAGS.includes(e.tagName)) {
          block = e;
          break;
        }
      }
      node = node.parentNode;
    }
    if (!block) return;
    // 只有「真正空」的块（仅空白文本和/或 <br>）才显示占位，图片/表格/分割线等都不算空
    const isBlank = Array.from(block.childNodes).every((c) => {
      if (c.nodeType === Node.TEXT_NODE) return (c.textContent ?? '').trim() === '';
      return (c as HTMLElement).tagName === 'BR';
    });
    if (isBlank) block.setAttribute('data-ph', '请输入文档内容');
  }, [editStyle]);

  // 应用一次格式化：先聚焦编辑器保持选区，执行后同步保存并刷新工具栏位置
  const textBarRun = (op: () => void) => {
    const el = richRef.current;
    if (!el) return;
    el.focus();
    op();
    el.dispatchEvent(new Event('input', { bubbles: true }));
    setTextBarMenu(null);
    requestAnimationFrame(() => {
      scanPopupsRich();
      scanTextBar();
    });
  };
  const textBarFormat = (tag: string) => textBarRun(() => formatRichBlockTag(tag));
  const textBarBold = () => textBarRun(() => document.execCommand('bold'));
  const textBarItalic = () => textBarRun(() => document.execCommand('italic'));
  const textBarUnderline = () => textBarRun(() => document.execCommand('underline'));
  const textBarStrike = () => textBarRun(() => document.execCommand('strikeThrough'));
  const textBarSize = (px: number) =>
    textBarRun(() => {
      document.execCommand('styleWithCSS', true);
      applyInlineStyle(`font-size:${px}px`);
    });
  const textBarColor = (c: string) =>
    textBarRun(() => {
      document.execCommand('styleWithCSS', true);
      document.execCommand('foreColor', false, c);
    });
  const textBarBg = (c: string) =>
    textBarRun(() => {
      document.execCommand('styleWithCSS', true);
      document.execCommand('hiliteColor', false, c);
    });
  const textBarCode = () => textBarRun(() => wrapSelection('`', '`'));
  const textBarClear = () =>
    textBarRun(() => {
      document.execCommand('removeFormat');
    });

  // 选区/滚动变化时刷新悬浮工具栏与空行占位；编辑器进入/退出 rich 时重置
  useEffect(() => {
    const refresh = () =>
      requestAnimationFrame(() => {
        scanTextBar();
        updateRichEmptyPh();
      });
    const onSelChange = () => refresh();
    const onScroll = () => refresh();
    const el = richRef.current;
    const onKeyUp = () => refresh();
    document.addEventListener('selectionchange', onSelChange);
    document.addEventListener('scroll', onScroll, true);
    el?.addEventListener('keyup', onKeyUp);
    return () => {
      document.removeEventListener('selectionchange', onSelChange);
      document.removeEventListener('scroll', onScroll, true);
      el?.removeEventListener('keyup', onKeyUp);
    };
  }, [scanTextBar, updateRichEmptyPh]);

  // 点击工具栏外部 / Esc 关闭下拉菜单
  useEffect(() => {
    if (!textBarMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTextBarMenu(null);
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (textBarRef.current && !textBarRef.current.contains(t)) setTextBarMenu(null);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [textBarMenu]);

  const tableOpLeft = () => activeCell && runTableOp(() => tableInsertColumn(activeCell, -1));
  const tableOpRight = () => activeCell && runTableOp(() => tableInsertColumn(activeCell, 1));
  const tableOpUp = () => activeCell && runTableOp(() => tableInsertRow(activeCell, -1));
  const tableOpDown = () => activeCell && runTableOp(() => tableInsertRow(activeCell, 1));
  const tableOpDelCol = () => activeCell && runTableOp(() => tableRemoveColumn(activeCell));
  const tableOpDelRow = () => activeCell && runTableOp(() => tableRemoveRow(activeCell));
  const tableOpDelTable = () => {
    if (!activeCell) return;
    const t = cellTable(activeCell);
    runTableOp(() => {
      if (t) tableRemove(t);
    });
    setActiveCell(null);
    setTableBar(false);
    richRef.current?.focus();
  };

  // 列宽拖拽
  const richTableMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const cell = target.closest('th,td');
    const el = richRef.current;
    if (!cell || !el) return;
    const table = cell.closest('table') as HTMLTableElement | null;
    if (!table) return;
    const pad = 5;
    const rect = cell.getBoundingClientRect();
    const nearRight = Math.abs(e.clientX - rect.right) <= pad;
    const nearLeft = Math.abs(e.clientX - rect.left) <= pad;
    if (!nearRight && !nearLeft) return;
    const rowCells = Array.from((cell.parentElement as HTMLTableRowElement).querySelectorAll<HTMLElement>(':scope > th, :scope > td'));
    const idx = rowCells.indexOf(cell as HTMLElement);
    const colIdx = nearRight ? idx : idx - 1;
    if (colIdx < 0) return;
    e.preventDefault();
    syncColgroup(table);
    const cols = Array.from(table.querySelectorAll<HTMLElement>(':scope > colgroup > col'));
    const targetCol = cols[colIdx];
    const startW = targetCol ? parseFloat(targetCol.style.width) || 72 : 72;
    const startX = e.clientX;
    const clearCursor = () => {
      el.style.cursor = '';
      document.removeEventListener('mousemove', onDragMove);
      document.removeEventListener('mouseup', onDragUp);
    };
    const onDragMove = (ev: MouseEvent) => {
      const w = Math.max(40, startW + (ev.clientX - startX));
      if (cols[colIdx]) cols[colIdx].style.width = `${Math.round(w)}px`;
    };
    const onDragUp = () => {
      clearCursor();
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragUp);
  };
  const richTableMouseMove = (e: React.MouseEvent) => {
    const el = richRef.current;
    if (!el) return;
    const cell = (e.target as HTMLElement).closest('th,td');
    if (cell) {
      const rect = cell.getBoundingClientRect();
      const pad = 5;
      const near = Math.abs(e.clientX - rect.left) <= pad || Math.abs(e.clientX - rect.right) <= pad;
      el.style.cursor = near ? 'col-resize' : '';
    } else {
      el.style.cursor = '';
    }
  };
  const insertCalloutRich = () => {
    insertRichBlock('::: 💡 blue\n高亮块内容\n:::');
  };
  const insertColumnsRich = () => {
    insertRichBlock('::: columns 2\n左栏内容\n===\n右栏内容\n:::');
  };
  const insertFormulaRich = () => {
    insertRichBlock('$$E=mc^2$$');
  };
  const insertCodeRich = () => {
    insertRichBlock('```\n代码\n```');
  };
  const insertDividerRich = () => {
    richRef.current?.focus();
    document.execCommand('insertHorizontalRule');
  };
  const insertTaskRich = () => {
    richRef.current?.focus();
    document.execCommand('insertHTML', false, '<ul><li><input type="checkbox"> 任务</li></ul>');
  };
  const insertTimerRich = () => {
    const d = window.prompt('请输入倒计时结束时间（如 2026-12-31 18:00）：', '');
    if (!d) return;
    insertRichBlock(`::: timer ${d}\n倒计时说明\n:::`);
  };
  const insertMindmapRich = () => {
    insertRichBlock('::: mindmap\n- 中心主题\n  - 分支 1\n    - 子分支 A\n  - 分支 2\n:::');
  };
  const insertVideoRich = () => {
    const url = window.prompt('请输入视频地址（MP4/YouTube）：', 'https://');
    if (!url) return;
    if (/youtube\.com|youtu\.be/i.test(url)) {
      const v = url.match(/(?:v=|youtu\.be\/)([\w-]{11})/);
      insertRichBlock(
        `<div class="video-embed"><iframe src="https://www.youtube.com/embed/${v ? v[1] : ''}" allowfullscreen></iframe></div>`,
      );
    } else {
      insertRichBlock(`<video controls src="${url}"></video>`);
    }
  };
  const insertTocRich = () => {
    insertRichBlock('[TOC]');
  };
  const insertMentionDocRich = () => {
    insertHtmlAtCaret('<span class="wiki-link" data-wiki="文档名">[[文档名]]</span>');
  };

  // ===== 格式化操作分派：rich 走 execCommand，md 走文本操作 =====
  const fmt = (rich: () => void, md: () => void) => (editStyle === 'rich' ? rich() : md());
  const toolbarHeading = (n: number) =>
    fmt(() => formatRichBlockTag(`h${n}`), () => doHeading(n));
  const toolbarBold = () => fmt(() => execRich('bold'), () => doInline('**', '**'));
  const toolbarItalic = () => fmt(() => execRich('italic'), () => doInline('*', '*'));
  const toolbarUnderline = () => fmt(() => execRich('underline'), () => doInline('<u>', '</u>'));
  const toolbarStrike = () => fmt(() => execRich('strikeThrough'), () => doInline('~~', '~~'));
  const toolbarHighlight = () =>
    fmt(
      () => {
        richRef.current?.focus();
        document.execCommand('hiliteColor', false, '#ffe9a8');
      },
      () => doInline('<mark>', '</mark>'),
    );
  const toolbarCode = () =>
    fmt(
      () => {
        richRef.current?.focus();
        const t = window.getSelection()?.toString() || 'code';
        insertHtmlAtCaret(`<code>${escapeHtml(t)}</code>`);
      },
      () => doInline('`', '`'),
    );
  const toolbarUL = () => fmt(() => execRich('insertUnorderedList'), () => doToggle('- '));
  const toolbarOL = () => fmt(() => execRich('insertOrderedList'), () => doToggle('1. '));
  const toolbarTask = () => fmt(insertTaskRich, () => doToggle('- [ ] '));
  const toolbarQuote = () => fmt(() => formatRichBlockTag('blockquote'), () => doToggle('> '));
  const toolbarCallout = () => fmt(insertCalloutRich, insertCallout);
  const toolbarColumns = () => fmt(insertColumnsRich, insertColumns);
  const toolbarFormula = () => fmt(insertFormulaRich, insertFormula);
  const toolbarCodeBlock = () => fmt(insertCodeRich, makeCodeBlock);
  const toolbarDivider = () => fmt(insertDividerRich, () => doInsert('\n\n---\n\n'));
  const toolbarLink = () => fmt(insertLinkRich, insertLink);
  const toolbarImage = () => fmt(insertImageRich, insertImage);
  const toolbarTable = () => {
    if (editStyle === 'rich') {
      const b = toolBarRef.current?.getBoundingClientRect();
      openTablePick({ left: b ? b.left + 8 : 200, top: b ? b.bottom + 8 : 120 });
    } else {
      insertTable();
    }
  };
  const toolbarAlign = (a: 'left' | 'center' | 'right') =>
    fmt(() => execRich(a === 'left' ? 'justifyLeft' : a === 'center' ? 'justifyCenter' : 'justifyRight'), () => doAlign(a));

  // ===== 斜杠命令 =====
  const commands = useMemo(
    () =>
      buildCommands({
        getContent: () => content,
        setContent: onContent,
        ta: taRef.current,
      }),
    // 依赖 content 以便 run 闭包拿最新值
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [content],
  );

  // 富文本斜杠命令（所见即所得模式）
  const richCommands: SlashCommand[] = [
    { key: 'h1', label: '一级标题', icon: 'H1', aliases: ['h1', '标题1', '一级标题'], hint: '# 标题', run: () => formatRichBlockTag('h1') },
    { key: 'h2', label: '二级标题', icon: 'H2', aliases: ['h2', '标题2', '二级标题'], hint: '## 标题', run: () => formatRichBlockTag('h2') },
    { key: 'h3', label: '三级标题', icon: 'H3', aliases: ['h3', '标题3', '三级标题'], hint: '### 标题', run: () => formatRichBlockTag('h3') },
    { key: 'text', label: '正文', icon: 'T', aliases: ['zw', 'text', '正文'], hint: '普通文本', run: () => formatRichBlockTag('p') },
    { key: 'ul', label: '无序列表', icon: '•', aliases: ['wxlb', 'bulleted list', 'ul', '无序列表'], hint: '- 列表项', run: () => execRich('insertUnorderedList') },
    { key: 'ol', label: '有序列表', icon: '1.', aliases: ['yxlb', 'numbered list', 'ol', '有序列表'], hint: '1. 列表项', run: () => execRich('insertOrderedList') },
    { key: 'task', label: '任务', icon: '☐', aliases: ['rw', 'todo', 'task', 'renwu', '任务'], hint: '- [ ] 任务', run: insertTaskRich },
    { key: 'quote', label: '引用', icon: '❝', aliases: ['yy', 'quote', '引用'], hint: '> 引用内容', run: () => formatRichBlockTag('blockquote') },
    { key: 'divider', label: '分割线', icon: '—', aliases: ['fgx', 'divider', '分割线'], hint: '---', run: insertDividerRich },
    { key: 'link', label: '链接', icon: '🔗', aliases: ['lj', 'link', 'url', '链接'], hint: '[文字](地址)', run: insertLinkRich },
    { key: 'image', label: '图片', icon: '🖼', aliases: ['tp', 'image', '图片'], hint: '图片', run: insertImageRich },
    { key: 'table', label: '表格', icon: '▦', aliases: ['bg', 'table', '表格'], hint: '插入表格', run: () => openTablePick(slashPos) },
    { key: 'columns', label: '分栏', icon: '▯', aliases: ['fl', 'column', 'columns', '分栏'], hint: '分栏', run: insertColumnsRich },
    { key: 'callout', label: '高亮块', icon: '💡', aliases: ['glk', 'callout', 'gaoliangkuai', '高亮块'], hint: '高亮块', run: insertCalloutRich },
    { key: 'code', label: '代码块', icon: '{}', aliases: ['dmk', 'code', '代码块'], hint: '代码块', run: insertCodeRich },
    { key: 'formula', label: '公式', icon: '∑', aliases: ['gs', 'eq', 'formula', 'gongshi', '公式'], hint: '公式', run: insertFormulaRich },
    { key: 'timer', label: '倒计时', icon: '⏳', aliases: ['djs', 'timer', 'daojishi', '倒计时'], hint: '倒计时', run: insertTimerRich },
    { key: 'mindmap', label: '思维导图', icon: '🧠', aliases: ['swdt', 'mindmap', 'siweidaotu', '思维导图'], hint: '思维导图', run: insertMindmapRich },
    {
      key: 'date',
      label: '日期',
      icon: '📅',
      aliases: ['rq', 'date', 'reminder', '日期'],
      hint: '今天日期',
      run: () => {
        const today = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        insertRichText(`${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())} `);
      },
    },
    { key: 'video', label: '音视频', icon: '▶', aliases: ['wj', 'sp', 'file', 'video', 'yinshipin', '音视频'], hint: '音视频', run: insertVideoRich },
    { key: 'toc', label: '目录', icon: '≡', aliases: ['ml', 'toc', '目录'], hint: '目录', run: insertTocRich },
    { key: 'mention-doc', label: '@文档', icon: '🔗', aliases: ['ywd', 'docs', 'wendang', '@文档'], hint: '[[文档名]]', run: insertMentionDocRich },
  ];

  const slashList = useMemo(
    () => filterCommands(editStyle === 'rich' ? richCommands : commands, slashQuery),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [commands, slashQuery, editStyle],
  );

  const runSlashCmd = (c: SlashCommand) => {
    setSlashOpen(false);
    c.run();
  };

  // 扫描光标前的 / 与 @，弹出对应菜单
  const scanPopups = useCallback(() => {
    const ta = taRef.current;
    const wrap = richWrapRef.current;
    if (!ta || !wrap) return;
    const caret = ta.selectionStart;
    const before = ta.value.slice(0, caret);
    // 菜单绝对定位在 richWrapRef 内，坐标需补偿 textarea 相对定位父级的偏移（标题区/封面）
    const caretRel = () => {
      const p = caretPositionIn(ta);
      return { left: p.left + ta.offsetLeft, top: p.top + ta.offsetTop };
    };
    const sm = before.match(/(?:^|\n| |\t)(\/[\p{L}\p{N}]*)$/u);
    if (sm) {
      const pos = caretRel();
      setSlashQuery(sm[1].slice(1));
      setSlashPos({ left: Math.max(8, Math.min(pos.left, wrap.clientWidth - 272)), top: Math.max(8, pos.top) });
      setSlashIdx(0);
      setSlashOpen(true);
      setMentionOpen(false);
      return;
    }
    const mm = before.match(/(?:^|[^\p{L}\p{N}_])(@[\p{L}\p{N}_]*)$/u);
    if (mm) {
      const pos = caretRel();
      setMentionQuery(mm[1].slice(1));
      setMentionPos({ left: Math.max(8, Math.min(pos.left, wrap.clientWidth - 296)), top: Math.max(8, pos.top) });
      setMentionIdx(0);
      setMentionOpen(true);
      setSlashOpen(false);
      return;
    }
    setSlashOpen(false);
    setMentionOpen(false);
  }, []);

  // @ 成员搜索（防抖）
  useEffect(() => {
    if (!mentionOpen) return;
    const t = setTimeout(async () => {
      if (!mentionQuery.trim()) {
        setMentionUsers([]);
        return;
      }
      try {
        setMentionUsers(await authApi.searchUsers(mentionQuery));
      } catch {
        setMentionUsers([]);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [mentionOpen, mentionQuery]);

  const insertMention = (u: UserHit) => {
    const ta = taRef.current;
    if (!ta) return;
    const caret = ta.selectionStart;
    const before = ta.value.slice(0, caret);
    const m = before.match(/(?:^|[^\p{L}\p{N}_])@[\p{L}\p{N}_]*$/u);
    if (!m) return;
    const start = caret - m[0].length;
    const next = ta.value.slice(0, start) + `@${u.name} ` + ta.value.slice(caret);
    onContent(next);
    // 提及通知（静默失败）
    if (id && u.id !== user?.id) docApi.mention(id, u.id).catch(() => {});
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + u.name.length + 2;
      ta.selectionStart = ta.selectionEnd = pos;
    });
    setMentionOpen(false);
  };

  // ===== 富文本模式：扫描 / 与 @，插入提及 =====
  const scanPopupsRich = useCallback(() => {
    const el = richRef.current;
    const wrap = richWrapRef.current;
    if (!el || !wrap) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) {
      setSlashOpen(false);
      setMentionOpen(false);
      return;
    }
    const node = sel.getRangeAt(0).startContainer;
    if (node.nodeType !== Node.TEXT_NODE) {
      setSlashOpen(false);
      setMentionOpen(false);
      return;
    }
    const offset = sel.getRangeAt(0).startOffset;
    const before = (node.textContent ?? '').slice(0, offset);
    const rect = getCaretRect(wrap);
    if (!rect) return;
    const sm = before.match(/(?:^|[\s(（>\/])(\/[\p{L}\p{N}]*)$/u);
    if (sm) {
      setSlashQuery(sm[1].slice(1));
      setSlashPos({ left: Math.max(8, Math.min(rect.left, wrap.clientWidth - 272)), top: Math.max(8, rect.top) });
      setSlashIdx(0);
      setSlashOpen(true);
      setMentionOpen(false);
      return;
    }
    const mm = before.match(/(?:^|[^\p{L}\p{N}_])(@[\p{L}\p{N}_]*)$/u);
    if (mm) {
      setMentionQuery(mm[1].slice(1));
      setMentionPos({ left: Math.max(8, Math.min(rect.left, wrap.clientWidth - 296)), top: Math.max(8, rect.top) });
      setMentionIdx(0);
      setMentionOpen(true);
      setSlashOpen(false);
      return;
    }
    setSlashOpen(false);
    setMentionOpen(false);
  }, []);

  const insertMentionRich = (u: UserHit) => {
    const el = richRef.current;
    const sel = window.getSelection();
    if (!el || !sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) return;
    const text = node.textContent ?? '';
    const offset = range.startOffset;
    const before = text.slice(0, offset);
    const m = before.match(/(?:^|[^\p{L}\p{N}_])@[\p{L}\p{N}_]*$/u);
    if (!m) return;
    const start = offset - m[0].length;
    const afterText = text.slice(offset);
    node.textContent = text.slice(0, start);
    const span = document.createElement('span');
    span.className = 'mention';
    span.setAttribute('data-mention', u.name);
    span.textContent = '@' + u.name;
    const parent = node.parentNode as HTMLElement;
    parent.insertBefore(span, node.nextSibling);
    const after = document.createTextNode(' ' + afterText);
    parent.insertBefore(after, span.nextSibling);
    const newRange = document.createRange();
    newRange.setStartAfter(after);
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);
    setMentionOpen(false);
    setRichVer((v) => v + 1);
    // 提及通知（静默失败）
    if (id && u.id !== user?.id) docApi.mention(id, u.id).catch(() => {});
  };

  // 点击外部关闭弹层
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (slashOpen && slashRef.current && !slashRef.current.contains(e.target as Node)) setSlashOpen(false);
      if (mentionOpen && mentionRef.current && !mentionRef.current.contains(e.target as Node)) setMentionOpen(false);
      if (findOpen && findRef.current && !findRef.current.contains(e.target as Node)) setFindOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [slashOpen, mentionOpen, findOpen]);

  // ===== 实时协同（MVP）：WebSocket 房间，保存驱动广播 + 在线状态 =====
  const [collabUsers, setCollabUsers] = useState<{ id: string; name: string }[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const lastRemoteMdRef = useRef<string | null>(null);

  // 广播本地最新内容（保存成功后调用）
  const broadcastMd = (md: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN && lastRemoteMdRef.current !== md) {
      wsRef.current.send(JSON.stringify({ type: 'content', md }));
    }
  };

  useEffect(() => {
    if (!id || !user) return;
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${window.location.host}/api/ws/docs/${id}`);
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'presence') {
          setCollabUsers((msg.users as { id: string; name: string }[]).filter((u) => u.id !== user.id));
        } else if (msg.type === 'content' && typeof msg.md === 'string') {
          lastRemoteMdRef.current = msg.md;
          setContent(msg.md);
          toast(`${msg.from?.name ?? '协作者'} 更新了文档`, 'info');
        }
      } catch {
        // 忽略非法消息
      }
    };
    wsRef.current = ws;
    return () => {
      ws.close();
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, user?.id]);

  // ===== 查找替换 =====
  const findMatches = useMemo(() => {
    if (!findQuery) return [] as number[];
    const q = findQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(q, 'gi');
    const out: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(content))) out.push(m.index);
    return out;
  }, [findQuery, content]);

  // 富文本模式：遍历文本节点查找
  type RichMatch = { node: Text; start: number; end: number };
  const findRichMatches = useMemo(() => {
    if (editStyle !== 'rich' || !findQuery || !richRef.current) return [] as RichMatch[];
    const matches: RichMatch[] = [];
    const walker = document.createTreeWalker(richRef.current, NodeFilter.SHOW_TEXT);
    const q = findQuery.toLowerCase();
    let n: Node | null;
    while ((n = walker.nextNode())) {
      const text = n.textContent ?? '';
      const lower = text.toLowerCase();
      let i = 0;
      while ((i = lower.indexOf(q, i)) !== -1) {
        matches.push({ node: n as Text, start: i, end: i + findQuery.length });
        i += findQuery.length;
      }
    }
    return matches;
  }, [findQuery, editStyle, richVer]);

  const clampedFindIdx = findMatches.length ? ((findIdx % findMatches.length) + findMatches.length) % findMatches.length : 0;
  const richFindTotal = findRichMatches.length;
  const clampedRichFindIdx = richFindTotal ? ((findIdx % richFindTotal) + richFindTotal) % richFindTotal : 0;

  const jumpFind = (dir: 1 | -1) => {
    if (editStyle === 'rich') {
      if (!richFindTotal) return;
      const next = findRichMatches[(clampedRichFindIdx + dir + richFindTotal) % richFindTotal];
      setFindIdx((i) => i + dir);
      if (!next) return;
      const range = document.createRange();
      range.setStart(next.node, next.start);
      range.setEnd(next.node, next.end);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      richRef.current?.focus();
      next.node.parentElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (!findMatches.length) return;
    setFindIdx((i) => i + dir);
    const ta = taRef.current;
    if (!ta) return;
    const next = findMatches[clampedFindIdx + dir];
    if (next !== undefined) {
      ta.focus();
      ta.selectionStart = next;
      ta.selectionEnd = next + findQuery.length;
      const lineStart = content.lastIndexOf('\n', next) + 1;
      const nl = content.indexOf('\n', next);
      const lineEnd = nl === -1 ? content.length : nl;
      ta.scrollTop = Math.max(0, lineStart - 40);
      void lineEnd;
    }
  };

  const replaceCurrent = () => {
    if (editStyle === 'rich') {
      const m = findRichMatches[clampedRichFindIdx];
      if (!m) return;
      const range = document.createRange();
      range.setStart(m.node, m.start);
      range.setEnd(m.node, m.end);
      range.deleteContents();
      m.node.parentNode?.insertBefore(document.createTextNode(replaceQuery), m.node);
      setFindIdx((i) => i + 1);
      setRichVer((v) => v + 1);
      return;
    }
    if (!findMatches.length) return;
    const idx = findMatches[clampedFindIdx];
    const next = content.slice(0, idx) + replaceQuery + content.slice(idx + findQuery.length);
    onContent(next);
    setFindIdx(0);
  };

  const replaceAll = () => {
    if (!findQuery) return;
    if (editStyle === 'rich') {
      for (let i = findRichMatches.length - 1; i >= 0; i--) {
        const m = findRichMatches[i];
        const range = document.createRange();
        range.setStart(m.node, m.start);
        range.setEnd(m.node, m.end);
        range.deleteContents();
        m.node.parentNode?.insertBefore(document.createTextNode(replaceQuery), m.node);
      }
      setFindIdx(0);
      setRichVer((v) => v + 1);
      return;
    }
    const q = findQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const next = content.replace(new RegExp(q, 'gi'), replaceQuery);
    onContent(next);
    setFindIdx(0);
  };

  // ===== 大纲（实时跟随用户填写内容） =====
  const headings = useMemo<Heading[]>(() => {
    if (editStyle === 'rich' && richRef.current) {
      // 富文本模式：直接从编辑区 DOM 提取标题，保证与用户实际填写内容一致
      const out: Heading[] = [];
      richRef.current.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((el, i) => {
        const level = parseInt(el.tagName.slice(1), 10);
        out.push({ level, text: el.textContent?.trim() ?? '', index: i });
      });
      return out;
    }
    return extractHeadings(content);
  }, [content, editStyle, richVer, preview]);

  const jumpToHeading = (h: Heading) => {
    const scrollHeading = (root: Element | null | undefined) => {
      const els = Array.from(root?.querySelectorAll('h1,h2,h3,h4,h5,h6') ?? []);
      const target = els.find((el) => el.textContent?.trim().replace(/#$/, '').trim() === h.text);
      (target ?? els[headings.findIndex((x) => x.index === h.index)])?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    if (preview) {
      scrollHeading(previewRef.current);
    } else if (editStyle === 'rich') {
      // 先聚焦但不触发滚动，再滚动到目标标题，避免 focus 把视口回滚到光标处抵消跳转
      richRef.current?.focus({ preventScroll: true });
      scrollHeading(richRef.current);
    } else {
      const ta = taRef.current;
      if (!ta) return;
      ta.focus();
      ta.selectionStart = ta.selectionEnd = h.index;
    }
  };

  // ===== AI =====
  // AI 可能把输出包在 ```markdown 代码围栏里（或先写评语再包围栏），提取围栏内的 Markdown 主体，避免渲染成代码块
  const cleanAiMd = (s: string) => {
    const t = s.trim();
    // 输出以围栏开头（AI 常见）：整段剥掉外层围栏
    if (/^```(?:markdown|md)?\s*\n/i.test(t)) {
      const m = t.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)(?:\n```)?$/);
      if (m && m[1]?.trim()) return m[1].trim();
    }
    // 输出先写评语再用围栏包裹正文：提取围栏块（块需足够长，避免误吞正文里的短代码片段）
    const m = t.match(/```(?:markdown|md)?\s*\n([\s\S]*?)\n```/);
    if (m && m[1]?.split('\n').length > 3) return m[1].trim();
    // 兜底：剥掉首尾遗留围栏标记
    return t.replace(/^```(?:markdown|md)?\s*\n?/i, '').replace(/```\s*$/, '').trim();
  };
  // 文档 AI 快捷操作（生成/续写/润色/总结）：结果展示到对话框
  // 处理对象：开启「参考文档内容」用整篇文档，关闭则用选中文字作为上下文
  const runAi = async (action: string) => {
    if (aiChatBusy) return;
    setAiBusy(action);
    const src = aiRefDoc ? getLiveMd() : (aiChatCtx || getSelectedText() || getLiveMd());
    setAiMsgs((m) => [...m, { role: 'assistant', content: '' }]);
    let acc = '';
    const patch = (content: string) =>
      setAiMsgs((m) => {
        const c = [...m];
        c[c.length - 1] = { role: 'assistant', content };
        return c;
      });
    const scroll = () => {
      const el = aiChatBodyRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    };
    try {
      await streamJson(
        '/ai/doc',
        { action, title, content: src },
        (delta) => {
          acc += delta;
          patch(acc);
          scroll();
        },
      );
      if (!acc) {
        patch('（AI 未返回内容）');
        toast('AI 未返回内容', 'error');
      } else {
        patch(cleanAiMd(acc));
        scroll();
      }
    } catch (e) {
      patch(`⚠ ${(e as Error).message}`);
    } finally {
      setAiBusy(null);
    }
  };

  // 取当前选中文字（富文本读 DOM 选区；Markdown 源码读 textarea 选区）
  const getSelectedText = () => {
    const richSel = (window.getSelection()?.toString() ?? '').trim();
    if (richSel) return richSel;
    if (editStyle !== 'rich' && taRef.current) {
      const ta = taRef.current;
      if (ta.selectionStart != null && ta.selectionEnd != null && ta.selectionStart !== ta.selectionEnd) {
        return content.slice(ta.selectionStart, ta.selectionEnd).trim();
      }
    }
    return '';
  };

  // 打开 AI 对话框（ctx：选中文字 / 文档全文等上下文）
  const openAiChat = (ctx: string) => {
    setAiChatCtx(ctx);
    setAiMsgs([]);
    setAiInput('');
    setAiChatOpen(true);
    setTimeout(() => aiChatInputRef.current?.focus(), 0);
  };

  // 发送聊天消息（流式）
  const sendAiChat = async () => {
    const text = aiInput.trim();
    if (!text || aiChatBusy) return;
    setAiInput('');
    setAiMsgs((m) => [...m, { role: 'user', content: text }]);
    setAiMsgs((m) => [...m, { role: 'assistant', content: '' }]);
    setAiChatBusy(true);
    let acc = '';
    const patch = (content: string) =>
      setAiMsgs((m) => {
        const c = [...m];
        c[c.length - 1] = { role: 'assistant', content };
        return c;
      });
    try {
      await streamJson('/ai/chat', { message: text, context: aiChatCtx || undefined }, (delta: string) => {
        acc += delta;
        patch(acc);
        const el = aiChatBodyRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
      if (!acc) patch('（AI 未返回内容）');
    } catch (e) {
      patch(`⚠ ${(e as Error).message}`);
    } finally {
      setAiChatBusy(false);
    }
  };

  // 复制 AI 输出内容
  const copyAiMsg = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast('已复制');
    } catch {
      toast('复制失败', 'error');
    }
  };

  // 将 AI 输出内容作为增量追加写入当前文档末尾
  const writeToDoc = (md: string) => {
    const base = getLiveMd();
    const next = base.trim() ? `${base.trim()}\n\n${md}` : md;
    setContent(next);
    // 富文本模式同步渲染到编辑器 DOM，保留阅读内容
    if (editStyle === 'rich' && richRef.current) {
      renderRich(next);
    }
    setSaving(true);
    docApi
      .update(id!, { title, content: next })
      .then(() => {
        lastSaved.current = next;
        qc.invalidateQueries({ queryKey: ['doc-versions', id] });
        toast('已写入文档');
      })
      .catch((e) => toast((e as Error).message, 'error'))
      .finally(() => setSaving(false));
  };

  const onAiChatKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendAiChat();
    }
  };

  // ===== 翻译 =====
  const openTranslate = (fragmentOnly: boolean) => {
    const src = getLiveMd();
    const ta = taRef.current;
    const hasSel = editStyle !== 'rich' && !!ta && ta.selectionStart !== ta.selectionEnd;
    if (fragmentOnly && hasSel) {
      const s = ta!.selectionStart;
      const e = ta!.selectionEnd;
      setTranslatePanel({ text: src.slice(s, e), target: '英语', translated: '', mode: 'fragment', selStart: s, selEnd: e });
    } else {
      setTranslatePanel({ text: src, target: '英语', translated: '', mode: 'full', selStart: 0, selEnd: src.length });
    }
  };

  const runTranslate = async () => {
    const p = translatePanel;
    if (!p || !p.text.trim()) return;
    setTranslating(true);
    try {
      const r = await aiApi.translate({ text: p.text, target_lang: p.target, mode: p.mode });
      setTranslatePanel({ ...p, translated: r.translated });
      toast('翻译完成');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setTranslating(false);
    }
  };

  const applyTranslation = (how: 'replace' | 'append') => {
    const p = translatePanel;
    if (!p || !p.translated) return;
    if (p.mode === 'fragment') {
      const next = content.slice(0, p.selStart) + p.translated + content.slice(p.selEnd);
      onContent(next);
    } else if (how === 'replace') {
      onContent(p.translated);
    } else {
      onContent((content ? `${content}\n\n---\n\n` : '') + p.translated);
    }
    setTranslatePanel(null);
  };

  // ===== 评论 =====
  const toggleComments = () => {
    if (rightTab === 'comments') {
      setRightTab(null);
      return;
    }
    const selText =
      editStyle === 'rich'
        ? (window.getSelection()?.toString() ?? '').trim()
        : (content.slice(taRef.current?.selectionStart ?? 0, taRef.current?.selectionEnd ?? 0) || '').trim();
    setCommentSelection(selText ? { start: 0, text: selText } : null);
    setRightTab('comments');
    if (selText) requestAnimationFrame(() => commentInputRef.current?.focus());
  };

  const submitComment = async () => {
    if (!commentDraft.trim()) {
      toast('请输入评论内容', 'error');
      return;
    }
    try {
      await docApi.addComment(id!, {
        content: commentDraft.trim(),
        selection_start: commentSelection?.start ?? 0,
        selection_text: commentSelection?.text ?? '',
      });
      setCommentDraft('');
      setCommentSelection(null);
      qc.invalidateQueries({ queryKey: ['doc-comments', id] });
      toast('评论已发表');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const deleteComment = async (cid: string) => {
    try {
      await docApi.removeComment(id!, cid);
      qc.invalidateQueries({ queryKey: ['doc-comments', id] });
      toast('已删除评论');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const toggleResolve = async (cid: string) => {
    try {
      await docApi.toggleResolveComment(id!, cid);
      qc.invalidateQueries({ queryKey: ['doc-comments', id] });
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  // ===== 版本历史 =====
  const saveVersion = async () => {
    try {
      await docApi.createVersion(id!, versionNote || undefined);
      setVersionNote('');
      qc.invalidateQueries({ queryKey: ['doc-versions', id] });
      toast('版本已保存');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const restoreVersion = async (vid: string) => {
    if (!window.confirm('确定恢复该版本吗？当前内容会被替换（系统会自动备份一份当前快照）')) return;
    try {
      const d = await docApi.restoreVersion(id!, vid);
      setTitle(d.title);
      setContent(d.content);
      lastSaved.current = d.content;
      firstLoad.current = true;
      qc.invalidateQueries({ queryKey: ['doc', id] });
      qc.invalidateQueries({ queryKey: ['doc-versions', id] });
      toast('已恢复该版本');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  // ===== 导出 / 分享 =====
  const exportMd = () => {
    const blob = new Blob([`# ${title}\n\n${getLiveMd()}`], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title || 'document'}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPdf = () => {
    // 不再触发打印弹窗：改为浏览器内预览，并提供「下载 PDF」按钮
    setPdfHtml(renderMarkdown(getLiveMd()));
  };

  const downloadPdf = async () => {
    setPdfing(true);
    try {
      const { default: html2pdf } = await import('html2pdf.js');
      // 在独立 iframe 中渲染自包含打印文档（全部使用十六进制颜色），再交给
      // html2canvas 捕获生成 PDF。避免 html2canvas 无法解析 SPA 里 Tailwind v4
      // 的 oklch() 颜色而导出空白页，也规避离屏捕获引起的空白。
      const frame = document.createElement('iframe');
      frame.style.cssText = 'position:fixed;right:-10000px;top:0;width:794px;border:0';
      document.body.appendChild(frame);
      const src = buildPrintHtml(getLiveMd(), title);
      const loaded = new Promise<void>((resolve, reject) => {
        frame.onload = () => resolve();
        frame.onerror = () => reject(new Error('打印文档加载失败'));
      });
      frame.srcdoc = src;
      await loaded;
      const win = frame.contentWindow;
      if (!win) throw new Error('打印文档初始化失败');
      await html2pdf()
        .set({
          margin: [12, 12, 12, 12],
          filename: `${(title || 'document').replace(/[\\/:*?"<>|]/g, '-')}.pdf`,
          image: { type: 'jpeg', quality: 0.95 },
          html2canvas: {
            scale: 2,
            useCORS: true,
            backgroundColor: '#ffffff',
            window: win,
            windowWidth: 794,
          },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
          pagebreak: { mode: ['css', 'legacy'] },
        })
        .from(win.document.body)
        .save();
      frame.remove();
      toast(`已下载「${title || 'document'}.pdf」`);
    } catch (e) {
      toast((e as Error).message || 'PDF 生成失败', 'error');
    } finally {
      setPdfing(false);
    }
  };

  // 生成自包含打印文档（纯十六进制颜色，可安全被 html2canvas 解析）
  const buildPrintHtml = (md: string, docTitle: string): string => {
    const body = renderMarkdown(md || '');
    return (
      '<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>' +
      escapeHtml(docTitle) +
      '</title><style>' +
      '*{box-sizing:border-box}' +
      "body{font-family:-apple-system,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;color:#1a1a2e;max-width:760px;margin:0 auto;padding:24px 32px;line-height:1.75;font-size:14px}" +
      'h1{font-size:26px;color:#111;border-bottom:1px solid #e8ecf2;padding-bottom:10px}' +
      'h2{font-size:20px}h3{font-size:16px}' +
      'p{margin:0.75em 0}' +
      'pre{background:#1a1a2e;color:#e8ecf2;padding:14px 16px;border-radius:12px;overflow-x:auto;font-size:13px}' +
      'code{background:#f0eefe;color:#5c3ee6;border-radius:5px;padding:0.15em 0.4em;font-size:0.92em}' +
      'pre code{background:transparent;color:inherit;padding:0}' +
      'blockquote{border-left:3px solid #7c5cff;padding-left:14px;color:#81899b;margin:0.75em 0}' +
      'a{color:#5c3ee6}' +
      'table{border-collapse:collapse;width:100%;margin:0.75em 0}' +
      'th,td{border:1px solid #e8ecf2;padding:8px 12px;text-align:left;vertical-align:top}' +
      'th{background:#f6f5ff}' +
      'mark{background:rgba(243,174,67,.35)}' +
      'img{max-width:100%}' +
      'ul,ol{padding-left:24px}' +
      'hr{border:none;border-top:1px solid #e8ecf2;margin:1.25em 0}' +
      '@media print{body{margin:0}}' +
      '</style></head><body>' +
      body +
      '</body></html>'
    );
  };

  const exportWord = () => {
    const outHtml = renderMarkdown(getLiveMd());
    const h = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1>${outHtml}</body></html>`;
    const blob = new Blob(['\ufeff', h], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title || 'document'}.doc`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast('链接已复制');
    } catch {
      toast('复制失败，请手动复制地址栏链接', 'error');
    }
  };

  const del = async () => {
    try {
      await docApi.remove(id!);
      toast('已删除');
      navigate(isWiki ? '/wiki' : '/docs');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  // ===== 预览 HTML / 演示 =====
  const html = useMemo(() => renderMarkdown(content), [content]);
  // PDF 预览（浏览器内预览 + 下载按钮，不再触发打印弹窗）
  const [pdfHtml, setPdfHtml] = useState<string | null>(null);
  const [pdfing, setPdfing] = useState(false);
  const slides = useMemo(() => splitSlides(content), [content]);
  const charCount = content.length;
  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;

  // 倒计时刷新
  useEffect(() => {
    if (!presenting && !preview) return;
    const tick = () => {
      document.querySelectorAll<HTMLElement>('[data-timer-end]').forEach((el) => {
        const end = new Date(el.dataset.timerEnd || '').getTime();
        const val = el.querySelector('.timer-value');
        if (!val) return;
        const diff = end - Date.now();
        if (Number.isNaN(end) || diff <= 0) {
          val.textContent = '已结束';
          return;
        }
        const d = Math.floor(diff / 86400000);
        const h = Math.floor(diff / 3600000) % 24;
        const m = Math.floor(diff / 60000) % 60;
        const s = Math.floor(diff / 1000) % 60;
        val.textContent = d > 0 ? `${d}天 ${h}时 ${m}分 ${s}秒` : `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
      });
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [presenting, preview, content]);

  // 演示模式键盘
  useEffect(() => {
    if (!presenting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') {
        setPresentIdx((i) => Math.min(i + 1, slides.length - 1));
        e.preventDefault();
      } else if (e.key === 'ArrowLeft') {
        setPresentIdx((i) => Math.max(i - 1, 0));
        e.preventDefault();
      } else if (e.key === 'Escape') {
        setPresenting(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [presenting, slides.length]);

  // ===== 快捷键 =====
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const key = e.key.toLowerCase();
    const mod = isMac() ? e.metaKey : e.ctrlKey;

    // 斜杠菜单导航
    if (slashOpen) {
      if (key === 'arrowdown') {
        e.preventDefault();
        setSlashIdx((i) => (i + 1) % Math.max(slashList.length, 1));
        return;
      }
      if (key === 'arrowup') {
        e.preventDefault();
        setSlashIdx((i) => (i - 1 + slashList.length) % Math.max(slashList.length, 1));
        return;
      }
      if (key === 'enter' || key === 'tab') {
        e.preventDefault();
        if (slashList[slashIdx]) runSlashCmd(slashList[slashIdx]);
        return;
      }
      if (key === 'escape') {
        e.preventDefault();
        setSlashOpen(false);
        return;
      }
    }

    // @ 提及菜单导航
    if (mentionOpen) {
      if (key === 'arrowdown') {
        e.preventDefault();
        setMentionIdx((i) => (i + 1) % Math.max(mentionUsers.length, 1));
        return;
      }
      if (key === 'arrowup') {
        e.preventDefault();
        setMentionIdx((i) => (i - 1 + mentionUsers.length) % Math.max(mentionUsers.length, 1));
        return;
      }
      if (key === 'enter' || key === 'tab') {
        e.preventDefault();
        if (mentionUsers[mentionIdx]) insertMention(mentionUsers[mentionIdx]);
        return;
      }
      if (key === 'escape') {
        e.preventDefault();
        setMentionOpen(false);
        return;
      }
    }

    if (mod) {
      const combo = `${key}${e.shiftKey ? '+shift' : ''}`;
      if (combo === 'b') {
        e.preventDefault();
        doInline('**', '**');
        return;
      }
      if (combo === 'i') {
        e.preventDefault();
        doInline('*', '*');
        return;
      }
      if (combo === 'u') {
        e.preventDefault();
        doInline('<u>', '</u>');
        return;
      }
      if (combo === 'f' || combo === 'h+shift') {
        e.preventDefault();
        setFindOpen(true);
        setFindQuery(taRef.current?.selectionStart !== taRef.current?.selectionEnd ? content.slice(taRef.current!.selectionStart, taRef.current!.selectionEnd) : '');
        setTimeout(() => findRef.current?.querySelector('input')?.focus(), 0);
        return;
      }
      if (combo === 'enter') {
        e.preventDefault();
        saveNow();
        return;
      }
      if (combo === 'p+shift') {
        e.preventDefault();
        setPresenting(true);
        setPresentIdx(0);
        return;
      }
    }

    if (key === 'escape') {
      setFindOpen(false);
    }
  };

  // ===== 富文本模式快捷键 =====
  const onRichKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const key = e.key.toLowerCase();
    const mod = isMac() ? e.metaKey : e.ctrlKey;

    // 斜杠菜单导航
    if (slashOpen) {
      if (key === 'arrowdown') {
        e.preventDefault();
        setSlashIdx((i) => (i + 1) % Math.max(slashList.length, 1));
        return;
      }
      if (key === 'arrowup') {
        e.preventDefault();
        setSlashIdx((i) => (i - 1 + slashList.length) % Math.max(slashList.length, 1));
        return;
      }
      if (key === 'enter' || key === 'tab') {
        e.preventDefault();
        if (slashList[slashIdx]) runSlashCmd(slashList[slashIdx]);
        return;
      }
      if (key === 'escape') {
        e.preventDefault();
        setSlashOpen(false);
        return;
      }
    }

    // @ 提及菜单导航
    if (mentionOpen) {
      if (key === 'arrowdown') {
        e.preventDefault();
        setMentionIdx((i) => (i + 1) % Math.max(mentionUsers.length, 1));
        return;
      }
      if (key === 'arrowup') {
        e.preventDefault();
        setMentionIdx((i) => (i - 1 + mentionUsers.length) % Math.max(mentionUsers.length, 1));
        return;
      }
      if (key === 'enter' || key === 'tab') {
        e.preventDefault();
        if (mentionUsers[mentionIdx]) insertMentionRich(mentionUsers[mentionIdx]);
        return;
      }
      if (key === 'escape') {
        e.preventDefault();
        setMentionOpen(false);
        return;
      }
    }

    if (mod) {
      const combo = `${key}${e.shiftKey ? '+shift' : ''}`;
      if (combo === 'b') {
        e.preventDefault();
        execRich('bold');
        return;
      }
      if (combo === 'i') {
        e.preventDefault();
        execRich('italic');
        return;
      }
      if (combo === 'u') {
        e.preventDefault();
        execRich('underline');
        return;
      }
      if (combo === 'f' || combo === 'h+shift') {
        e.preventDefault();
        setFindOpen(true);
        const selText = window.getSelection()?.toString() ?? '';
        setFindQuery(selText);
        setTimeout(() => findRef.current?.querySelector('input')?.focus(), 0);
        return;
      }
      if (combo === 'enter') {
        e.preventDefault();
        saveNow();
        return;
      }
      if (combo === 'p+shift') {
        e.preventDefault();
        setPresenting(true);
        setPresentIdx(0);
        return;
      }
    }

    // 回车：Shift+Enter 软换行；表格单元格内回车 → 软换行（避免新建段破坏表格）；标题内回车 → 新正文段落；其余一律用浏览器原生 insertParagraph，保证空块/分割线边界都能连续换行
    if (key === 'enter') {
      const inCell = richRef.current ? isInsideTableCell(richRef.current) : false;
      if (e.shiftKey || inCell) {
        // 软换行：表格单元格内 / Shift+Enter，用 insertLineBreak 比 insertHTML('<br>') 更可靠（连续换行不塌陷）
        e.preventDefault();
        document.execCommand('insertLineBreak', false);
      } else if (richRef.current) {
        const tag = getCurrentBlockTag(richRef.current);
        if (tag && /^H[1-6]$/.test(tag)) {
          // 标题内回车：降级为正文段落
          splitRichBlockAtCaret(richRef.current);
        } else {
          document.execCommand('insertParagraph');
        }
        e.preventDefault();
      }
      return;
    }

    if (key === 'escape') {
      setFindOpen(false);
    }
  };

  // ===== 富文本链接点击：阻止进入编辑状态，改为点击跳转（新标签） =====
  const richLinkTarget = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a');
    if (!a || a.classList.contains('anchor') || a.classList.contains('wiki-link')) return null;
    return a.getAttribute('href');
  };

  // hover 检测：显示链接气泡；移出后延迟关闭，允许鼠标滑到气泡上
  const onRichMouseOver = (e: React.MouseEvent) => {
    clearTimeout(linkHoverTimer.current);
    if (linkBarRef.current?.contains(e.target as Node)) return; // 已在气泡内，保持
    const a = (e.target as HTMLElement).closest('a');
    const link = a && !a.classList.contains('anchor') && !a.classList.contains('wiki-link') ? a : null;
    if (link) {
      if (linkHoverElRef.current === link) return;
      linkHoverElRef.current = link;
      const r = link.getBoundingClientRect();
      const above = r.top > 64;
      setLinkHover({ left: r.left + r.width / 2, top: above ? r.top - 12 : r.bottom + 14, above });
    } else if (linkHoverElRef.current) {
      linkHoverTimer.current = window.setTimeout(() => {
        setLinkHover(null);
        linkHoverElRef.current = null;
      }, 140);
    }
  };

  const onRichMouseLeave = () => {
    if (linkBarRef.current?.matches(':hover')) return;
    linkHoverTimer.current = window.setTimeout(() => {
      setLinkHover(null);
      linkHoverElRef.current = null;
    }, 140);
  };

  // 从气泡点「编辑」：打开链接配置弹窗，预填当前链接的 URL 与显示名
  const openLinkEdit = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const a = linkHoverElRef.current;
    if (!a) return;
    linkEditElRef.current = a;
    setLinkUrl(a.getAttribute('href') || '');
    setLinkLabel((a.textContent || '').trim() || '链接');
    setLinkHover(null);
    linkHoverElRef.current = null;
    setLinkOpen(true);
    setTimeout(() => linkModalRef.current?.querySelector('input')?.focus(), 0);
  };

  const richMouseDown = (e: React.MouseEvent) => {
    const href = richLinkTarget(e);
    if (href) {
      // 阻止把光标放进入链接（进编辑态），链接保持可点击
      e.preventDefault();
      return;
    }
    richTableMouseDown(e);
  };

  const richClick = (e: React.MouseEvent) => {
    const href = richLinkTarget(e);
    if (href) {
      e.preventDefault();
      window.open(href, '_blank', 'noopener,noreferrer');
    }
    requestAnimationFrame(scanPopupsRich);
    requestAnimationFrame(scanTableActive);
  };

  // ===== 预览锚点点击 =====
  const onPreviewClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a.anchor');
    if (a) {
      e.preventDefault();
      const href = a.getAttribute('href') || '';
      navigator.clipboard.writeText(`${window.location.origin}${location.pathname}${href}`).then(
        () => toast('锚点链接已复制'),
        () => {},
      );
    }
    const wiki = (e.target as HTMLElement).closest('a.wiki-link');
    if (wiki && wiki.getAttribute('href')) {
      e.preventDefault();
      navigate(wiki.getAttribute('href')!);
    }
  };

  if (doc.isLoading) return <div className="flex h-full items-center justify-center"><Spinner size={24} /></div>;
  if (doc.isError) return <Empty icon="/pulse-documents.svg" title="文档不存在或无权访问" />;

  return (
    <div className="flex h-full flex-col">
      {/* 顶栏 */}
      <div className="flex items-center gap-2 border-b border-line bg-white/90 px-5 py-2.5">
        <button onClick={() => navigate(isWiki ? '/wiki' : '/docs')} className="rounded-lg p-1.5 text-muted transition hover:bg-surface hover:text-ink" title="返回">
          <ArrowLeft size={18} />
        </button>
        {isWiki && (
          <div className="flex min-w-0 items-center gap-0.5 text-13px text-muted">
            <button
              onClick={() => setWikiTreeOpen((v) => !v)}
              className="rounded-lg p-1.5 text-muted transition hover:bg-surface hover:text-ink"
              title={wikiTreeOpen ? '收起目录' : '展开目录'}
            >
              {wikiTreeOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
            </button>
            <button onClick={() => navigate('/wiki')} className="shrink-0 rounded px-1 font-600 text-muted hover:text-violet">
              知识库
            </button>
            {(ancestors.data ?? []).slice(0, -1).map((a) => (
              <span key={a.id} className="flex min-w-0 items-center gap-0.5">
                <ChevronRight size={13} className="shrink-0 text-muted" />
                <button
                  onClick={() => navigate(`/wiki/${a.id}`)}
                  className="max-w-36 truncate rounded px-1 font-600 text-ink/70 hover:text-violet"
                >
                  {a.title}
                </button>
              </span>
            ))}
          </div>
        )}
        <input
          className="min-w-0 flex-1 border-none bg-transparent font-display text-16px font-700 text-ink outline-none"
          value={title}
          onChange={(e) => onTitle(e.target.value)}
          placeholder="未命名文档"
        />
        <span className={`shrink-0 text-11px font-600 ${saving ? 'text-amber' : 'text-muted'}`}>
          {saving ? '保存中…' : '已自动保存'}
        </span>

        <div className="ml-2 flex items-center gap-1 rounded-xl border border-line bg-white p-1">
          <button
            onClick={() => setRightTab(rightTab === 'outline' ? null : 'outline')}
            className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-12px font-650 transition ${
              rightTab === 'outline' ? 'bg-violet-light text-violet' : 'text-muted hover:text-ink'
            }`}
            title="大纲"
          >
            <ListTree size={14} /> 大纲
          </button>
          <button
            onClick={toggleComments}
            className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-12px font-650 transition ${
              rightTab === 'comments' ? 'bg-violet-light text-violet' : 'text-muted hover:text-ink'
            }`}
            title="评论"
          >
            <MessageSquare size={14} /> 评论{comments.data?.length ? <span className="text-coral">{comments.data.length}</span> : null}
          </button>
          <button
            onClick={() => setRightTab(rightTab === 'versions' ? null : 'versions')}
            className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-12px font-650 transition ${
              rightTab === 'versions' ? 'bg-violet-light text-violet' : 'text-muted hover:text-ink'
            }`}
            title="版本历史"
          >
            <History size={14} /> 版本
          </button>
        </div>

        <button
          onClick={togglePreview}
          className={`flex shrink-0 items-center gap-1 rounded-lg border px-3 py-1.5 text-12px font-650 transition ${
            preview
              ? 'border-violet-border bg-violet-light text-violet'
              : 'border-line bg-white text-muted hover:border-violet-border hover:text-violet'
          }`}
          title="预览 / 返回编辑"
        >
          {preview ? <Pencil size={13} /> : <Eye size={13} />} {preview ? '返回编辑' : '预览'}
        </button>
        <button
          onClick={() => switchEditStyle(editStyle === 'md' ? 'rich' : 'md')}
          className={`flex shrink-0 items-center gap-1 rounded-lg border px-3 py-1.5 text-12px font-650 transition ${
            editStyle === 'md'
              ? 'border-violet-border bg-violet-light text-violet'
              : 'border-line bg-white text-muted hover:border-violet-border hover:text-violet'
          }`}
          title="切换 Markdown 源码 / 富文本"
        >
          <Code2 size={13} /> {editStyle === 'md' ? 'Markdown 源码' : '源码'}
        </button>

        <button className="btn btn-ghost !px-2.5" onClick={() => setPageWide((w) => !w)} title="切换页面宽度（宽 / 窄）">
          <LayoutPanelLeft size={15} />
        </button>
        <button className="btn btn-ghost !px-2.5" onClick={() => setPresenting(true)} title="演示模式 (⌘⇧P)">
          <Presentation size={15} />
        </button>
        <button className="btn btn-ghost !px-2.5" onClick={() => openTranslate(false)} title="翻译全文">
          <Languages size={15} />
        </button>
        <button
          className={`btn btn-ghost !px-2.5 ${revisionMode ? '!border-violet !text-violet' : ''}`}
          onClick={() => setRevisionMode((r) => !r)}
          title="修订模式"
        >
          <GitCompare size={15} />
        </button>
        <ShareMenu docId={id!} />
        <div className="group relative">
          <button className="btn btn-ghost !px-2.5" title="导出">
            <FileDown size={15} />
          </button>
          <div className="invisible absolute right-0 top-full z-20 mt-1 w-40 overflow-hidden rounded-xl border border-line bg-white py-1 opacity-0 shadow-card transition-all duration-200 group-hover:visible group-hover:opacity-100">
            <button onClick={exportMd} className="block w-full px-4 py-2 text-left text-12px font-600 text-ink hover:bg-violet-light">导出 Markdown (.md)</button>
            <button onClick={exportPdf} className="block w-full px-4 py-2 text-left text-12px font-600 text-ink hover:bg-violet-light">导出 PDF（打印）</button>
            <button onClick={exportWord} className="block w-full px-4 py-2 text-left text-12px font-600 text-ink hover:bg-violet-light">导出 Word (.doc)</button>
          </div>
        </div>
        <button
          className="btn btn-ghost !px-2.5"
          onClick={() => importInputRef.current?.click()}
          title="导入 Markdown / PDF / Word"
          disabled={importing}
        >
          <Upload size={15} /> {importing ? '导入中…' : '导入'}
        </button>
        <input
          ref={importInputRef}
          type="file"
          accept={IMPORT_ACCEPT}
          className="hidden"
          onChange={(e) => handleImport(e.target.files?.[0])}
        />
        {/* 更多：删除等操作 */}
        <div className="group relative">
          <button className="btn btn-ghost !px-2.5" title="更多">
            <MoreHorizontal size={15} />
          </button>
          <div className="invisible absolute right-0 top-full z-20 mt-1 w-40 overflow-hidden rounded-xl border border-line bg-white py-1 opacity-0 shadow-card transition-all duration-200 group-hover:visible group-hover:opacity-100">
            <button
              onClick={() => setBacklinksOpen(true)}
              className="block w-full px-4 py-2 text-left text-12px font-600 text-ink hover:bg-violet-light"
            >
              反向链接
            </button>
            <button
              onClick={async () => {
                try {
                  await saveNow();
                  await docApi.saveAsTemplate(id!, title);
                  toast('已保存为模板，可在「新建 → 从模板新建」中使用');
                } catch (e) {
                  toast((e as Error).message, 'error');
                }
              }}
              className="block w-full px-4 py-2 text-left text-12px font-600 text-ink hover:bg-violet-light"
            >
              另存为模板
            </button>
            <button
              onClick={() => setConfirmDel(true)}
              className="block w-full px-4 py-2 text-left text-12px font-600 text-coral hover:bg-coral/10"
            >
              删除文档
            </button>
          </div>
        </div>
      </div>

      {/* 富文本格式工具栏 */}
      <div ref={toolBarRef} className="flex items-center gap-0.5 overflow-x-auto border-b border-line bg-white/90 px-5 py-1.5">
        <button
          onClick={() => openAiChat(getSelectedText())}
          className="mr-1 flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-violet px-2.5 text-11px font-700 text-white transition hover:brightness-110"
          title="AI 助手：针对选中文字与 AI 对话"
        >
          <Sparkles size={13} /> AI
        </button>
        <Divider />
        <ToolBtn title="一级标题" icon={Heading1} onClick={() => toolbarHeading(1)} />
        <ToolBtn title="二级标题" icon={Heading2} onClick={() => toolbarHeading(2)} />
        <ToolBtn title="三级标题" icon={Heading3} onClick={() => toolbarHeading(3)} />
        <Divider />
        <ToolBtn title="加粗" icon={Bold} onClick={toolbarBold} />
        <ToolBtn title="斜体" icon={Italic} onClick={toolbarItalic} />
        <ToolBtn title="下划线" icon={Underline} onClick={toolbarUnderline} />
        <ToolBtn title="删除线" icon={Strikethrough} onClick={toolbarStrike} />
        <ToolBtn title="高亮" icon={Highlighter} onClick={toolbarHighlight} />
        <ToolBtn title="行内代码" icon={Code} onClick={toolbarCode} />
        <Divider />
        <ToolBtn title="无序列表" icon={List} onClick={toolbarUL} />
        <ToolBtn title="有序列表" icon={ListOrdered} onClick={toolbarOL} />
        <ToolBtn title="任务列表" icon={ListChecks} onClick={toolbarTask} />
        <Divider />
        <ToolBtn title="引用" icon={Quote} onClick={toolbarQuote} />
        <ToolBtn title="高亮块" icon={MessageSquareQuote} onClick={toolbarCallout} />
        <ToolBtn title="分栏" icon={Columns2} onClick={toolbarColumns} />
        <ToolBtn title="公式" icon={Sigma} onClick={toolbarFormula} />
        <ToolBtn title="代码块" icon={Code2} onClick={toolbarCodeBlock} />
        <ToolBtn title="分割线" icon={Minus} onClick={toolbarDivider} />
        <ToolBtn title="链接" icon={Link} onClick={toolbarLink} />
        <ToolBtn title="图片" icon={Image} onClick={toolbarImage} />
        <ToolBtn title="表格" icon={Table} onClick={toolbarTable} />
        <Divider />
        <ToolBtn title="左对齐" icon={AlignLeft} onClick={() => toolbarAlign('left')} />
        <ToolBtn title="居中" icon={AlignCenter} onClick={() => toolbarAlign('center')} />
        <ToolBtn title="右对齐" icon={AlignRight} onClick={() => toolbarAlign('right')} />
        <Divider />
        <button
          onClick={() => {
            setFindOpen(true);
            setTimeout(() => findRef.current?.querySelector('input')?.focus(), 0);
          }}
          className="flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-11px font-650 text-muted transition hover:bg-violet-light hover:text-violet"
          title="查找替换 (⌘F / ⌘⇧H)"
        >
          <Search size={14} /> 查找替换
        </button>
        <button
          onClick={toggleComments}
          className="flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-11px font-650 text-muted transition hover:bg-violet-light hover:text-violet"
          title="针对选中文字发表评论"
        >
          <MessageSquare size={14} /> 评论选中
        </button>
        <button
          onClick={() => openTranslate(true)}
          className="flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-11px font-650 text-muted transition hover:bg-violet-light hover:text-violet"
          title="翻译选中文字"
        >
          <Languages size={14} /> 翻译选中
        </button>
      </div>

      {/* 主编辑区 + 右侧面板 */}
      <div className="flex min-h-0 flex-1 bg-white">
        {isWiki && wikiTreeOpen && doc.data && (
          <WikiSidebar
            scope={doc.data.team_id ? 'team' : 'personal'}
            teamId={doc.data.team_id ?? undefined}
            currentId={doc.data.id}
            ancestors={ancestors.data ?? []}
          />
        )}
        {/* 主编辑区 */}
        <div className="flex min-w-0 flex-1">
          <div className="relative min-w-0 flex-1 overflow-y-auto bg-white">
            {preview ? (
              <div className="min-h-full overflow-y-auto px-8 py-6">
                {revisionMode ? (
                  <div className="mx-auto" style={{ width: pageWide ? '100%' : 760, maxWidth: '100%' }}>
                    <h1 className="mb-2 font-display text-[36px] font-[800] text-ink">{title}</h1>
                    <p className="mb-4 rounded-lg bg-amber/10 px-3 py-1.5 text-11px font-650 text-amber">
                      修订模式：绿色为新增，红色删除线为移除（对比最近一次保存）
                    </p>
                    <div className="md-body">
                      {simpleDiff(lastSaved.current, content).map((l, i) => (
                        <div key={i} className={l.type === 'add' ? 'rev-add' : l.type === 'del' ? 'rev-del' : ''}>
                          {l.text || ' '}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div ref={previewRef} className="mx-auto" style={{ width: pageWide ? '100%' : 760, maxWidth: '100%' }} onClick={onPreviewClick}>
                    <h1 className="pt-8 font-display text-[36px] font-[800] text-ink">{title}</h1>
                    {doc.data && (
                      <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-12px text-muted">
                        {doc.data.owner_name && (
                          <span className="flex items-center gap-1.5">
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-light text-10px font-700 text-violet">
                              {doc.data.owner_name.slice(0, 1).toUpperCase()}
                            </span>
                            <span className="font-600 text-ink/70">{doc.data.owner_name}</span>
                          </span>
                        )}
                        {doc.data.created_at && (
                          <>
                            <span className="opacity-50">·</span>
                            <span>创作于 {fmtTime(doc.data.created_at)}</span>
                          </>
                        )}
                      </div>
                    )}
                    <div className="mb-4 mt-4 h-px bg-line" />
                    <div className="md-body" dangerouslySetInnerHTML={{ __html: html }} />
                  </div>
                )}
              </div>
            ) : (
              <div ref={richWrapRef} className="relative min-h-full">
                {/* 文档标题（上）+ 分割线：标题与正文分离 */}
                <div className="mx-auto px-6 pt-8" style={{ width: pageWide ? '100%' : 720, maxWidth: '100%' }}>
                  <input
                    className="doc-title-input w-full border-none bg-transparent font-display text-[36px] font-[800] leading-tight text-ink outline-none"
                    value={title}
                    onChange={(e) => onTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        (editStyle === 'rich' ? richRef.current : taRef.current)?.focus();
                      }
                    }}
                    onClick={() => {
                      setSlashOpen(false);
                      setMentionOpen(false);
                    }}
                    placeholder="输入文档标题…"
                  />
                  {/* 文档创作者 · 创作时间 */}
                  {doc.data && (
                    <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-12px text-muted">
                      {doc.data.owner_name && (
                        <span className="flex items-center gap-1.5">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-light text-10px font-700 text-violet">
                            {doc.data.owner_name.slice(0, 1).toUpperCase()}
                          </span>
                          <span className="font-600 text-ink/70">{doc.data.owner_name}</span>
                        </span>
                      )}
                      {doc.data.created_at && (
                        <>
                          <span className="opacity-50">·</span>
                          <span>创作于 {fmtTime(doc.data.created_at)}</span>
                        </>
                      )}
                    </div>
                  )}
                  <div className="mb-2 mt-4 h-px bg-line" />
                </div>
                {editStyle === 'rich' ? (
                  <div
                    ref={richRef}
                    contentEditable
                    suppressContentEditableWarning
                    spellCheck={false}
                    className="rich-editor md-body mx-auto min-h-[60vh] bg-white px-6 py-5 outline-none"
                    style={{ width: pageWide ? '100%' : 720, maxWidth: '100%' }}
                    data-placeholder="在此输入文档内容…\n\n输入 / 快速插入内容（如 /glk 高亮块、/fl 分栏、/djs 倒计时、/swdt 思维导图）\n输入 @ 提及成员"
                    onKeyUp={() => {
                      requestAnimationFrame(scanPopupsRich);
                      requestAnimationFrame(scanTableActive);
                    }}
                    onClick={richClick}
                    onMouseOver={onRichMouseOver}
                    onMouseLeave={onRichMouseLeave}
                    onMouseDown={richMouseDown}
                    onMouseMove={richTableMouseMove}
                    onMouseUp={() => requestAnimationFrame(scanTableActive)}
                    onInput={() => {
                      // 保存由 useEffect 监听 input 完成
                    }}
                    onKeyDown={onRichKeyDown}
                    onContextMenu={openPasteMenu}
                    onPaste={onRichPaste}
                    onBlur={() => {
                      // 失焦时清除空行占位，避免占位残留
                      richRef.current?.querySelectorAll('[data-ph]').forEach((n) => n.removeAttribute('data-ph'));
                    }}
                  />
                ) : (
                  <textarea
                    ref={taRef}
                    className="mx-auto block resize-none bg-white px-6 py-5 font-mono text-13px leading-7 text-ink outline-none"
                    style={{ width: pageWide ? '100%' : 720, maxWidth: '100%' }}
                    value={content}
                    onChange={(e) => {
                      onContent(e.target.value);
                      requestAnimationFrame(scanPopups);
                    }}
                    onKeyDown={onKeyDown}
                    onClick={() => requestAnimationFrame(scanPopups)}
                    onSelect={() => requestAnimationFrame(scanPopups)}
                    placeholder={'在此输入 Markdown 内容…\n\n# 标题\n\n- 列表项\n\n**加粗** 等语法\n\n输入 / 插入飞书风格内容（如 /glk 高亮块、/fl 分栏、/djs 倒计时）\n输入 @ 提及成员'}
                  />
                )}

                {/* 右键菜单：编辑操作 + 选择性粘贴 */}
                {pasteMenu && editStyle === 'rich' && (
                  <div
                    className="paste-menu fixed z-50 max-h-[80vh] w-44 overflow-hidden overflow-y-auto rounded-xl border border-line bg-white py-1 shadow-card"
                    style={{ left: pasteMenu.x, top: pasteMenu.y }}
                    onMouseDown={(e) => e.preventDefault()}
                  >
                    <div className="px-3 pb-1 pt-2 text-10px font-650 uppercase tracking-wide text-muted">编辑</div>
                    <button
                      className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition hover:bg-violet-light"
                      onClick={() => runEditCmd('copy')}
                    >
                      <Copy size={14} className="shrink-0 text-violet" />
                      <span className="text-12px font-650 text-ink">复制</span>
                    </button>
                    <button
                      className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition hover:bg-violet-light"
                      onClick={() => runEditCmd('cut')}
                    >
                      <Scissors size={14} className="shrink-0 text-violet" />
                      <span className="text-12px font-650 text-ink">剪切</span>
                    </button>
                    <button
                      className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition hover:bg-violet-light"
                      onClick={() => runEditCmd('delete')}
                    >
                      <Trash2 size={14} className="shrink-0 text-violet" />
                      <span className="text-12px font-650 text-ink">删除</span>
                    </button>
                    <div className="mx-3 my-1 h-px bg-line" />
                    <button
                      className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition hover:bg-violet-light"
                      onClick={() => runEditCmd('select')}
                    >
                      <MousePointer2 size={14} className="shrink-0 text-violet" />
                      <span className="text-12px font-650 text-ink">选择</span>
                    </button>
                    <button
                      className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition hover:bg-violet-light"
                      onClick={() => runEditCmd('selectAll')}
                    >
                      <SquareCheckBig size={14} className="shrink-0 text-violet" />
                      <span className="text-12px font-650 text-ink">全选</span>
                    </button>
                    <div className="mx-3 my-1 h-px bg-line" />
                    <div className="px-3 pb-1 pt-2 text-10px font-650 uppercase tracking-wide text-muted">选择性粘贴</div>
                    <button
                      className="flex w-full items-start gap-2.5 px-3 py-1.5 text-left transition hover:bg-violet-light"
                      onClick={() => pasteFromMenu('keep')}
                    >
                      <Copy size={14} className="mt-0.5 shrink-0 text-violet" />
                      <span>
                        <span className="block text-12px font-650 text-ink">保留原文件格式</span>
                        <span className="block text-10px text-muted">与复制内容格式保持一致</span>
                      </span>
                    </button>
                    <button
                      className="flex w-full items-start gap-2.5 px-3 py-1.5 text-left transition hover:bg-violet-light"
                      onClick={() => pasteFromMenu('match')}
                    >
                      <AlignLeft size={14} className="mt-0.5 shrink-0 text-violet" />
                      <span>
                        <span className="block text-12px font-650 text-ink">匹配格式</span>
                        <span className="block text-10px text-muted">转为当前文档格式（标题/字体/大纲）</span>
                      </span>
                    </button>
                    <button
                      className="flex w-full items-start gap-2.5 px-3 py-1.5 text-left transition hover:bg-violet-light"
                      onClick={() => pasteFromMenu('text')}
                    >
                      <Type size={14} className="mt-0.5 shrink-0 text-violet" />
                      <span>
                        <span className="block text-12px font-650 text-ink">仅保留文本</span>
                        <span className="block text-10px text-muted">仅复制纯文本内容</span>
                      </span>
                    </button>
                  </div>
                )}

                {/* 斜杠菜单 */}
                {slashOpen && (
                  <div ref={slashRef} style={{ left: slashPos.left, top: slashPos.top }}>
                    <SlashMenu cmds={slashList} active={slashIdx} onSelect={runSlashCmd} style={{ position: 'absolute' }} />
                  </div>
                )}

                {/* 表格 9×9 插入选择器 */}
                {tablePick && (
                  <div
                    ref={tablePickRef}
                    className="fixed z-50 rounded-xl border border-line bg-white p-3 shadow-card"
                    style={{ left: tablePick.left, top: tablePick.top }}
                  >
                    <div className="grid grid-cols-9 gap-1">
                      {Array.from({ length: 81 }).map((_, i) => {
                        const r = Math.floor(i / 9) + 1;
                        const c = (i % 9) + 1;
                        const on = r <= tablePickRC.r && c <= tablePickRC.c;
                        return (
                          <button
                            key={i}
                            type="button"
                            onMouseEnter={() => setTablePickRC({ r, c })}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              insertTableRich(tablePickRC.r, tablePickRC.c);
                            }}
                            className={`h-4 w-4 rounded-[3px] transition ${on ? 'bg-violet' : 'bg-surface hover:bg-violet-light'}`}
                          />
                        );
                      })}
                    </div>
                    <div className="mt-2 text-center text-11px font-650 text-muted">
                      {tablePickRC.r} × {tablePickRC.c}
                    </div>
                  </div>
                )}

                {/* 表格浮动工具条（当前单元格在表格内时出现） */}
                {tableBar && activeCell && cellTable(activeCell) && (
                  <div
                    className="fixed z-50 flex items-center gap-0.5 rounded-lg border border-line bg-white px-1 py-0.5 shadow-card"
                    style={
                      (() => {
                        const r = cellTable(activeCell)!.getBoundingClientRect();
                        const w = 8 * 30;
                        return { left: Math.min(Math.max(8, r.right - w - 12), window.innerWidth - w - 12), top: Math.max(8, r.top - 40) };
                      })()
                    }
                  >
                    <button title="在左侧插入一列" onMouseDown={(e) => { e.preventDefault(); tableOpLeft(); }} className="flex h-6 shrink-0 items-center gap-0.5 rounded-md px-1.5 text-10px font-650 text-muted transition hover:bg-violet-light hover:text-violet">
                      <Plus size={11} /><span>左列</span>
                    </button>
                    <button title="在右侧插入一列" onMouseDown={(e) => { e.preventDefault(); tableOpRight(); }} className="flex h-6 shrink-0 items-center gap-0.5 rounded-md px-1.5 text-10px font-650 text-muted transition hover:bg-violet-light hover:text-violet">
                      <ChevronRight size={11} /><span>右列</span>
                    </button>
                    <button title="删除此列" onMouseDown={(e) => { e.preventDefault(); tableOpDelCol(); }} className="flex h-6 shrink-0 items-center gap-0.5 rounded-md px-1.5 text-10px font-650 text-muted transition hover:bg-coral/10 hover:text-coral">
                      <Trash2 size={11} /><span>删列</span>
                    </button>
                    <div className="mx-1 h-4 w-px bg-line" />
                    <button title="在上方插入一行" onMouseDown={(e) => { e.preventDefault(); tableOpUp(); }} className="flex h-6 shrink-0 items-center gap-0.5 rounded-md px-1.5 text-10px font-650 text-muted transition hover:bg-violet-light hover:text-violet">
                      <Plus size={11} /><span>上行</span>
                    </button>
                    <button title="在下方插入一行" onMouseDown={(e) => { e.preventDefault(); tableOpDown(); }} className="flex h-6 shrink-0 items-center gap-0.5 rounded-md px-1.5 text-10px font-650 text-muted transition hover:bg-violet-light hover:text-violet">
                      <Plus size={11} /><span>下行</span>
                    </button>
                    <button title="删除此行" onMouseDown={(e) => { e.preventDefault(); tableOpDelRow(); }} className="flex h-6 shrink-0 items-center gap-0.5 rounded-md px-1.5 text-10px font-650 text-muted transition hover:bg-coral/10 hover:text-coral">
                      <Trash2 size={11} /><span>删行</span>
                    </button>
                    <div className="mx-1 h-4 w-px bg-line" />
                    <button title="删除整个表格" onMouseDown={(e) => { e.preventDefault(); tableOpDelTable(); }} className="flex h-6 shrink-0 items-center gap-0.5 rounded-md px-1.5 text-10px font-650 text-muted transition hover:bg-coral/10 hover:text-coral">
                      <Trash2 size={11} /><span>删表</span>
                    </button>
                  </div>
                )}

                {/* 选中文字悬浮工具栏（飞书式） */}
                {textBar && editStyle === 'rich' && (
                  <div
                    ref={textBarRef}
                    className="fixed z-50 flex items-center gap-0.5 rounded-lg border border-line bg-white px-1.5 py-1 shadow-card"
                    style={(() => {
                      const w = textBarRef.current?.getBoundingClientRect().width ?? 400;
                      const h = textBarRef.current?.getBoundingClientRect().height ?? 34;
                      // 文档总体工具栏底部（fixed 定位同视口坐标），悬浮栏不得高于它
                      const tbBottom = toolBarRef.current?.getBoundingClientRect().bottom ?? 0;
                      const gap = 6;
                      const minTop = tbBottom + gap;
                      const above = textBar.top - h - 12;
                      const below = textBar.top + textBar.height + 12;
                      // 优先放在选区上方；若上方会顶到文档工具栏，则改放到选区下方，且不高于工具栏
                      const top = above >= minTop ? above : Math.max(minTop, below);
                      const left = Math.min(Math.max(8, textBar.left + textBar.width / 2 - w / 2), window.innerWidth - w - 8);
                      return { left, top };
                    })()}
                    onMouseDown={(e) => {
                      e.preventDefault(); // 点击工具按钮保持选中内容不丢失
                    }}
                  >
                    {/* AI 助手：针对选中文字对话（工具栏第一个入口） */}
                    <button
                      title="AI 助手：针对选中文字与 AI 对话"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => openAiChat(getSelectedText())}
                      className="mr-1 flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-violet px-2.5 text-11px font-700 text-white transition hover:brightness-110"
                    >
                      <Sparkles size={13} /> AI
                    </button>
                    {/* 格式下拉 */}
                    <button
                      title="段落格式"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setTextBarMenu((m) => (m === 'format' ? null : 'format'));
                      }}
                      className="flex h-7 shrink-0 items-center gap-0.5 rounded-md px-1.5 text-11px font-650 text-muted transition hover:bg-violet-light hover:text-violet"
                    >
                      <Type size={14} />
                      <ChevronRight size={11} className="rotate-90 text-muted" />
                    </button>
                    {/* 字号下拉 */}
                    <button
                      title="字号"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setTextBarMenu((m) => (m === 'size' ? null : 'size'));
                      }}
                      className="flex h-7 shrink-0 items-center gap-0.5 rounded-md px-1.5 text-11px font-650 text-muted transition hover:bg-violet-light hover:text-violet"
                    >
                      <span>字号</span>
                      <ChevronRight size={11} className="rotate-90 text-muted" />
                    </button>
                    {/* 字体颜色 */}
                    <button
                      title="字体颜色"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setTextBarMenu((m) => (m === 'color' ? null : 'color'));
                      }}
                      className="flex h-7 shrink-0 items-center gap-0.5 rounded-md px-1.5 text-11px font-650 text-muted transition hover:bg-violet-light hover:text-violet"
                    >
                      <CaseSensitive size={14} />
                      <span className="block h-1 w-3.5 rounded-sm bg-ink/60" />
                    </button>
                    {/* 背景高亮 */}
                    <button
                      title="背景高亮"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setTextBarMenu((m) => (m === 'bg' ? null : 'bg'));
                      }}
                      className="flex h-7 shrink-0 items-center gap-0.5 rounded-md px-1.5 text-11px font-650 text-muted transition hover:bg-violet-light hover:text-violet"
                    >
                      <Highlighter size={14} />
                      <span className="block h-1 w-3.5 rounded-sm bg-amber" />
                    </button>
                    <Divider />
                    <ToolBtn title="加粗" icon={Bold} onClick={textBarBold} />
                    <ToolBtn title="斜体" icon={Italic} onClick={textBarItalic} />
                    <ToolBtn title="下划线" icon={Underline} onClick={textBarUnderline} />
                    <ToolBtn title="中划线" icon={Strikethrough} onClick={textBarStrike} />
                    <Divider />
                    <ToolBtn title="行内代码" icon={Code} onClick={textBarCode} />
                    <ToolBtn title="清除格式" icon={Eraser} onClick={textBarClear} />

                    {/* 下拉面板（格式 / 字号 / 颜色 / 背景） */}
                    {textBarMenu && (
                      <div className="absolute left-0 top-full z-20 mt-1 rounded-lg border border-line bg-white p-1.5 shadow-card">
                        {textBarMenu === 'format' && (
                          <div className="flex flex-col gap-0.5">
                            {[
                              { t: '正文', tag: 'p' },
                              { t: '标题1', tag: 'h1' },
                              { t: '标题2', tag: 'h2' },
                              { t: '标题3', tag: 'h3' },
                            ].map((it) => (
                              <button
                                key={it.tag}
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  textBarFormat(it.tag);
                                }}
                                className="flex items-center justify-between gap-8 rounded-md px-2 py-1 text-12px font-650 text-ink transition hover:bg-violet-light"
                              >
                                {it.t}
                              </button>
                            ))}
                          </div>
                        )}
                        {textBarMenu === 'size' && (
                          <div className="flex flex-wrap gap-1">
                            {[12, 14, 16, 18, 20, 24, 28, 36].map((px) => (
                              <button
                                key={px}
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  textBarSize(px);
                                }}
                                className="flex h-8 w-10 items-center justify-center rounded-md text-12px font-650 text-ink transition hover:bg-violet-light"
                                style={{ fontSize: Math.min(px, 20) }}
                              >
                                {px}
                              </button>
                            ))}
                          </div>
                        )}
                        {textBarMenu === 'color' && (
                          <div className="flex flex-wrap gap-1">
                            {[
                              '#22222b',
                              '#6b7280',
                              '#e2434c',
                              '#f28b2e',
                              '#b45309',
                              '#18a875',
                              '#2f6fed',
                              '#7c5cff',
                              '#0e7490',
                            ].map((c) => (
                              <button
                                key={c}
                                title={c}
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  textBarColor(c);
                                }}
                                className="h-6 w-6 rounded-md transition hover:ring-2 hover:ring-violet/40"
                                style={{ background: c }}
                              />
                            ))}
                          </div>
                        )}
                        {textBarMenu === 'bg' && (
                          <div className="flex flex-wrap gap-1">
                            {[
                              { c: 'transparent', t: '无' },
                              { c: '#ffe9a8', t: '' },
                              { c: '#d7f0ff', t: '' },
                              { c: '#d7f7e8', t: '' },
                              { c: '#ffe1e5', t: '' },
                              { c: '#f1ecfe', t: '' },
                              { c: '#f0f2f5', t: '' },
                            ].map((it, i) => (
                              <button
                                key={i}
                                title={it.c === 'transparent' ? '清除背景' : it.c}
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  textBarBg(it.c);
                                }}
                                className="flex h-6 w-6 items-center justify-center rounded-md text-10px font-650 text-muted transition hover:ring-2 hover:ring-violet/40"
                                style={{ background: it.c }}
                              >
                                {it.t}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* @ 提及菜单 */}
                {mentionOpen && (
                  <div ref={mentionRef} style={{ left: mentionPos.left, top: mentionPos.top }}>
                    <MentionMenu
                      users={mentionUsers}
                      active={mentionIdx}
                      onSelect={editStyle === 'rich' ? insertMentionRich : insertMention}
                      style={{ position: 'absolute' }}
                    />
                  </div>
                )}

                {/* 查找替换条 */}
                {findOpen && (
                  <div ref={findRef} className="find-bar">
                    <Search size={13} className="text-muted" />
                    <input
                      placeholder="查找"
                      value={findQuery}
                      onChange={(e) => {
                        setFindQuery(e.target.value);
                        setFindIdx(0);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          jumpFind(e.shiftKey ? -1 : 1);
                        }
                        if (e.key === 'Escape') setFindOpen(false);
                      }}
                    />
                    <input
                      placeholder="替换为"
                      value={replaceQuery}
                      onChange={(e) => setReplaceQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          replaceCurrent();
                        }
                        if (e.key === 'Escape') setFindOpen(false);
                      }}
                    />
                    <span className="shrink-0 text-11px text-muted">
                      {editStyle === 'rich'
                        ? richFindTotal
                          ? `${clampedRichFindIdx + 1}/${richFindTotal}`
                          : '0'
                        : findMatches.length
                          ? `${clampedFindIdx + 1}/${findMatches.length}`
                          : '0'}
                    </span>
                    <button className="rounded-md p-1 text-muted hover:bg-surface hover:text-ink" onClick={() => jumpFind(-1)} title="上一个">
                      ▲
                    </button>
                    <button className="rounded-md p-1 text-muted hover:bg-surface hover:text-ink" onClick={() => jumpFind(1)} title="下一个">
                      ▼
                    </button>
                    <button className="rounded-md p-1 text-muted hover:bg-surface hover:text-violet" onClick={replaceCurrent} title="替换当前 (Enter)">
                      <Replace size={13} />
                    </button>
                    <button className="rounded-md px-1.5 text-11px font-650 text-muted hover:bg-surface hover:text-violet" onClick={replaceAll} title="全部替换">
                      全部
                    </button>
                    <button className="rounded-md p-1 text-muted hover:bg-surface hover:text-coral" onClick={() => setFindOpen(false)} title="关闭 (Esc)">
                      <X size={13} />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 翻译面板 */}
        {translatePanel && (
          <div className="flex w-96 shrink-0 flex-col border-l border-line bg-white">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <span className="text-12px font-700 text-ink">
                {translatePanel.mode === 'full' ? '全文翻译' : '片段翻译'}
                <span className="ml-2 rounded-full bg-cyan/10 px-2 py-0.5 text-10px font-650 text-cyan">{translatePanel.text.length} 字符</span>
              </span>
              <button onClick={() => setTranslatePanel(null)} className="rounded-md p-1 text-muted hover:bg-surface hover:text-ink">
                <X size={15} />
              </button>
            </div>
            <div className="border-b border-line p-3">
              <div className="flex items-center gap-2">
                <select
                  className="form-input !px-3 !py-2 text-12px"
                  value={translatePanel.target}
                  onChange={(e) => setTranslatePanel({ ...translatePanel, target: e.target.value })}
                >
                  {TRANSLATE_LANGS.map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
                <button className="btn btn-primary !px-4 !py-2" onClick={runTranslate} disabled={translating || !translatePanel.text.trim()}>
                  {translating ? '翻译中…' : '翻译'}
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              <p className="mb-1.5 text-11px font-650 text-muted">原文</p>
              <pre className="mb-4 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg bg-surface p-3 font-mono text-11px leading-5 text-muted">
                {translatePanel.text}
              </pre>
              <p className="mb-1.5 text-11px font-650 text-muted">译文</p>
              {translatePanel.translated ? (
                <pre className="whitespace-pre-wrap rounded-lg bg-violet-light/40 p-3 font-sans text-12px leading-6 text-ink">
                  {translatePanel.translated}
                </pre>
              ) : (
                <p className="rounded-lg bg-surface p-3 text-12px text-muted">点击「翻译」后展示译文（保留 Markdown 结构）</p>
              )}
            </div>
            {translatePanel.translated && (
              <div className="flex items-center gap-2 border-t border-line p-3">
                {translatePanel.mode === 'full' ? (
                  <>
                    <button className="btn btn-primary !px-3 !py-2 flex-1" onClick={() => applyTranslation('replace')}>替换全文</button>
                    <button className="btn btn-ghost !px-3 !py-2 flex-1" onClick={() => applyTranslation('append')}>插入文末</button>
                  </>
                ) : (
                  <button className="btn btn-primary !px-3 !py-2 flex-1" onClick={() => applyTranslation('replace')}>替换选中</button>
                )}
              </div>
            )}
          </div>
        )}

        {/* 右侧面板：大纲 / 评论 / 版本 */}
        {rightTab && (
          <div className="flex w-80 shrink-0 flex-col border-l border-line bg-white">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <span className="text-12px font-700 text-ink">
                {rightTab === 'outline' ? '文档大纲' : rightTab === 'comments' ? '评论' : '版本历史'}
              </span>
              <button onClick={() => setRightTab(null)} className="rounded-md p-1 text-muted hover:bg-surface hover:text-ink">
                <X size={15} />
              </button>
            </div>

            {rightTab === 'outline' && (
              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {headings.length === 0 ? (
                  <p className="px-3 py-4 text-center text-12px text-muted">暂无标题，使用「# 标题」语法后自动生成大纲</p>
                ) : (
                  headings.map((h) => (
                    <button
                      key={h.index}
                      onClick={() => jumpToHeading(h)}
                      className="block w-full truncate rounded-lg px-3 py-1.5 text-left text-12px text-muted transition hover:bg-violet-light hover:text-violet"
                      style={{ paddingLeft: `${12 + (h.level - 1) * 14}px`, fontWeight: h.level <= 2 ? 650 : 500 }}
                    >
                      {h.text}
                    </button>
                  ))
                )}
              </div>
            )}

            {rightTab === 'comments' && (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="border-b border-line p-3">
                  {commentSelection?.text ? (
                    <div className="mb-2 rounded-lg border border-violet-border bg-violet-light/50 px-3 py-2">
                      <p className="mb-1 text-10px font-650 uppercase text-violet">针对选中文字</p>
                      <p className="line-clamp-3 text-12px text-ink">“{commentSelection.text}”</p>
                    </div>
                  ) : (
                    <p className="mb-2 text-11px text-muted">在编辑区选中文字后点「评论选中」，即可针对该段发表评论。</p>
                  )}
                  <div className="flex items-center gap-2">
                    <input
                      ref={commentInputRef}
                      className="form-input !px-3 !py-2 text-12px"
                      placeholder="输入评论内容…"
                      value={commentDraft}
                      onChange={(e) => setCommentDraft(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && submitComment()}
                    />
                    <button className="btn btn-primary !px-3 !py-2" onClick={submitComment}>
                      <Check size={14} />
                    </button>
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-3">
                  {comments.isLoading ? (
                    <div className="flex justify-center py-8"><Spinner size={18} /></div>
                  ) : comments.data?.length === 0 ? (
                    <p className="py-8 text-center text-12px text-muted">暂无评论</p>
                  ) : (
                    comments.data!.map((c) => (
                      <div key={c.id} className={`mb-3 rounded-xl border p-3 ${c.resolved ? 'border-line bg-surface/60 opacity-70' : 'border-violet-border bg-violet-light/30'}`}>
                        <div className="mb-1.5 flex items-center gap-2">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet to-violet-dark text-10px font-700 text-white">
                            {c.user_name?.[0] ?? '?'}
                          </span>
                          <span className="text-12px font-650 text-ink">{c.user_name}</span>
                          <span className="text-10px text-muted">{fmtTime(c.created_at)}</span>
                          <span className="ml-auto flex items-center gap-1">
                            {c.resolved && <span className="rounded-full bg-green/12 px-1.5 py-0.5 text-10px font-650 text-green">已解决</span>}
                            <button onClick={() => toggleResolve(c.id)} title={c.resolved ? '重新打开' : '标记解决'} className="rounded-md p-1 text-muted hover:bg-surface hover:text-cyan">
                              <Check size={13} />
                            </button>
                            <button onClick={() => deleteComment(c.id)} title="删除" className="rounded-md p-1 text-muted hover:bg-surface hover:text-coral">
                              <Trash2 size={13} />
                            </button>
                          </span>
                        </div>
                        {c.selection_text && (
                          <p className="mb-1.5 line-clamp-2 rounded-md bg-amber/10 px-2 py-1 text-11px text-amber">“{c.selection_text}”</p>
                        )}
                        <p className="text-12px leading-6 text-ink">{c.content}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {rightTab === 'versions' && (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="border-b border-line p-3">
                  <div className="flex items-center gap-2">
                    <input
                      className="form-input !px-3 !py-2 text-12px"
                      placeholder="备注（可选）"
                      value={versionNote}
                      onChange={(e) => setVersionNote(e.target.value)}
                    />
                    <button className="btn btn-primary !px-3 !py-2" onClick={saveVersion} title="保存当前内容为版本">
                      存版本
                    </button>
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-3">
                  {versions.isLoading ? (
                    <div className="flex justify-center py-8"><Spinner size={18} /></div>
                  ) : versions.data?.length === 0 ? (
                    <p className="py-8 text-center text-12px text-muted">暂无版本，编辑文档后自动生成快照</p>
                  ) : (
                    versions.data!.map((v, i) => (
                      <div key={v.id} className="mb-2 flex items-start gap-2 rounded-xl border border-line p-3 transition hover:border-violet-border">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-12px font-700 text-ink">版本 {versions.data!.length - i}</span>
                            <span className="text-10px text-muted">{fmtTime(v.created_at)}</span>
                          </div>
                          <p className="mt-0.5 text-11px text-muted">
                            {v.created_by_name ? `${v.created_by_name} · ` : ''}
                            {v.note || '自动保存版本'} · {v.content.length} 字符
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-col gap-1">
                          <button
                            onClick={() => setDiffTarget({ version: v, currentMd: getLiveMd() })}
                            className="flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-11px font-650 text-muted transition hover:border-cyan hover:text-cyan"
                            title="与当前内容对比"
                          >
                            对比
                          </button>
                          <button
                            onClick={() => restoreVersion(v.id)}
                            className="flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-11px font-650 text-muted transition hover:border-violet hover:text-violet"
                            title="恢复此版本"
                          >
                            <RotateCcw size={12} /> 恢复
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 版本对比 */}
      <Modal
        open={!!diffTarget}
        onClose={() => setDiffTarget(null)}
        title={`版本对比：「${diffTarget?.version.note || '历史版本'}」 vs 当前内容`}
        width={760}
      >
        {diffTarget && (
          <DiffView oldText={diffTarget.version.content} newText={diffTarget.currentMd} />
        )}
      </Modal>

      {/* 反向链接 */}
      <BacklinksModal docId={id!} open={backlinksOpen} onClose={() => setBacklinksOpen(false)} />

      {/* 状态栏：字数统计 */}
      <div className="flex items-center justify-end gap-4 border-t border-line bg-white/90 px-5 py-1.5 text-11px text-muted">
        {collabUsers.length > 0 && (
          <span className="mr-auto flex items-center gap-1 font-650 text-green">
            ● {collabUsers.map((u) => u.name).join('、')} 正在协同编辑
          </span>
        )}
        <span>{charCount} 字符</span>
        <span>{wordCount} 字</span>
        <span>{headings.length} 个标题</span>
        <span className="hidden items-center gap-1 md:flex"><Type size={11} /> 输入 / 快速插入 · @ 提及成员 · ⌘F 查找替换</span>
        {revisionMode && <span className="text-amber">修订模式</span>}
        {preview ? <span className="text-cyan">预览模式</span> : <span className="text-violet">{editStyle === 'rich' ? '富文本编辑' : 'Markdown 源码'}</span>}
      </div>

      {/* 演示模式 */}
      {presenting && (
        <div className="present-stage fixed inset-0 z-50 flex items-center justify-center">
          <div className="present-slide md-body">
            <h1 className="mb-4 font-display text-28px font-700 text-ink">{slides[presentIdx]?.title}</h1>
            <div dangerouslySetInnerHTML={{ __html: renderMarkdown(slides[presentIdx]?.content ?? '') }} />
          </div>
          <div className="fixed bottom-6 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-full bg-white/10 px-4 py-2 text-white backdrop-blur">
            <button
              onClick={() => setPresentIdx((i) => Math.max(i - 1, 0))}
              disabled={presentIdx === 0}
              className="rounded-full bg-white/15 px-3 py-1 text-16px transition hover:bg-white/30 disabled:opacity-40"
            >
              ‹
            </button>
            <span className="text-12px font-650">{presentIdx + 1} / {slides.length}</span>
            <button
              onClick={() => setPresentIdx((i) => Math.min(i + 1, slides.length - 1))}
              disabled={presentIdx === slides.length - 1}
              className="rounded-full bg-white/15 px-3 py-1 text-16px transition hover:bg-white/30 disabled:opacity-40"
            >
              ›
            </button>
          </div>
          <button
            onClick={() => setPresenting(false)}
            className="fixed right-6 top-6 z-10 rounded-full bg-white/10 px-4 py-2 text-12px font-650 text-white backdrop-blur transition hover:bg-white/25"
          >
            退出演示 (Esc)
          </button>
        </div>
      )}

      {/* PDF 预览（浏览器内，含下载按钮） */}
      {pdfHtml && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white">
          <div className="flex items-center justify-between border-b border-line px-6 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <FileDown size={16} className="shrink-0 text-violet" />
              <span className="shrink-0 text-14px font-600 text-ink">PDF 预览</span>
              <span className="truncate text-13px text-muted">— {title}</span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={downloadPdf}
                disabled={pdfing}
                className="btn btn-primary !px-4 !py-2 text-13px disabled:opacity-50"
              >
                {pdfing ? '生成中…' : '下载 PDF'}
              </button>
              <button
                onClick={() => setPdfHtml(null)}
                className="btn btn-ghost !px-2.5"
                title="关闭"
              >
                <X size={16} />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-auto bg-[#f5f6f8]">
            <article className="md-body mx-auto my-6 w-[794px] max-w-full bg-white px-10 py-8 shadow-card">
              <div dangerouslySetInnerHTML={{ __html: pdfHtml }} />
            </article>
          </div>
        </div>
      )}

      {/* AI 对话对话框（单入口：文档工具栏 / 文字工具栏） */}
      {aiChatOpen && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/35 p-4"
          onClick={() => setAiChatOpen(false)}
        >
          <div
            className="flex h-[70vh] w-[600px] max-w-full flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 头部 */}
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet text-white">
                  <Sparkles size={16} />
                </span>
                <div className="min-w-0">
                  <div className="text-14px font-700 text-ink">AI 助手</div>
                  <div className="truncate text-11px text-muted">
                    {aiRefDoc
                      ? '快捷操作将依据整篇文档内容'
                      : aiChatCtx
                        ? `快捷操作将依据所选内容（${aiChatCtx.length} 字）`
                        : '快捷操作将依据选中文字（当前无选中）'}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setAiChatOpen(false)}
                className="rounded-md p-1 text-muted transition hover:bg-surface hover:text-ink"
                title="关闭"
              >
                <X size={16} />
              </button>
            </div>

            {/* 文档快捷操作：保留原文档 AI 能力，整合进同一入口 */}
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-2.5">
              <span className="shrink-0 text-11px font-650 text-muted">文档操作：</span>
              {AI_ACTIONS.map((a) => (
                <button
                  key={a.key}
                  className="shrink-0 rounded-full border border-violet-border bg-violet-light px-3 py-1 text-11px font-650 text-violet transition hover:bg-violet hover:text-white disabled:opacity-50"
                  onClick={() => runAi(a.key)}
                  disabled={!!aiBusy}
                >
                  {aiBusy === a.key ? '生成中…' : a.label}
                </button>
              ))}
              {/* 参考文档内容开关 */}
              <div
                className="ml-auto flex shrink-0 items-center gap-1.5"
                title="开启：基于整篇文档内容处理任务；关闭：仅基于所选文字 / 字段"
              >
                <span className="text-11px font-650 text-muted">参考文档内容</span>
                <button
                  onClick={() => setAiRefDoc((v) => !v)}
                  aria-pressed={aiRefDoc}
                  className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${aiRefDoc ? 'bg-violet' : 'bg-line'}`}
                >
                  <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
                      aiRefDoc ? 'left-[18px]' : 'left-0.5'
                    }`}
                  />
                </button>
              </div>
            </div>

            {/* 消息区 */}
            <div ref={aiChatBodyRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
              {aiMsgs.length === 0 ? (
                <p className="pt-10 text-center text-12px text-muted">
                  {aiChatCtx ? '将基于所选内容 / 文档上下文与你对话' : '开始与 AI 对话，Enter 发送'}
                </p>
              ) : (
                aiMsgs.map((m, i) =>
                  m.role === 'user' ? (
                    <div key={i} className="flex justify-end">
                      <div className="max-w-[82%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-violet px-4 py-2.5 text-13px leading-6 text-white">
                        {m.content}
                      </div>
                    </div>
                  ) : (
                    <div key={i} className="flex justify-start">
                      <div className="flex max-w-[88%] flex-col items-start">
                        <div className="md-body w-full rounded-2xl rounded-bl-md bg-surface px-4 py-2.5">
                          {m.content ? (
                            <div
                              dangerouslySetInnerHTML={{
                                __html: renderMarkdown(cleanAiMd(m.content)),
                              }}
                            />
                          ) : (
                            <div className="flex items-center gap-2">
                              <Spinner size={14} className="!border-violet-200 !border-t-violet" />
                              <span className="text-12px text-muted">思考中…</span>
                            </div>
                          )}
                        </div>
                        {m.content ? (
                          <div className="mt-1 flex items-center gap-1 px-1">
                            <button
                              title="将 AI 输出作为增量内容写入当前文档末尾"
                              onClick={() => writeToDoc(cleanAiMd(m.content))}
                              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-11px font-650 text-muted transition hover:bg-violet-light hover:text-violet"
                            >
                              <FilePlus size={13} /> 写入文档
                            </button>
                            <button
                              title="复制当前 AI 输出内容"
                              onClick={() => copyAiMsg(cleanAiMd(m.content))}
                              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-11px font-650 text-muted transition hover:bg-violet-light hover:text-violet"
                            >
                              <Copy size={13} /> 复制
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ),
                )
              )}
            </div>

            {/* 输入区 */}
            <div className="border-t border-line px-5 py-3">
              <div className="flex items-end gap-2">
                <textarea
                  ref={aiChatInputRef}
                  value={aiInput}
                  onChange={(e) => setAiInput(e.target.value)}
                  onKeyDown={onAiChatKey}
                  rows={1}
                  className="form-input min-h-[42px] flex-1 resize-none !py-2 text-13px"
                  placeholder="输入问题，Enter 发送，Shift+Enter 换行"
                />
                <button
                  onClick={sendAiChat}
                  disabled={aiChatBusy || !aiInput.trim()}
                  className="btn btn-primary !px-4 !py-2.5 disabled:opacity-50"
                >
                  <Send size={15} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 链接 hover 气泡：鼠标移出关闭，点「编辑」打开配置弹窗 */}
      {linkHover && (
        <div
          ref={linkBarRef}
          className="fixed z-50 flex items-center rounded-lg border border-line bg-white py-1 pl-1.5 pr-1 shadow-xl"
          style={{ left: linkHover.left, top: linkHover.top, transform: `translate(-50%, ${linkHover.above ? '-100%' : '0%'})` }}
          onMouseEnter={() => clearTimeout(linkHoverTimer.current)}
          onMouseLeave={() => {
            setLinkHover(null);
            linkHoverElRef.current = null;
          }}
        >
          <span className="max-w-[160px] truncate px-1 text-11px text-muted">链接</span>
          <button
            title="编辑链接（修改地址 / 显示名）"
            onMouseDown={(e) => e.preventDefault()}
            onClick={openLinkEdit}
            className="flex h-6 shrink-0 items-center gap-1 rounded-md px-2 text-11px font-650 text-muted transition hover:bg-violet-light hover:text-violet"
          >
            <Pencil size={12} /> 编辑
          </button>
        </div>
      )}

      {/* 链接配置弹窗（内部弹窗，替代浏览器 prompt） */}
      {linkOpen && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/35 p-4"
          onClick={() => setLinkOpen(false)}
        >
          <div
            ref={linkModalRef}
            className="card w-full max-w-sm rounded-2xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-4 font-display text-16px font-650 text-ink">
              {linkMode === 'rich' ? '插入链接' : '插入链接'}
            </h3>
            <div className="form-group">
              <label>链接地址</label>
              <input
                className="form-input"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') applyLink();
                }}
                placeholder="https:// 或 /path、#anchor"
              />
              <p className="mt-1 text-11px text-muted">无协议地址将自动补 https://（相对路径 / 锚点除外）</p>
            </div>
            <div className="form-group">
              <label>显示文字</label>
              <input
                className="form-input"
                value={linkLabel}
                onChange={(e) => setLinkLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') applyLink();
                }}
                placeholder="链接显示文字"
              />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn btn-ghost" onClick={() => setLinkOpen(false)}>
                取消
              </button>
              <button className="btn btn-primary" onClick={applyLink}>
                确定
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={confirmDel}
        onClose={() => setConfirmDel(false)}
        onConfirm={del}
        title="删除文档"
        message="删除后不可恢复（含版本与评论），确定删除吗？"
      />
    </div>
  );
}
