import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { docApi, aiApi, type SheetAction } from '../lib/api';
import {
  ArrowLeft,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Trash2,
  ArrowUpDown,
  ArrowDownUp,
  Filter,
  Rows3,
  Columns3,
  Merge,
  Ban,
  Snowflake,
  Table2,
  PlusCircle,
  Copy,
  Scissors,
  ClipboardPaste,
  CheckCheck,
  Shield,
  CircleDot,
  FormInput,
  List,
  X,
  Undo2,
  Redo2,
  Eraser,
  Search,
  Replace,
  Calendar,
  ChevronDown,
  Paintbrush,
  IndentIncrease,
  IndentDecrease,
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  Frame,
  Palette,
  Sparkles,
} from 'lucide-react';
import { Spinner, useToast } from '../components/ui';
import {
  cellKey,
  colToLetter,
  defaultSheetData,
  parseSheet,
  serializeSheet,
  evaluateCell,
  formatValue,
  mergeSheet,
  unmergeSheet,
  findMerge,
  isCoveredByMerge,
  insertRow,
  deleteRow,
  insertCol,
  deleteCol,
  sortSheet,
  makeClipGrid,
  pasteGrid,
  clearRange,
  clearContentRange,
  clipToTSV,
  parseTSV,
  validateCellValue,
  cloneSheet,
  type SheetData,
  type SheetState,
  type Cell,
  type CellStyle,
  type NumberFormat,
  type VerticalAlign,
  type CellBorder,
  type BorderLineStyle,
  type ClipGrid,
  type PasteMode,
  type ValidationType,
  type CellValidation,
  fillSeries,
  matchCondition,
  colorScaleBg,
  dataBarRatio,
  type ConditionalFormat,
  type ConditionalType,
  type CellValueOperator,
  type FillRange,
  parseSheetDate,
  uniqueColumnValues,
  groupRowsByColumn,
} from '../lib/sheetUtil';

const FONTS = [10, 11, 12, 13, 14, 15, 16, 18, 20, 24, 28, 32];
const FONTFAMILIES = [
  { value: 'Inter', label: '默认（Inter）' },
  { value: 'Georgia', label: 'Georgia' },
  { value: 'ui-serif, Georgia, serif', label: '衬线' },
  { value: 'ui-monospace, monospace', label: '等宽' },
  { value: '"Microsoft YaHei", sans-serif', label: '微软雅黑' },
  { value: 'SimSun, serif', label: '宋体' },
  { value: 'SimHei, sans-serif', label: '黑体' },
];
const FORMATS: { value: NumberFormat; label: string }[] = [
  { value: 'general', label: '常规' },
  { value: 'number', label: '数字' },
  { value: 'currency', label: '货币' },
  { value: 'accounting', label: '会计' },
  { value: 'percent', label: '百分比' },
  { value: 'scientific', label: '科学计数' },
  { value: 'date', label: '日期' },
  { value: 'time', label: '时间' },
  { value: 'text', label: '文本' },
];

/** 公式补全候选函数 */
const FORMULA_FUNCTIONS: { name: string; desc: string; args: string }[] = [
  { name: 'SUM', desc: '求和', args: '数值1, 数值2, ...' },
  { name: 'AVERAGE', desc: '平均值', args: '数值1, 数值2, ...' },
  { name: 'COUNT', desc: '计数（数值）', args: '数值1, 数值2, ...' },
  { name: 'COUNTA', desc: '计数（非空）', args: '区域' },
  { name: 'MIN', desc: '最小值', args: '数值1, ...' },
  { name: 'MAX', desc: '最大值', args: '数值1, ...' },
  { name: 'IF', desc: '条件判断', args: '条件, 真值, 假值' },
  { name: 'AND', desc: '逻辑与', args: '条件1, ...' },
  { name: 'OR', desc: '逻辑或', args: '条件1, ...' },
  { name: 'NOT', desc: '逻辑非', args: '条件' },
  { name: 'IFERROR', desc: '容错', args: '值, 出错值' },
  { name: 'COUNTIF', desc: '条件计数', args: '区域, 条件' },
  { name: 'SUMIF', desc: '条件求和', args: '区域, 条件' },
  { name: 'SUMIFS', desc: '多条件求和', args: '求和区间, 条件区间1, 条件1, ...' },
  { name: 'COUNTIFS', desc: '多条件计数', args: '区间1, 条件1, ...' },
  { name: 'VLOOKUP', desc: '纵向查找', args: '查找值, 区域, 列序号' },
  { name: 'ROUND', desc: '四舍五入', args: '数值, 位数' },
  { name: 'ABS', desc: '绝对值', args: '数值' },
  { name: 'INT', desc: '向下取整', args: '数值' },
  { name: 'CONCAT', desc: '连接文本', args: '文本1, 文本2, ...' },
  { name: 'LEN', desc: '文本长度', args: '文本' },
  { name: 'LEFT', desc: '左侧字符', args: '文本, 长度' },
  { name: 'RIGHT', desc: '右侧字符', args: '文本, 长度' },
  { name: 'MID', desc: '中间字符', args: '文本, 起始, 长度' },
  { name: 'TRIM', desc: '去除多余空格', args: '文本' },
  { name: 'UPPER', desc: '转大写', args: '文本' },
  { name: 'LOWER', desc: '转小写', args: '文本' },
];

type Pt = { r: number; c: number };
type SelectionRange = { r0: number; c0: number; r1: number; c1: number };

function cellStyle(cell: Cell | undefined): CSSProperties {
  const style: CSSProperties = {};
  if (!cell?.style) return style;
  const st = cell.style;
  if (st.bold) style.fontWeight = 700;
  if (st.italic) style.fontStyle = 'italic';
  if (st.underline && st.strikethrough) style.textDecoration = 'underline line-through';
  else if (st.underline) style.textDecoration = 'underline';
  else if (st.strikethrough) style.textDecoration = 'line-through';
  if (st.color) style.color = st.color;
  if (st.bg) style.backgroundColor = st.bg;
  if (st.align) style.textAlign = st.align;
  if (st.vAlign) style.verticalAlign = st.vAlign;
  if (st.fontFamily) style.fontFamily = st.fontFamily;
  if (st.indent) style.paddingLeft = st.indent * 8 + 6;
  style.fontSize = st.fontSize ?? 13;
  // 内容展示方式：wrap=换行 / overflow=溢出 / 其余=截断
  if (st.wrap) {
    style.whiteSpace = 'pre-wrap';
    style.overflowWrap = 'break-word';
    style.overflow = 'hidden';
  } else if (st.overflow) {
    style.whiteSpace = 'nowrap';
    style.overflow = 'visible';
  } else {
    style.whiteSpace = 'nowrap';
    style.overflow = 'hidden';
    style.textOverflow = 'ellipsis';
  }
  return style;
}

/** 默认网格线（数据格右/下边界） */
const GRID_LINE = '1px solid #e8e8ef';

/** 计算某条边的真实边框样式：参与声明的两侧中任一侧设为 true 即显示该边，
 *  仅绘制一次（单线），样式取先声明者；都未声明时返回默认网格线 */
function mergedEdge(
  own: [CellBorder | undefined, 'top' | 'bottom' | 'left' | 'right'],
  ...others: [CellBorder | undefined, 'top' | 'bottom' | 'left' | 'right'][]
): string | undefined {
  for (const [b, side] of [own, ...others]) {
    if (b && b[side] === true) {
      const s = b.style ?? 'solid';
      const color = b.color ?? '#1a1a2e';
      return `1px ${s} ${color}`;
    }
  }
  return GRID_LINE;
}

/** 单元格展示文本：普通格应用格式；公式格显示计算结果 */
function displayText(s: SheetState, r: number, c: number, cell: Cell | undefined): string {
  if (!cell) return '';
  const v = String(cell.value ?? '');
  if (!v.startsWith('=')) return formatValue(cell);
  const ev = evaluateCell(s.cells, r, c);
  if (ev.kind === 'number') return String(ev.num);
  if (ev.kind === 'string') return ev.text;
  return '';
}

function ToolBtn({
  title,
  icon: Icon,
  active,
  onClick,
  label,
  disabled,
}: {
  title: string;
  icon?: typeof Bold;
  active?: boolean;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-8 min-w-8 items-center justify-center gap-1 rounded-lg px-2 text-13px text-ink transition hover:bg-violet-light hover:text-violet disabled:cursor-not-allowed disabled:opacity-40 ${
        active ? 'bg-violet-light text-violet' : ''
      }`}
    >
      {Icon && <Icon size={15} />}
      {label && <span className="text-12px font-600">{label}</span>}
    </button>
  );
}

function Divider() {
  return <span className="mx-1 h-6 w-px bg-line" />;
}

function CtxDivider() {
  return <div className="mx-2 my-1 h-px bg-line" />;
}

function CtxItem({
  icon: Icon,
  label,
  shortcut,
  onClick,
  disabled,
}: {
  icon?: typeof Copy;
  label: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-13px text-ink transition hover:bg-violet-light hover:text-violet disabled:cursor-not-allowed disabled:opacity-40"
    >
      {Icon && <Icon size={15} className="shrink-0 text-muted" />}
      <span className="flex-1">{label}</span>
      {shortcut && <span className="text-11px text-muted">⌘{shortcut}</span>}
    </button>
  );
}

const shortcutLabel = (c: string) => c;

export function SheetEditor() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  const [data, setData] = useState<SheetData | null>(null);
  const [title, setTitle] = useState('未命名表格');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState<'idle' | 'dirty' | 'saved' | 'error'>('idle');

  // 选区 / 拖拽 / 筛选
  const [anchor, setAnchor] = useState<Pt>({ r: 0, c: 0 });
  const [dragEnd, setDragEnd] = useState<Pt | null>(null);
  const [dragging, setDragging] = useState(false);
  // 填充柄拖拽（序列填充）
  const [fillActive, setFillActive] = useState(false);
  const [fillEnd, setFillEnd] = useState<Pt | null>(null);
  const fillSrcRef = useRef<SelectionRange | null>(null);
  const [hiddenMap, setHiddenMap] = useState<Record<number, number[]>>({});
  // ---- 常规筛选：面板 + 已应用筛选 ----
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterCol, setFilterCol] = useState(0);
  const [filterApp, setFilterApp] = useState<{ col: number; values: string[] } | null>(null);
  const [filterAnchor, setFilterAnchor] = useState<{ left: number; bottom: number } | null>(null);
  // ---- 条件格式 ----
  const [cfOpen, setCfOpen] = useState(false);
  const [cfAnchor, setCfAnchor] = useState<{ left: number; bottom: number } | null>(null);
  // ---- 多视图 ----
  const [viewMode, setViewMode] = useState<'table' | 'board' | 'calendar'>('table');
  const [boardGroupCol, setBoardGroupCol] = useState(0);
  const [calDateCol, setCalDateCol] = useState(0);
  // ---- AI 表格助手 ----
  const [aiOpen, setAiOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiInstruction, setAiInstruction] = useState('');

  // ---- 复制 / 剪切 / 粘贴 / 右键菜单 / 数据验证 ----
  const clipRef = useRef<{ grid: ClipGrid; cut: boolean; srcAt: { r: number; c: number } | null } | null>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number } | null>(null);
  const [pastable, setPastable] = useState(false);
  const [valPop, setValPop] = useState<null | { type: ValidationType; options: string }>(null);

  // ---- 单元格内联编辑 ----
  const [editing, setEditing] = useState<null | { r: number; c: number }>(null);
  const [editValue, setEditValue] = useState('');
  const editReplaceRef = useRef(false);
  const editInputRef = useRef<HTMLTextAreaElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const headerSelRef = useRef<{ type: 'col' | 'row' } | null>(null);
  const resizeRef = useRef<null | { type: 'col' | 'row'; index: number; start: number; size: number }>(null);
  const [resizePreview, setResizePreview] = useState<null | { type: 'col' | 'row'; index: number; pos: number }>(null);

  // ---- 撤销/重做历史 ----
  const historyRef = useRef<SheetState[]>([]);
  const historyIdxRef = useRef(-1);
  const MAX_HISTORY = 30;

  // ---- 查找/替换 ----
  const [findOpen, setFindOpen] = useState(false);
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');

  // ---- 格式刷 / 清除 / 边框 下拉 ----
  const [brushing, setBrushing] = useState(false);
  const brushRef = useRef<CellStyle | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [borderOpen, setBorderOpen] = useState(false);

  const sheet: SheetState | null = data ? data.sheets[data.activeSheet] : null;

  // 加载文档 content 并解析为 SheetData
  const { data: doc, isLoading } = useQuery({ queryKey: ['sheet-doc', id], queryFn: () => docApi.get(id) });
  useEffect(() => {
    if (doc && !loaded) {
      setData(parseSheet(doc.content));
      setTitle(doc.title || '未命名表格');
      setLoaded(true);
    }
  }, [doc, loaded]);

  // ---- 自动保存（防抖 900ms，复用 docApi.update 的 content 字段） ----
  const dataRef = useRef(data);
  dataRef.current = data;
  const titleRef = useRef(title);
  titleRef.current = title;
  const pendingRef = useRef(false); // 是否有未保存的改动
  const persist = useCallback(async () => {
    const d = dataRef.current;
    if (!d) return;
    setSaving('saved');
    try {
      await docApi.update(id, { title: titleRef.current, content: serializeSheet(d) });
      pendingRef.current = false;
    } catch (e) {
      setSaving('error');
      toast((e as Error).message, 'error');
    }
  }, [id, toast]);

  useEffect(() => {
    if (!loaded || !data) return;
    pendingRef.current = true;
    setSaving('dirty');
    const t = setTimeout(() => persist(), 900);
    return () => clearTimeout(t);
  }, [data, title, loaded, persist]);

  // 退出文档（回到列表 / 关闭 / 刷新）时，把 900ms 内尚未保存的改动立即落库，避免丢内容。
  // 用 keepalive: true 的 fetch，确保整页刷新/关闭时请求也能送达（普通 fetch 会被导航中断）
  useEffect(() => {
    const flush = () => {
      const d = dataRef.current;
      if (!d || !pendingRef.current) return;
      pendingRef.current = false;
      try {
        const url = `${location.origin}/api/documents/${id}`;
        void fetch(url, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          keepalive: true,
          body: JSON.stringify({ title: titleRef.current, content: serializeSheet(d) }),
        }).catch(() => {});
      } catch {
        /* 退出时保存失败静默，避免阻塞离开 */
      }
    };
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      flush();
    };
  }, [id]);

  // ---- 选区（anchor 到 dragEnd 围成的矩形） ----
  const sel: SelectionRange = useMemo(() => {
    const e = dragEnd ?? anchor;
    return {
      r0: Math.min(anchor.r, e.r),
      c0: Math.min(anchor.c, e.c),
      r1: Math.max(anchor.r, e.r),
      c1: Math.max(anchor.c, e.c),
    };
  }, [anchor, dragEnd]);

  // ---- 填充柄目标范围（源区域 sel 到当前 fillEnd 围成的矩形） ----
  const fillTarget: SelectionRange | null = useMemo(() => {
    if (!fillActive || !fillEnd) return null;
    const src = fillSrcRef.current;
    if (!src) return null;
    return {
      r0: Math.min(src.r0, fillEnd.r),
      c0: Math.min(src.c0, fillEnd.c),
      r1: Math.max(src.r1, fillEnd.r),
      c1: Math.max(src.c1, fillEnd.c),
    };
  }, [fillActive, fillEnd]);

  // ---- 条件格式：预计算每条规则范围的 min/max 与值计数 ----
  const cfStats = useMemo(() => {
    const list = sheet?.conditionalFormats ?? [];
    return list.map((cf) => {
      let min = Infinity;
      let max = -Infinity;
      const counts: Record<string, number> = {};
      for (let rr = cf.r0; rr <= cf.r1; rr++) {
        for (let cc = cf.c0; cc <= cf.c1; cc++) {
          const v = sheet?.cells[cellKey(rr, cc)]?.value ?? '';
          counts[v] = (counts[v] ?? 0) + 1;
          const n = Number(v);
          if (v.trim() !== '' && !Number.isNaN(n)) {
            if (n < min) min = n;
            if (n > max) max = n;
          }
        }
      }
      return { min: min === Infinity ? 0 : min, max: max === -Infinity ? 0 : max, counts };
    });
  }, [sheet]);

  // ---- sheet 级更新辅助（自动记录历史） ----
  const setSheet = useCallback((mut: (s: SheetState) => SheetState) => {
    const cur = sheetRef.current;
    if (!cur) return;
    // 推历史前快照当前状态
    const hist = historyRef.current;
    const idx = historyIdxRef.current;
    if (idx < hist.length - 1) hist.length = idx + 1; // 截断未来 redo 分支
    hist.push(cloneSheet(cur));
    if (hist.length > MAX_HISTORY) hist.shift();
    historyIdxRef.current = hist.length - 1;
    setData((old) => {
      const s = old?.sheets[old.activeSheet];
      if (!old || !s) return old;
      const sheets = old.sheets.map((x, i) => (i === old.activeSheet ? mut(s) : x));
      return { ...old, sheets };
    });
  }, []);

  const undo = () => {
    const hist = historyRef.current;
    const idx = historyIdxRef.current;
    if (idx < 0) return;
    const snap = hist[idx];
    historyIdxRef.current = idx - 1;
    setData((old) => {
      if (!old) return old;
      const sheets = old.sheets.map((x, i) => (i === old.activeSheet ? cloneSheet(snap) : x));
      return { ...old, sheets };
    });
  };
  const redo = () => {
    const hist = historyRef.current;
    const idx = historyIdxRef.current;
    if (idx >= hist.length - 1) return;
    historyIdxRef.current = idx + 1;
    const snap = hist[idx + 1];
    setData((old) => {
      if (!old) return old;
      const sheets = old.sheets.map((x, i) => (i === old.activeSheet ? cloneSheet(snap) : x));
      return { ...old, sheets };
    });
  };

  const setCellValue = useCallback(
    (r: number, c: number, value: string) => {
      const cell = sheet?.cells[cellKey(r, c)];
      const err = validateCellValue(cell, value);
      if (err) {
        toast(err, 'error');
        return;
      }
      setSheet((s) => {
        const next = { ...s, cells: { ...s.cells } };
        const key = cellKey(r, c);
        if (value === '') delete next.cells[key];
        else {
          const cur = next.cells[key];
          next.cells[key] = { value, style: cur?.style, validation: cur?.validation };
        }
        return next;
      });
    },
    [setSheet, sheet, toast],
  );

  // ---- 条件格式：新增 / 删除规则 ----
  const addConditionalFormat = useCallback(
    (cf: ConditionalFormat) => {
      setSheet((s) => ({ ...s, conditionalFormats: [...(s.conditionalFormats ?? []), cf] }));
    },
    [setSheet],
  );
  const removeConditionalFormat = useCallback(
    (id: string) => {
      setSheet((s) => ({ ...s, conditionalFormats: (s.conditionalFormats ?? []).filter((x) => x.id !== id) }));
    },
    [setSheet],
  );

  // ---- AI 表格助手：自然语言 → 公式 / 高亮条件格式 ----
  function toCellOp(sym: string): CellValueOperator {
    switch (sym) {
      case '>':
        return 'greaterThan';
      case '>=':
        return 'greaterOrEqual';
      case '<':
        return 'lessThan';
      case '<=':
        return 'lessOrEqual';
      case '=':
        return 'equal';
      case 'between':
        return 'between';
      default:
        return 'greaterThan';
    }
  }

  function applySheetAction(action: SheetAction) {
    if (action.action === 'formula') {
      setCellValue(anchor.r, anchor.c, action.formula);
      toast('已填入公式', 'info');
    } else {
      const cf: ConditionalFormat = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        r0: 0,
        c0: action.column,
        r1: (sheet?.rowCount ?? 1) - 1,
        c1: action.column,
        type: 'cellValue',
        operator: toCellOp(action.operator),
        value1: action.value,
        bg: action.bg,
      };
      addConditionalFormat(cf);
      toast('已应用高亮规则', 'info');
    }
  }

  async function runSheetAi() {
    const instr = aiInstruction.trim();
    if (!instr || aiLoading || !sheet) return;
    setAiLoading(true);
    try {
      const headers = Array.from({ length: sheet.colCount }, (_, c) => {
        const h = sheet.cells[cellKey(0, c)]?.value?.trim();
        return h || colToLetter(c);
      });
      const sample = Array.from({ length: Math.min(8, sheet.rowCount) }, (_, r) =>
        Array.from({ length: sheet.colCount }, (_, c) => sheet.cells[cellKey(r, c)]?.value ?? ''),
      );
      const action = await aiApi.sheet({ headers, sample, instruction: instr });
      applySheetAction(action);
      setAiOpen(false);
      setAiInstruction('');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'AI 调用失败', 'error');
    } finally {
      setAiLoading(false);
    }
  }

  // ---- 单元格内联编辑处理 ----
  const beginEdit = (r: number, c: number, replace: boolean, initial = '') => {
    const cell = sheet?.cells[cellKey(r, c)];
    setAnchor({ r, c });
    setDragEnd({ r, c });
    const initialValue = initial !== '' ? initial : (cell?.value ?? '');
    editReplaceRef.current = replace || initial !== '';
    setEditValue(initialValue);
    setEditing({ r, c });
  };
  const commitEdit = () => {
    if (!editing) return;
    setCellValue(editing.r, editing.c, editValue);
    setEditing(null);
  };
  const cancelEdit = () => setEditing(null);
  const onEditKey = (e: React.KeyboardEvent) => {
    // Alt/Option + Enter：强制插入换行（无论是否自动换行），不提交
    if (e.key === 'Enter' && e.altKey) return;
    const wrap = editing ? !!sheetRef.current?.cells[cellKey(editing.r, editing.c)]?.style?.wrap : false;
    if (e.key === 'Enter' && !wrap) {
      e.preventDefault();
      commitEdit();
    } else if (e.key === 'Enter' && wrap && e.shiftKey) {
      e.preventDefault();
      commitEdit();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      moveEdit(0, e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    }
  };
  const moveEdit = (dr: number, dc: number) => {
    if (!editing) return;
    const nr = Math.max(0, editing.r + dr);
    const nc = Math.max(0, editing.c + dc);
    setCellValue(editing.r, editing.c, editValue);
    setEditing(null);
    beginEdit(nr, nc, false);
  };

  // ---- 公式补全：输入 =函数名前段 时提示候选 ----
  const formulaSuggestions = useMemo(() => {
    if (!editing) return null;
    const m = /^=([A-Za-z]+)$/.exec(editValue);
    if (!m) return null;
    const prefix = m[1].toUpperCase();
    const matches = FORMULA_FUNCTIONS.filter((f) => f.name.startsWith(prefix));
    if (matches.length === 0) return null;
    return { prefix, matches };
  }, [editing, editValue]);

  const pickFormula = useCallback((name: string) => {
    setEditValue(`=${name}(`);
    requestAnimationFrame(() => {
      const el = editInputRef.current;
      if (el) {
        el.focus();
        const pos = el.value.length;
        el.setSelectionRange(pos, pos);
      }
    });
  }, []);

  // 进入编辑态后聚焦内联输入框：连点/回车光标置尾，键入则全选以便直接替换
  useEffect(() => {
    if (!editing) return;
    const el = editInputRef.current;
    if (!el) return;
    el.focus();
    if (editReplaceRef.current) el.select();
    else el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  // 把样式应用到选区中的每个单元格
  const applyStyle = useCallback(
    (mut: (st: CellStyle) => CellStyle) => {
      setSheet((s) => {
        const next = { ...s, cells: { ...s.cells } };
        for (let r = sel.r0; r <= sel.r1; r++) {
          for (let c = sel.c0; c <= sel.c1; c++) {
            if (isCoveredByMerge(s, r, c)) continue;
            const key = cellKey(r, c);
            const cur = next.cells[key];
            next.cells[key] = { value: cur?.value ?? '', style: { ...(cur?.style ?? {}), ...mut(cur?.style ?? {}) }, validation: cur?.validation };
          }
        }
        return next;
      });
    },
    [setSheet, sel],
  );

  // ---- 格式刷：复制锚点样式，点击目标单元格即套用 ----
  const startFormatBrush = useCallback(() => {
    const s = sheetRef.current;
    const a = anchorPtRef.current;
    const st = s?.cells[cellKey(a.r, a.c)]?.style;
    brushRef.current = st ? { ...st } : {};
    setBrushing(true);
    toast('已复制格式，点击目标单元格应用');
  }, [toast]);

  const applyBrushTo = useCallback(
    (r: number, c: number): boolean => {
      const st = brushRef.current;
      if (!st) return false;
      setSheet((s) => {
        const next = { ...s, cells: { ...s.cells } };
        const key = cellKey(r, c);
        const cur = next.cells[key];
        next.cells[key] = { value: cur?.value ?? '', style: { ...st }, validation: cur?.validation };
        return next;
      });
      brushRef.current = null;
      setBrushing(false);
      return true;
    },
    [setSheet],
  );

  // ---- 清除：内容 / 格式 / 全部 ----
  const clearContent = useCallback(() => {
    const a = selRef.current;
    setSheet((s) => clearContentRange(s, a.r0, a.c0, a.r1, a.c1));
    setClearOpen(false);
  }, [setSheet]);
  const clearFormats = useCallback(() => {
    setSheet((s) => {
      const a = selRef.current;
      const next = { ...s, cells: { ...s.cells } };
      for (let r = a.r0; r <= a.r1; r++) {
        for (let c = a.c0; c <= a.c1; c++) {
          if (isCoveredByMerge(s, r, c)) continue;
          const key = cellKey(r, c);
          const cur = next.cells[key];
          if (cur?.style) next.cells[key] = { value: cur.value, style: undefined, validation: cur.validation };
        }
      }
      return next;
    });
    setClearOpen(false);
  }, [setSheet]);
  const clearAll = useCallback(() => {
    const a = selRef.current;
    setSheet((s) => clearRange(s, a.r0, a.c0, a.r1, a.c1));
    setClearOpen(false);
  }, [setSheet]);

  // ---- 边框：外边框 / 所有框线 / 无边框（含颜色与线型） ----
  const [borderColor, setBorderColor] = useState('#1a1a2e');
  const [borderLine, setBorderLine] = useState<BorderLineStyle>('solid');
  const applyBorder = useCallback(
    (kind: 'outer' | 'all' | 'none') => {
      setSheet((s) => {
        const next = { ...s, cells: { ...s.cells } };
        const a = selRef.current;
        const opts = { color: borderColor, style: borderLine };
        for (let r = a.r0; r <= a.r1; r++) {
          for (let c = a.c0; c <= a.c1; c++) {
            if (isCoveredByMerge(s, r, c)) continue;
            const key = cellKey(r, c);
            const cur = next.cells[key];
            const style = { ...(cur?.style ?? {}) };
            if (kind === 'none') {
              delete style.border;
            } else if (kind === 'all') {
              style.border = { ...opts, top: true, bottom: true, left: true, right: true };
            } else {
              style.border = { ...opts, top: r === a.r0, bottom: r === a.r1, left: c === a.c0, right: c === a.c1 };
            }
            next.cells[key] = { value: cur?.value ?? '', style, validation: cur?.validation };
          }
        }
        return next;
      });
      setBorderOpen(false);
    },
    [setSheet, borderColor, borderLine],
  );

  // ---- 复制 / 剪切 / 粘贴 ----
  const sheetRef = useRef(sheet);
  sheetRef.current = sheet;
  const selRef = useRef(sel);
  selRef.current = sel;
  const anchorPtRef = useRef(anchor);
  anchorPtRef.current = anchor;

  const copySel = useCallback(
    (isCut: boolean) => {
      const s = sheetRef.current;
      const a = selRef.current;
      if (!s) return;
      const grid = makeClipGrid(s, a.r0, a.c0, a.r1, a.c1);
      if (grid.rows === 0 || grid.cols === 0) return;
      clipRef.current = { grid, cut: isCut, srcAt: isCut ? { r: a.r0, c: a.c0 } : null };
      setPastable(true);
      if (isCut) {
        setSheet((prev) => clearRange(prev, a.r0, a.c0, a.r1, a.c1));
        setCtx(null);
      }
      // 同时写入系统剪贴板（TSV），便于粘贴到其他程序/被内部兜底读取
      navigator.clipboard?.writeText(clipToTSV(grid)).catch(() => {});
      if (!isCut) toast('已复制选区');
    },
    [setSheet, toast],
  );

  const paste = useCallback(
    async (mode: PasteMode) => {
      const s = sheetRef.current;
      const a = selRef.current;
      if (!s) return;
      let grid = clipRef.current?.grid ?? null;
      if (!grid) {
        // 内部无剪贴板：尝试读取系统剪贴板 TSV
        try {
          const text = await navigator.clipboard?.readText();
          if (text) grid = parseTSV(text);
        } catch {
          /* 剪贴板读取被拒绝则忽略 */
        }
      }
      if (!grid || grid.rows === 0) {
        toast('剪贴板为空或不可用', 'error');
        return;
      }
      const srcAt = clipRef.current?.cut ? clipRef.current.srcAt : null;
      const cutGrid = clipRef.current?.cut ? clipRef.current.grid : null;
      setSheet((prev) => pasteGrid(prev, grid, a.r0, a.c0, mode));
      if (cutGrid && srcAt) {
        // 剪切：粘贴后清除源区域
        setSheet((prev) => clearRange(prev, srcAt.r, srcAt.c, srcAt.r + cutGrid.rows - 1, srcAt.c + cutGrid.cols - 1));
        clipRef.current = { ...clipRef.current!, cut: false };
      }
      setCtx(null);
    },
    [setSheet, toast],
  );

  // ---- 键盘快捷键：Ctrl/Cmd + C/X/V + Z/Y（撤销/重做） ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      const t = e.target as HTMLElement;
      const tag = t.tagName;
      const editing = tag === 'INPUT' || tag === 'TEXTAREA' || t.isContentEditable === true;
      if (editing) return; // 编辑输入框内不劫持：让浏览器原生处理文本撤销
      const k = e.key.toLowerCase();
      if (k === 'c') {
        e.preventDefault();
        copySel(false);
      } else if (k === 'x') {
        e.preventDefault();
        copySel(true);
      } else if (k === 'v') {
        e.preventDefault();
        void paste('normal');
      } else if (k === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (k === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [copySel, paste, undo, redo]);

  const setValidation = useCallback(
    (type: ValidationType, options: string) => {
      setSheet((s) => {
        const next = { ...s, cells: { ...s.cells } };
        const v: CellValidation = type === 'list' ? { type, options: options.split(/[,，、]/).map((o) => o.trim()).filter(Boolean) } : { type };
        for (let r = sel.r0; r <= sel.r1; r++) {
          for (let c = sel.c0; c <= sel.c1; c++) {
            if (isCoveredByMerge(s, r, c)) continue;
            const key = cellKey(r, c);
            const cur = next.cells[key];
            next.cells[key] = { value: cur?.value ?? '', style: cur?.style, validation: { ...v } };
          }
        }
        return next;
      });
      setValPop(null);
      toast('已设置数据验证');
    },
    [setSheet, sel, toast],
  );

  const clearValidation = useCallback(() => {
    setSheet((s) => {
      const next = { ...s, cells: { ...s.cells } };
      for (let r = sel.r0; r <= sel.r1; r++) {
        for (let c = sel.c0; c <= sel.c1; c++) {
          if (isCoveredByMerge(s, r, c)) continue;
          const key = cellKey(r, c);
          const cur = next.cells[key];
          if (cur) next.cells[key] = { value: cur.value, style: cur.style };
        }
      }
      return next;
    });
    setCtx(null);
    toast('已清除数据验证');
  }, [setSheet, sel, toast]);

  // ---- 查找 / 替换 ----
  const doReplace = (all: boolean) => {
    const s = sheetRef.current;
    if (!s || !findText) return;
    let count = 0;
    for (const k of Object.keys(s.cells)) {
      const v = s.cells[k]?.value;
      if (v && v.includes(findText)) count++;
    }
    if (count === 0) {
      setFindOpen(false);
      toast('未找到匹配内容', 'info');
      return;
    }
    setSheet((cur) => {
      const next = { ...cur, cells: { ...cur.cells } };
      for (const k of Object.keys(next.cells)) {
        const cell = next.cells[k];
        if (!cell || !cell.value.includes(findText)) continue;
        next.cells[k] = { ...cell, value: cell.value.split(findText).join(replaceText) };
      }
      return next;
    });
    setFindOpen(false);
    toast(`已替换 ${count} 处`);
  };

  if (isLoading || (!loaded && !data)) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size={26} />
      </div>
    );
  }
  if (!data || !sheet) {
    return <div className="flex h-full items-center justify-center text-muted">加载失败</div>;
  }

  const anchorCell = sheet.cells[cellKey(anchor.r, anchor.c)];
  const anchorRef = `${colToLetter(anchor.c)}${anchor.r + 1}`;
  const hidden = hiddenMap[data.activeSheet] ?? [];
  // 表格总宽 = 行号列 44 + 各数据列宽之和；显式设置 table 宽度，确保 table-layout: fixed 下
  // 列宽严格等于 colWidths（否则浏览器会回退到内容宽度，导致 colWidths 与渲染脱节、拖拽错乱）
  const totalTableWidth = 44 + Array.from({ length: sheet.colCount }, (_, c) => sheet.colWidths[c] ?? 100).reduce((a, b) => a + b, 0);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-white">
      {/* ===== 顶栏 ===== */}
      <div className="flex items-center gap-3 border-b border-line px-4 py-2.5">
        <button
          onClick={() => navigate('/docs')}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition hover:bg-surface hover:text-violet"
          title="返回我的文档"
        >
          <ArrowLeft size={17} />
        </button>
        <Table2 size={18} className="text-violet" />
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-56 truncate rounded-md border border-transparent bg-transparent px-2 py-1 text-14px font-650 text-ink outline-none transition focus:border-violet-border focus:bg-white"
          placeholder="未命名表格"
        />
        <span className="text-12px text-muted">
          {saving === 'saved' ? '已保存' : saving === 'dirty' ? '保存中…' : saving === 'error' ? '保存失败' : ''}
        </span>
        <button
          onClick={() => setAiOpen(true)}
          className="ml-auto flex h-8 items-center gap-1.5 rounded-lg bg-violet px-3 text-12px font-700 text-white transition hover:brightness-110"
          title="AI 助手：用自然语言生成公式或高亮规则"
        >
          <Sparkles size={14} />
          AI 助手
        </button>
      </div>

      {/* ===== 工具栏（按 PRD 12 区聚合） ===== */}
      <div className="flex flex-wrap items-center gap-1 border-b border-line bg-surface/60 px-4 py-1.5">
        {/* 编辑区：撤销/重做 · 格式刷 · 清除 · 复制/剪切/粘贴 · 查找替换 */}
        <ToolBtn title="撤销" icon={Undo2} disabled={historyIdxRef.current < 0} onClick={undo} />
        <ToolBtn
          title="重做"
          icon={Redo2}
          disabled={historyIdxRef.current >= historyRef.current.length - 1}
          onClick={redo}
        />
        <ToolBtn title="格式刷" icon={Paintbrush} active={brushing} onClick={startFormatBrush} />
        <ToolBtn title="清除（内容/格式/全部）" icon={Eraser} label="清除" active={clearOpen} onClick={() => { setClearOpen((o) => !o); setBorderOpen(false); }} />
        <ToolBtn title="复制" icon={Copy} onClick={() => copySel(false)} />
        <ToolBtn title="剪切" icon={Scissors} onClick={() => copySel(true)} />
        <ToolBtn title="粘贴" icon={ClipboardPaste} onClick={() => void paste('normal')} disabled={!pastable} />
        <ToolBtn title="查找 / 替换" icon={Search} onClick={() => setFindOpen(true)} />
        <Divider />

        {/* 字体区：字体族 · 字号 · B/I/U/S · 字体色 · 填充色 */}
        <select
          className="h-8 rounded-lg border border-line bg-white px-1 text-12px outline-none"
          value={anchorCell?.style?.fontFamily ?? 'Inter'}
          onChange={(e) => applyStyle((st) => ({ ...st, fontFamily: e.target.value }))}
        >
          {FONTFAMILIES.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
        <select
          className="h-8 rounded-lg border border-line bg-white px-1 text-12px outline-none"
          value={anchorCell?.style?.fontSize ?? 13}
          onChange={(e) => applyStyle((st) => ({ ...st, fontSize: Number(e.target.value) }))}
        >
          {FONTS.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
        <ToolBtn title="加粗" icon={Bold} active={!!anchorCell?.style?.bold} onClick={() => applyStyle((st) => ({ ...st, bold: !st.bold }))} />
        <ToolBtn title="斜体" icon={Italic} active={!!anchorCell?.style?.italic} onClick={() => applyStyle((st) => ({ ...st, italic: !st.italic }))} />
        <ToolBtn title="下划线" icon={Underline} active={!!anchorCell?.style?.underline} onClick={() => applyStyle((st) => ({ ...st, underline: !st.underline }))} />
        <ToolBtn title="删除线" icon={Strikethrough} active={!!anchorCell?.style?.strikethrough} onClick={() => applyStyle((st) => ({ ...st, strikethrough: !st.strikethrough }))} />
        <label className="flex h-8 cursor-pointer items-center gap-1 rounded-lg px-2 hover:bg-violet-light" title="文字颜色">
          <span className="text-13px font-700" style={{ color: anchorCell?.style?.color ?? '#1a1a2e' }}>A</span>
          <input
            type="color"
            className="h-0 w-0 opacity-0"
            value={anchorCell?.style?.color ?? '#7c5cff'}
            onChange={(e) => applyStyle((st) => ({ ...st, color: e.target.value }))}
          />
        </label>
        <label className="flex h-8 cursor-pointer items-center gap-1 rounded-lg px-2 hover:bg-violet-light" title="背景填充色">
          <span className="rounded px-1.5 text-12px font-700" style={{ backgroundColor: anchorCell?.style?.bg ?? '#cfe3ff' }}>填</span>
          <input
            type="color"
            className="h-0 w-0 opacity-0"
            value={anchorCell?.style?.bg ?? '#ffffff'}
            onChange={(e) => applyStyle((st) => ({ ...st, bg: e.target.value }))}
          />
        </label>
        <Divider />

        {/* 单元格样式区：边框 · 合并 · 对齐 · 垂直对齐 · 换行 · 缩进 */}
        <ToolBtn title="边框" icon={Frame} active={borderOpen} onClick={() => { setBorderOpen((o) => !o); setClearOpen(false); }} />
        <ToolBtn
          title="合并/取消合并选区"
          icon={Merge}
          onClick={() => {
            const m = findMerge(sheet, sel.r0, sel.c0);
            if (m && m.r0 === sel.r0 && m.c0 === sel.c0 && m.r1 === sel.r1 && m.c1 === sel.c1) {
              setSheet((s) => unmergeSheet(s, sel.r0, sel.c0, sel.r1, sel.c1));
            } else {
              setSheet((s) => mergeSheet(s, sel.r0, sel.c0, sel.r1, sel.c1));
            }
          }}
        />
        <ToolBtn
          title="取消覆盖当前单元格的合并"
          icon={Ban}
          onClick={() => {
            const m = findMerge(sheet, anchor.r, anchor.c);
            if (m) setSheet((s) => unmergeSheet(s, m.r0, m.c0, m.r1, m.c1));
          }}
        />
        <ToolBtn title="左对齐" icon={AlignLeft} active={anchorCell?.style?.align === 'left'} onClick={() => applyStyle((st) => ({ ...st, align: 'left' }))} />
        <ToolBtn title="居中" icon={AlignCenter} active={anchorCell?.style?.align === 'center'} onClick={() => applyStyle((st) => ({ ...st, align: 'center' }))} />
        <ToolBtn title="右对齐" icon={AlignRight} active={anchorCell?.style?.align === 'right'} onClick={() => applyStyle((st) => ({ ...st, align: 'right' }))} />
        <ToolBtn title="顶端对齐" icon={AlignStartVertical} active={anchorCell?.style?.vAlign === 'top'} onClick={() => applyStyle((st) => ({ ...st, vAlign: 'top' as VerticalAlign }))} />
        <ToolBtn title="垂直居中" icon={AlignCenterVertical} active={anchorCell?.style?.vAlign === 'middle'} onClick={() => applyStyle((st) => ({ ...st, vAlign: 'middle' }))} />
        <ToolBtn title="底端对齐" icon={AlignEndVertical} active={anchorCell?.style?.vAlign === 'bottom'} onClick={() => applyStyle((st) => ({ ...st, vAlign: 'bottom' }))} />
        <select
          className="h-8 rounded-lg border border-line bg-white px-1 text-12px outline-none"
          title="单元格内容展示方式"
          value={
            anchorCell?.style?.wrap ? 'wrap' : anchorCell?.style?.overflow ? 'overflow' : 'truncate'
          }
          onChange={(e) => {
            const v = e.target.value;
            applyStyle((st) =>
              v === 'wrap'
                ? { ...st, wrap: true, overflow: false }
                : v === 'overflow'
                  ? { ...st, wrap: false, overflow: true }
                  : { ...st, wrap: false, overflow: false },
            );
          }}
        >
          <option value="truncate">截断显示</option>
          <option value="wrap">自动换行</option>
          <option value="overflow">溢出显示</option>
        </select>
        <ToolBtn title="减少缩进" icon={IndentDecrease} onClick={() => applyStyle((st) => ({ ...st, indent: Math.max(0, (st.indent ?? 0) - 1) }))} />
        <ToolBtn title="增加缩进" icon={IndentIncrease} onClick={() => applyStyle((st) => ({ ...st, indent: Math.min(10, (st.indent ?? 0) + 1) }))} />
        <Divider />

        {/* 数字格式区 */}
        <select
          className="h-8 rounded-lg border border-line bg-white px-1 text-12px outline-none"
          value={anchorCell?.style?.format ?? 'general'}
          onChange={(e) => applyStyle((st) => ({ ...st, format: e.target.value as NumberFormat }))}
        >
          {FORMATS.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
        <Divider />

        {/* 数据区：排序 · 筛选 */}
        <ToolBtn title="按选中列升序排序" icon={ArrowUpDown} label="升序" onClick={() => setSheet((s) => sortSheet(s, 1, s.rowCount - 1, sel.c0, 'asc'))} />
        <ToolBtn title="按选中列降序排序" icon={ArrowDownUp} label="降序" onClick={() => setSheet((s) => sortSheet(s, 1, s.rowCount - 1, sel.c0, 'desc'))} />
        <ToolBtn
          title={filterApp?.col === sel.c0 ? '已筛选，点击重新设置' : '按选中列筛选'}
          icon={Filter}
          label="筛选"
          active={filterApp?.col === sel.c0}
          onClick={(e) => {
            setFilterCol(sel.c0);
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setFilterAnchor({ left: rect.left, bottom: rect.bottom });
            setFilterOpen(true);
          }}
        />
        {filterOpen && (
          <FilterMenu
            sheet={sheet}
            col={filterCol}
            current={filterApp?.col === filterCol ? filterApp.values : null}
            anchor={filterAnchor}
            onApply={(values) => {
              const app = { col: filterCol, values };
              setFilterApp(app);
              const keep = new Set(values);
              const hid: number[] = [];
              for (let r = 0; r < sheet.rowCount; r++) {
                const v = sheet.cells[cellKey(r, filterCol)]?.value ?? '';
                if (v !== '' && !keep.has(v)) hid.push(r);
              }
              setHiddenMap((m) => ({ ...m, [data.activeSheet]: hid }));
              setFilterOpen(false);
              toast(values.length ? `已筛选，隐藏 ${hid.length} 行` : '已筛选（所有值已隐藏）', 'info');
            }}
            onClear={() => {
              setFilterApp(null);
              setHiddenMap((m) => ({ ...m, [data.activeSheet]: [] }));
              setFilterOpen(false);
              toast('已清除筛选', 'info');
            }}
            onClose={() => setFilterOpen(false)}
          />
        )}
        <ToolBtn
          title="条件格式"
          icon={Palette}
          label="条件格式"
          active={(sheet.conditionalFormats ?? []).length > 0}
          onClick={(e) => {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setCfAnchor({ left: rect.left, bottom: rect.bottom });
            setCfOpen(true);
          }}
        />
        {cfOpen && (
          <CFMenu
            sheet={sheet}
            sel={sel}
            anchor={cfAnchor}
            onAdd={addConditionalFormat}
            onRemove={removeConditionalFormat}
            onClose={() => setCfOpen(false)}
          />
        )}
        <Divider />

        {/* 插入区：行列 · 下拉 · 日期 · 勾选 */}
        <ToolBtn title="在选区上方插入行" icon={Rows3} label="插行" onClick={() => setSheet((s) => insertRow(s, sel.r0))} />
        <ToolBtn title="删除选区所在行" icon={Trash2} label="删行" onClick={() => setSheet((s) => deleteRow(s, sel.r0))} />
        <ToolBtn title="在选区左侧插入列" icon={Columns3} label="插列" onClick={() => setSheet((s) => insertCol(s, sel.c0))} />
        <ToolBtn title="删除选区所在列" icon={Trash2} label="删列" onClick={() => setSheet((s) => deleteCol(s, sel.c0))} />
        <ToolBtn title="插入下拉列表（数据验证）" icon={Shield} label="下拉" onClick={() => setValPop({ type: 'list', options: '' })} />
        <ToolBtn title="插入日期（单元格日期格式）" icon={Calendar} label="日期" onClick={() => applyStyle((st) => ({ ...st, format: 'date' }))} />
        <Divider />

        {/* 视图区：冻结首行/首列 */}
        <ToolBtn
          title={sheet.freezeRows > 0 ? '取消冻结首行' : '冻结首行'}
          icon={Snowflake}
          label="冻结行"
          active={sheet.freezeRows > 0}
          onClick={() => setSheet((s) => ({ ...s, freezeRows: s.freezeRows > 0 ? 0 : 1 }))}
        />
        <ToolBtn
          title={sheet.freezeCols > 0 ? '取消冻结首列' : '冻结首列'}
          icon={Columns3}
          label="冻结列"
          active={sheet.freezeCols > 0}
          onClick={() => setSheet((s) => ({ ...s, freezeCols: s.freezeCols > 0 ? 0 : 1 }))}
        />

        {/* 清除下拉 */}
        {clearOpen && (
          <span className="flex items-center gap-1 rounded-lg border border-line bg-white px-1 py-0.5 shadow-card">
            <button className="h-7 rounded-md px-2 text-12px font-600 text-ink hover:bg-surface" onClick={clearContent}>内容</button>
            <button className="h-7 rounded-md px-2 text-12px font-600 text-ink hover:bg-surface" onClick={clearFormats}>格式</button>
            <button className="h-7 rounded-md px-2 text-12px font-600 text-ink hover:bg-surface" onClick={clearAll}>全部</button>
          </span>
        )}

        {/* 边框下拉：颜色 + 线型 + 应用方式 */}
        {borderOpen && (
          <span className="flex items-center gap-1 rounded-lg border border-line bg-white px-2 py-1 shadow-card">
            <label className="flex h-7 cursor-pointer items-center gap-1 rounded-md px-1.5 hover:bg-surface" title="边框颜色">
              <span className="rounded px-1 text-11px font-700 text-white" style={{ backgroundColor: borderColor }}>色</span>
              <input
                type="color"
                className="h-0 w-0 opacity-0"
                value={borderColor}
                onChange={(e) => setBorderColor(e.target.value)}
              />
            </label>
            <select
              className="h-7 rounded-md border border-line bg-white px-1 text-12px outline-none"
              title="线条样式"
              value={borderLine}
              onChange={(e) => setBorderLine(e.target.value as BorderLineStyle)}
            >
              <option value="solid">实线</option>
              <option value="dashed">虚线</option>
              <option value="dotted">点线</option>
            </select>
            <button className="h-7 rounded-md px-2 text-12px font-600 text-ink hover:bg-surface" onClick={() => applyBorder('outer')}>外边框</button>
            <button className="h-7 rounded-md px-2 text-12px font-600 text-ink hover:bg-surface" onClick={() => applyBorder('all')}>所有框线</button>
            <button className="h-7 rounded-md px-2 text-12px font-600 text-ink hover:bg-surface" onClick={() => applyBorder('none')}>无边框</button>
          </span>
        )}
      </div>

      {/* ===== 公式栏 ===== */}
      <div className="flex items-center gap-2 border-b border-line px-4 py-1.5">
        <span className="flex h-8 w-16 items-center justify-center rounded-lg bg-violet-light font-mono text-13px font-700 text-violet">
          {anchorRef}
        </span>
        <div className="h-3.5 w-px bg-line" />
        <input
          value={anchorCell?.value ?? ''}
          onChange={(e) => setCellValue(anchor.r, anchor.c, e.target.value)}
          placeholder="输入单元格内容，以 = 开头为公式（如 =SUM(A1:B3)）"
          className="h-8 flex-1 rounded-lg px-2 font-mono text-13px text-ink outline-none focus:ring-2 focus:ring-violet/15"
        />
      </div>

      {/* ===== 视图切换（表格 / 看板 / 日历） ===== */}
      <div className="flex items-center gap-1 border-b border-line bg-surface/40 px-4 py-1">
        <button
          onClick={() => setViewMode('table')}
          className={`flex h-7 items-center gap-1 rounded-lg px-3 text-12px font-600 transition ${viewMode === 'table' ? 'bg-white text-violet shadow-sm' : 'text-muted hover:text-violet'}`}
        >
          <Table2 size={13} /> 表格
        </button>
        <button
          onClick={() => setViewMode('board')}
          className={`flex h-7 items-center gap-1 rounded-lg px-3 text-12px font-600 transition ${viewMode === 'board' ? 'bg-white text-violet shadow-sm' : 'text-muted hover:text-violet'}`}
        >
          <Columns3 size={13} /> 看板
        </button>
        <button
          onClick={() => setViewMode('calendar')}
          className={`flex h-7 items-center gap-1 rounded-lg px-3 text-12px font-600 transition ${viewMode === 'calendar' ? 'bg-white text-violet shadow-sm' : 'text-muted hover:text-violet'}`}
        >
          <Calendar size={13} /> 日历
        </button>
        <span className="mx-1 h-3.5 w-px bg-line" />
        {viewMode === 'board' && (
          <label className="flex items-center gap-1 text-12px text-muted">
            分组列
            <select
              value={boardGroupCol}
              onChange={(e) => setBoardGroupCol(Number(e.target.value))}
              className="h-7 rounded-lg border border-line bg-white px-1 text-12px outline-none"
            >
              {Array.from({ length: sheet.colCount }, (_, c) => (
                <option key={c} value={c}>{colToLetter(c)} 列</option>
              ))}
            </select>
          </label>
        )}
        {viewMode === 'calendar' && (
          <label className="flex items-center gap-1 text-12px text-muted">
            日期列
            <select
              value={calDateCol}
              onChange={(e) => setCalDateCol(Number(e.target.value))}
              className="h-7 rounded-lg border border-line bg-white px-1 text-12px outline-none"
            >
              {Array.from({ length: sheet.colCount }, (_, c) => (
                <option key={c} value={c}>{colToLetter(c)} 列</option>
              ))}
            </select>
          </label>
        )}
      </div>

      {/* ===== 网格 ===== */}
      {viewMode === 'table' ? (
      <div
        className="sheet-grid flex-1 select-none overflow-auto bg-white outline-none"
        ref={gridRef}
        tabIndex={0}
        onMouseUp={onGridUp}
        onMouseMove={onGridMove}
        onKeyDown={(e) => {
          // 全选
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
            e.preventDefault();
            setAnchor({ r: 0, c: 0 });
            setDragEnd({ r: Math.max(0, sheet.rowCount - 1), c: Math.max(0, sheet.colCount - 1) });
            return;
          }
          if (editing) return; // 内联输入框自行处理
          if (e.metaKey || e.ctrlKey || e.altKey) return;
          if (e.key === 'Enter') {
            e.preventDefault();
            beginEdit(anchor.r, anchor.c, false);
          } else if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            // 清空当前选区（全选后按 Delete 即清空整表内容）
            setSheet((s) => clearRange(s, sel.r0, sel.c0, sel.r1, sel.c1));
          } else if (e.key === 'F2') {
            e.preventDefault();
            beginEdit(anchor.r, anchor.c, false);
          } else if (e.key.length === 1) {
            e.preventDefault();
            beginEdit(anchor.r, anchor.c, true, e.key);
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          const td = (e.target as HTMLElement).closest('td[data-r][data-c]') as HTMLElement | null;
          if (td) {
            const r = Number(td.getAttribute('data-r'));
            const c = Number(td.getAttribute('data-c'));
            setAnchor({ r, c });
            setDragEnd({ r, c });
          }
          setCtx({ x: e.clientX, y: e.clientY });
        }}
        style={{ cursor: resizeRef.current ? (resizeRef.current.type === 'col' ? 'col-resize' : 'row-resize') : undefined }}
      >
        <table className="border-separate" style={{ tableLayout: 'fixed', borderSpacing: 0, width: totalTableWidth }}>
          <colgroup>
            <col style={{ width: 44 }} />
            {Array.from({ length: sheet.colCount }, (_, c) => (
              <col key={c} style={{ width: sheet.colWidths[c] ?? 100 }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th
                className="border-r border-line bg-surface"
                style={{ width: 44, minWidth: 44, height: 26, position: 'sticky', top: 0, left: 0, zIndex: 30 }}
              />
              {Array.from({ length: sheet.colCount }, (_, c) => (
                <th
                  key={c}
                  onMouseDown={(e) => colHeaderDown(c, e)}
                  onMouseEnter={() => colHeaderEnter(c)}
                  className="relative border-r border-line bg-surface px-0 text-center font-mono text-11px font-600 text-muted"
                  style={{ width: sheet.colWidths[c] ?? 100, minWidth: 0, height: 26, position: 'sticky', top: 0, zIndex: 20 }}
                >
                  {colToLetter(c)}
                  {/* 列宽拖拽把手：右缘固定命中区，光标变为可拖拽形态 */}
                  <span
                    className="absolute inset-y-0 right-0 z-20 block w-3 cursor-col-resize select-none"
                    title="拖拽调整列宽"
                    onMouseDown={(e) => startColResize(c, e)}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: sheet.rowCount }, (_, r) => (
              <GridRow
                key={r}
                sheet={sheet}
                r={r}
                sel={sel}
                anchor={anchor}
                dragging={dragging}
                hidden={hidden}
                onRowHeaderDown={(e, rr) => rowHeaderDown(rr, e)}
                onRowHeaderEnter={(rr) => rowHeaderEnter(rr)}
                onRowResizeStart={(e, rr) => startRowResize(rr, e)}
                onCellMouse={onCellMouse}
                onCellDbl={(r, c) => beginEdit(r, c, false)}
                editing={editing}
                editValue={editValue}
                onEditInput={(e) => setEditValue(e.target.value)}
                onEditKey={onEditKey}
                onEditCommit={commitEdit}
                editInputRef={editInputRef}
                fillActive={fillActive}
                fillTarget={fillTarget}
                onFillStart={onFillStart}
                onFillMove={onFillMove}
                cfStats={cfStats}
                formulaSuggestions={formulaSuggestions}
                onFormulaPick={pickFormula}
              />
            ))}
          </tbody>
        </table>
      </div>
      ) : viewMode === 'board' ? (
        <BoardView sheet={sheet} groupCol={boardGroupCol} />
      ) : (
        <CalendarView sheet={sheet} dateCol={calDateCol} />
      )}

      {/* ===== 工作表 tabs ===== */}
      <div className="flex items-center gap-1 border-t border-line bg-surface px-2 py-1">
        {data.sheets.map((s, i) => (
          <div key={`${i}-${s.name}`} className="group relative">
            <button
              onClick={() => setData((d) => ({ ...d!, activeSheet: i }))}
              className={`flex h-7 items-center gap-1 rounded-lg px-3 text-12px font-600 transition ${
                data.activeSheet === i ? 'bg-white text-violet shadow-sm' : 'text-muted hover:text-violet'
              }`}
            >
              <Table2 size={13} />
              {s.name}
            </button>
            {data.activeSheet === i && (
              <span className="absolute -right-0 -top-1 z-10" onClick={(e) => e.stopPropagation()}>
                <button
                  title="重命名工作表"
                  className="flex h-4 w-4 items-center justify-center rounded-full bg-surface text-[10px] text-muted hover:bg-violet-light hover:text-violet"
                  onClick={() => {
                    const name = window.prompt('重命名工作表', s.name);
                    if (name && name.trim()) setData((d) => d && { ...d, sheets: d.sheets.map((x, xi) => (xi === i ? { ...x, name: name.trim() } : x)) });
                  }}
                >
                  ✎
                </button>
              </span>
            )}
          </div>
        ))}
        <button
          onClick={() =>
            setData((d) => {
              if (!d) return d;
              const n = d.sheets.length + 1;
              const base = defaultSheetData(`表格${n}`).sheets[0];
              return { ...d, sheets: [...d.sheets, { ...base, rowCount: d.sheets[0].rowCount, colCount: d.sheets[0].colCount, name: `表格${n}` }], activeSheet: d.sheets.length };
            })
          }
          className="flex h-7 w-7 items-center justify-center rounded-lg text-muted transition hover:bg-violet-light hover:text-violet"
          title="新增工作表"
        >
          <PlusCircle size={16} />
        </button>
        {data.sheets.length > 1 && (
          <button
            onClick={() => {
              if (!window.confirm(`删除工作表「${sheet.name}」？`)) return;
              setData((d) => {
                if (!d || d.sheets.length <= 1) return d;
                const sheets = d.sheets.filter((_, x) => x !== d.activeSheet);
                return { ...d, sheets, activeSheet: Math.min(d.activeSheet, sheets.length - 1) };
              });
              setHiddenMap((m) => {
                const next = { ...m };
                delete next[data.activeSheet];
                return next;
              });
            }}
            className="ml-1 flex h-7 w-7 items-center justify-center rounded-lg text-muted transition hover:bg-coral/10 hover:text-coral"
            title="删除当前工作表"
          >
            <Trash2 size={14} />
          </button>
        )}
        <div className="ml-auto px-2 text-11px text-muted">
          {sheet.rowCount} 行 × {sheet.colCount} 列
        </div>
      </div>

      {/* ===== AI 表格助手弹窗 ===== */}
      {aiOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20" onMouseDown={() => setAiOpen(false)}>
          <div className="w-[440px] rounded-2xl border border-line bg-white p-5 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-14px font-700 text-ink">
                <Sparkles size={16} className="text-violet" /> AI 助手
              </span>
              <button onClick={() => setAiOpen(false)} className="rounded-md p-1 text-muted hover:bg-surface hover:text-ink" title="关闭">
                <X size={16} />
              </button>
            </div>
            <textarea
              value={aiInstruction}
              onChange={(e) => setAiInstruction(e.target.value)}
              placeholder="用自然语言描述表格操作，例如：\n「把 B 列大于 10 的单元格标黄」\n「对 C 列求和并填入当前单元格」"
              className="h-28 w-full resize-none rounded-lg border border-line px-3 py-2 text-13px text-ink outline-none focus:ring-2 focus:ring-violet/15"
            />
            <div className="mt-3 flex items-center justify-between">
              <span className="text-11px text-muted">将生成公式或高亮条件格式并应用</span>
              <div className="flex items-center gap-2">
                <button onClick={() => setAiOpen(false)} className="h-8 rounded-lg px-3 text-12px font-600 text-muted hover:bg-surface">
                  取消
                </button>
                <button
                  onClick={runSheetAi}
                  disabled={aiLoading || !aiInstruction.trim()}
                  className="flex h-8 items-center gap-1 rounded-lg bg-violet px-4 text-12px font-700 text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {aiLoading ? <Spinner size={14} /> : <Sparkles size={14} />}
                  {aiLoading ? '处理中…' : '生成'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== 右键菜单 ===== */}
      {ctx && (
        <div
          className="fixed inset-0 z-50"
          onMouseDown={(e) => {
            e.stopPropagation();
            setCtx(null);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            setCtx(null);
          }}
        >
          <div
            className="absolute w-52 rounded-xl border border-line bg-white py-1 shadow-2xl"
            style={{ left: Math.min(ctx.x, window.innerWidth - 216), top: Math.min(ctx.y, window.innerHeight - 380) }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <CtxItem icon={Copy} label="复制" shortcut={shortcutLabel('C')} onClick={() => copySel(false)} />
            <CtxItem
              icon={Scissors}
              label="剪切"
              shortcut={shortcutLabel('X')}
              onClick={() => {
                setCtx(null);
                copySel(true);
              }}
            />
            <CtxItem icon={ClipboardPaste} label="粘贴" shortcut={shortcutLabel('V')} onClick={() => void paste('normal')} disabled={!pastable} />
            <CtxDivider />
            <div className="px-2 pb-1 pt-2 text-10px font-700 uppercase tracking-wide text-muted">选择性粘贴</div>
            <CtxItem icon={CheckCheck} label="仅粘贴值" onClick={() => void paste('value')} disabled={!pastable} />
            <CtxItem icon={FormInput} label="仅粘贴格式" onClick={() => void paste('format')} disabled={!pastable} />
            <CtxItem icon={List} label="仅粘贴公式" onClick={() => void paste('formula')} disabled={!pastable} />
            <CtxItem icon={Shield} label="仅粘贴数据验证" onClick={() => void paste('validation')} disabled={!pastable} />
            <CtxDivider />
            <CtxItem icon={Shield} label="设置数据验证…" onClick={() => setValPop({ type: 'number', options: '' })} />
            <CtxItem icon={Ban} label="清除数据验证" onClick={clearValidation} />
          </div>
        </div>
      )}

      {/* ===== 查找/替换弹窗 ===== */}
      {findOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          onMouseDown={(e) => {
            e.stopPropagation();
            setFindOpen(false);
          }}
        >
          <div className="w-96 rounded-2xl border border-line bg-white p-5 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-14px font-700 text-ink">查找 / 替换</h3>
              <button
                onClick={() => setFindOpen(false)}
                className="flex items-center gap-1 rounded-md p-1 text-muted hover:bg-surface hover:text-ink"
              >
                <X size={14} />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-11px font-600 text-muted">查找内容</label>
                <input
                  autoFocus
                  className="form-input h-9 w-full text-13px"
                  placeholder="输入要查找的文字"
                  value={findText}
                  onChange={(e) => setFindText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && findText && doReplace(true)}
                />
              </div>
              <div>
                <label className="mb-1 block text-11px font-600 text-muted">替换为</label>
                <input
                  className="form-input h-9 w-full text-13px"
                  placeholder="替换后的文字"
                  value={replaceText}
                  onChange={(e) => setReplaceText(e.target.value)}
                />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  onClick={() => setFindOpen(false)}
                  className="h-9 rounded-lg px-4 text-13px font-600 text-muted hover:bg-surface"
                >
                  关闭
                </button>
                <button
                  className="h-9 rounded-lg bg-violet px-4 text-13px font-700 text-white hover:brightness-110 disabled:opacity-50"
                  disabled={!findText}
                  onClick={() => doReplace(true)}
                >
                  全部替换
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== 数据验证弹窗 ===== */}
      {valPop && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          onMouseDown={(e) => {
            e.stopPropagation();
            setValPop(null);
            setCtx(null);
          }}
        >
          <div className="w-80 rounded-2xl border border-line bg-white p-5 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-14px font-700 text-ink">设置数据验证</h3>
              <button
                onClick={() => {
                  setValPop(null);
                  setCtx(null);
                }}
                className="rounded-md p-1 text-muted hover:bg-surface hover:text-ink"
              >
                <X size={15} />
              </button>
            </div>
            <div className="space-y-3">
              <select
                className="h-9 w-full rounded-lg border border-line bg-white px-2 text-13px outline-none"
                value={valPop.type}
                onChange={(e) => setValPop({ ...valPop, type: e.target.value as ValidationType })}
              >
                <option value="number">数字</option>
                <option value="text">文本</option>
                <option value="list">下拉列表</option>
              </select>
              {valPop.type === 'list' && (
                <input
                  autoFocus
                  className="form-input h-9 w-full text-13px"
                  placeholder="选项，用逗号分隔，如：高,中,低"
                  value={valPop.options}
                  onChange={(e) => setValPop({ ...valPop, options: e.target.value })}
                />
              )}
              <div className="flex justify-end gap-2 pt-1">
                <button
                  onClick={() => {
                    setValPop(null);
                    setCtx(null);
                  }}
                  className="h-9 rounded-lg px-4 text-13px font-600 text-muted hover:bg-surface"
                >
                  取消
                </button>
                <button
                  className="h-9 rounded-lg bg-violet px-4 text-13px font-700 text-white hover:brightness-110"
                  onClick={() => {
                    if (valPop.type === 'list' && !valPop.options.trim()) {
                      toast('下拉列表请输入至少一个选项', 'error');
                      return;
                    }
                    setValidation(valPop.type, valPop.options);
                  }}
                >
                  确定
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== 列宽/行高拖拽虚线预览（定位，松手后生效） ===== */}
      {resizePreview && (
        <div
          className="pointer-events-none fixed z-50 border-violet"
          style={
            resizePreview.type === 'col'
              ? { left: resizePreview.pos, top: 0, bottom: 0, borderLeft: '1px dashed #7c5cff' }
              : { top: resizePreview.pos, left: 0, right: 0, borderTop: '1px dashed #7c5cff' }
          }
        />
      )}
    </div>
  );

  // ---- 网格交互函数 ----

  function onCellMouse(r: number, c: number, ev: 'down' | 'move' | 'dbl') {
    if (ev === 'down') {
      // 格式刷激活时：点击目标单元格即套用格式并退出刷取态
      if (applyBrushTo(r, c)) return;
      // 点击新单元格时提交上一个正在编辑的内容，并聚焦网格容器以接收键盘输入
      if (editing) commitEdit();
      gridRef.current?.focus({ preventScroll: true });
      setDragging(true);
      setAnchor({ r, c });
      setDragEnd({ r, c });
    } else if (ev === 'move') {
      if (dragging) setDragEnd({ r, c });
    } else {
      setAnchor({ r, c });
      setDragEnd({ r, c });
    }
  }

  function onGridMove() {} // 保留占位（原逻辑迁移到列宽/行高的 document 监听）

  // ---- 填充柄拖拽：序列填充 ----
  function onFillStart(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    fillSrcRef.current = sel;
    setFillActive(true);
    setFillEnd({ r: sel.r1, c: sel.c1 });
  }

  function onFillMove(r: number, c: number) {
    if (fillActive) setFillEnd({ r, c });
  }

  function onFillCommit() {
    if (!fillActive) return;
    const src = fillSrcRef.current;
    const end = fillEnd;
    setFillActive(false);
    setFillEnd(null);
    fillSrcRef.current = null;
    if (!src || !end || !sheet) return;
    const target: FillRange = {
      r0: Math.min(src.r0, end.r),
      c0: Math.min(src.c0, end.c),
      r1: Math.max(src.r1, end.r),
      c1: Math.max(src.c1, end.c),
    };
    const filled = fillSeries(sheet, { r0: src.r0, c0: src.c0, r1: src.r1, c1: src.c1 }, target);
    const keys = Object.keys(filled);
    if (keys.length === 0) return;
    setSheet((s) => {
      const next = { ...s, cells: { ...s.cells } };
      for (const k of keys) next.cells[k] = filled[k];
      return next;
    });
  }

  function onGridUp() {
    setDragging(false);
    headerSelRef.current = null;
    onFillCommit();
  }

  // ---- 列宽 / 行高拖拽：挂 document 级监听，拖出容器也不中断。
  //   交互仿飞书：拖拽过程只显示虚线预览定位，不实时改变尺寸；松开鼠标后一次性生效（记录一次历史）
  function stopResize(e: MouseEvent) {
    const r = resizeRef.current;
    if (r) {
      const isCol = r.type === 'col';
      const delta = isCol ? e.clientX - r.start : e.clientY - r.start;
      const size = Math.max(30, r.size + delta);
      if (isCol) setSheet((s) => ({ ...s, colWidths: { ...s.colWidths, [r.index]: size } }));
      else setSheet((s) => ({ ...s, rowHeights: { ...s.rowHeights, [r.index]: size } }));
      document.body.style.cursor = '';
    }
    resizeRef.current = null;
    setResizePreview(null);
    document.removeEventListener('mousemove', resizeMove);
    document.removeEventListener('mouseup', stopResize);
  }
  function resizeMove(e: MouseEvent) {
    const r = resizeRef.current;
    if (!r) return;
    // 计算松手后的目标尺寸（含最小宽度钳制），虚线定位在“结果边界”而非鼠标位置，
    // 确保所见即所得：虚线停在哪，列/行右(下)缘就停在哪
    const isCol = r.type === 'col';
    const delta = isCol ? e.clientX - r.start : e.clientY - r.start;
    const size = Math.max(30, r.size + delta);
    const edge = r.start + (size - r.size); // r.start 即按下时的列右缘/行下缘屏幕位置
    setResizePreview({ type: r.type, index: r.index, pos: edge });
  }
  function startColResize(index: number, e: React.MouseEvent) {
    if (editing) commitEdit();
    e.preventDefault();
    e.stopPropagation();
    headerSelRef.current = null;
    // 以该列「数据单元格」的真实右缘为基准，且原始宽度取「实际渲染宽度」而非 colWidths 存储值，
    // 避免存储值被历史数据污染（巨大浮点值）后与渲染宽度错位，导致拖拽结果错误
    const grid = gridRef.current;
    const cell = grid?.querySelector<HTMLElement>(`td[data-c="${index}"]`);
    const rect = cell?.getBoundingClientRect();
    const right = rect ? rect.right : (e.currentTarget as HTMLElement).getBoundingClientRect().right;
    const origW = rect ? rect.width : (sheet!.colWidths[index] ?? 100);
    resizeRef.current = { type: 'col', index, start: right, size: origW };
    setResizePreview({ type: 'col', index, pos: right });
    document.body.style.cursor = 'col-resize';
    document.addEventListener('mousemove', resizeMove);
    document.addEventListener('mouseup', stopResize);
  }
  function startRowResize(index: number, e: React.MouseEvent) {
    if (editing) commitEdit();
    e.preventDefault();
    e.stopPropagation();
    headerSelRef.current = null;
    // 以把手（行下缘）的精确屏幕位置为基准，松手后行下缘对齐虚线
    const bottom = (e.currentTarget as HTMLElement).getBoundingClientRect().bottom;
    resizeRef.current = { type: 'row', index, start: bottom, size: sheet!.rowHeights[index] ?? 28 };
    setResizePreview({ type: 'row', index, pos: bottom });
    document.body.style.cursor = 'row-resize';
    document.addEventListener('mousemove', resizeMove);
    document.addEventListener('mouseup', stopResize);
  }

  // ---- 表头选择：点列头/行头整列整行，拖动跨表头多选 ----
  function colHeaderDown(c: number, e: React.MouseEvent) {
    if (editing) commitEdit();
    e.preventDefault();
    headerSelRef.current = { type: 'col' };
    gridRef.current?.focus({ preventScroll: true });
    setAnchor({ r: 0, c });
    setDragEnd({ r: Math.max(0, sheet!.rowCount - 1), c });
  }
  function colHeaderEnter(c: number) {
    if (headerSelRef.current?.type !== 'col') return;
    setAnchor({ r: 0, c });
    setDragEnd({ r: Math.max(0, sheet!.rowCount - 1), c });
  }
  function rowHeaderDown(r: number, e: React.MouseEvent) {
    if (editing) commitEdit();
    e.preventDefault();
    headerSelRef.current = { type: 'row' };
    gridRef.current?.focus({ preventScroll: true });
    setAnchor({ r, c: 0 });
    setDragEnd({ r, c: Math.max(0, sheet!.colCount - 1) });
  }
  function rowHeaderEnter(r: number) {
    if (headerSelRef.current?.type !== 'row') return;
    setAnchor({ r, c: 0 });
    setDragEnd({ r, c: Math.max(0, sheet!.colCount - 1) });
  }
}

// ===== 网格行组件 =====

interface CFStat {
  min: number;
  max: number;
  counts: Record<string, number>;
}

/** 计算某单元格命中的条件格式样式（背景/文字色，或色阶/数据条） */
function cellConditionalStyle(
  sheet: SheetState,
  stats: CFStat[],
  r: number,
  c: number,
  value: string,
): { bg?: string; color?: string; bar?: { ratio: number; color: string } } {
  const out: { bg?: string; color?: string; bar?: { ratio: number; color: string } } = {};
  const list = sheet.conditionalFormats ?? [];
  list.forEach((cf, i) => {
    if (r < cf.r0 || r > cf.r1 || c < cf.c0 || c > cf.c1) return;
    const st = stats[i];
    if (!st) return;
    if (cf.type === 'colorScale') {
      const b = colorScaleBg(cf, value, st.min, st.max);
      if (b) out.bg = b;
    } else if (cf.type === 'dataBar') {
      const ratio = dataBarRatio(value, st.min, st.max);
      if (ratio != null) out.bar = { ratio, color: cf.barColor ?? '#7c5cff' };
    } else if (matchCondition(cf, value, st.counts)) {
      if (cf.bg) out.bg = cf.bg;
      if (cf.color) out.color = cf.color;
    }
  });
  return out;
}

function GridRow({
  sheet,
  r,
  sel,
  anchor,
  dragging,
  hidden,
  onRowHeaderDown,
  onRowHeaderEnter,
  onRowResizeStart,
  onCellMouse,
  onCellDbl,
  editing,
  editValue,
  onEditInput,
  onEditKey,
  onEditCommit,
  editInputRef,
  fillActive,
  fillTarget,
  onFillStart,
  onFillMove,
  cfStats,
  formulaSuggestions,
  onFormulaPick,
}: {
  sheet: SheetState;
  r: number;
  sel: SelectionRange;
  anchor: Pt;
  dragging: boolean;
  hidden: number[];
  onRowHeaderDown: (e: React.MouseEvent, r: number) => void;
  onRowHeaderEnter: (r: number) => void;
  onRowResizeStart: (e: React.MouseEvent, r: number) => void;
  onCellMouse: (r: number, c: number, ev: 'down' | 'move' | 'dbl') => void;
  onCellDbl: (r: number, c: number) => void;
  editing: { r: number; c: number } | null;
  editValue: string;
  onEditInput: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onEditKey: (e: React.KeyboardEvent) => void;
  onEditCommit: () => void;
  editInputRef: React.Ref<HTMLTextAreaElement>;
  fillActive: boolean;
  fillTarget: SelectionRange | null;
  onFillStart: (e: React.MouseEvent) => void;
  onFillMove: (r: number, c: number) => void;
  cfStats: CFStat[];
  formulaSuggestions: { prefix: string; matches: { name: string; desc: string; args: string }[] } | null;
  onFormulaPick: (name: string) => void;
}) {
  if (hidden.includes(r)) return null;

  const isSel = (c: number) => r >= sel.r0 && r <= sel.r1 && c >= sel.c0 && c <= sel.c1;
  const isAnchor = (c: number) => r === anchor.r && c === anchor.c;
  const isFillTarget = (c: number) => !!fillTarget && r >= fillTarget.r0 && r <= fillTarget.r1 && c >= fillTarget.c0 && c <= fillTarget.c1;

  return (
    <tr style={{ height: sheet.rowHeights[r] ?? 28 }}>
      <td
        onMouseDown={(e) => onRowHeaderDown(e, r)}
        onMouseEnter={() => onRowHeaderEnter(r)}
        className="relative border-b border-line bg-surface text-center font-mono text-11px font-600 text-muted"
        style={{
          width: 44,
          minWidth: 44,
          position: 'sticky',
          left: 0,
          ...(sheet.freezeRows > 0 && r === 0 ? { top: 26, zIndex: 18 } : { zIndex: 16 }),
        }}
      >
        {r + 1}
        {/* 行高拖拽把手：下缘固定命中区 */}
        <span
          className="absolute inset-x-0 bottom-0 z-20 block h-2 cursor-row-resize select-none"
          title="拖拽调整行高"
          onMouseDown={(e) => onRowResizeStart(e, r)}
        />
      </td>
      {Array.from({ length: sheet.colCount }, (_, c) => {
        const cell = sheet.cells[cellKey(r, c)];
        const m = findMerge(sheet, r, c);
        if (m && !(m.r0 === r && m.c0 === c)) return null; // 合并被覆盖格不占位
        const base = cellStyle(cell);
        const wrap = !!cell?.style?.wrap;
        const overflow = !!cell?.style?.overflow;
        const border = cell?.style?.border;
        const rightNei = sheet.cells[cellKey(r, c + 1)]?.style?.border;
        const bottomNei = sheet.cells[cellKey(r + 1, c)]?.style?.border;
        const isAnchorCell = isAnchor(c);
        const isSelCell = isSel(c);
        const isEditing = editing?.r === r && editing?.c === c;
        const cfStyle = cellConditionalStyle(sheet, cfStats, r, c, cell?.value ?? '');
        return (
          <td
            key={c}
            rowSpan={m ? m.r1 - m.r0 + 1 : undefined}
            colSpan={m ? m.c1 - m.c0 + 1 : undefined}
            onMouseDown={(ev) => {
              if (isEditing) {
                ev.stopPropagation();
                return;
              }
              ev.preventDefault();
              onCellMouse(r, c, 'down');
            }}
            onMouseEnter={() => {
              if (dragging) onCellMouse(r, c, 'move');
              if (fillActive) onFillMove(r, c);
            }}
            onDoubleClick={() => onCellDbl(r, c)}
            className="relative px-1.5 align-middle"
            data-r={r}
            data-c={c}
            style={{
              ...base,
              // 列宽完全由 colWidths 决定：给单元格加显式宽度/最大宽度，内容不得撑开列（合并格除外）
              width: m ? undefined : sheet.colWidths[c] ?? 100,
              maxWidth: m ? undefined : sheet.colWidths[c] ?? 100,
              minWidth: m ? undefined : 0,
              boxSizing: 'border-box',
              // 每条边界只由一个承载格绘制（单线）；样式由两侧声明合并
              borderRight: mergedEdge([border, 'right'], [rightNei, 'left']),
              borderBottom: mergedEdge([border, 'bottom'], [bottomNei, 'top']),
              // 左/上外缘仅由首列/首行承载
              borderLeft: c === 0 ? mergedEdge([border, 'left']) : undefined,
              borderTop: r === 0 ? mergedEdge([border, 'top']) : undefined,
              // 冻结首行：数据第一行固定在列标行下方（top 26）；冻结首列：第一列固定在行号列右侧（left 44）
              ...(sheet.freezeRows > 0 && r === 0 ? { position: 'sticky', top: 26 } : {}),
              ...(sheet.freezeCols > 0 && c === 0 ? { position: 'sticky', left: 44 } : {}),
              // 行+列同时冻结的交点单元格需要更高层级，避免水平滚动时被冻结首行其他列（同 z14）按 DOM 顺序覆盖
              ...(
                sheet.freezeRows > 0 && r === 0 && sheet.freezeCols > 0 && c === 0
                  ? { zIndex: 15 }
                  : sheet.freezeRows > 0 && r === 0
                    ? { zIndex: 14 }
                    : sheet.freezeCols > 0 && c === 0
                      ? { zIndex: 12 }
                      : {}
              ),
              background: isAnchorCell ? '#eef0ff' : isSelCell ? '#f5f3ff' : isFillTarget(c) ? '#e8f3ff' : cfStyle.bg ?? base.backgroundColor ?? '#fff',
              boxShadow: isAnchorCell ? 'inset 0 0 0 2px #7c5cff' : undefined,
              ...(cfStyle.color ? { color: cfStyle.color } : {}),
            }}
            title={!isEditing ? cell?.value : undefined}
          >
            {isEditing ? (
              <>
                <textarea
                  ref={editInputRef}
                  value={editValue}
                  onChange={onEditInput}
                  onKeyDown={onEditKey}
                  onBlur={onEditCommit}
                  onMouseDown={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => e.stopPropagation()}
                  rows={1}
                  className="absolute inset-0 z-10 block resize-none overflow-hidden bg-white outline-none"
                  style={{
                  ...base,
                  border: 'none',
                  margin: 0,
                  padding: '0 6px',
                  width: '100%',
                  height: '100%',
                  maxWidth: '100%',
                  minWidth: 0,
                  minHeight: 0,
                  fontFamily: base.fontFamily ?? 'inherit',
                  fontSize: base.fontSize ?? 13,
                  textAlign: base.textAlign ?? 'left',
                  whiteSpace: base.whiteSpace === 'pre-wrap' ? 'pre-wrap' : 'nowrap',
                  overflowWrap: base.whiteSpace === 'pre-wrap' ? 'break-word' : undefined,
                  boxSizing: 'border-box',
                }}
              />
              {formulaSuggestions && (
                <div className="absolute left-0 top-full z-30 mt-0.5 max-h-44 w-64 overflow-auto rounded-lg border border-line bg-white py-1 shadow-xl">
                  {formulaSuggestions.matches.map((f) => (
                    <button
                      key={f.name}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onFormulaPick(f.name);
                      }}
                      className="flex w-full items-baseline gap-2 px-2.5 py-1 text-left hover:bg-violet-light"
                    >
                      <span className="shrink-0 font-700 text-13px text-ink">{f.name}</span>
                      <span className="truncate text-11px text-muted">{f.desc}</span>
                    </button>
                  ))}
                </div>
                )}
              </>
            ) : (
              <>
                {cfStyle.bar && (
                  <span
                    className="pointer-events-none absolute bottom-0 left-0 h-1 rounded-sm"
                    style={{ width: `${Math.round(cfStyle.bar.ratio * 100)}%`, backgroundColor: cfStyle.bar.color, opacity: 0.55 }}
                  />
                )}
                <span
                  className={`block ${
                    wrap
                      ? 'whitespace-pre-wrap break-words'
                      : overflow
                        ? 'relative z-10 whitespace-nowrap overflow-visible'
                        : 'truncate'
                  }`}
                >
                  {displayText(sheet, r, c, cell)}
                </span>
                {r === sel.r1 && c === sel.c1 && (
                  <span
                    className="absolute bottom-0 right-0 z-20 block h-2 w-2 cursor-crosshair rounded-[1px] border border-violet bg-violet"
                    onMouseDown={onFillStart}
                    title="拖拽填充"
                  />
                )}
                {cell?.validation && (
                  <span
                    className="pointer-events-none absolute bottom-0 right-0 h-0 w-0 border-[5px] border-b-transparent border-l-transparent border-r-transparent"
                    style={{ borderTopColor: '#7c5cff' }}
                  />
                )}
              </>
            )}
          </td>
        );
      })}
    </tr>
  );
}

// ===== 看板视图：按分组列分列渲染卡片 =====

function BoardView({ sheet, groupCol }: { sheet: SheetState; groupCol: number }) {
  const groups = groupRowsByColumn(sheet, groupCol);
  return (
    <div className="flex h-full gap-3 overflow-x-auto bg-surface/50 p-3">
      {groups.map((g) => (
        <div key={g.value} className="flex w-64 shrink-0 flex-col rounded-xl bg-surface">
          <div className="flex items-baseline gap-1 px-3 py-2 text-13px font-700 text-ink">
            <span className="truncate">{g.value}</span>
            <span className="text-11px font-500 text-muted">{g.rows.length}</span>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2">
            {g.rows.map((r) => (
              <div key={r} className="rounded-lg border border-line bg-white p-2.5 shadow-sm">
                <div className="text-13px font-650 text-ink">
                  {displayText(sheet, r, 0, sheet.cells[cellKey(r, 0)]) || `行 ${r + 1}`}
                </div>
                {Array.from({ length: sheet.colCount }, (_, c) => {
                  if (c === 0 || c === groupCol) return null;
                  const cell = sheet.cells[cellKey(r, c)];
                  if (!cell || cell.value === '') return null;
                  return (
                    <div key={c} className="mt-1 flex items-baseline gap-1 text-11px">
                      <span className="shrink-0 text-muted">{colToLetter(c)}</span>
                      <span className="truncate text-ink">{displayText(sheet, r, c, cell)}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ===== 日历视图：按日期列按月历展示 =====

function CalendarView({ sheet, dateCol }: { sheet: SheetState; dateCol: number }) {
  const byDate = new Map<string, number[]>();
  for (let r = 0; r < sheet.rowCount; r++) {
    const d = parseSheetDate(sheet.cells[cellKey(r, dateCol)]?.value ?? '');
    if (d) {
      if (!byDate.has(d)) byDate.set(d, []);
      byDate.get(d)!.push(r);
    }
  }
  const dates = [...byDate.keys()].sort();
  const now = new Date();
  const year = dates.length > 0 ? Number(dates[0].slice(0, 4)) : now.getFullYear();
  const month = dates.length > 0 ? Number(dates[0].slice(5, 7)) - 1 : now.getMonth();
  const startWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div className="flex h-full flex-col overflow-auto bg-white p-3">
      <div className="mb-2 text-14px font-700 text-ink">
        {year}年{month + 1}月
      </div>
      <div className="grid grid-cols-7 gap-1 border-b border-line pb-1 text-center text-11px text-muted">
        {['日', '一', '二', '三', '四', '五', '六'].map((w) => (
          <div key={w}>{w}</div>
        ))}
      </div>
      <div className="grid flex-1 auto-rows-fr grid-cols-7 gap-1 overflow-auto py-1">
        {cells.map((d, i) => {
          if (d === null) return <div key={i} className="min-h-16 rounded-lg bg-surface/40" />;
          const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
          const rows = byDate.get(key) ?? [];
          return (
            <div key={i} className="min-h-16 overflow-hidden rounded-lg border border-line bg-white p-1">
              <div className={`mb-0.5 text-right text-11px ${rows.length > 0 ? 'font-700 text-violet' : 'text-muted'}`}>{d}</div>
              <div className="space-y-0.5">
                {rows.slice(0, 3).map((r) => (
                  <div key={r} className="truncate rounded bg-violet-light px-1 text-11px text-violet">
                    {sheet.cells[cellKey(r, 0)]?.value || `行 ${r + 1}`}
                  </div>
                ))}
                {rows.length > 3 && <div className="px-1 text-11px text-muted">+{rows.length - 3}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ===== 条件格式面板：新增规则 + 管理已有规则 =====

function opLabel(op: CellValueOperator | undefined): string {
  switch (op) {
    case 'greaterThan':
      return '大于';
    case 'greaterOrEqual':
      return '大于等于';
    case 'lessThan':
      return '小于';
    case 'lessOrEqual':
      return '小于等于';
    case 'equal':
      return '等于';
    case 'between':
      return '介于';
    case 'notEmpty':
      return '不为空';
    default:
      return '';
  }
}

function CFMenu({
  sheet,
  sel,
  anchor,
  onAdd,
  onRemove,
  onClose,
}: {
  sheet: SheetState;
  sel: SelectionRange;
  anchor: { left: number; bottom: number } | null;
  onAdd: (cf: ConditionalFormat) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}) {
  const [type, setType] = useState<ConditionalType>('cellValue');
  const [operator, setOperator] = useState<CellValueOperator>('greaterThan');
  const [value1, setValue1] = useState('');
  const [value2, setValue2] = useState('');
  const [text, setText] = useState('');
  const [bg, setBg] = useState('#fde68a');

  const list = sheet.conditionalFormats ?? [];
  const left = anchor ? Math.max(8, Math.min(anchor.left, (window.innerWidth || 1024) - 8 - 300)) : 8;
  const top = anchor ? Math.max(8, Math.min(anchor.bottom + 4, (window.innerHeight || 768) - 8 - 400)) : 8;

  function add() {
    const cf: ConditionalFormat = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      r0: sel.r0,
      c0: sel.c0,
      r1: sel.r1,
      c1: sel.c1,
      type,
    };
    if (type === 'cellValue') {
      cf.operator = operator;
      cf.value1 = value1;
      if (operator === 'between') cf.value2 = value2;
      cf.bg = bg;
    } else if (type === 'textContains') {
      cf.text = text || ' ';
      cf.bg = bg;
    } else if (type === 'duplicate') {
      cf.bg = bg;
    } else if (type === 'colorScale') {
      cf.minColor = '#f87171';
      cf.midColor = '#ffffff';
      cf.maxColor = '#4ade80';
    } else if (type === 'dataBar') {
      cf.barColor = bg;
    }
    onAdd(cf);
    onClose();
  }

  function ruleLabel(cf: ConditionalFormat): string {
    switch (cf.type) {
      case 'cellValue':
        return `单元格值 ${opLabel(cf.operator)} ${cf.value1 ?? ''}${cf.value2 ? ' ~ ' + cf.value2 : ''}`;
      case 'textContains':
        return `文本包含「${(cf.text ?? '').trim()}」`;
      case 'duplicate':
        return '重复值';
      case 'colorScale':
        return '色阶';
      case 'dataBar':
        return '数据条';
      default:
        return '条件格式';
    }
  }

  return (
    <div className="fixed z-50 w-[300px] rounded-xl border border-line bg-white p-3 shadow-2xl" style={{ left, top }}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-13px font-700 text-ink">条件格式</span>
        <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-surface hover:text-ink" title="关闭">
          <X size={14} />
        </button>
      </div>

      <div className="space-y-2">
        <label className="block text-12px font-600 text-muted">规则类型</label>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as ConditionalType)}
          className="h-8 w-full rounded-lg border border-line bg-white px-2 text-13px text-ink"
        >
          <option value="cellValue">单元格值</option>
          <option value="textContains">文本包含</option>
          <option value="duplicate">重复值</option>
          <option value="colorScale">色阶</option>
          <option value="dataBar">数据条</option>
        </select>

        {type === 'cellValue' && (
          <div className="flex gap-2">
            <select
              value={operator}
              onChange={(e) => setOperator(e.target.value as CellValueOperator)}
              className="h-8 w-24 rounded-lg border border-line bg-white px-2 text-13px text-ink"
            >
              <option value="greaterThan">大于</option>
              <option value="lessThan">小于</option>
              <option value="equal">等于</option>
              <option value="between">介于</option>
            </select>
            <input
              value={value1}
              onChange={(e) => setValue1(e.target.value)}
              placeholder="数值"
              className="h-8 min-w-0 flex-1 rounded-lg border border-line px-2 text-13px"
            />
            {operator === 'between' && (
              <input
                value={value2}
                onChange={(e) => setValue2(e.target.value)}
                placeholder="到"
                className="h-8 min-w-0 flex-1 rounded-lg border border-line px-2 text-13px"
              />
            )}
          </div>
        )}

        {type === 'textContains' && (
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="包含的文字"
            className="h-8 w-full rounded-lg border border-line px-2 text-13px"
          />
        )}

        {(type === 'cellValue' || type === 'textContains' || type === 'duplicate' || type === 'dataBar') && (
          <div className="flex items-center gap-2">
            <span className="text-12px text-muted">{type === 'dataBar' ? '条形颜色' : '高亮颜色'}</span>
            <input type="color" value={bg} onChange={(e) => setBg(e.target.value)} className="h-6 w-10 cursor-pointer rounded border border-line bg-white p-0.5" />
          </div>
        )}

        <button onClick={add} className="h-8 w-full rounded-lg bg-violet text-12px font-700 text-white hover:brightness-110">
          添加规则
        </button>
      </div>

      {list.length > 0 && (
        <div className="mt-3 border-t border-line pt-2">
          <div className="mb-1 text-12px font-600 text-muted">已有规则（{list.length}）</div>
          <div className="max-h-40 space-y-1 overflow-auto">
            {list.map((cf) => (
              <div key={cf.id} className="flex items-center justify-between rounded-lg bg-surface px-2 py-1">
                <span className="truncate text-12px text-ink">{ruleLabel(cf)}</span>
                <button onClick={() => onRemove(cf.id)} className="shrink-0 text-12px font-600 text-muted hover:text-red-500">
                  删除
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ===== 常规筛选面板：列出选中列的唯一值，勾选保留项 =====
function FilterMenu({
  sheet,
  col,
  current,
  anchor,
  onApply,
  onClear,
  onClose,
}: {
  sheet: SheetState;
  col: number;
  current: string[] | null;
  anchor: { left: number; bottom: number } | null;
  onApply: (values: string[]) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const unique = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (let r = 0; r < sheet.rowCount; r++) {
      const v = sheet.cells[cellKey(r, col)]?.value ?? '';
      if (v !== '' && !seen.has(v)) {
        seen.add(v);
        out.push(v);
      }
    }
    return out;
  }, [sheet, col]);
  // 草稿：默认全选（= 不过滤）；若当前该列已有筛选，则以其值为初始选中
  const [draft, setDraft] = useState<Set<string>>(() => {
    const init = current && current.length > 0 ? new Set(current) : new Set(unique);
    return init;
  });
  // 当列改变时重置草稿
  useEffect(() => {
    const init = current && current.length > 0 ? new Set(current) : new Set(unique);
    setDraft(init);
  }, [col, current, unique]);

  const toggle = (v: string) => {
    setDraft((d) => {
      const n = new Set(d);
      if (n.has(v)) n.delete(v);
      else n.add(v);
      return n;
    });
  };

  const left = anchor ? Math.max(8, Math.min(anchor.left, (window.innerWidth || 1024) - 8 - 260)) : 8;
  const top = anchor ? Math.max(8, Math.min(anchor.bottom + 4, (window.innerHeight || 768) - 8 - 340)) : 8;

  return (
    <div
      className="fixed z-50 w-[260px] rounded-xl border border-line bg-white p-3 shadow-2xl"
      style={{ left, top }}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-13px font-700 text-ink">按 {colToLetter(col)} 列筛选</span>
        <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-surface hover:text-ink" title="关闭">
          <X size={14} />
        </button>
      </div>
      <div className="max-h-56 overflow-auto rounded-lg border border-line">
        {unique.map((u) => {
          const checked = draft.has(u);
          return (
            <label key={u} className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 hover:bg-surface">
              <input type="checkbox" checked={checked} onChange={() => toggle(u)} className="accent-violet" />
              <span className="truncate text-13px text-ink">{u}</span>
            </label>
          );
        })}
        {unique.length === 0 && <div className="px-3 py-4 text-center text-12px text-muted">该列暂无数据</div>}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <div className="flex gap-2">
          <button onClick={() => setDraft(new Set(unique))} className="text-12px font-600 text-muted hover:text-violet">
            全选
          </button>
          <button onClick={() => setDraft(new Set())} className="text-12px font-600 text-muted hover:text-violet">
            全不选
          </button>
        </div>
        <div className="flex gap-2">
          <button onClick={onClear} className="h-8 rounded-lg px-3 text-12px font-600 text-muted hover:bg-surface">
            清除筛选
          </button>
          <button
            onClick={() => onApply([...draft])}
            className="h-8 rounded-lg bg-violet px-4 text-12px font-700 text-white hover:brightness-110"
          >
            确定
          </button>
        </div>
      </div>
    </div>
  );
}