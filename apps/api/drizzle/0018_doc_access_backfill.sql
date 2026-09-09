-- 权限管理 backfill（幂等）：
-- 1. 补 document_access 复合主键（generate 未自动生成）
-- 2. 存量回填：团队文档保持团队可见（现状最宽松权），个人文档保持私有（默认值即可）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'document_access_pk' AND conrelid = 'document_access'::regclass
  ) THEN
    ALTER TABLE "document_access" ADD CONSTRAINT "document_access_pk" PRIMARY KEY ("doc_id", "user_id");
  END IF;
END $$;--> statement-breakpoint
UPDATE "documents" SET "visibility" = 'team', "base_permission" = 'edit' WHERE "team_id" IS NOT NULL;--> statement-breakpoint
UPDATE "documents" SET "visibility" = 'private', "base_permission" = 'edit' WHERE "team_id" IS NULL;