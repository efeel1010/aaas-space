import { pgTable, uuid, varchar, timestamp, text, boolean, pgEnum, integer, primaryKey } from 'drizzle-orm/pg-core';

// ===== 枚举 =====
export const teamRoleEnum = pgEnum('team_role', ['owner', 'admin', 'member']);
export const docKindEnum = pgEnum('doc_kind', ['doc', 'wiki', 'sheet']);
export const projectStatusEnum = pgEnum('project_status', [
  'planning',
  'active',
  'paused',
  'completed',
  'archived',
]);
export const requirementStatusEnum = pgEnum('requirement_status', [
  'open',
  'in_progress',
  'done',
  'cancelled',
]);
export const taskStatusEnum = pgEnum('task_status', ['todo', 'doing', 'review', 'done']);
export const commentTargetEnum = pgEnum('comment_target', ['requirement', 'task']);
export const notificationTypeEnum = pgEnum('notification_type', ['comment', 'task_assigned', 'doc_comment', 'mention']);
export const sharePermissionEnum = pgEnum('share_permission', ['read', 'edit']);
export const aiRoleEnum = pgEnum('ai_role', ['user', 'assistant']);
export const docVisibilityEnum = pgEnum('doc_visibility', ['private', 'team', 'public']);
export const docBasePermEnum = pgEnum('doc_base_permission', ['read', 'edit']);
export const docAccessPermEnum = pgEnum('doc_access_permission', ['read', 'edit', 'manage']);

// ===== 用户 =====
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 200 }).notNull().unique(),
  password_hash: varchar('password_hash', { length: 256 }).notNull(),
  name: varchar('name', { length: 50 }).notNull(),
  avatar_url: varchar('avatar_url', { length: 500 }),
  is_admin: boolean('is_admin').notNull().default(false),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ===== 会话 =====
export const sessions = pgTable('sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  user_id: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  token: varchar('token', { length: 256 }).notNull().unique(),
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ===== 团队 =====
export const teams = pgTable('teams', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 60 }).notNull(),
  description: text('description').notNull().default(''),
  owner_id: uuid('owner_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const teamMembers = pgTable(
  'team_members',
  {
    team_id: uuid('team_id')
      .references(() => teams.id, { onDelete: 'cascade' })
      .notNull(),
    user_id: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    role: teamRoleEnum('role').notNull().default('member'),
    joined_at: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ name: 'team_members_pk', columns: [t.team_id, t.user_id] })],
);

// ===== 文档 / 知识库 =====
export const documents = pgTable('documents', {
  id: uuid('id').defaultRandom().primaryKey(),
  team_id: uuid('team_id').references(() => teams.id, { onDelete: 'cascade' }),
  owner_id: uuid('owner_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  parent_id: uuid('parent_id'),
  is_folder: boolean('is_folder').notNull().default(false),
  kind: docKindEnum('kind').notNull().default('doc'),
  title: varchar('title', { length: 200 }).notNull().default('未命名文档'),
  content: text('content').notNull().default(''),
  icon: varchar('icon', { length: 50 }),
  cover: varchar('cover', { length: 500 }),
  last_viewed_at: timestamp('last_viewed_at', { withTimezone: true }),
  visibility: docVisibilityEnum('visibility').notNull().default('private'),
  base_permission: docBasePermEnum('base_permission').notNull().default('edit'),
  deleted_at: timestamp('deleted_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ===== 文档分享链接 =====
export const documentShares = pgTable('document_shares', {
  id: uuid('id').defaultRandom().primaryKey(),
  doc_id: uuid('doc_id')
    .references(() => documents.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  token: uuid('token').defaultRandom().notNull().unique(),
  permission: sharePermissionEnum('permission').notNull().default('read'),
  created_by: uuid('created_by')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ===== 文档逐成员授权 =====
export const documentAccess = pgTable(
  'document_access',
  {
    doc_id: uuid('doc_id')
      .references(() => documents.id, { onDelete: 'cascade' })
      .notNull(),
    user_id: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    permission: docAccessPermEnum('permission').notNull().default('read'),
    granted_by: uuid('granted_by').references(() => users.id, { onDelete: 'set null' }),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [{ pk: { name: 'document_access_pk', columns: [t.doc_id, t.user_id] } }],
);

// ===== 文档模板 =====
export const docTemplates = pgTable('doc_templates', {
  id: uuid('id').defaultRandom().primaryKey(),
  owner_id: uuid('owner_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  title: varchar('title', { length: 200 }).notNull(),
  content: text('content').notNull().default(''),
  kind: docKindEnum('kind').notNull().default('doc'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ===== 文档版本历史 =====
export const documentVersions = pgTable('document_versions', {
  id: uuid('id').defaultRandom().primaryKey(),
  doc_id: uuid('doc_id')
    .references(() => documents.id, { onDelete: 'cascade' })
    .notNull(),
  created_by: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  title: varchar('title', { length: 200 }).notNull(),
  content: text('content').notNull(),
  note: varchar('note', { length: 200 }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ===== 文档评论 =====
export const documentComments = pgTable('document_comments', {
  id: uuid('id').defaultRandom().primaryKey(),
  doc_id: uuid('doc_id')
    .references(() => documents.id, { onDelete: 'cascade' })
    .notNull(),
  user_id: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  content: text('content').notNull(),
  selection_start: integer('selection_start').notNull().default(0),
  selection_text: text('selection_text').notNull().default(''),
  resolved: boolean('resolved').notNull().default(false),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ===== 文档收藏 =====
export const documentFavorites = pgTable(
  'document_favorites',
  {
    doc_id: uuid('doc_id')
      .references(() => documents.id, { onDelete: 'cascade' })
      .notNull(),
    user_id: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ name: 'document_favorites_pk', columns: [t.doc_id, t.user_id] })],
);

// ===== 项目 =====
export const projects = pgTable('projects', {
  id: uuid('id').defaultRandom().primaryKey(),
  team_id: uuid('team_id').references(() => teams.id, { onDelete: 'cascade' }),
  owner_id: uuid('owner_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  name: varchar('name', { length: 120 }).notNull(),
  description: text('description').notNull().default(''),
  status: projectStatusEnum('status').notNull().default('planning'),
  plan_start_at: timestamp('plan_start_at', { withTimezone: true }),
  plan_end_at: timestamp('plan_end_at', { withTimezone: true }),
  actual_start_at: timestamp('actual_start_at', { withTimezone: true }),
  actual_end_at: timestamp('actual_end_at', { withTimezone: true }),
  deleted_at: timestamp('deleted_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ===== 需求 =====
export const requirements = pgTable('requirements', {
  id: uuid('id').defaultRandom().primaryKey(),
  project_id: uuid('project_id')
    .references(() => projects.id, { onDelete: 'cascade' })
    .notNull(),
  title: varchar('title', { length: 200 }).notNull(),
  description: text('description').notNull().default(''),
  status: requirementStatusEnum('status').notNull().default('open'),
  priority: varchar('priority', { length: 10 }).notNull().default('medium'),
  owner_id: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
  milestone_id: uuid('milestone_id').references(() => milestones.id, { onDelete: 'set null' }),
  plan_start_at: timestamp('plan_start_at', { withTimezone: true }),
  plan_end_at: timestamp('plan_end_at', { withTimezone: true }),
  actual_start_at: timestamp('actual_start_at', { withTimezone: true }),
  actual_end_at: timestamp('actual_end_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ===== 任务 =====
export const tasks = pgTable('tasks', {
  id: uuid('id').defaultRandom().primaryKey(),
  requirement_id: uuid('requirement_id')
    .references(() => requirements.id, { onDelete: 'cascade' })
    .notNull(),
  title: varchar('title', { length: 300 }).notNull(),
  description: text('description').notNull().default(''),
  status: taskStatusEnum('status').notNull().default('todo'),
  priority: varchar('priority', { length: 10 }).notNull().default('medium'),
  assignee_id: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
  milestone_id: uuid('milestone_id').references(() => milestones.id, { onDelete: 'set null' }),
  due_date: timestamp('due_date', { withTimezone: true }),
  plan_start_at: timestamp('plan_start_at', { withTimezone: true }),
  plan_end_at: timestamp('plan_end_at', { withTimezone: true }),
  actual_start_at: timestamp('actual_start_at', { withTimezone: true }),
  actual_end_at: timestamp('actual_end_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ===== 里程碑 =====
export const milestones = pgTable('milestones', {
  id: uuid('id').defaultRandom().primaryKey(),
  project_id: uuid('project_id')
    .references(() => projects.id, { onDelete: 'cascade' })
    .notNull(),
  title: varchar('title', { length: 200 }).notNull(),
  description: text('description').notNull().default(''),
  due_date: timestamp('due_date', { withTimezone: true }),
  completed_at: timestamp('completed_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ===== 项目评论（需求 / 任务，多态目标） =====
export const projectComments = pgTable('project_comments', {
  id: uuid('id').defaultRandom().primaryKey(),
  target_type: commentTargetEnum('target_type').notNull(),
  target_id: uuid('target_id').notNull(),
  user_id: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  content: text('content').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ===== 通知中心 =====
export const notifications = pgTable('notifications', {
  id: uuid('id').defaultRandom().primaryKey(),
  user_id: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  type: notificationTypeEnum('type').notNull(),
  title: varchar('title', { length: 200 }).notNull(),
  content: text('content').notNull().default(''),
  link: varchar('link', { length: 500 }),
  read_at: timestamp('read_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ===== 协作人（多对多，关联系统用户） =====
export const projectCollaborators = pgTable(
  'project_collaborators',
  {
    project_id: uuid('project_id')
      .references(() => projects.id, { onDelete: 'cascade' })
      .notNull(),
    user_id: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
  },
  (t) => [{ pk: { name: 'project_collaborators_pk', columns: [t.project_id, t.user_id] } }],
);

export const requirementCollaborators = pgTable(
  'requirement_collaborators',
  {
    requirement_id: uuid('requirement_id')
      .references(() => requirements.id, { onDelete: 'cascade' })
      .notNull(),
    user_id: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
  },
  (t) => [{ pk: { name: 'requirement_collaborators_pk', columns: [t.requirement_id, t.user_id] } }],
);

export const taskCollaborators = pgTable(
  'task_collaborators',
  {
    task_id: uuid('task_id')
      .references(() => tasks.id, { onDelete: 'cascade' })
      .notNull(),
    user_id: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
  },
  (t) => [{ pk: { name: 'task_collaborators_pk', columns: [t.task_id, t.user_id] } }],
);

// ===== AI 会话 =====
export const aiConversations = pgTable('ai_conversations', {
  id: uuid('id').defaultRandom().primaryKey(),
  user_id: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  team_id: uuid('team_id').references(() => teams.id, { onDelete: 'set null' }),
  title: varchar('title', { length: 100 }).notNull().default('新对话'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const aiMessages = pgTable('ai_messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  conversation_id: uuid('conversation_id')
    .references(() => aiConversations.id, { onDelete: 'cascade' })
    .notNull(),
  role: aiRoleEnum('role').notNull(),
  content: text('content').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
