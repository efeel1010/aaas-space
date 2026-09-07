import { useQuery } from '@tanstack/react-query';
import { adminApi } from '../lib/api';
import { Spinner } from '../components/ui';
import { Users, Building2, FileText, FolderKanban, ListChecks, CheckSquare, Bot, Flag, MessageSquare, Bell, Trash2 } from 'lucide-react';

const statCards = [
  { key: 'user_count', label: '用户', icon: Users },
  { key: 'team_count', label: '团队', icon: Building2 },
  { key: 'document_count', label: '文档', icon: FileText },
  { key: 'project_count', label: '项目', icon: FolderKanban },
  { key: 'requirement_count', label: '需求', icon: ListChecks },
  { key: 'task_count', label: '任务', icon: CheckSquare },
  { key: 'milestone_count', label: '里程碑', icon: Flag },
  { key: 'comment_count', label: '评论', icon: MessageSquare },
  { key: 'notification_count', label: '通知', icon: Bell },
  { key: 'ai_conversation_count', label: 'AI 会话', icon: Bot },
  { key: 'deleted_document_count', label: '回收站文档', icon: Trash2 },
  { key: 'deleted_project_count', label: '回收站项目', icon: Trash2 },
] as const;

export function Overview() {
  const { data, isLoading } = useQuery({ queryKey: ['admin-stats'], queryFn: () => adminApi.stats() });

  return (
    <div className="px-8 py-8">
      <h2 className="font-display text-20px font-700 text-ink">平台概览</h2>
      <p className="mt-1 text-13px text-muted">Pulse Space 平台的核心数据总览</p>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Spinner size={24} />
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
          {statCards.map((s) => (
            <div key={s.key} className="card p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-light text-violet">
                  <s.icon size={19} />
                </div>
                <div>
                  <p className="text-24px font-700 text-ink">{data?.[s.key] ?? 0}</p>
                  <p className="text-12px text-muted">{s.label}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}