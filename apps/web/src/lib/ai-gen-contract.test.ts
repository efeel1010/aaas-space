import { describe, it, expect } from 'vitest';
import {
  AiGenRequirementsRequest,
  AiGenRequirementsResult,
  AiGenTasksRequest,
  AiGenTasksResult,
} from '@pulse-space/contracts';

// AI 生成需求 / 生成任务 契约验证
describe('AI 生成契约', () => {
  // ===== AiGenRequirementsRequest =====
  it('AiGenRequirementsRequest：project_description 可缺省带默认空串', () => {
    const parsed = AiGenRequirementsRequest.parse({
      project_name: 'Pulse',
      request: '补充上线里程碑需求',
    });
    expect(parsed.project_description).toBe('');
    expect(parsed.request).toBe('补充上线里程碑需求');
  });

  it('AiGenRequirementsRequest 缺 project_name / request 被拒绝', () => {
    expect(() => AiGenRequirementsRequest.parse({ request: 'x' })).toThrow();
    expect(() => AiGenRequirementsRequest.parse({ project_name: 'Pulse' })).toThrow();
  });

  // ===== AiGenRequirementsResult =====
  it('AiGenRequirementsResult：requirements 数组项含 title/description/priority 枚举', () => {
    const res = AiGenRequirementsResult.parse({
      requirements: [
        { title: '登录注册', description: '支持邮箱注册', priority: 'high' },
        { title: '看板', priority: 'medium' },
      ],
    });
    expect(res.requirements).toHaveLength(2);
    expect(res.requirements[0].priority).toBe('high');
    expect(res.requirements[1].description).toBe('');
  });

  it('AiGenRequirementsResult priority 非法值被拒绝', () => {
    const bad = () => AiGenRequirementsResult.parse({ requirements: [{ title: 't', priority: 'critical' }] });
    expect(bad).toThrow();
  });

  // ===== AiGenTasksRequest =====
  it('AiGenTasksRequest：requirement_description 可缺省，request 必填', () => {
    const parsed = AiGenTasksRequest.parse({
      requirement_title: '在线文档协作',
      request: '拆解为可并行任务',
    });
    expect(parsed.requirement_description).toBe('');
    expect(() => AiGenTasksRequest.parse({ requirement_title: 't' })).toThrow();
  });

  // ===== AiGenTasksResult =====
  it('AiGenTasksResult：tasks 数组项校验通过', () => {
    const res = AiGenTasksResult.parse({
      tasks: [{ title: '设计数据结构', description: '任务表字段', priority: 'urgent' }],
    });
    expect(res.tasks[0].priority).toBe('urgent');
  });
});