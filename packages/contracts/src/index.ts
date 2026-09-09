import { z } from 'zod';

// ===== 统一响应封装 =====
export const ApiResponse = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    code: z.number(),
    message: z.string(),
    data: dataSchema.optional(),
    timestamp: z.string(),
  });

// ===== 用户（公开） =====
export const UserPublic = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  avatar_url: z.string().nullable(),
  is_admin: z.boolean(),
  created_at: z.string(),
});
export type UserPublic = z.infer<typeof UserPublic>;

// ===== 注册 / 登录 =====
export const RegisterRequest = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(50),
  password: z.string().min(6).max(64),
});
export type RegisterRequest = z.infer<typeof RegisterRequest>;

export const LoginRequest = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(64),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

// ===== 会话 =====
export const SessionInfo = z.object({
  user: UserPublic,
  expires_at: z.string(),
});
export type SessionInfo = z.infer<typeof SessionInfo>;

// ===== 团队 =====
export const TeamRole = z.enum(['owner', 'admin', 'member']);
export type TeamRole = z.infer<typeof TeamRole>;

export const Team = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  owner_id: z.string(),
  member_count: z.number(),
  my_role: TeamRole.nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Team = z.infer<typeof Team>;

export const TeamMember = z.object({
  user_id: z.string(),
  email: z.string(),
  name: z.string(),
  avatar_url: z.string().nullable(),
  role: TeamRole,
  joined_at: z.string(),
});
export type TeamMember = z.infer<typeof TeamMember>;

export const TeamDetail = Team.extend({
  members: z.array(TeamMember),
});
export type TeamDetail = z.infer<typeof TeamDetail>;

export const CreateTeamRequest = z.object({
  name: z.string().min(1).max(60),
  description: z.string().max(500).optional().default(''),
});
export type CreateTeamRequest = z.infer<typeof CreateTeamRequest>;

export const AddMemberRequest = z.object({
  email: z.string().email(),
  role: TeamRole.optional().default('member'),
});
export type AddMemberRequest = z.infer<typeof AddMemberRequest>;

// ===== 文档 / 知识库 / 表格 =====
export const DocKind = z.enum(['doc', 'wiki', 'sheet']);
export type DocKind = z.infer<typeof DocKind>;

// ==== 文档权限 =====
export const DocVisibility = z.enum(['private', 'team', 'public']);
export type DocVisibility = z.infer<typeof DocVisibility>;
export const DocBasePermission = z.enum(['read', 'edit']);
export type DocBasePermission = z.infer<typeof DocBasePermission>;
export const EffectivePermission = z.enum(['none', 'read', 'edit', 'manage']);
export type EffectivePermission = z.infer<typeof EffectivePermission>;
export const DocAccessPermission = z.enum(['read', 'edit', 'manage']);
export type DocAccessPermission = z.infer<typeof DocAccessPermission>;

export const Document = z.object({
  id: z.string(),
  team_id: z.string().nullable(),
  owner_id: z.string(),
  owner_name: z.string().nullable(),
  parent_id: z.string().nullable(),
  is_folder: z.boolean(),
  kind: DocKind,
  title: z.string(),
  content: z.string(),
  icon: z.string().nullable(),
  cover: z.string().nullable(),
  last_viewed_at: z.string().nullable(),
  is_favorite: z.boolean(),
  visibility: DocVisibility,
  base_permission: DocBasePermission,
  effective_permission: EffectivePermission,
  created_at: z.string(),
  updated_at: z.string(),
});
export type Document = z.infer<typeof Document>;

export const RecentDocsTab = z.enum(['viewed', 'created', 'favorite']);
export type RecentDocsTab = z.infer<typeof RecentDocsTab>;

export const CreateDocRequest = z.object({
  scope: z.enum(['personal', 'team']),
  team_id: z.string().optional(),
  kind: DocKind,
  parent_id: z.string().optional(),
  is_folder: z.boolean().optional().default(false),
  title: z.string().min(1).max(200).default('未命名文档'),
  content: z.string().optional().default(''),
  icon: z.string().optional(),
  cover: z.string().optional(),
  visibility: DocVisibility.optional(),
  base_permission: DocBasePermission.optional(),
});
export type CreateDocRequest = z.infer<typeof CreateDocRequest>;

export const UpdateDocRequest = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().optional(),
  parent_id: z.string().nullable().optional(),
  is_folder: z.boolean().optional(),
  icon: z.string().nullable().optional(),
  cover: z.string().nullable().optional(),
  visibility: DocVisibility.optional(),
  base_permission: DocBasePermission.optional(),
});
export type UpdateDocRequest = z.infer<typeof UpdateDocRequest>;

// ===== 文档逐成员授权 =====
export const DocumentAccessItem = z.object({
  user_id: z.string(),
  name: z.string(),
  email: z.string(),
  avatar_url: z.string().nullable(),
  permission: DocAccessPermission,
  team_role: TeamRole.nullable(),
});
export type DocumentAccessItem = z.infer<typeof DocumentAccessItem>;

export const SetDocAccessRequest = z.object({
  user_id: z.string(),
  permission: DocAccessPermission,
});
export type SetDocAccessRequest = z.infer<typeof SetDocAccessRequest>;

// ===== 文档版本历史 =====
export const DocumentVersion = z.object({
  id: z.string(),
  doc_id: z.string(),
  created_by: z.string().nullable(),
  created_by_name: z.string().nullable(),
  title: z.string(),
  content: z.string(),
  note: z.string().nullable(),
  created_at: z.string(),
});
export type DocumentVersion = z.infer<typeof DocumentVersion>;

export const CreateVersionRequest = z.object({
  note: z.string().max(200).optional(),
});
export type CreateVersionRequest = z.infer<typeof CreateVersionRequest>;

// ===== 文档评论 =====
export const DocumentComment = z.object({
  id: z.string(),
  doc_id: z.string(),
  user_id: z.string(),
  user_name: z.string(),
  user_email: z.string(),
  avatar_url: z.string().nullable(),
  content: z.string(),
  selection_start: z.number(),
  selection_text: z.string(),
  resolved: z.boolean(),
  created_at: z.string(),
});
export type DocumentComment = z.infer<typeof DocumentComment>;

export const CreateCommentRequest = z.object({
  content: z.string().min(1).max(2000),
  selection_start: z.number().int().min(0).optional().default(0),
  selection_text: z.string().max(1000).optional().default(''),
});
export type CreateCommentRequest = z.infer<typeof CreateCommentRequest>;

// ===== 协作人（关联系统用户）=====
export const Collaborator = z.object({
  user_id: z.string(),
  name: z.string(),
  avatar_url: z.string().nullable(),
});
export type Collaborator = z.infer<typeof Collaborator>;

// 可空的 datetime 字符串（ISO），用于计划/实际开始结束时间
export const DateTimeField = z.string().nullable();

// 协作人最大数量上限
export const MAX_COLLABORATORS = 20;

// ===== 项目 =====
export const ProjectStatus = z.enum(['planning', 'active', 'paused', 'completed', 'archived']);
export type ProjectStatus = z.infer<typeof ProjectStatus>;

export const Project = z.object({
  id: z.string(),
  team_id: z.string().nullable(),
  owner_id: z.string(),
  owner_name: z.string().nullable(),
  name: z.string(),
  description: z.string(),
  status: ProjectStatus,
  plan_start_at: DateTimeField,
  plan_end_at: DateTimeField,
  actual_start_at: DateTimeField,
  actual_end_at: DateTimeField,
  collaborators: z.array(Collaborator),
  requirement_count: z.number(),
  task_count: z.number(),
  done_task_count: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Project = z.infer<typeof Project>;

export const CreateProjectRequest = z.object({
  scope: z.enum(['personal', 'team']),
  team_id: z.string().optional(),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional().default(''),
  plan_start_at: DateTimeField.optional(),
  plan_end_at: DateTimeField.optional(),
  actual_start_at: DateTimeField.optional(),
  actual_end_at: DateTimeField.optional(),
  collaborator_ids: z.array(z.string()).max(MAX_COLLABORATORS).optional(),
});
export type CreateProjectRequest = z.infer<typeof CreateProjectRequest>;

export const UpdateProjectRequest = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).optional(),
  status: ProjectStatus.optional(),
  plan_start_at: DateTimeField.optional(),
  plan_end_at: DateTimeField.optional(),
  actual_start_at: DateTimeField.optional(),
  actual_end_at: DateTimeField.optional(),
  collaborator_ids: z.array(z.string()).max(MAX_COLLABORATORS).optional(),
});
export type UpdateProjectRequest = z.infer<typeof UpdateProjectRequest>;

// ===== 需求 =====
export const RequirementStatus = z.enum(['open', 'in_progress', 'done', 'cancelled']);
export type RequirementStatus = z.infer<typeof RequirementStatus>;

export const Requirement = z.object({
  id: z.string(),
  project_id: z.string(),
  title: z.string(),
  description: z.string(),
  status: RequirementStatus,
  priority: z.string(),
  owner_id: z.string().nullable(),
  owner_name: z.string().nullable(),
  milestone_id: z.string().nullable(),
  milestone_name: z.string().nullable(),
  plan_start_at: DateTimeField,
  plan_end_at: DateTimeField,
  actual_start_at: DateTimeField,
  actual_end_at: DateTimeField,
  collaborators: z.array(Collaborator),
  task_count: z.number(),
  done_task_count: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Requirement = z.infer<typeof Requirement>;

export const CreateRequirementRequest = z.object({
  project_id: z.string().optional(),
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional().default(''),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional().default('medium'),
  owner_id: z.string().nullable().optional(),
  milestone_id: z.string().nullable().optional(),
  plan_start_at: DateTimeField.optional(),
  plan_end_at: DateTimeField.optional(),
  actual_start_at: DateTimeField.optional(),
  actual_end_at: DateTimeField.optional(),
  collaborator_ids: z.array(z.string()).max(MAX_COLLABORATORS).optional(),
});
export type CreateRequirementRequest = z.infer<typeof CreateRequirementRequest>;

export const UpdateRequirementRequest = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  status: RequirementStatus.optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  owner_id: z.string().nullable().optional(),
  milestone_id: z.string().nullable().optional(),
  plan_start_at: DateTimeField.optional(),
  plan_end_at: DateTimeField.optional(),
  actual_start_at: DateTimeField.optional(),
  actual_end_at: DateTimeField.optional(),
  collaborator_ids: z.array(z.string()).max(MAX_COLLABORATORS).optional(),
});
export type UpdateRequirementRequest = z.infer<typeof UpdateRequirementRequest>;

// ===== 任务 =====
export const TaskStatus = z.enum(['todo', 'doing', 'review', 'done']);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const Task = z.object({
  id: z.string(),
  requirement_id: z.string(),
  requirement_title: z.string().nullable(),
  milestone_id: z.string().nullable(),
  milestone_name: z.string().nullable(),
  title: z.string(),
  description: z.string(),
  status: TaskStatus,
  priority: z.string(),
  assignee_id: z.string().nullable(),
  assignee_name: z.string().nullable(),
  owner_name: z.string().nullable(),
  due_date: z.string().nullable(),
  plan_start_at: DateTimeField,
  plan_end_at: DateTimeField,
  actual_start_at: DateTimeField,
  actual_end_at: DateTimeField,
  collaborators: z.array(Collaborator),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Task = z.infer<typeof Task>;

export const CreateTaskRequest = z.object({
  requirement_id: z.string().optional(),
  title: z.string().min(1).max(300),
  description: z.string().max(5000).optional().default(''),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional().default('medium'),
  assignee_id: z.string().optional(),
  milestone_id: z.string().nullable().optional(),
  due_date: z.string().optional(),
  plan_start_at: DateTimeField.optional(),
  plan_end_at: DateTimeField.optional(),
  actual_start_at: DateTimeField.optional(),
  actual_end_at: DateTimeField.optional(),
  collaborator_ids: z.array(z.string()).max(MAX_COLLABORATORS).optional(),
});
export type CreateTaskRequest = z.infer<typeof CreateTaskRequest>;

export const UpdateTaskRequest = z.object({
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(5000).optional(),
  status: TaskStatus.optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  assignee_id: z.string().nullable().optional(),
  milestone_id: z.string().nullable().optional(),
  due_date: z.string().nullable().optional(),
  plan_start_at: DateTimeField.optional(),
  plan_end_at: DateTimeField.optional(),
  actual_start_at: DateTimeField.optional(),
  actual_end_at: DateTimeField.optional(),
  collaborator_ids: z.array(z.string()).max(MAX_COLLABORATORS).optional(),
});
export type UpdateTaskRequest = z.infer<typeof UpdateTaskRequest>;

// ===== AI =====
export const AiMessage = z.object({
  id: z.string(),
  conversation_id: z.string(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  created_at: z.string(),
});
export type AiMessage = z.infer<typeof AiMessage>;

export const AiConversation = z.object({
  id: z.string(),
  title: z.string(),
  team_id: z.string().nullable(),
  message_count: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type AiConversation = z.infer<typeof AiConversation>;

export const AiChatRequest = z.object({
  conversation_id: z.string().optional(),
  message: z.string().min(1).max(8000),
  context: z.string().max(20000).optional(),
});
export type AiChatRequest = z.infer<typeof AiChatRequest>;

export const AiDocAction = z.enum(['generate', 'continue', 'polish', 'summarize']);
export type AiDocAction = z.infer<typeof AiDocAction>;

export const AiDocRequest = z.object({
  action: AiDocAction,
  title: z.string().optional(),
  content: z.string().optional().default(''),
});
export type AiDocRequest = z.infer<typeof AiDocRequest>;

export const AiBreakdownRequest = z.object({
  project_name: z.string().min(1).max(120),
  requirement: z.string().min(1).max(5000),
});
export type AiBreakdownRequest = z.infer<typeof AiBreakdownRequest>;

export const AiTranslateRequest = z.object({
  text: z.string().min(1).max(20000),
  target_lang: z.string().min(1).max(20).default('英语'),
  mode: z.enum(['full', 'fragment']).default('fragment'),
});
export type AiTranslateRequest = z.infer<typeof AiTranslateRequest>;

export const AiTranslateResult = z.object({
  translated: z.string(),
  target_lang: z.string(),
});
export type AiTranslateResult = z.infer<typeof AiTranslateResult>;

export const AiBreakdownItem = z.object({
  title: z.string(),
  description: z.string(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
});
export type AiBreakdownItem = z.infer<typeof AiBreakdownItem>;

export const AiBreakdownResponse = z.object({
  tasks: z.array(AiBreakdownItem),
});
export type AiBreakdownResponse = z.infer<typeof AiBreakdownResponse>;

// ===== AI 整理文件到文件夹 =====
export const AiOrganizeFileInput = z.object({
  name: z.string().min(1).max(200),
  content: z.string().max(20000).default(''),
});
export type AiOrganizeFileInput = z.infer<typeof AiOrganizeFileInput>;

type AiOrganizeNodeShape = {
  name: string;
  type: 'folder' | 'file';
  children?: AiOrganizeNodeShape[];
};
export const AiOrganizeNode: z.ZodType<AiOrganizeNodeShape> = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(['folder', 'file']),
  children: z.array(z.lazy(() => AiOrganizeNode)).optional(),
});
export type AiOrganizeNode = z.infer<typeof AiOrganizeNode>;

export const AiOrganizeRequest = z.object({
  scope: z.enum(['personal', 'team']),
  team_id: z.string().optional(),
  parent_id: z.string().optional(),
  files: z.array(AiOrganizeFileInput).min(1).max(10),
});
export type AiOrganizeRequest = z.infer<typeof AiOrganizeRequest>;

export const AiOrganizeResult = z.object({
  tree: z.array(AiOrganizeNode),
});
export type AiOrganizeResult = z.infer<typeof AiOrganizeResult>;

// ===== AI 生成需求 / 生成任务（非流式 JSON） =====
export const AiGenRequirementItem = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).default(''),
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
});
export type AiGenRequirementItem = z.infer<typeof AiGenRequirementItem>;

export const AiGenRequirementsRequest = z.object({
  project_name: z.string().min(1).max(120),
  project_description: z.string().max(5000).optional().default(''),
  request: z.string().min(1).max(5000),
});
export type AiGenRequirementsRequest = z.infer<typeof AiGenRequirementsRequest>;

export const AiGenRequirementsResult = z.object({
  requirements: z.array(AiGenRequirementItem),
});
export type AiGenRequirementsResult = z.infer<typeof AiGenRequirementsResult>;

export const AiGenTaskItem = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(5000).default(''),
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
});
export type AiGenTaskItem = z.infer<typeof AiGenTaskItem>;

export const AiGenTasksRequest = z.object({
  requirement_title: z.string().min(1).max(200),
  requirement_description: z.string().max(5000).optional().default(''),
  request: z.string().min(1).max(5000),
});
export type AiGenTasksRequest = z.infer<typeof AiGenTasksRequest>;

export const AiGenTasksResult = z.object({
  tasks: z.array(AiGenTaskItem),
});
export type AiGenTasksResult = z.infer<typeof AiGenTasksResult>;

// ===== 管理端（platform）契约 =====

export const AdminStats = z.object({
  user_count: z.number(),
  team_count: z.number(),
  document_count: z.number(),
  project_count: z.number(),
  requirement_count: z.number(),
  task_count: z.number(),
  ai_conversation_count: z.number(),
  milestone_count: z.number(),
  comment_count: z.number(),
  notification_count: z.number(),
  deleted_document_count: z.number(),
  deleted_project_count: z.number(),
});
export type AdminStats = z.infer<typeof AdminStats>;

export const AdminUser = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  avatar_url: z.string().nullable(),
  is_admin: z.boolean(),
  created_at: z.string(),
});
export type AdminUser = z.infer<typeof AdminUser>;

export const AdminTeam = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  owner_id: z.string(),
  owner_name: z.string(),
  member_count: z.number(),
  created_at: z.string(),
});
export type AdminTeam = z.infer<typeof AdminTeam>;

export const AdminDocument = z.object({
  id: z.string(),
  title: z.string(),
  kind: DocKind,
  owner_id: z.string(),
  owner_name: z.string().nullable(),
  team_id: z.string().nullable(),
  is_folder: z.boolean(),
  visibility: DocVisibility,
  base_permission: DocBasePermission,
  deleted_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type AdminDocument = z.infer<typeof AdminDocument>;

export const AdminProject = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  status: ProjectStatus,
  owner_id: z.string(),
  owner_name: z.string().nullable(),
  team_id: z.string().nullable(),
  deleted_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type AdminProject = z.infer<typeof AdminProject>;

// 管理端评论审计
export const AdminComment = z.object({
  id: z.string(),
  target_type: z.enum(['requirement', 'task']),
  target_id: z.string(),
  content: z.string(),
  created_at: z.string(),
  user_id: z.string(),
  user_name: z.string(),
  user_email: z.string(),
});
export type AdminComment = z.infer<typeof AdminComment>;

export const AdminSetUserRequest = z.object({
  is_admin: z.boolean(),
});
export type AdminSetUserRequest = z.infer<typeof AdminSetUserRequest>;

// ===== 知识库树引用（面包屑 / 祖先链）=====
export const WikiRef = z.object({
  id: z.string(),
  title: z.string(),
  parent_id: z.string().nullable(),
});
export type WikiRef = z.infer<typeof WikiRef>;

// ===== 知识库目录节点（概览 / 搜索 / 移动目标选择）=====
export const WikiTocItem = z.object({
  id: z.string(),
  title: z.string(),
  parent_id: z.string().nullable(),
  updated_at: z.string(),
  visibility: DocVisibility,
  effective_permission: EffectivePermission,
});
export type WikiTocItem = z.infer<typeof WikiTocItem>;

// ===== 里程碑 =====
export const Milestone = z.object({
  id: z.string(),
  project_id: z.string(),
  title: z.string(),
  description: z.string(),
  due_date: z.string().nullable(),
  completed_at: z.string().nullable(),
  requirement_count: z.number(),
  task_count: z.number(),
  created_at: z.string(),
});
export type Milestone = z.infer<typeof Milestone>;

export const CreateMilestoneRequest = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional().default(''),
  due_date: z.string().nullable().optional(),
});
export type CreateMilestoneRequest = z.infer<typeof CreateMilestoneRequest>;

export const UpdateMilestoneRequest = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  due_date: z.string().nullable().optional(),
});
export type UpdateMilestoneRequest = z.infer<typeof UpdateMilestoneRequest>;

// ===== 项目评论（需求 / 任务） =====
export const CommentTargetType = z.enum(['requirement', 'task']);
export type CommentTargetType = z.infer<typeof CommentTargetType>;

export const ProjectComment = z.object({
  id: z.string(),
  target_type: CommentTargetType,
  target_id: z.string(),
  user_id: z.string(),
  user_name: z.string(),
  avatar_url: z.string().nullable(),
  content: z.string(),
  created_at: z.string(),
});
export type ProjectComment = z.infer<typeof ProjectComment>;

export const CreateProjectCommentRequest = z.object({
  target_type: CommentTargetType,
  target_id: z.string().min(1),
  content: z.string().min(1).max(2000),
});
export type CreateProjectCommentRequest = z.infer<typeof CreateProjectCommentRequest>;

// ===== 首页工作台 =====
export const MyTodoTask = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  priority: z.string(),
  due_date: z.string().nullable(),
  project_id: z.string(),
  project_name: z.string(),
  requirement_id: z.string(),
  requirement_title: z.string(),
});
export type MyTodoTask = z.infer<typeof MyTodoTask>;

export const MyTodoMilestone = z.object({
  id: z.string(),
  title: z.string(),
  due_date: z.string().nullable(),
  project_id: z.string(),
  project_name: z.string(),
});
export type MyTodoMilestone = z.infer<typeof MyTodoMilestone>;

export const MyTodos = z.object({
  tasks: z.array(MyTodoTask),
  milestones: z.array(MyTodoMilestone),
});
export type MyTodos = z.infer<typeof MyTodos>;

export const SearchDocItem = Document.extend({ snippet: z.string() });
export type SearchDocItem = z.infer<typeof SearchDocItem>;

export const SearchResult = z.object({
  documents: z.array(SearchDocItem),
  projects: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      status: ProjectStatus,
      updated_at: z.string(),
    }),
  ),
});
export type SearchResult = z.infer<typeof SearchResult>;

// ===== 通知中心 =====
export const Notification = z.object({
  id: z.string(),
  type: z.enum(['comment', 'task_assigned', 'doc_comment', 'mention']),
  title: z.string(),
  content: z.string(),
  link: z.string().nullable(),
  read_at: z.string().nullable(),
  created_at: z.string(),
});
export type Notification = z.infer<typeof Notification>;

export const NotificationList = z.object({
  list: z.array(Notification),
  unread_count: z.number(),
});
export type NotificationList = z.infer<typeof NotificationList>;

// ===== 回收站 =====
export const TrashDocItem = z.object({
  id: z.string(),
  title: z.string(),
  kind: DocKind,
  is_folder: z.boolean(),
  deleted_at: z.string(),
});
export type TrashDocItem = z.infer<typeof TrashDocItem>;

export const TrashProjectItem = z.object({
  id: z.string(),
  name: z.string(),
  deleted_at: z.string(),
});
export type TrashProjectItem = z.infer<typeof TrashProjectItem>;

// ===== 文档模板 =====
export const DocTemplate = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  kind: DocKind,
  created_at: z.string(),
});
export type DocTemplate = z.infer<typeof DocTemplate>;
