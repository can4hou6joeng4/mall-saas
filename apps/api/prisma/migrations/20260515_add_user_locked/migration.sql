-- M28: 用户锁定字段（admin 跨租户用户管理）
ALTER TABLE "User" ADD COLUMN "locked" BOOLEAN NOT NULL DEFAULT false;
