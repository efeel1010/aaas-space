// ===== 时间字段工具（ISO <-> datetime-local 展示） =====
const pad = (n: number) => String(n).padStart(2, '0');

export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 把展示字符串转为 "开始 → 结束" 摘要，无值返回空串
export function rangeSummary(start: string | null | undefined, end: string | null | undefined): string {
  const s = formatDateTime(start);
  const e = formatDateTime(end);
  if (!s && !e) return '';
  if (s && e) return `${s} → ${e}`;
  return s || e;
}