// ===== 在线表格（Sheet）数据模型与纯函数工具 =====
// 结构以 JSON 字符串整体存入 documents.content（复用 docApi.get / docApi.update）。
// 纯函数设计，便于单元测试：公式求值、行列插入删除、单元格合并、序列化。

// ---------- 类型定义 ----------

export type NumberFormat =
  | 'general'
  | 'text'
  | 'number'
  | 'currency'
  | 'accounting'
  | 'percent'
  | 'scientific'
  | 'date'
  | 'time';
export type HorizontalAlign = 'left' | 'center' | 'right';
export type VerticalAlign = 'top' | 'middle' | 'bottom';

/** 单元格边框：按四条边分别控制，颜色默认深色 */
export type BorderLineStyle = 'solid' | 'dashed' | 'dotted';
export interface CellBorder {
  color?: string;
  /** 线条样式：实线/虚线/点线，默认 solid */
  style?: BorderLineStyle;
  top?: boolean;
  bottom?: boolean;
  left?: boolean;
  right?: boolean;
}

export interface CellStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  fontSize?: number;
  /** 文字颜色（#rrggbb） */
  color?: string;
  /** 背景填充色（#rrggbb） */
  bg?: string;
  align?: HorizontalAlign;
  vAlign?: VerticalAlign;
  /** 文本缩进级数（0–10） */
  indent?: number;
  /** 字体族（系统字体栈名） */
  fontFamily?: string;
  /** 单元格边框 */
  border?: CellBorder;
  format?: NumberFormat;
  /** 单元格内自动换行：true 时超出列宽自动换行而不撑宽列 */
  wrap?: boolean;
  /** 内容溢出：true 时超出列宽内容横向溢出显示到相邻单元格，不与 wrap 同时为 true */
  overflow?: boolean;
}

export interface Cell {
  /** 原始输入——普通文本为字符串；以 = 开头表示公式（如 =SUM(A1:B3)） */
  value: string;
  style?: CellStyle;
  /** 数据验证（供「仅粘贴数据验证」及设置数据验证使用） */
  validation?: CellValidation;
}

/** 数据验证类型：数字 / 文本 / 下拉列表 */
export type ValidationType = 'number' | 'text' | 'list';

export interface CellValidation {
  type: ValidationType;
  /** 下拉列表的合法选项 */
  options?: string[];
}

/** 合并区域：主单元格为 (r0,c0)，延伸至 (r1,c1) 右下 */
export interface MergeRange {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
}

export interface SheetState {
  name: string;
  /** 单元格键 `${row},${col}`。只有非空/有样式/被引用的单元格才存在。 */
  cells: Record<string, Cell>;
  /** col -> 宽度 px（缺省用默认宽度） */
  colWidths: Record<number, number>;
  /** row -> 高度 px（缺省用默认高度） */
  rowHeights: Record<number, number>;
  /** 合并区域列表 */
  merges: MergeRange[];
  /** 冻结的首行数（0 或 1） */
  freezeRows: number;
  /** 冻结的首列数（0 或 1） */
  freezeCols: number;
  colCount: number;
  rowCount: number;
  /** 条件格式规则列表 */
  conditionalFormats?: ConditionalFormat[];
}

export interface SheetData {
  sheets: SheetState[];
  activeSheet: number;
}

// ---------- 条件格式 ----------

export type ConditionalType = 'cellValue' | 'textContains' | 'duplicate' | 'colorScale' | 'dataBar';
export type CellValueOperator = 'greaterThan' | 'greaterOrEqual' | 'lessThan' | 'lessOrEqual' | 'between' | 'equal' | 'notEmpty';

/** 条件格式规则：针对一个矩形范围，命中规则的单元格应用指定样式 */
export interface ConditionalFormat {
  id: string;
  r0: number;
  c0: number;
  r1: number;
  c1: number;
  type: ConditionalType;
  /** cellValue 类型的比较运算符 */
  operator?: CellValueOperator;
  /** 比较阈值（between 时 value1/value2 为上下界） */
  value1?: string;
  value2?: string;
  /** textContains 类型的关键词 */
  text?: string;
  /** 高亮：背景色 / 文字色 */
  bg?: string;
  color?: string;
  /** 色阶：最小/中间/最大颜色 */
  minColor?: string;
  midColor?: string;
  maxColor?: string;
  /** 数据条：条形颜色（默认取 bg 或蓝色） */
  barColor?: string;
}

// ---------- 常量 ----------
export const DEFAULT_COL_WIDTH = 100;
export const DEFAULT_ROW_HEIGHT = 28;
export const DEFAULT_COLS = 26; // A..Z
export const DEFAULT_ROWS = 50;
export const MAX_COLS = 52; // A..AZ
export const MAX_ROWS = 100;
export const MIN_COLS = 1;
export const MIN_ROWS = 1;

export const SHEET_MIME = 1;

export const cellKey = (r: number, c: number) => `${r},${c}`;

/** 创建默认单工作表数据；name 为空时用「表格1」 */
export function defaultSheetData(name = '表格1'): SheetData {
  return {
    sheets: [
      {
        name,
        cells: {},
        colWidths: {},
        rowHeights: {},
        merges: [],
        freezeRows: 0,
        freezeCols: 0,
        colCount: DEFAULT_COLS,
        rowCount: DEFAULT_ROWS,
      },
    ],
    activeSheet: 0,
  };
}

/** 归一化尺寸映射：丢弃非法/越界值（历史脏数据可能为巨大浮点值或 NaN），缺省回退默认 */
function normalizeSizeMap(map: unknown, min: number, max: number): Record<number, number> {
  const out: Record<number, number> = {};
  if (map && typeof map === 'object') {
    for (const [k, v] of Object.entries(map as Record<string, unknown>)) {
      const n = Number(v);
      if (Number.isFinite(n) && n >= min && n <= max) out[Number(k)] = n;
    }
  }
  return out;
}

/** 容错反序列化：JSON 异常或结构非法时回退默认 */
export function parseSheet(json: string): SheetData {
  if (!json) return defaultSheetData();
  try {
    const d = JSON.parse(json) as SheetData;
    if (!Array.isArray(d.sheets) || d.sheets.length === 0) return defaultSheetData();
    const sheets = d.sheets.map((s) => ({
      name: s.name || '表格1',
      cells: (s.cells ?? {}) as Record<string, Cell>,
      colWidths: normalizeSizeMap(s.colWidths, 30, 600),
      rowHeights: normalizeSizeMap(s.rowHeights, 20, 300),
      merges: Array.isArray(s.merges) ? s.merges : [],
      freezeRows: s.freezeRows ?? 0,
      freezeCols: s.freezeCols ?? 0,
      colCount: clamp(s.colCount ?? DEFAULT_COLS, MIN_COLS, MAX_COLS),
      rowCount: clamp(s.rowCount ?? DEFAULT_ROWS, MIN_ROWS, MAX_ROWS),
      conditionalFormats: Array.isArray(s.conditionalFormats) ? s.conditionalFormats : [],
    }));
    const active = clamp(Number.isInteger(d.activeSheet) ? d.activeSheet : 0, 0, sheets.length - 1);
    return { sheets, activeSheet: active };
  } catch {
    return defaultSheetData();
  }
}

export function serializeSheet(data: SheetData): string {
  return JSON.stringify(data);
}

export function cloneSheet(s: SheetState): SheetState {
  const cells: Record<string, Cell> = {};
  for (const [k, v] of Object.entries(s.cells)) {
    cells[k] = {
      value: v.value,
      style: v.style ? { ...v.style } : undefined,
      validation: v.validation ? { ...v.validation, options: v.validation.options ? [...v.validation.options] : undefined } : undefined,
    };
  }
  return {
    ...s,
    cells,
    colWidths: { ...s.colWidths },
    rowHeights: { ...s.rowHeights },
    merges: s.merges.map((m) => ({ ...m })),
    conditionalFormats: (s.conditionalFormats ?? []).map((c) => ({ ...c })),
  };
}

// ---------- 列名 / 引用转换 ----------

export function colToLetter(c: number): string {
  let n = c;
  let s = '';
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

export function letterToCol(letters: string): number {
  let col = 0;
  for (let i = 0; i < letters.length; i++) {
    col = col * 26 + (letters.charCodeAt(i) - 64);
  }
  return col - 1;
}

/** 解析单元格引用（可带 $ 前缀，如 $A1），返回行列；非法返回 null */
export function parseCellRef(ref: string): { r: number; c: number } | null {
  const m = /^\$?([A-Za-z]+)\$?(\d+)$/.exec(ref.trim());
  if (!m) return null;
  return { r: Number(m[2]) - 1, c: letterToCol(m[1].toUpperCase()) };
}

// ---------- 取值（含公式递归求值） ----------

export type EvalValue = { kind: 'number'; num: number } | { kind: 'string'; text: string } | { kind: 'empty' };

const MAX_DEPTH = 64;

/** 求单元格的「运算值」：公式递归求值，非公式按字符串/数字判断；空返回 empty */
export function evaluateCell(cells: Record<string, Cell>, r: number, c: number, depth = 0): EvalValue {
  const cell = cells[cellKey(r, c)];
  if (!cell) return { kind: 'empty' };
  const raw = String(cell.value ?? '');
  if (raw === '') return { kind: 'empty' };
  if (raw.startsWith('=')) {
    return evaluateFormulaExpr(cells, raw.slice(1), depth + 1);
  }
  const n = Number(raw);
  if (raw.trim() !== '' && Number.isFinite(n) && /^-?\d+(\.\d+)?$/.test(raw.trim())) {
    return { kind: 'number', num: n };
  }
  return { kind: 'string', text: raw };
}

/** 求值的数值化（供 SUM/AVERAGE/... 与排序使用）：非数值单元格返回 null */
export function evalNumber(v: EvalValue): number | null {
  if (v.kind === 'number') return v.num;
  if (v.kind === 'string') {
    const n = Number(v.text);
    if (v.text.trim() !== '' && Number.isFinite(n)) return n;
  }
  return null;
}

function splitArgs(inner: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let inStr = false;
  let cur = '';
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (inStr) {
      cur += ch;
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      cur += ch;
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      args.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) args.push(cur.trim());
  return args;
}

/** 收集一个参数（数字/引用/区间，可混单元格）的数值数组 */
function collectNumbers(cells: Record<string, Cell>, arg: string, depth: number): number[] {
  const a = arg.trim();
  if (a === '') return [];
  if (/^"[^"]*"$/.test(a)) return []; // 字符串字面量，非数值
  if (/^[+-]?\d+(\.\d+)?$/.test(a)) return [Number(a)];
  if (a.includes(':')) {
    const [s0, s1] = a.split(':');
    const p0 = parseCellRef(s0);
    const p1 = parseCellRef(s1);
    if (!p0 || !p1) return [];
    const out: number[] = [];
    for (let r = Math.min(p0.r, p1.r); r <= Math.max(p0.r, p1.r); r++) {
      for (let c = Math.min(p0.c, p1.c); c <= Math.max(p0.c, p1.c); c++) {
        const n = evalNumber(evaluateCell(cells, r, c, depth));
        if (n !== null) out.push(n);
      }
    }
    return out;
  }
  const p = parseCellRef(a);
  if (p) {
    const n = evalNumber(evaluateCell(cells, p.r, p.c, depth));
    return n === null ? [] : [n];
  }
  return [];
}

/** 对「=后面的表达式」求值：支持比较/逻辑运算、IF/VLOOKUP/COUNTIF/SUMIF 等函数 */
export function evaluateFormulaExpr(cells: Record<string, Cell>, exprRaw: string, depth = 0): EvalValue {
  return evalScalar(cells, exprRaw, depth);
}

function isTruthy(v: EvalValue): boolean {
  if (v.kind === 'number') return v.num !== 0;
  if (v.kind === 'string') return v.text !== '' && v.text.toLowerCase() !== 'false';
  return false;
}

function compareOp(op: string, left: EvalValue, right: EvalValue): EvalValue {
  const ln = evalNumber(left);
  const rn = evalNumber(right);
  let cmp: number;
  if (ln !== null && rn !== null) {
    cmp = ln === rn ? 0 : ln < rn ? -1 : 1;
  } else {
    const ls = left.kind === 'string' ? left.text : left.kind === 'number' ? String(left.num) : '';
    const rs = right.kind === 'string' ? right.text : right.kind === 'number' ? String(right.num) : '';
    cmp = ls === rs ? 0 : ls < rs ? -1 : 1;
  }
  let res: boolean;
  switch (op) {
    case '=':
    case '==':
      res = cmp === 0;
      break;
    case '<>':
    case '!=':
      res = cmp !== 0;
      break;
    case '>':
      res = cmp > 0;
      break;
    case '<':
      res = cmp < 0;
      break;
    case '>=':
      res = cmp >= 0;
      break;
    case '<=':
      res = cmp <= 0;
      break;
    default:
      res = false;
  }
  return { kind: 'number', num: res ? 1 : 0 };
}

/** 找顶层（括号外/字符串外）运算符位置 */
function findTopLevelOp(expr: string, op: string): number {
  let depth = 0;
  let inStr = false;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (inStr) {
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (depth === 0 && expr.startsWith(op, i)) return i;
  }
  return -1;
}

/** 求标量表达式：函数调用 → 比较 → 字面量/引用 */
function evalScalar(cells: Record<string, Cell>, exprRaw: string, depth: number): EvalValue {
  const expr = exprRaw.trim();
  if (depth > MAX_DEPTH) return { kind: 'string', text: '#CIRC!#' };
  if (expr === '') return { kind: 'empty' };

  // 1. 函数调用
  const fm = /^([A-Za-z]+)\((.*)\)$/s.exec(expr);
  if (fm) return evalFunction(cells, fm[1].toUpperCase(), splitArgs(fm[2]), depth);

  // 2. 比较运算
  for (const op of ['>=', '<=', '<>', '!=', '=', '>', '<']) {
    const idx = findTopLevelOp(expr, op);
    if (idx > 0) {
      const left = evalScalar(cells, expr.slice(0, idx), depth);
      const right = evalScalar(cells, expr.slice(idx + op.length), depth);
      return compareOp(op, left, right);
    }
  }

  // 3. 字面量 / 引用 / 裸文本
  if (/^[+-]?\d+(\.\d+)?$/.test(expr)) return { kind: 'number', num: Number(expr) };
  if (/^"[^"]*"$/.test(expr)) return { kind: 'string', text: expr.slice(1, -1) };
  const p = parseCellRef(expr);
  if (p) return evaluateCell(cells, p.r, p.c, depth);
  return { kind: 'string', text: expr };
}

/** 收集区间内所有单元格的值（保留原始求值，供 COUNTA/文本判断） */
function collectValues(cells: Record<string, Cell>, arg: string, depth: number): EvalValue[] {
  const a = arg.trim();
  if (a === '') return [];
  if (a.includes(':')) {
    const [s0, s1] = a.split(':');
    const p0 = parseCellRef(s0);
    const p1 = parseCellRef(s1);
    if (!p0 || !p1) return [];
    const out: EvalValue[] = [];
    for (let r = Math.min(p0.r, p1.r); r <= Math.max(p0.r, p1.r); r++) {
      for (let c = Math.min(p0.c, p1.c); c <= Math.max(p0.c, p1.c); c++) out.push(evaluateCell(cells, r, c, depth));
    }
    return out;
  }
  const p = parseCellRef(a);
  if (p) return [evaluateCell(cells, p.r, p.c, depth)];
  return [evalScalar(cells, a, depth)];
}

/** 匹配 COUNTIF/SUMIF 的条件：支持 ">10" / ">=5" / "<>0" / 等值(数值或文本) */
function matchCriteria(v: EvalValue, criteria: string): boolean {
  const c = criteria.trim().replace(/^"|"$/g, '');
  const m = /^(>=|<=|<>|!=|>|<|=)\s*(.*)$/.exec(c);
  if (m) {
    const target: EvalValue = /^[+-]?\d+(\.\d+)?$/.test(m[2].trim())
      ? { kind: 'number', num: Number(m[2]) }
      : { kind: 'string', text: m[2].trim() };
    return isTruthy(compareOp(m[1], v, target));
  }
  const val = v.kind === 'number' ? String(v.num) : v.kind === 'string' ? v.text : '';
  return val === c;
}

/** 单元格/表达式值的字符串表示 */
function asText(v: EvalValue): string {
  if (v.kind === 'number') return String(v.num);
  if (v.kind === 'string') return v.text;
  return '';
}

function evalFunction(cells: Record<string, Cell>, fn: string, args: string[], depth: number): EvalValue {
  const num = (i: number) => evalNumber(args[i] !== undefined ? evalScalar(cells, args[i], depth) : { kind: 'empty' }) ?? 0;
  const text = (i: number) => asText(args[i] !== undefined ? evalScalar(cells, args[i], depth) : { kind: 'empty' });
  switch (fn) {
    case 'IF': {
      const cond = args[0] !== undefined ? evalScalar(cells, args[0], depth) : { kind: 'empty' } as EvalValue;
      const branch = isTruthy(cond) ? args[1] : args[2];
      return branch === undefined ? ({ kind: 'empty' } as EvalValue) : evalScalar(cells, branch, depth);
    }
    case 'AND':
      for (const a of args) if (!isTruthy(evalScalar(cells, a, depth))) return { kind: 'number', num: 0 };
      return { kind: 'number', num: 1 };
    case 'OR':
      for (const a of args) if (isTruthy(evalScalar(cells, a, depth))) return { kind: 'number', num: 1 };
      return { kind: 'number', num: 0 };
    case 'NOT':
      return { kind: 'number', num: isTruthy(evalScalar(cells, args[0] ?? '', depth)) ? 0 : 1 };
    case 'IFERROR': {
      const v = evalScalar(cells, args[0] ?? '', depth);
      const isErr = v.kind === 'string' && v.text.startsWith('#');
      return isErr ? evalScalar(cells, args[1] ?? '', depth) : v;
    }
    case 'SUM': {
      const nums: number[] = [];
      for (const a of args) nums.push(...collectNumbers(cells, a, depth));
      return { kind: 'number', num: nums.reduce((x, y) => x + y, 0) };
    }
    case 'AVERAGE': {
      const nums: number[] = [];
      for (const a of args) nums.push(...collectNumbers(cells, a, depth));
      return nums.length === 0 ? { kind: 'string', text: '#DIV/0!' } : { kind: 'number', num: nums.reduce((x, y) => x + y, 0) / nums.length };
    }
    case 'COUNT': {
      let n = 0;
      for (const a of args) n += collectNumbers(cells, a, depth).length;
      return { kind: 'number', num: n };
    }
    case 'COUNTA': {
      let n = 0;
      for (const a of args) n += collectValues(cells, a, depth).filter((v) => v.kind !== 'empty').length;
      return { kind: 'number', num: n };
    }
    case 'MIN': {
      const nums: number[] = [];
      for (const a of args) nums.push(...collectNumbers(cells, a, depth));
      return nums.length === 0 ? { kind: 'string', text: '#NUM!' } : { kind: 'number', num: Math.min(...nums) };
    }
    case 'MAX': {
      const nums: number[] = [];
      for (const a of args) nums.push(...collectNumbers(cells, a, depth));
      return nums.length === 0 ? { kind: 'string', text: '#NUM!' } : { kind: 'number', num: Math.max(...nums) };
    }
    case 'ROUND':
      return { kind: 'number', num: Math.round(num(0) * 10 ** num(1)) / 10 ** num(1) };
    case 'ROUNDUP':
      return { kind: 'number', num: Math.ceil(num(0) * 10 ** num(1)) / 10 ** num(1) };
    case 'ROUNDDOWN':
      return { kind: 'number', num: Math.floor(num(0) * 10 ** num(1)) / 10 ** num(1) };
    case 'ABS':
      return { kind: 'number', num: Math.abs(num(0)) };
    case 'INT':
      return { kind: 'number', num: Math.floor(num(0)) };
    case 'COUNTIF': {
      const values = collectValues(cells, args[0] ?? '', depth);
      const crit = args[1] ?? '';
      return { kind: 'number', num: values.filter((v) => matchCriteria(v, crit)).length };
    }
    case 'SUMIF': {
      const values = collectValues(cells, args[0] ?? '', depth);
      const crit = args[1] ?? '';
      let sum = 0;
      for (const v of values) if (matchCriteria(v, crit)) sum += evalNumber(v) ?? 0;
      return { kind: 'number', num: sum };
    }
    case 'SUMIFS': {
      // SUMIFS(求和区间, 条件区间1, 条件1, 条件区间2, 条件2, ...)
      const sumRange = collectValues(cells, args[0] ?? '', depth);
      const condCount = Math.floor((args.length - 1) / 2);
      let total = 0;
      for (let i = 0; i < sumRange.length; i++) {
        let ok = true;
        for (let k = 0; k < condCount; k++) {
          const range = collectValues(cells, args[1 + k * 2] ?? '', depth);
          const crit = args[2 + k * 2] ?? '';
          if (i >= range.length || !matchCriteria(range[i], crit)) {
            ok = false;
            break;
          }
        }
        if (ok) total += evalNumber(sumRange[i]) ?? 0;
      }
      return { kind: 'number', num: total };
    }
    case 'COUNTIFS': {
      const condCount = Math.floor(args.length / 2);
      const first = collectValues(cells, args[0] ?? '', depth);
      let cnt = 0;
      for (let i = 0; i < first.length; i++) {
        let ok = true;
        for (let k = 0; k < condCount; k++) {
          const range = collectValues(cells, args[k * 2] ?? '', depth);
          const crit = args[k * 2 + 1] ?? '';
          if (i >= range.length || !matchCriteria(range[i], crit)) {
            ok = false;
            break;
          }
        }
        if (ok) cnt++;
      }
      return { kind: 'number', num: cnt };
    }
    case 'VLOOKUP': {
      if (args.length < 3) return { kind: 'string', text: '#N/A' };
      const lookup = evalScalar(cells, args[0], depth);
      const range = args[1].trim();
      const colIdx = Math.round(num(2)) || 1;
      const [s0, s1] = range.includes(':') ? range.split(':') : [range, range];
      const p0 = parseCellRef(s0);
      const p1 = parseCellRef(s1);
      if (!p0 || !p1) return { kind: 'string', text: '#N/A' };
      const want = evalNumber(lookup) ?? (lookup.kind === 'string' ? lookup.text : '');
      for (let r = p0.r; r <= p1.r; r++) {
        const first = evaluateCell(cells, r, p0.c, depth);
        const firstV = evalNumber(first) ?? (first.kind === 'string' ? first.text : '');
        if (firstV === want) return evaluateCell(cells, r, p0.c + colIdx - 1, depth);
      }
      return { kind: 'string', text: '#N/A' };
    }
    case 'CONCAT':
    case 'CONCATENATE':
      return { kind: 'string', text: args.map((a) => asText(evalScalar(cells, a, depth))).join('') };
    case 'LEN':
      return { kind: 'number', num: text(0).length };
    case 'LEFT':
      return { kind: 'string', text: text(0).slice(0, args.length > 1 ? num(1) : 1) };
    case 'RIGHT':
      return { kind: 'string', text: args.length > 1 ? text(0).slice(-num(1)) : text(0).slice(-1) };
    case 'MID':
      return { kind: 'string', text: text(0).slice(num(1) - 1, num(1) - 1 + num(2)) };
    case 'TRIM':
      return { kind: 'string', text: text(0).replace(/\s+/g, ' ').trim() };
    case 'UPPER':
      return { kind: 'string', text: text(0).toUpperCase() };
    case 'LOWER':
      return { kind: 'string', text: text(0).toLowerCase() };
    case 'SUBSTITUTE': {
      const t = text(0);
      const old = text(1);
      const neu = text(2);
      return { kind: 'string', text: t.split(old).join(neu) };
    }
    default:
      return { kind: 'string', text: '#NAME?#' };
  }
}

/** 单元格展示值：应用数字格式 */
export function formatValue(cell: Cell | undefined): string {
  const raw = cell ? String(cell.value ?? '') : '';
  if (raw === '') return '';
  const fmt = cell?.style?.format ?? 'general';
  const isFormula = raw.startsWith('=');
  if (isFormula) return raw;
  const n = Number(raw);
  const numish = raw.trim() !== '' && Number.isFinite(n);
  switch (fmt) {
    case 'currency':
      return numish ? `¥${n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : raw;
    case 'accounting':
      return numish
        ? `${n < 0 ? '-' : ''}¥${Math.abs(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : raw;
    case 'percent':
      return numish ? `${(n * 100).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}%` : raw;
    case 'scientific':
      return numish ? n.toExponential(2) : raw;
    case 'number':
      return numish ? n.toLocaleString('zh-CN', { maximumFractionDigits: 6 }) : raw;
    case 'time': {
      const t = Date.parse(raw);
      let d: Date | null = numish && Number.isFinite(n) ? new Date(n) : null;
      if (!d && !Number.isNaN(t)) d = new Date(t);
      if (d && !Number.isNaN(d.getTime())) {
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
      }
      return raw;
    }
    case 'date': {
      const t = Date.parse(raw);
      let d: Date | null = numish && Number.isFinite(n) ? new Date(n) : null;
      if (!d && !Number.isNaN(t)) d = new Date(t);
      if (d && !Number.isNaN(d.getTime()))
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return raw;
    }
    case 'text':
      return raw;
    default:
      return numish ? n.toLocaleString('zh-CN', { maximumFractionDigits: 6 }) : raw;
  }
}

// ---------- 合并单元格 ----------

export function mergeSheet(s: SheetState, r0: number, c0: number, r1: number, c1: number): SheetState {
  const next = cloneSheet(s);
  const rMin = Math.min(r0, r1);
  const rMax = Math.max(r0, r1);
  const cMin = Math.min(c0, c1);
  const cMax = Math.max(c0, c1);
  // 同区域重复合并是幂等操作；先移除旧的重叠区
  next.merges = next.merges.filter(
    (m) => !(rMin <= m.r1 && rMax >= m.r0 && cMin <= m.c1 && cMax >= m.c0),
  );
  next.merges.push({ r0: rMin, c0: cMin, r1: rMax, c1: cMax });
  // 合并后：主单元格保留，区域内其余单元格清空
  for (let r = rMin; r <= rMax; r++) {
    for (let c = cMin; c <= cMax; c++) {
      if (r === rMin && c === cMin) continue;
      delete next.cells[cellKey(r, c)];
    }
  }
  return next;
}

export function unmergeSheet(s: SheetState, r0: number, c0: number, r1: number, c1: number): SheetState {
  const next = cloneSheet(s);
  const rMin = Math.min(r0, r1);
  const rMax = Math.max(r0, r1);
  const cMin = Math.min(c0, c1);
  const cMax = Math.max(c0, c1);
  next.merges = next.merges.filter((m) => !(m.r0 === rMin && m.c0 === cMin && m.r1 === rMax && m.c1 === cMax));
  return next;
}

/** 查找包含 (r,c) 的合并区域；非合并单元格返回 null */
export function findMerge(s: SheetState, r: number, c: number): MergeRange | null {
  return s.merges.find((m) => r >= m.r0 && r <= m.r1 && c >= m.c0 && c <= m.c1) ?? null;
}

/** 判断 (r,c) 是否被某合并区域覆盖（非主单元格） */
export function isCoveredByMerge(s: SheetState, r: number, c: number): boolean {
  const m = findMerge(s, r, c);
  return !!m && !(r === m.r0 && c === m.c0);
}

// ---------- 行列插入删除 ----------

function shiftCellKey(key: string, dr: number, dc: number): string | null {
  const idx = key.indexOf(',');
  const r = Number(key.slice(0, idx));
  const c = Number(key.slice(idx + 1));
  const nr = r + dr;
  const nc = c + dc;
  if (nr < 0 || nc < 0) return null;
  return cellKey(nr, nc);
}

export function insertRow(s: SheetState, atRow: number): SheetState {
  const next = cloneSheet(s);
  next.rowCount = Math.min(next.rowCount + 1, MAX_ROWS);
  const rekey: Record<string, Cell> = {};
  for (const key of Object.keys(next.cells)) {
    const idx = key.indexOf(',');
    const r = Number(key.slice(0, idx));
    const c = Number(key.slice(idx + 1));
    const nr = r >= atRow ? r + 1 : r;
    if (nr < 0) continue;
    rekey[cellKey(nr, c)] = next.cells[key];
  }
  next.cells = rekey;
  // 行高映射：>= atRow 的 +1
  const rh: Record<number, number> = {};
  for (const [k, v] of Object.entries(next.rowHeights)) {
    const r = Number(k);
    rh[r >= atRow ? r + 1 : r] = v;
  }
  next.rowHeights = rh;
  // 合并区域：位于 atRow 及以下整体下移
  next.merges = next.merges.map((m) => (m.r0 >= atRow ? { ...m, r0: m.r0 + 1, r1: m.r1 + 1 } : m));
  return next;
}

export function deleteRow(s: SheetState, atRow: number): SheetState {
  const next = cloneSheet(s);
  if (next.rowCount <= MIN_ROWS) return next;
  next.rowCount = Math.max(next.rowCount - 1, MIN_ROWS);
  const rekey: Record<string, Cell> = {};
  for (const key of Object.keys(next.cells)) {
    const idx = key.indexOf(',');
    const r = Number(key.slice(0, idx));
    const c = Number(key.slice(idx + 1));
    if (r === atRow) continue;
    const nr = r > atRow ? r - 1 : r;
    rekey[cellKey(nr, c)] = next.cells[key];
  }
  next.cells = rekey;
  const rh: Record<number, number> = {};
  for (const [k, v] of Object.entries(next.rowHeights)) {
    const r = Number(k);
    if (r === atRow) continue;
    rh[r > atRow ? r - 1 : r] = v;
  }
  next.rowHeights = rh;
  next.merges = next.merges
    .filter((m) => !(m.r0 <= atRow && m.r1 >= atRow)) // 跨被删行的合并移除
    .map((m) => (m.r0 > atRow ? { ...m, r0: m.r0 - 1, r1: m.r1 - 1 } : m));
  return next;
}

export function insertCol(s: SheetState, atCol: number): SheetState {
  const next = cloneSheet(s);
  next.colCount = Math.min(next.colCount + 1, MAX_COLS);
  const rekey: Record<string, Cell> = {};
  for (const key of Object.keys(next.cells)) {
    const idx = key.indexOf(',');
    const r = Number(key.slice(0, idx));
    const c = Number(key.slice(idx + 1));
    const nc = c >= atCol ? c + 1 : c;
    rekey[cellKey(r, nc)] = next.cells[key];
  }
  next.cells = rekey;
  const cw: Record<number, number> = {};
  for (const [k, v] of Object.entries(next.colWidths)) {
    const c = Number(k);
    cw[c >= atCol ? c + 1 : c] = v;
  }
  next.colWidths = cw;
  next.merges = next.merges.map((m) => (m.c0 >= atCol ? { ...m, c0: m.c0 + 1, c1: m.c1 + 1 } : m));
  return next;
}

export function deleteCol(s: SheetState, atCol: number): SheetState {
  const next = cloneSheet(s);
  if (next.colCount <= MIN_COLS) return next;
  next.colCount = Math.max(next.colCount - 1, MIN_COLS);
  const rekey: Record<string, Cell> = {};
  for (const key of Object.keys(next.cells)) {
    const idx = key.indexOf(',');
    const r = Number(key.slice(0, idx));
    const c = Number(key.slice(idx + 1));
    if (c === atCol) continue;
    const nc = c > atCol ? c - 1 : c;
    rekey[cellKey(r, nc)] = next.cells[key];
  }
  next.cells = rekey;
  const cw: Record<number, number> = {};
  for (const [k, v] of Object.entries(next.colWidths)) {
    const c = Number(k);
    if (c === atCol) continue;
    cw[c > atCol ? c - 1 : c] = v;
  }
  next.colWidths = cw;
  next.merges = next.merges
    .filter((m) => !(m.c0 <= atCol && m.c1 >= atCol))
    .map((m) => (m.c0 > atCol ? { ...m, c0: m.c0 - 1, c1: m.c1 - 1 } : m));
  return next;
}

// ---------- 排序 ----------

/** 对指定范围按首列（col）排序，仅移动整行单元格；返回新 SheetState */
export function sortSheet(
  s: SheetState,
  r0: number,
  r1: number,
  c: number,
  dir: 'asc' | 'desc',
): SheetState {
  const next = cloneSheet(s);
  const orig = s.cells; // 排序依据与数据源，避免原地覆盖
  const rows = Array.from({ length: r1 - r0 + 1 }, (_, i) => r0 + i);
  const val = (r: number): number => evalNumber(evaluateCell(orig, r, c)) ?? NaN;
  rows.sort((a, b) => {
    const na = val(a);
    const nb = val(b);
    if (Number.isNaN(na) || Number.isNaN(nb)) {
      // 含非数值（文本）时按文本字典序，数值排在文本前
      const ta = formatValue(orig[cellKey(a, c)]);
      const tb = formatValue(orig[cellKey(b, c)]);
      return ta.localeCompare(tb, 'zh-CN');
    }
    return dir === 'asc' ? na - nb : nb - na;
  });
  // 按排序结果把原行数据整体搬到新位置，重建 cells
  const rebuilt: Record<string, Cell> = {};
  for (let i = 0; i < rows.length; i++) {
    const from = rows[i];
    const to = r0 + i;
    for (let col = 0; col < next.colCount; col++) {
      const v = orig[cellKey(from, col)];
      if (v !== undefined) rebuilt[cellKey(to, col)] = v;
    }
  }
  for (const key of Object.keys(orig)) {
    const idx = key.indexOf(',');
    const rr = Number(key.slice(0, idx));
    if (rr < r0 || rr > r1) rebuilt[key] = orig[key];
  }
  next.cells = rebuilt;
  return next;
}

// ---------- 工具 ----------

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

// ---------- 复制 / 剪切 / 粘贴（含选择性粘贴） ----------

/** 剪贴板单元格：保留值、样式、数据验证；computed 为公式求值后的字面值 */
export interface ClipCell {
  value: string;
  /** 公式求值后的字面结果（非公式时等于 value） */
  computed: string;
  style?: CellStyle;
  validation?: CellValidation;
}

/** 剪贴板矩形容器 */
export interface ClipGrid {
  rows: number;
  cols: number;
  cells: (ClipCell | null)[][];
}

export type PasteMode = 'normal' | 'value' | 'format' | 'formula' | 'validation';

/** 从选区读取一个复制网格（不改变数据） */
export function makeClipGrid(s: SheetState, r0: number, c0: number, r1: number, c1: number): ClipGrid {
  const rr = Math.min(r0, r1);
  const cc = Math.min(c0, c1);
  const R = Math.abs(r1 - r0) + 1;
  const C = Math.abs(c1 - c0) + 1;
  const rows: (ClipCell | null)[][] = [];
  for (let dr = 0; dr < R; dr++) {
    const row: (ClipCell | null)[] = [];
    for (let dc = 0; dc < C; dc++) {
      const r = rr + dr;
      const c = cc + dc;
      const cell = s.cells[cellKey(r, c)];
      if (!cell) {
        row.push(null);
        continue;
      }
      row.push({
        value: cell.value,
        computed: cellComputedValue(s, cell),
        style: cell.style ? { ...cell.style } : undefined,
        validation: cell.validation ? { ...cell.validation, options: cell.validation.options ? [...cell.validation.options] : undefined } : undefined,
      });
    }
    rows.push(row);
  }
  return { rows: R, cols: C, cells: rows };
}

function cellComputedValue(s: SheetState, cell: Cell): string {
  const raw = String(cell.value ?? '');
  if (!raw.startsWith('=')) return raw;
  // 公式：取主单元格求值结果（需要行列，这里通过扫描 cells 找到该 cell 的行列）
  for (const key of Object.keys(s.cells)) {
    if (s.cells[key] === cell) {
      const idx = key.indexOf(',');
      const r = Number(key.slice(0, idx));
      const c = Number(key.slice(idx + 1));
      const ev = evaluateCell(s.cells, r, c);
      return ev.kind === 'number' ? String(ev.num) : ev.kind === 'string' ? ev.text : '';
    }
  }
  return raw;
}

/** 将复制网格粘贴到 (startR,startC)，按 mode 决定保留哪些属性；返回新 SheetState */
export function pasteGrid(s: SheetState, grid: ClipGrid, startR: number, startC: number, mode: PasteMode | 'clear'): SheetState {
  const next = cloneSheet(s);
  for (let dr = 0; dr < grid.rows; dr++) {
    for (let dc = 0; dc < grid.cols; dc++) {
      const r = startR + dr;
      const c = startC + dc;
      if (r >= next.rowCount || c >= next.colCount) continue;
      if (isCoveredByMerge(next, r, c)) continue;
      const src = grid.cells[dr][dc];
      const key = cellKey(r, c);
      const cur = next.cells[key];
      const baseCell: Cell = cur
        ? { value: cur.value, style: cur.style ? { ...cur.style } : undefined, validation: cur.validation ? { ...cur.validation, options: cur.validation.options ? [...cur.validation.options] : undefined } : undefined }
        : { value: '' };
      if (!src) {
        // 源为空：视作清空该格内容（normal 粘贴时）
        if (mode === 'normal') delete next.cells[key];
        continue;
      }
      switch (mode) {
        case 'value': {
          // 仅粘贴值：公式格粘贴求值字面量，非公式格粘贴文本
          if (src.value.startsWith('=')) baseCell.value = src.computed || '';
          else if (src.value !== '') baseCell.value = src.value;
          next.cells[key] = baseCell;
          break;
        }
        case 'format': {
          if (src.style) {
            baseCell.style = { ...src.style };
            next.cells[key] = baseCell;
          }
          break;
        }
        case 'formula': {
          if (src.value.startsWith('=')) {
            baseCell.value = src.value;
            next.cells[key] = baseCell;
          }
          break;
        }
        case 'validation': {
          if (src.validation) {
            baseCell.validation = { ...src.validation, options: src.validation.options ? [...src.validation.options] : undefined };
            next.cells[key] = baseCell;
          }
          break;
        }
        case 'normal':
        default: {
          next.cells[key] = {
            value: src.value,
            style: src.style ? { ...src.style } : undefined,
            validation: src.validation ? { ...src.validation, options: src.validation.options ? [...src.validation.options] : undefined } : undefined,
          };
          break;
        }
      }
    }
  }
  return next;
}

/** 清空选区（剪切后清除源区域内容/样式/验证） */
export function clearRange(s: SheetState, r0: number, c0: number, r1: number, c1: number): SheetState {
  const next = cloneSheet(s);
  const rr = Math.min(r0, r1);
  const cc = Math.min(c0, c1);
  for (let r = rr; r <= Math.max(r0, r1); r++) {
    for (let c = cc; c <= Math.max(c0, c1); c++) {
      if (isCoveredByMerge(next, r, c) && !(r === rr && c === cc)) continue;
      delete next.cells[cellKey(r, c)];
    }
  }
  return next;
}

/** 清除选区内容（值），保留样式与数据验证 */
export function clearContentRange(s: SheetState, r0: number, c0: number, r1: number, c1: number): SheetState {
  const next = cloneSheet(s);
  const rr = Math.min(r0, r1);
  const cc = Math.min(c0, c1);
  for (let r = rr; r <= Math.max(r0, r1); r++) {
    for (let c = cc; c <= Math.max(c0, c1); c++) {
      if (isCoveredByMerge(next, r, c) && !(r === rr && c === cc)) continue;
      const key = cellKey(r, c);
      const cur = next.cells[key];
      if (cur) next.cells[key] = { value: '', style: cur.style, validation: cur.validation };
    }
  }
  return next;
}

/** 复制网格序列化为 TSV（供写入系统剪贴板） */
export function clipToTSV(grid: ClipGrid): string {
  const rows: string[] = [];
  for (let r = 0; r < grid.rows; r++) {
    const cols: string[] = [];
    for (let c = 0; c < grid.cols; c++) {
      const cell = grid.cells[r][c];
      cols.push(cell === null ? '' : cell.value);
    }
    rows.push(cols.join('\t'));
  }
  return rows.join('\n');
}

/** 从 TSV 文本解析为一个「仅值」复制网格（用于系统剪贴板外部粘贴） */
export function parseTSV(text: string): ClipGrid {
  const rows = text.replace(/\r/g, '').split('\n');
  if (rows.length === 0) return { rows: 0, cols: 0, cells: [] };
  const cells: (ClipCell | null)[][] = rows.map((line) => {
    const parts = line.split('\t');
    return parts.map((p) => (p === '' ? null : { value: p, computed: p }));
  });
  const cols = cells.reduce((m, row) => Math.max(m, row.length), 0);
  return { rows: cells.length, cols, cells };
}

/** 校验某个值是否符合单元格的数据验证；返回错误信息或 null */
export function validateCellValue(cell: Cell | undefined, value: string): string | null {
  if (!cell?.validation || value === '') return null;
  const v = cell.validation;
  if (v.type === 'number') {
    if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(value.trim())) return '该单元格要求数字格式';
  } else if (v.type === 'list') {
    if (v.options && v.options.length > 0 && !v.options.includes(value)) return `请输入列表选项：${v.options.join(' / ')}`;
  }
  return null;
}

// ---------- 拖拽填充（序列填充） ----------

export interface FillRange {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
}

function cellTextOf(cells: Record<string, Cell>, r: number, c: number): string {
  return cells[cellKey(r, c)]?.value ?? '';
}

/** 从一维源序列扩展出 n 个后续值：纯数字等差 → 数字后缀递增 → 复制末值 */
export function extendSeries(values: string[], n: number): string[] {
  if (n <= 0) return [];
  const src = values.length > 0 ? values : [''];
  const last = src[src.length - 1] ?? '';

  // 1. 纯数字等差
  const nums = src.map((v) => (v.trim() === '' ? NaN : Number(v)));
  if (nums.every((x) => !Number.isNaN(x))) {
    const step = src.length >= 2 ? nums[nums.length - 1] - nums[nums.length - 2] : 1;
    const out: string[] = [];
    let cur = nums[nums.length - 1];
    for (let i = 0; i < n; i++) {
      cur += step;
      out.push(String(cur));
    }
    return out;
  }

  // 2. 数字后缀递增：前缀 + 数字 + 后缀（如「项目1」「第3天」）
  if (src.length >= 2) {
    const m = src.map((v) => v.match(/^(.*?)(-?\d+(?:\.\d+)?)([^\d]*)$/));
    if (m.every((x) => x !== null)) {
      const prefix = m[0]![1];
      const suffix = m[0]![3];
      const dNums = m.map((x) => Number(x![2]));
      if (m.every((x) => x![1] === prefix && x![3] === suffix)) {
        const step = dNums.length >= 2 ? dNums[dNums.length - 1] - dNums[dNums.length - 2] : 1;
        const out: string[] = [];
        let cur = dNums[dNums.length - 1];
        for (let i = 0; i < n; i++) {
          cur += step;
          out.push(`${prefix}${cur}${suffix}`);
        }
        return out;
      }
    }
  }

  // 3. 默认复制末值
  return Array(n).fill(last);
}

/** 目标区域内源区域对应列/行的模板下标（跨周期循环回源区域） */
function srcIndexOffset(delta: number, size: number): number {
  return ((delta % size) + size) % size;
}

/**
 * 拖拽填充：以 src 为序列模板，沿向下/向右方向延续到 target。
 * 返回 target 范围内（不含 src 已覆盖部分）需写入的 cells（含样式继承）。
 */
export function fillSeries(s: SheetState, src: FillRange, target: FillRange): Record<string, Cell> {
  const out: Record<string, Cell> = {};
  const srcH = src.r1 - src.r0 + 1;
  const srcW = src.c1 - src.c0 + 1;

  for (let r = target.r0; r <= target.r1; r++) {
    for (let c = target.c0; c <= target.c1; c++) {
      if (r >= src.r0 && r <= src.r1 && c >= src.c0 && c <= src.c1) continue;

      let value = '';
      let styleSrc: Cell | undefined;
      if (r > src.r1) {
        // 向下填充：按列取序列，样式继承该列最后一行
        const col = src.c0 + srcIndexOffset(c - src.c0, srcW);
        const series = Array.from({ length: srcH }, (_, i) => cellTextOf(s.cells, src.r0 + i, col));
        const ext = extendSeries(series, r - src.r1);
        value = ext[ext.length - 1];
        styleSrc = s.cells[cellKey(src.r1, col)];
      } else if (c > src.c1) {
        // 向右填充：按行取序列，样式继承该行最后一列
        const row = src.r0 + srcIndexOffset(r - src.r0, srcH);
        const series = Array.from({ length: srcW }, (_, i) => cellTextOf(s.cells, row, src.c0 + i));
        const ext = extendSeries(series, c - src.c1);
        value = ext[ext.length - 1];
        styleSrc = s.cells[cellKey(row, src.c1)];
      } else {
        continue;
      }

      const cell: Cell = { value };
      if (styleSrc?.style) cell.style = { ...styleSrc.style };
      out[cellKey(r, c)] = cell;
    }
  }
  return out;
}

// ---------- 条件格式 ----------

function numOf(v: string): number | null {
  if (v.trim() === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

/** 单元格文本是否命中某条高亮类条件格式规则（cellValue/textContains/duplicate） */
export function matchCondition(cf: ConditionalFormat, value: string, counts: Record<string, number>): boolean {
  if (cf.type === 'colorScale' || cf.type === 'dataBar') return false;
  const v = value ?? '';
  switch (cf.type) {
    case 'cellValue': {
      if (cf.operator === 'notEmpty') return v.trim() !== '';
      const a = numOf(v);
      const t1 = numOf(cf.value1 ?? '');
      if (a === null || t1 === null) return false;
      switch (cf.operator) {
        case 'greaterThan':
          return a > t1;
        case 'greaterOrEqual':
          return a >= t1;
        case 'lessThan':
          return a < t1;
        case 'lessOrEqual':
          return a <= t1;
        case 'equal':
          return a === t1;
        case 'between': {
          const t2 = numOf(cf.value2 ?? '');
          return t2 !== null && a >= Math.min(t1, t2) && a <= Math.max(t1, t2);
        }
        default:
          return false;
      }
    }
    case 'textContains':
      return cf.text != null && v.includes(cf.text);
    case 'duplicate':
      return v.trim() !== '' && (counts[v] ?? 0) > 1;
    default:
      return false;
  }
}

// ---- 颜色插值工具 ----

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((x) => x + x).join('') : h;
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return [0, 0, 0];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (x: number) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** 两个颜色按 ratio(0-1) 线性插值 */
export function lerpColor(a: string, b: string, ratio: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const t = Math.max(0, Math.min(1, ratio));
  return rgbToHex(ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t);
}

/** 色阶：根据 value 在 [min,max] 的归一化位置插出背景色；非数值或 min===max 返回 null */
export function colorScaleBg(cf: ConditionalFormat, value: string, min: number, max: number): string | null {
  const a = numOf(value);
  if (a === null || max === min || cf.minColor == null || cf.maxColor == null) return null;
  const ratio = (a - min) / (max - min);
  if (cf.midColor != null) {
    // 三段色阶：min → mid → max
    return ratio < 0.5 ? lerpColor(cf.minColor, cf.midColor, ratio * 2) : lerpColor(cf.midColor, cf.maxColor, (ratio - 0.5) * 2);
  }
  return lerpColor(cf.minColor, cf.maxColor, ratio);
}

/** 数据条：返回 0-1 比例；非数值返回 null */
export function dataBarRatio(value: string, min: number, max: number): number | null {
  const a = numOf(value);
  if (a === null || max === min) return null;
  return Math.max(0, Math.min(1, (a - min) / (max - min)));
}

// ---------- 多视图（看板 / 日历）辅助 ----------

/** 解析单元格文本为 ISO 日期（YYYY-MM-DD）；无法解析返回 null。支持 2026/1/15、2026-01-15、2026.1.15 */
export function parseSheetDate(value: string): string | null {
  const v = (value ?? '').trim();
  if (!v) return null;
  const m = /^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/.exec(v);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** 某一列的非空唯一值（按首次出现顺序） */
export function uniqueColumnValues(s: SheetState, col: number, fromRow = 0, toRow = s.rowCount - 1): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (let r = fromRow; r <= toRow; r++) {
    const v = (s.cells[cellKey(r, col)]?.value ?? '').trim();
    if (v !== '' && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

/** 看板分组：按列值分组行号，返回 [{ value, rows[] }]（按组名首次出现顺序） */
export function groupRowsByColumn(s: SheetState, col: number): { value: string; rows: number[] }[] {
  const map = new Map<string, number[]>();
  const order: string[] = [];
  for (let r = 0; r < s.rowCount; r++) {
    const v = (s.cells[cellKey(r, col)]?.value ?? '').trim();
    const key = v === '' ? '（无值）' : v;
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key)!.push(r);
  }
  return order.map((k) => ({ value: k, rows: map.get(k)! }));
}