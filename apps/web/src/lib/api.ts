import type {
  UserPublic,
  Team,
  Project,
  Requirement,
  Task,
  Document,
  DocumentVersion,
  DocumentComment,
  AiConversation,
  AiMessage,
  AiTranslateResult,
  AiOrganizeFileInput,
  AiOrganizeNode,
  DocKind,
  WikiRef,
  WikiTocItem,
  Milestone,
  ProjectComment,
  CommentTargetType,
  RecentDocsTab,
  MyTodos,
  SearchResult,
  NotificationList,
  TrashDocItem,
  TrashProjectItem,
  DocTemplate,
  DocumentAccessItem,
  DocAccessPermission,
} from '@pulse-space/contracts';

const BASE = '/api';

export class ApiError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (body && body.message) || `请求失败 (${res.status})`;
    if (res.status === 401) throw new ApiError(401, msg);
    throw new ApiError(res.status, msg);
  }
  return (body as { data: T }).data;
}

// ===== 认证 =====
export const authApi = {
  register: (email: string, name: string, password: string) =>
    request<{ user: UserPublic; expires_at: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, name, password }),
    }),
  login: (email: string, password: string) =>
    request<{ user: UserPublic; expires_at: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request<null>('/auth/logout', { method: 'POST' }),
  session: () => request<{ user: UserPublic }>('/auth/session'),
  searchUsers: (q: string) =>
    request<{ id: string; name: string; email: string; avatar_url: string | null }[]>(`/auth/search?q=${encodeURIComponent(q)}`),
};

// ===== 团队 =====
export const teamApi = {
  list: () => request<Team[]>('/teams'),
  detail: (id: string) => request<Team & { members: { user_id: string; email: string; name: string; avatar_url: string | null; role: string; joined_at: string }[] }>(`/teams/${id}`),
  create: (name: string, description: string) =>
    request<{ id: string }>('/teams', { method: 'POST', body: JSON.stringify({ name, description }) }),
  update: (id: string, patch: { name?: string; description?: string }) =>
    request<null>(`/teams/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  remove: (id: string) => request<null>(`/teams/${id}`, { method: 'DELETE' }),
  addMember: (id: string, email: string, role: string) =>
    request<null>(`/teams/${id}/members`, { method: 'POST', body: JSON.stringify({ email, role }) }),
  removeMember: (id: string, userId: string) =>
    request<null>(`/teams/${id}/members/${userId}`, { method: 'DELETE' }),
  setRole: (id: string, userId: string, role: string) =>
    request<null>(`/teams/${id}/members/${userId}?role=${role}`, { method: 'PATCH' }),
  stats: (id: string) => request<{ doc_count: number; project_count: number; ai_conversation_count: number }>(`/teams/${id}/stats`),
};

// ===== 文档 =====
// 列表 kind 支持单值或多值（逗号分隔，如 'doc,sheet'）
export type DocListKind = DocKind | `${DocKind},${DocKind}`;

export const docApi = {
  list: (params: { scope: 'personal' | 'team'; teamId?: string; kind: DocListKind; parent?: string }) => {
    const qs = new URLSearchParams({ scope: params.scope, kind: params.kind });
    if (params.teamId) qs.set('teamId', params.teamId);
    if (params.parent) qs.set('parent', params.parent);
    return request<Document[]>(`/documents?${qs}`);
  },
  get: (id: string) => request<Document>(`/documents/${id}`),
  recent: (tab: RecentDocsTab) => request<Document[]>(`/documents/recent?tab=${tab}`),
  toggleFavorite: (id: string) => request<{ favorited: boolean }>(`/documents/${id}/favorite`, { method: 'POST' }),
  mention: (id: string, userId: string) => request<null>(`/documents/${id}/mentions`, { method: 'POST', body: JSON.stringify({ user_id: userId }) }),
  // 模板
  templates: () => request<DocTemplate[]>('/documents/templates'),
  useTemplate: (tid: string) => request<Document>(`/documents/templates/${tid}/use`, { method: 'POST' }),
  removeTemplate: (tid: string) => request<null>(`/documents/templates/${tid}`, { method: 'DELETE' }),
  saveAsTemplate: (id: string, title?: string) =>
    request<{ id: string }>(`/documents/${id}/save-as-template`, { method: 'POST', body: JSON.stringify({ title }) }),
  // 分享
  getShare: (id: string) => request<{ token: string; permission: 'read' | 'edit' } | null>(`/documents/${id}/share`),
  createShare: (id: string, permission: 'read' | 'edit') =>
    request<{ token: string; permission: string }>(`/documents/${id}/share`, { method: 'POST', body: JSON.stringify({ permission }) }),
  closeShare: (id: string) => request<null>(`/documents/${id}/share`, { method: 'DELETE' }),
  trash: () => request<TrashDocItem[]>('/documents/trash'),
  restore: (id: string) => request<null>(`/documents/${id}/restore`, { method: 'POST' }),
  permanentDelete: (id: string) => request<null>(`/documents/${id}/permanent`, { method: 'DELETE' }),
  ancestors: (id: string) => request<WikiRef[]>(`/documents/${id}/ancestors`),
  backlinks: (id: string) =>
    request<{ id: string; title: string; kind: DocKind; updated_at: string }[]>(`/documents/${id}/backlinks`),
  wikiToc: (params: { scope: 'personal' | 'team'; teamId?: string }) => {
    const qs = new URLSearchParams({ scope: params.scope });
    if (params.teamId) qs.set('teamId', params.teamId);
    return request<WikiTocItem[]>(`/documents/wiki-toc?${qs}`);
  },
  create: (body: { scope: 'personal' | 'team'; team_id?: string; kind: DocKind; parent_id?: string; is_folder?: boolean; title?: string; content?: string; icon?: string; visibility?: string; base_permission?: string }) =>
    request<Document>('/documents', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, patch: { title?: string; content?: string; parent_id?: string | null; icon?: string | null; cover?: string | null; visibility?: string; base_permission?: string }) =>
    request<Document>(`/documents/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  remove: (id: string) => request<null>(`/documents/${id}`, { method: 'DELETE' }),
  // 版本历史
  versions: (id: string) => request<DocumentVersion[]>(`/documents/${id}/versions`),
  createVersion: (id: string, note?: string) =>
    request<DocumentVersion>(`/documents/${id}/versions`, { method: 'POST', body: JSON.stringify({ note }) }),
  restoreVersion: (id: string, versionId: string) =>
    request<Document>(`/documents/${id}/versions/${versionId}/restore`, { method: 'POST' }),
  // 评论
  comments: (id: string) => request<DocumentComment[]>(`/documents/${id}/comments`),
  addComment: (id: string, body: { content: string; selection_start?: number; selection_text?: string }) =>
    request<DocumentComment>(`/documents/${id}/comments`, { method: 'POST', body: JSON.stringify(body) }),
  removeComment: (id: string, commentId: string) =>
    request<null>(`/documents/${id}/comments/${commentId}`, { method: 'DELETE' }),
  toggleResolveComment: (id: string, commentId: string) =>
    request<null>(`/documents/${id}/comments/${commentId}/resolve`, { method: 'POST' }),
  // 逐成员授权
  access: (id: string) => request<DocumentAccessItem[]>(`/documents/${id}/access`),
  grantAccess: (id: string, userId: string, permission: DocAccessPermission) =>
    request<null>(`/documents/${id}/access`, { method: 'PUT', body: JSON.stringify({ user_id: userId, permission }) }),
  revokeAccess: (id: string, userId: string) =>
    request<null>(`/documents/${id}/access/${userId}`, { method: 'DELETE' }),
};

// ===== 项目 =====
// 可空 datetime 字符串，用于计划/实际开始结束时间
type NullableTime = string | null;

export const projectApi = {
  list: (params: { scope: 'personal' | 'team'; teamId?: string }) => {
    const qs = new URLSearchParams({ scope: params.scope });
    if (params.teamId) qs.set('teamId', params.teamId);
    return request<Project[]>(`/projects?${qs}`);
  },
  get: (id: string) => request<Project>(`/projects/${id}`),
  create: (body: { scope: 'personal' | 'team'; team_id?: string; name: string; description?: string; plan_start_at?: NullableTime; plan_end_at?: NullableTime; actual_start_at?: NullableTime; actual_end_at?: NullableTime; collaborator_ids?: string[] }) =>
    request<Project>('/projects', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, patch: { name?: string; description?: string; status?: string; plan_start_at?: NullableTime; plan_end_at?: NullableTime; actual_start_at?: NullableTime; actual_end_at?: NullableTime; collaborator_ids?: string[] }) =>
    request<Project>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  remove: (id: string) => request<null>(`/projects/${id}`, { method: 'DELETE' }),
  requirements: (id: string) => request<Requirement[]>(`/projects/${id}/requirements`),
  createRequirement: (id: string, body: { title: string; description?: string; priority?: string; owner_id?: string | null; milestone_id?: string | null; plan_start_at?: NullableTime; plan_end_at?: NullableTime; actual_start_at?: NullableTime; actual_end_at?: NullableTime; collaborator_ids?: string[] }) =>
    request<Requirement>(`/projects/${id}/requirements`, { method: 'POST', body: JSON.stringify(body) }),
  updateRequirement: (id: string, patch: { title?: string; description?: string; status?: string; priority?: string; owner_id?: string | null; milestone_id?: string | null; plan_start_at?: NullableTime; plan_end_at?: NullableTime; actual_start_at?: NullableTime; actual_end_at?: NullableTime; collaborator_ids?: string[] }) =>
    request<Requirement>(`/projects/requirements/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  removeRequirement: (id: string) => request<null>(`/projects/requirements/${id}`, { method: 'DELETE' }),
  tasks: (requirementId: string) => request<Task[]>(`/projects/requirements/${requirementId}/tasks`),
  createTask: (requirementId: string, body: { title: string; description?: string; priority?: string; assignee_id?: string; milestone_id?: string | null; due_date?: string; plan_start_at?: NullableTime; plan_end_at?: NullableTime; actual_start_at?: NullableTime; actual_end_at?: NullableTime; collaborator_ids?: string[] }) =>
    request<Task>(`/projects/requirements/${requirementId}/tasks`, { method: 'POST', body: JSON.stringify(body) }),
  updateTask: (id: string, patch: { title?: string; description?: string; status?: string; priority?: string; assignee_id?: string | null; milestone_id?: string | null; due_date?: string | null; plan_start_at?: NullableTime; plan_end_at?: NullableTime; actual_start_at?: NullableTime; actual_end_at?: NullableTime; collaborator_ids?: string[] }) =>
    request<Task>(`/projects/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  removeTask: (id: string) => request<null>(`/projects/tasks/${id}`, { method: 'DELETE' }),
  // 项目级任务列表（含 requirement_title / milestone_name）
  projectTasks: (projectId: string) => request<Task[]>(`/projects/${projectId}/tasks`),
  milestones: (projectId: string) => request<Milestone[]>(`/projects/${projectId}/milestones`),
  createMilestone: (projectId: string, body: { title: string; description?: string; due_date?: string | null }) =>
    request<{ id: string }>(`/projects/${projectId}/milestones`, { method: 'POST', body: JSON.stringify(body) }),
  updateMilestone: (id: string, patch: { title?: string; description?: string; due_date?: string | null }) =>
    request<Milestone>(`/projects/milestones/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  toggleMilestone: (id: string) => request<null>(`/projects/milestones/${id}/toggle`, { method: 'POST' }),
  removeMilestone: (id: string) => request<null>(`/projects/milestones/${id}`, { method: 'DELETE' }),
  comments: (targetType: CommentTargetType, targetId: string) =>
    request<ProjectComment[]>(`/projects/comments?target_type=${targetType}&target_id=${targetId}`),
  createComment: (body: { target_type: CommentTargetType; target_id: string; content: string }) =>
    request<{ id: string }>(`/projects/comments`, { method: 'POST', body: JSON.stringify(body) }),
  removeComment: (id: string) => request<null>(`/projects/comments/${id}`, { method: 'DELETE' }),
  myTodos: () => request<MyTodos>('/projects/my/todos'),
  trash: () => request<TrashProjectItem[]>('/projects/trash'),
  restore: (id: string) => request<null>(`/projects/${id}/restore`, { method: 'POST' }),
  permanentDelete: (id: string) => request<null>(`/projects/${id}/permanent`, { method: 'DELETE' }),
};

// ===== 全局搜索 =====
export const searchApi = {
  search: (q: string) => request<SearchResult>(`/search?q=${encodeURIComponent(q)}`),
};

// ===== 通知中心 =====
export const notifApi = {
  list: () => request<NotificationList>('/notifications'),
  markRead: (id: string) => request<null>(`/notifications/${id}/read`, { method: 'POST' }),
  markAllRead: () => request<null>('/notifications/read-all', { method: 'POST' }),
};

// ===== AI =====
export type SheetAction =
  | { action: 'formula'; formula: string }
  | { action: 'highlight'; column: number; operator: string; value: string; bg: string };

export const aiApi = {
  conversations: () => request<AiConversation[]>('/ai/conversations'),
  createConversation: (title?: string, team_id?: string) =>
    request<AiConversation>('/ai/conversations', { method: 'POST', body: JSON.stringify({ title, team_id }) }),
  messages: (id: string) => request<AiMessage[]>(`/ai/conversations/${id}/messages`),
  removeConversation: (id: string) => request<null>(`/ai/conversations/${id}`, { method: 'DELETE' }),
  breakdown: (project_name: string, requirement: string) =>
    request<{ tasks: { title: string; description: string; priority: string }[] }>('/ai/breakdown', {
      method: 'POST',
      body: JSON.stringify({ project_name, requirement }),
    }),
  // AI 生成需求（项目级别）
  genRequirements: (body: { project_name: string; project_description?: string; request: string }) =>
    request<{ requirements: { title: string; description: string; priority: string }[] }>('/ai/gen-requirements', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  // AI 生成任务（需求级别）
  genTasks: (body: { requirement_title: string; requirement_description?: string; request: string }) =>
    request<{ tasks: { title: string; description: string; priority: string }[] }>('/ai/gen-tasks', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  // 文档翻译
  translate: (body: { text: string; target_lang: string; mode?: 'full' | 'fragment' }) =>
    request<AiTranslateResult>('/ai/translate', { method: 'POST', body: JSON.stringify(body) }),
  // AI 整理文件到文件夹（返回推荐的文件夹树）
  organize: (body: { scope: 'personal' | 'team'; team_id?: string; parent_id?: string; files: AiOrganizeFileInput[] }, signal?: AbortSignal) =>
    request<{ tree: AiOrganizeNode[] }>('/ai/organize', { method: 'POST', body: JSON.stringify(body), signal }),
  // AI 表格操作（自然语言 → 公式 / 高亮条件格式）
  sheet: (body: { headers: string[]; sample: string[][]; instruction: string }) =>
    request<SheetAction>('/ai/sheet', { method: 'POST', body: JSON.stringify(body) }),
};

// ===== 流式请求（对话 / 文档 AI） =====
export async function streamJson<T = unknown>(path: string, body: unknown, onChunk: (text: string) => void): Promise<string> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new ApiError(res.status, (err && err.message) || 'AI 调用失败');
  }
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let raw = '';
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    raw += decoder.decode(value, { stream: true });
    buffer += decoder.decode(value, { stream: true });
    // 按行解析 SSE
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const j = JSON.parse(payload);
        const d = j.choices?.[0]?.delta;
        // 仅透出正文 content，忽略推理模型的 reasoning_content（深度思考过程）
        const content = d?.content ?? '';
        if (content) onChunk(content);
      } catch {
        // 忽略
      }
    }
  }
  return raw;
}
