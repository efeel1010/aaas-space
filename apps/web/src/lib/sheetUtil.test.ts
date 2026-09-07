import { describe, it, expect } from 'vitest';
import {
  cellKey,
  colToLetter,
  letterToCol,
  parseCellRef,
  defaultSheetData,
  parseSheet,
  serializeSheet,
  evaluateCell,
  evaluateFormulaExpr,
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
  clipToTSV,
  parseTSV,
  validateCellValue,
  SHEET_MIME,
  extendSeries,
  fillSeries,
  matchCondition,
  colorScaleBg,
  dataBarRatio,
  parseSheetDate,
  uniqueColumnValues,
  groupRowsByColumn,
  type SheetState,
  type ConditionalFormat,
} from './sheetUtil';

function sheet(n: number): SheetState {
  const s = defaultSheetData('测试').sheets[0];
  s.colCount = n;
  return s;
}

describe('列名与引用', () => {
  it('colToLetter：A/B/Z/AA/AZ', () => {
    expect(colToLetter(0)).toBe('A');
    expect(colToLetter(1)).toBe('B');
    expect(colToLetter(25)).toBe('Z');
    expect(colToLetter(26)).toBe('AA');
    expect(colToLetter(51)).toBe('AZ');
  });
  it('letterToCol 与 parseCellRef', () => {
    expect(letterToCol('A')).toBe(0);
    expect(letterToCol('AA')).toBe(26);
    expect(parseCellRef('B3')).toEqual({ r: 2, c: 1 });
    expect(parseCellRef('$A$1')).toEqual({ r: 0, c: 0 });
    expect(parseCellRef('ZZ')).toBeNull();
  });
});

describe('公式求值 evaluateFormulaExpr / evaluateCell', () => {
  function mkCells(rows: Record<string, string>): Record<string, { value: string }> {
    return Object.fromEntries(Object.entries(rows).map(([k, v]) => [cellKey(parseCellRef(k)!.r, parseCellRef(k)!.c), { value: v }]));
  }

  it('SUM 区间', () => {
    const cells = mkCells({ A1: '1', A2: '2', B1: '3', B2: '4' });
    expect(evaluateFormulaExpr(cells, 'SUM(A1:B2)')).toEqual({ kind: 'number', num: 10 });
  });
  it('SUM 区间 + 数字参数混合', () => {
    const cells = mkCells({ A1: '1', A2: '2' });
    expect(evaluateFormulaExpr(cells, 'SUM(A1:A2, 10, 5)')).toEqual({ kind: 'number', num: 18 });
  });
  it('AVERAGE 排除空与文本', () => {
    const cells = mkCells({ A1: '10', A2: '20', A3: 'abc' });
    expect(evaluateFormulaExpr(cells, 'AVERAGE(A1:A3)')).toEqual({ kind: 'number', num: 15 });
  });
  it('COUNT 仅统计数值单元格', () => {
    const cells = mkCells({ A1: '10', A2: 'abc', A3: '0' });
    expect(evaluateFormulaExpr(cells, 'COUNT(A1:A4)')).toEqual({ kind: 'number', num: 2 });
  });
  it('MIN / MAX', () => {
    const cells = mkCells({ A1: '3', A2: '7', A3: '1' });
    expect(evaluateFormulaExpr(cells, 'MIN(A1:A3)')).toEqual({ kind: 'number', num: 1 });
    expect(evaluateFormulaExpr(cells, 'MAX(A1:A3)')).toEqual({ kind: 'number', num: 7 });
  });
  it('空区间不崩，AVERAGE 返回 #DIV/0!', () => {
    expect(evaluateFormulaExpr({}, 'SUM(A1:A3)')).toEqual({ kind: 'number', num: 0 });
    expect(evaluateFormulaExpr({}, 'AVERAGE(A1:A3)')).toEqual({ kind: 'string', text: '#DIV/0!' });
  });
  it('公式引用另一个公式单元格（级联）', () => {
    const cells = mkCells({ A1: '=SUM(B1:B2)', B1: '10', B2: '20' });
    expect(evaluateCell(cells, 0, 0)).toEqual({ kind: 'number', num: 30 });
  });
  it('未知函数返回 #NAME?#', () => {
    expect(evaluateFormulaExpr({}, 'FOO(1)')).toEqual({ kind: 'string', text: '#NAME?#' });
  });
  it('单元格首字母 = 触发公式（以 = 开头）', () => {
    const cells = mkCells({ A1: '5', A2: '6' });
    expect(evaluateCell(cells, 0, 0)); // 无断言，仅确认调用不抛错
    const wrapped = mkCells({ B3: '=SUM(A1:A2)', A1: '5', A2: '6' });
    expect(evaluateCell(wrapped, 2, 1)).toEqual({ kind: 'number', num: 11 });
  });

  it('比较运算与 IF', () => {
    const cells = mkCells({ A1: '15' });
    expect(evaluateFormulaExpr(cells, 'A1>10')).toEqual({ kind: 'number', num: 1 });
    expect(evaluateFormulaExpr(cells, 'A1<10')).toEqual({ kind: 'number', num: 0 });
    expect(evaluateFormulaExpr(cells, 'IF(A1>=10, "高", "低")')).toEqual({ kind: 'string', text: '高' });
    expect(evaluateFormulaExpr(cells, 'IF(A1=10, 1, 0)')).toEqual({ kind: 'number', num: 0 });
  });

  it('AND / OR / NOT', () => {
    const cells = mkCells({ A1: '5', B1: '10' });
    expect(evaluateFormulaExpr(cells, 'AND(A1>0, B1>0)')).toEqual({ kind: 'number', num: 1 });
    expect(evaluateFormulaExpr(cells, 'OR(A1>100, B1>5)')).toEqual({ kind: 'number', num: 1 });
    expect(evaluateFormulaExpr(cells, 'NOT(A1=5)')).toEqual({ kind: 'number', num: 0 });
  });

  it('COUNTIF / SUMIF', () => {
    const cells = mkCells({ A1: '10', A2: '20', A3: '30' });
    expect(evaluateFormulaExpr(cells, 'COUNTIF(A1:A3, ">15")')).toEqual({ kind: 'number', num: 2 });
    expect(evaluateFormulaExpr(cells, 'SUMIF(A1:A3, ">=20")')).toEqual({ kind: 'number', num: 50 });
  });

  it('VLOOKUP 精确查找', () => {
    const cells = mkCells({ A1: '苹果', B1: '5', A2: '香蕉', B2: '8' });
    expect(evaluateFormulaExpr(cells, 'VLOOKUP("苹果", A1:B2, 2)')).toEqual({ kind: 'number', num: 5 });
    expect(evaluateFormulaExpr(cells, 'VLOOKUP("梨", A1:B2, 2)')).toEqual({ kind: 'string', text: '#N/A' });
  });

  it('文本函数 CONCAT / LEN / LEFT / UPPER', () => {
    expect(evaluateFormulaExpr({}, 'CONCAT("a", "b", "c")')).toEqual({ kind: 'string', text: 'abc' });
    expect(evaluateFormulaExpr({}, 'LEN("你好")')).toEqual({ kind: 'number', num: 2 });
    expect(evaluateFormulaExpr({}, 'LEFT("abcd", 2)')).toEqual({ kind: 'string', text: 'ab' });
    expect(evaluateFormulaExpr({}, 'UPPER("ab")')).toEqual({ kind: 'string', text: 'AB' });
  });

  it('ROUND / ABS / INT', () => {
    expect(evaluateFormulaExpr({}, 'ROUND(3.14159, 2)')).toEqual({ kind: 'number', num: 3.14 });
    expect(evaluateFormulaExpr({}, 'ABS(-5)')).toEqual({ kind: 'number', num: 5 });
    expect(evaluateFormulaExpr({}, 'INT(3.9)')).toEqual({ kind: 'number', num: 3 });
  });
});

describe('合并单元格', () => {
  it('mergeSheet 清空区域内非主格', () => {
    let s = sheet(3);
    s.cells[cellKey(1, 1)] = { value: 'a' };
    s.cells[cellKey(1, 2)] = { value: 'b' };
    s = mergeSheet(s, 1, 1, 2, 2);
    expect(s.merges).toHaveLength(1);
    expect(s.cells[cellKey(1, 1)]?.value).toBe('a');
    expect(s.cells[cellKey(1, 2)]).toBeUndefined();
    expect(s.cells[cellKey(2, 2)]).toBeUndefined();
  });
  it('findMerge / isCoveredByMerge', () => {
    let s = mergeSheet(sheet(3), 0, 0, 1, 1);
    expect(findMerge(s, 0, 0)).toEqual({ r0: 0, c0: 0, r1: 1, c1: 1 });
    expect(findMerge(s, 1, 1)).toEqual({ r0: 0, c0: 0, r1: 1, c1: 1 });
    expect(isCoveredByMerge(s, 1, 1)).toBe(true);
    expect(isCoveredByMerge(s, 0, 0)).toBe(false);
    expect(isCoveredByMerge(s, 2, 2)).toBe(false);
  });
  it('unmerge 恢复', () => {
    let s = mergeSheet(sheet(3), 1, 1, 2, 2);
    s = unmergeSheet(s, 1, 1, 2, 2);
    expect(s.merges).toHaveLength(0);
  });
});

describe('行列插入与删除', () => {
  it('insertRow 后下方单元格整体下移，缩放正确', () => {
    let s = sheet(3);
    s.cells[cellKey(2, 0)] = { value: 'x' }; // 原第 3 行
    s.cells[cellKey(0, 0)] = { value: 'keep' };
    s = insertRow(s, 1);
    expect(s.cells[cellKey(3, 0)]?.value).toBe('x');
    expect(s.cells[cellKey(0, 0)]?.value).toBe('keep');
  });
  it('deleteRow 删除行，后续行上移', () => {
    let s = sheet(3);
    s.cells[cellKey(0, 0)] = { value: 'a' };
    s.cells[cellKey(2, 0)] = { value: 'c' };
    s = deleteRow(s, 1);
    expect(s.cells[cellKey(1, 0)]?.value).toBe('c');
    expect(s.cells[cellKey(2, 0)]).toBeUndefined();
  });
  it('insertCol / deleteCol 列移动', () => {
    let s = sheet(3);
    s.cells[cellKey(0, 2)] = { value: 'z' };
    s = insertCol(s, 1);
    expect(s.cells[cellKey(0, 3)]?.value).toBe('z');
    s = deleteCol(s, 1);
    expect(s.cells[cellKey(0, 2)]?.value).toBe('z');
  });
  it('删除行/列时横向跨越的合并区域被移除', () => {
    let s = mergeSheet(sheet(4), 0, 0, 3, 1); // 跨 4 行
    const before = s.merges.length;
    s = deleteRow(s, 2);
    expect(s.merges).toHaveLength(0);
    expect(before).toBe(1);
  });
  it('单行/单列时不允许再删', () => {
    let s = sheet(3);
    s.rowCount = 1;
    s.colCount = 1;
    const { rowCount } = deleteRow(s, 0);
    const { colCount } = deleteCol(s, 0);
    expect(rowCount).toBe(1);
    expect(colCount).toBe(1);
  });
});

describe('排序', () => {
  it('按数字升序排列整行', () => {
    let s = sheet(3);
    s.cells[cellKey(0, 0)] = { value: '3' };
    s.cells[cellKey(1, 0)] = { value: '1' };
    s.cells[cellKey(2, 0)] = { value: '2' };
    s.cells[cellKey(0, 1)] = { value: 'c' };
    s.cells[cellKey(1, 1)] = { value: 'a' };
    s.cells[cellKey(2, 1)] = { value: 'b' };
    s = sortSheet(s, 0, 2, 0, 'asc');
    expect(s.cells[cellKey(0, 1)]?.value).toBe('a');
    expect(s.cells[cellKey(1, 1)]?.value).toBe('b');
    expect(s.cells[cellKey(2, 1)]?.value).toBe('c');
  });
  it('降序排列', () => {
    let s = sheet(2);
    s.cells[cellKey(0, 0)] = { value: '1' };
    s.cells[cellKey(1, 0)] = { value: '3' };
    s.cells[cellKey(2, 0)] = { value: '2' };
    s = sortSheet(s, 0, 2, 0, 'desc');
    expect(s.cells[cellKey(0, 0)]?.value).toBe('3');
    expect(s.cells[cellKey(2, 0)]?.value).toBe('1');
  });
});

describe('数字格式 formatValue', () => {
  it('货币 / 百分比 / 日期 / 常规', () => {
    expect(formatValue({ value: '1234.5', style: { format: 'currency' } })).toBe('¥1,234.50');
    expect(formatValue({ value: '0.25', style: { format: 'percent' } })).toBe('25%');
    expect(formatValue({ value: '0', style: { format: 'date' } })).toBe('1970-01-01');
    expect(formatValue({ value: '42' })).toBe('42');
    expect(formatValue({ value: '=SUM(1,2)' })).toBe('=SUM(1,2)'); // 公式保持原文
  });
});

describe('序列化 round trip', () => {
  it('serialize -> parse 保持一致', () => {
    let s = defaultSheetData('预算');
    s.sheets[0].cells[cellKey(0, 0)] = { value: '收入', style: { bold: true, format: 'currency' } };
    const d = parseSheet(serializeSheet(s));
    expect(d.sheets[0].name).toBe('预算');
    expect(d.sheets[0].cells[cellKey(0, 0)]?.style?.bold).toBe(true);
    expect(d.sheets[0].cells[cellKey(0, 0)]?.value).toBe('收入');
  });
  it('非法 JSON 回退默认', () => {
    const d = parseSheet('not-json{');
    expect(d.sheets).toHaveLength(1);
    expect(d.sheets[0].name).toBe('表格1');
  });
  it('版本常量存在（便于未来升级格式）', () => {
    expect(SHEET_MIME).toBe(1);
  });
});

describe('复制 / 剪切 / 粘贴（含选择性粘贴）', () => {
  const full = () => {
    const s = defaultSheetData('剪贴板').sheets[0];
    s.cells[cellKey(0, 0)] = { value: '=SUM(1,2)', style: { bold: true }, validation: { type: 'list', options: ['高', '低'] } };
    s.cells[cellKey(0, 1)] = { value: '42', style: { italic: true }, validation: { type: 'number' } };
    return s;
  };

  it('makeClipGrid 读取值/样式/验证及公式求值结果', () => {
    const grid = makeClipGrid(full(), 0, 0, 0, 1);
    expect(grid.rows).toBe(1);
    expect(grid.cols).toBe(2);
    expect(grid.cells[0][0]?.value).toBe('=SUM(1,2)');
    expect(grid.cells[0][0]?.computed).toBe('3');
    expect(grid.cells[0][0]?.style?.bold).toBe(true);
    expect(grid.cells[0][0]?.validation?.options).toEqual(['高', '低']);
    expect(grid.cells[0][1]?.validation?.type).toBe('number');
  });

  it('normal 粘贴：完整复制值/样式/验证', () => {
    const t = defaultSheetData('目标').sheets[0];
    const out = pasteGrid(t, makeClipGrid(full(), 0, 0, 0, 1), 2, 2, 'normal');
    expect(out.cells[cellKey(2, 2)]?.value).toBe('=SUM(1,2)');
    expect(out.cells[cellKey(2, 2)]?.style?.bold).toBe(true);
    expect(out.cells[cellKey(2, 3)]?.validation?.type).toBe('number');
  });

  it('仅粘贴值：公式粘贴求值结果，不携带样式/验证', () => {
    const t = defaultSheetData('目标').sheets[0];
    const out = pasteGrid(t, makeClipGrid(full(), 0, 0, 0, 1), 0, 0, 'value');
    expect(out.cells[cellKey(0, 0)]?.value).toBe('3');
    expect(out.cells[cellKey(0, 0)]?.style).toBeUndefined();
    expect(out.cells[cellKey(0, 0)]?.validation).toBeUndefined();
  });

  it('仅粘贴格式：值保持不变，只沿用格式', () => {
    const t = defaultSheetData('目标').sheets[0];
    t.cells[cellKey(4, 4)] = { value: '原有' };
    const out = pasteGrid(t, makeClipGrid(full(), 0, 0, 0, 0), 4, 4, 'format');
    expect(out.cells[cellKey(4, 4)]?.value).toBe('原有');
    expect(out.cells[cellKey(4, 4)]?.style?.bold).toBe(true);
    expect(out.cells[cellKey(4, 4)]?.validation).toBeUndefined();
  });

  it('仅粘贴公式：非公式格不覆盖，公式格粘贴公式', () => {
    const t = defaultSheetData('目标').sheets[0];
    t.cells[cellKey(4, 4)] = { value: '保留我' };
    t.cells[cellKey(4, 5)] = { value: '保留我' };
    const s = defaultSheetData('源').sheets[0];
    s.cells[cellKey(0, 0)] = { value: '=SUM(1,2)' };
    s.cells[cellKey(0, 1)] = { value: '普通文本' };
    const out = pasteGrid(t, makeClipGrid(s, 0, 0, 0, 1), 4, 4, 'formula');
    expect(out.cells[cellKey(4, 4)]?.value).toBe('=SUM(1,2)');
    expect(out.cells[cellKey(4, 5)]?.value).toBe('保留我'); // 源非公式 → 目标保留
  });

  it('仅粘贴数据验证：只复制验证，不动值/样式', () => {
    const t = defaultSheetData('目标').sheets[0];
    t.cells[cellKey(1, 1)] = { value: 'x', style: { format: 'currency' } };
    const s = defaultSheetData('源').sheets[0];
    s.cells[cellKey(0, 0)] = { value: 'a', style: { bold: true }, validation: { type: 'list', options: ['高', '中'] } };
    const out = pasteGrid(t, makeClipGrid(s, 0, 0, 0, 0), 1, 1, 'validation');
    expect(out.cells[cellKey(1, 1)]?.value).toBe('x');
    expect(out.cells[cellKey(1, 1)]?.style?.format).toBe('currency');
    expect(out.cells[cellKey(1, 1)]?.validation?.options).toEqual(['高', '中']);
  });

  it('clearRange 清空值/样式/验证', () => {
    const s = full();
    const out = clearRange(s, 0, 0, 0, 1);
    expect(out.cells[cellKey(0, 0)]).toBeUndefined();
    expect(out.cells[cellKey(0, 1)]).toBeUndefined();
  });

  it('clipToTSV / parseTSV 往返', () => {
    const grid = makeClipGrid(full(), 0, 0, 0, 1);
    const tsv = clipToTSV(grid);
    expect(tsv).toBe('=SUM(1,2)\t42');
    const parsed = parseTSV(tsv);
    expect(parsed.cells[0][0]?.value).toBe('=SUM(1,2)');
    expect(parsed.cells[0][1]?.value).toBe('42');
  });

  it('validateCellValue：数字/列表校验', () => {
    expect(validateCellValue({ value: '', validation: { type: 'number' } }, 'abc')).toBe('该单元格要求数字格式');
    expect(validateCellValue({ value: '', validation: { type: 'number' } }, '12.5')).toBeNull();
    expect(validateCellValue({ value: '', validation: { type: 'list', options: ['高', '低'] } }, '中')).toContain('高');
    expect(validateCellValue({ value: '', validation: { type: 'list', options: ['高', '低'] } }, '高')).toBeNull();
    expect(validateCellValue(undefined, '任意')).toBeNull();
  });
});

describe('拖拽填充 extendSeries / fillSeries', () => {
  it('extendSeries：纯数字等差递增', () => {
    expect(extendSeries(['1'], 3)).toEqual(['2', '3', '4']);
    expect(extendSeries(['1', '3'], 3)).toEqual(['5', '7', '9']);
  });

  it('extendSeries：数字后缀递增（项目1 → 项目2）', () => {
    expect(extendSeries(['项目1', '项目2'], 2)).toEqual(['项目3', '项目4']);
  });

  it('extendSeries：普通文本复制末值', () => {
    expect(extendSeries(['完成', '进行中'], 2)).toEqual(['进行中', '进行中']);
  });

  it('fillSeries：向下填充列序列', () => {
    const s = defaultSheetData('填充').sheets[0];
    s.cells[cellKey(0, 0)] = { value: '1' };
    s.cells[cellKey(1, 0)] = { value: '2' };
    const out = fillSeries(s, { r0: 0, c0: 0, r1: 1, c1: 0 }, { r0: 0, c0: 0, r1: 4, c1: 0 });
    expect(out[cellKey(2, 0)].value).toBe('3');
    expect(out[cellKey(3, 0)].value).toBe('4');
    expect(out[cellKey(4, 0)].value).toBe('5');
  });

  it('fillSeries：单格向下复制数字', () => {
    const s = defaultSheetData('填充').sheets[0];
    s.cells[cellKey(0, 0)] = { value: '7' };
    const out = fillSeries(s, { r0: 0, c0: 0, r1: 0, c1: 0 }, { r0: 0, c0: 0, r1: 3, c1: 0 });
    expect(out[cellKey(1, 0)].value).toBe('8');
    expect(out[cellKey(3, 0)].value).toBe('10');
  });
});

describe('条件格式匹配', () => {
  const cf = (p: Partial<ConditionalFormat>): ConditionalFormat => ({
    id: 'x',
    r0: 0,
    c0: 0,
    r1: 10,
    c1: 10,
    type: 'cellValue',
    ...p,
  });

  it('matchCondition：单元格值大于', () => {
    expect(matchCondition(cf({ operator: 'greaterThan', value1: '10' }), '11', {})).toBe(true);
    expect(matchCondition(cf({ operator: 'greaterThan', value1: '10' }), '9', {})).toBe(false);
  });

  it('matchCondition：文本包含', () => {
    expect(matchCondition(cf({ type: 'textContains', text: '需求' }), '产品需求', {})).toBe(true);
    expect(matchCondition(cf({ type: 'textContains', text: '需求' }), '设计', {})).toBe(false);
  });

  it('matchCondition：重复值', () => {
    expect(matchCondition(cf({ type: 'duplicate' }), 'A', { A: 2 })).toBe(true);
    expect(matchCondition(cf({ type: 'duplicate' }), 'B', { B: 1 })).toBe(false);
  });

  it('colorScaleBg：两端插值', () => {
    const c = cf({ type: 'colorScale', minColor: '#000000', maxColor: '#ffffff' });
    expect(colorScaleBg(c, '5', 0, 10)).toBe('#808080');
    expect(colorScaleBg(c, 'abc', 0, 10)).toBeNull();
  });

  it('dataBarRatio：归一化比例', () => {
    expect(dataBarRatio('5', 0, 10)).toBeCloseTo(0.5);
    expect(dataBarRatio('20', 0, 10)).toBe(1);
  });
});

describe('多视图辅助（看板/日历）', () => {
  it('parseSheetDate：多种日期格式归一化为 YYYY-MM-DD', () => {
    expect(parseSheetDate('2026/1/15')).toBe('2026-01-15');
    expect(parseSheetDate('2026-01-15')).toBe('2026-01-15');
    expect(parseSheetDate('2026.1.5')).toBe('2026-01-05');
    expect(parseSheetDate('abc')).toBeNull();
    expect(parseSheetDate('')).toBeNull();
  });

  it('uniqueColumnValues / groupRowsByColumn：按列分组', () => {
    const s = defaultSheetData('视图').sheets[0];
    s.rowCount = 3;
    s.cells[cellKey(0, 1)] = { value: '进行中' };
    s.cells[cellKey(1, 1)] = { value: '已完成' };
    s.cells[cellKey(2, 1)] = { value: '进行中' };
    expect(uniqueColumnValues(s, 1)).toEqual(['进行中', '已完成']);
    const groups = groupRowsByColumn(s, 1);
    expect(groups.map((g) => g.value)).toEqual(['进行中', '已完成']);
    expect(groups[0].rows).toEqual([0, 2]);
    expect(groups[1].rows).toEqual([1]);
  });
});