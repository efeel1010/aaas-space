import type { AiOrganizeFileInput, AiOrganizeNode } from '@pulse-space/contracts';

// ===== AI 整理文件到文件夹：提示构造 + 树解析（纯函数，便于单测） =====

const MAX_FILE_PREVIEW = 2000; // 每个文件发给 AI 的内容最大长度（字符）
const MAX_DEPTH = 6; // 允许的最大嵌套深度
const MAX_NODES = 200; // 允许的最大节点总数

// 构造发给 AI 的 system + user 提示
export function buildOrganizeMessages(files: AiOrganizeFileInput[]): { role: string; content: string }[] {
  const fileList = files
    .map(
      (f, i) =>
        `${i + 1}. 文件名：${f.name}\n    内容摘录：${(f.content || '').slice(0, MAX_FILE_PREVIEW)}`,
    )
    .join('\n\n');

  return [
    {
      role: 'system',
      content:
        '你是一个文件整理助手。请根据用户提供的一组「文件名 + 内容摘录」，判断它们的主题或用途，将其归类整理为多级文件夹结构。' +
        '严格输出 JSON 数组，不要输出任何其他文字或 markdown 代码块标记。' +
        '数组元素格式：[{"name":"文件夹名","type":"folder","children":[{"name":"子文件夹名","type":"folder","children":[{"name":"文档名","type":"file"}]},{"name":"文档名","type":"file"}]}]。' +
        '要求：' +
        '1) type 只能是 "folder" 或 "file"；' +
        '2) folder 需要 children，file 不能有 children；' +
        '3) 文件的 name 必须严格等于用户上传的原始文件名（不要改名、不要补扩展名），你的职责是把文件分组归入不同的文件夹层级，而不是重命名；' +
        '4) 文件夹名应简洁、贴合文件内容主题；' +
        '5) 单个文件若不适合放入任何文件夹，可直接放在顶层数组；' +
        '6) 最多嵌套 6 层，全部节点数不超过 200。',
    },
    {
      role: 'user',
      content: `请把以下 ${files.length} 个文件按主题整理成文件夹树。\n\n${fileList}`,
    },
  ];
}

// 清洗并安全解析 AI 返回的树形 JSON（带深度/总数上限校验）
export function parseOrganize(raw: string): AiOrganizeNode[] {
  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const count = { n: 0 };
  try {
    const nodes = sanitizeNodes(parsed, 0, count) ?? [];
    return count.n > MAX_NODES ? nodes.slice(0, MAX_NODES) : nodes;
  } catch {
    return [];
  }
}

function sanitizeNodes(
  arr: unknown[],
  depth: number,
  count: { n: number },
): AiOrganizeNode[] | null {
  if (depth > MAX_DEPTH) return null; // 超深 → 拒绝整棵子树
  const nodes: AiOrganizeNode[] = [];
  for (const item of arr) {
    if (count.n >= MAX_NODES) break;
    if (!item || typeof item !== 'object') continue;
    const it = item as Record<string, unknown>;
    const name = typeof it.name === 'string' ? it.name.trim().slice(0, 200) : '';
    if (!name) continue;
    const type = it.type === 'folder' ? 'folder' : 'file';
    const node: AiOrganizeNode = { name, type };
    if (type === 'folder') {
      const children = Array.isArray(it.children) ? sanitizeNodes(it.children, depth + 1, count) : null;
      node.children = children ?? [];
    }
    nodes.push(node);
    count.n++;
  }
  return nodes;
}