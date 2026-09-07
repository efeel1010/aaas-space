-- Pulse-Space 数据库初始化
-- 扩展 uuid 生成（若当前数据库不支持 gen_random_uuid 需启用）
CREATE EXTENSION IF NOT EXISTS pgcrypto;
