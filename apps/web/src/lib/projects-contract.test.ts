import { describe, it, expect } from 'vitest';
import {
  Collaborator,
  CreateProjectRequest,
  UpdateProjectRequest,
  CreateRequirementRequest,
  UpdateRequirementRequest,
  CreateTaskRequest,
  UpdateTaskRequest,
  Project,
  Requirement,
  Task,
  MAX_COLLABORATORS,
} from '@pulse-space/contracts';

// 项目中心「时间 / 负责人 / 协作人」字段契约验证
describe('项目中心契约 - 时间/负责人/协作人新增字段', () => {
  // ===== Collaborator =====
  it('Collaborator 解析：name 必填，avatar_url 可空', () => {
    const withAvatar = Collaborator.parse({ user_id: 'u1', name: '张三', avatar_url: 'http://a.png' });
    const withoutAvatar = Collaborator.parse({ user_id: 'u2', name: '李四', avatar_url: null });
    expect(withAvatar.avatar_url).toBe('http://a.png');
    expect(withoutAvatar.avatar_url).toBeNull();
    expect(() => Collaborator.parse({ user_id: 'u3', name: '' })).toThrow();
  });

  // ===== DateTimeField =====
  it('DateTimeField 接受 ISO 字符串或 null', () => {
    expect(CreateProjectRequest.parse({ scope: 'personal', name: 'x', plan_start_at: null }).plan_start_at).toBeNull();
    expect(
      CreateProjectRequest.parse({ scope: 'personal', name: 'x', plan_end_at: '2026-09-01T00:00:00.000Z' }).plan_end_at,
    ).toBe('2026-09-01T00:00:00.000Z');
  });

  // ===== CreateProjectRequest =====
  it('CreateProjectRequest 携带全部时间字段与 collaborator_ids', () => {
    const parsed = CreateProjectRequest.parse({
      scope: 'personal',
      name: '项目A',
      plan_start_at: '2026-09-01T00:00:00.000Z',
      plan_end_at: '2026-12-31T00:00:00.000Z',
      actual_start_at: '2026-09-05T00:00:00.000Z',
      actual_end_at: null,
      collaborator_ids: ['u1', 'u2'],
    });
    expect(parsed.description).toBe(''); // 默认值
    expect(parsed.plan_start_at).toBe('2026-09-01T00:00:00.000Z');
    expect(parsed.actual_end_at).toBeNull();
    expect(parsed.collaborator_ids).toEqual(['u1', 'u2']);
  });

  it('CreateProjectRequest 协作人超过上限被拒绝', () => {
    const ids = Array.from({ length: MAX_COLLABORATORS + 1 }, (_, i) => `u${i}`);
    expect(() => CreateProjectRequest.parse({ scope: 'personal', name: 'x', collaborator_ids: ids })).toThrow();
  });

  // ===== UpdateProjectRequest =====
  it('UpdateProjectRequest 时间与协作人字段均可选（部分更新）', () => {
    const parsed = UpdateProjectRequest.parse({ plan_start_at: '2026-10-01T00:00:00.000Z', collaborator_ids: ['u1'] });
    expect(parsed.plan_start_at).toBe('2026-10-01T00:00:00.000Z');
    expect(parsed.name).toBeUndefined();
    expect(parsed.collaborator_ids).toEqual(['u1']);
  });

  // ===== Requirement =====
  it('Requirement 响应含 owner_id/owner_name 与四个时间字段', () => {
    const r = Requirement.parse({
      id: 'r1',
      project_id: 'p1',
      title: '需求',
      description: '',
      status: 'open',
      priority: 'high',
      owner_id: 'u1',
      owner_name: '张三',
      plan_start_at: '2026-09-01T00:00:00.000Z',
      plan_end_at: null,
      actual_start_at: null,
      actual_end_at: null,
      collaborators: [{ user_id: 'u2', name: '李四', avatar_url: null }],
      task_count: 0,
      done_task_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    expect(r.owner_id).toBe('u1');
    expect(r.owner_name).toBe('张三');
    expect(r.plan_start_at).toContain('2026-09-01');
    expect(r.collaborators).toHaveLength(1);
  });

  it('CreateRequirementRequest 负责人可空，时间字段可选', () => {
    const parsed = CreateRequirementRequest.parse({
      project_id: 'p1',
      title: '需求',
      owner_id: null,
      plan_start_at: '2026-09-01T00:00:00.000Z',
    });
    expect(parsed.owner_id).toBeNull();
    expect(parsed.priority).toBe('medium'); // 默认值
    expect(parsed.plan_start_at).toContain('2026-09-01');
  });

  it('CreateRequirementRequest.project_id 可选（由路径参数提供，修复 400）', () => {
    // AI/批量创建场景：body 不含 project_id，走路径 /projects/:id/requirements
    const parsed = CreateRequirementRequest.parse({ title: 'AI 生成的需求', priority: 'high' });
    expect(parsed.project_id).toBeUndefined();
    expect(parsed.priority).toBe('high');
  });

  it('UpdateRequirementRequest owner_id 支持置空', () => {
    expect(UpdateRequirementRequest.parse({ owner_id: null }).owner_id).toBeNull();
  });

  // ===== Task =====
  it('Task 响应含 assignee 与四个时间字段', () => {
    const t = Task.parse({
      id: 't1',
      requirement_id: 'r1',
      title: '任务',
      description: '',
      status: 'todo',
      priority: 'medium',
      assignee_id: 'u1',
      assignee_name: '张三',
      owner_name: '张三',
      due_date: '2026-09-10T00:00:00.000Z',
      plan_start_at: '2026-09-01T00:00:00.000Z',
      plan_end_at: '2026-09-05T00:00:00.000Z',
      actual_start_at: null,
      actual_end_at: null,
      collaborators: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    expect(t.plan_start_at).toContain('2026-09-01');
    expect(t.actual_start_at).toBeNull();
    expect(t.collaborators).toEqual([]);
  });

  it('CreateTaskRequest 携带 assignee_id 与四个时间字段', () => {
    const parsed = CreateTaskRequest.parse({
      requirement_id: 'r1',
      title: '任务',
      assignee_id: 'u1',
      plan_start_at: '2026-09-01T00:00:00.000Z',
      plan_end_at: '2026-09-05T00:00:00.000Z',
      collaborator_ids: ['u2', 'u3'],
    });
    expect(parsed.assignee_id).toBe('u1');
    expect(parsed.collaborator_ids).toEqual(['u2', 'u3']);
  });

  it('CreateTaskRequest.requirement_id 可选（由路径参数提供，修复 400）', () => {
    // AI/批量创建场景：body 不含 requirement_id，走路径 /projects/requirements/:id/tasks
    const parsed = CreateTaskRequest.parse({ title: 'AI 生成的任务', priority: 'medium' });
    expect(parsed.requirement_id).toBeUndefined();
    expect(parsed.priority).toBe('medium');
  });

  it('UpdateTaskRequest assignee_id 支持置空，字段均可选', () => {
    const parsed = UpdateTaskRequest.parse({ assignee_id: null, due_date: null, plan_start_at: null });
    expect(parsed.assignee_id).toBeNull();
    expect(parsed.due_date).toBeNull();
    expect(parsed.plan_start_at).toBeNull();
  });

  // ===== 响应模型必须强制携带新字段（缺字段即解析失败） =====
  it('Project 响应缺新字段解析失败（契约严格）', () => {
    const base = {
      id: 'p1',
      team_id: null,
      owner_id: 'u1',
      owner_name: '张三',
      name: '项目',
      description: '',
      status: 'planning',
      requirement_count: 0,
      task_count: 0,
      done_task_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    // 缺 plan_start_at / collaborators 时应失败
    expect(() => Project.parse(base)).toThrow();
  });
});