-- 先去重（种子数据曾多次重复插入），再加复合主键
DELETE FROM "team_members" a USING "team_members" b WHERE a.ctid < b.ctid AND a."team_id" = b."team_id" AND a."user_id" = b."user_id";--> statement-breakpoint
DELETE FROM "document_favorites" a USING "document_favorites" b WHERE a.ctid < b.ctid AND a."doc_id" = b."doc_id" AND a."user_id" = b."user_id";--> statement-breakpoint
ALTER TABLE "document_favorites" ADD CONSTRAINT "document_favorites_pk" PRIMARY KEY("doc_id","user_id");--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_pk" PRIMARY KEY("team_id","user_id");