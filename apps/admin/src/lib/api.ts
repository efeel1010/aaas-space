import type {
  UserPublic,
  AdminStats,
  AdminUser,
  AdminTeam,
  AdminDocument,
  AdminProject,
  AdminComment,
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
    throw new ApiError(res.status, msg);
  }
  return (body as { data: T }).data;
}

// ===== 认证 =====
export const authApi = {
  login: (email: string, password: string) =>
    request<{ user: UserPublic; expires_at: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request<null>('/auth/logout', { method: 'POST' }),
  session: () => request<{ user: UserPublic }>('/auth/session'),
};

// ===== 管理端 =====
const q = (value?: string) => (value ? `?q=${encodeURIComponent(value)}` : '');

export const adminApi = {
  stats: () => request<AdminStats>('/admin/stats'),
  users: (query?: string) => request<AdminUser[]>(`/admin/users${q(query)}`),
  setUserAdmin: (id: string, is_admin: boolean) =>
    request<null>(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify({ is_admin }) }),
  removeUser: (id: string) => request<null>(`/admin/users/${id}`, { method: 'DELETE' }),
  teams: (query?: string) => request<AdminTeam[]>(`/admin/teams${q(query)}`),
  removeTeam: (id: string) => request<null>(`/admin/teams/${id}`, { method: 'DELETE' }),
  documents: (query?: string) => request<AdminDocument[]>(`/admin/documents${q(query)}`),
  removeDocument: (id: string) => request<null>(`/admin/documents/${id}`, { method: 'DELETE' }),
  projects: (query?: string) => request<AdminProject[]>(`/admin/projects${q(query)}`),
  removeProject: (id: string) => request<null>(`/admin/projects/${id}`, { method: 'DELETE' }),
  comments: (query?: string) => request<AdminComment[]>(`/admin/comments${q(query)}`),
  removeComment: (id: string) => request<null>(`/admin/comments/${id}`, { method: 'DELETE' }),
};