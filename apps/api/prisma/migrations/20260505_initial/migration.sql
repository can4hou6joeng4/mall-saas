-- CreateTable
CREATE TABLE "Tenant" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Note" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Note_tenantId_idx" ON "Note"("tenantId");

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 启用 Note 的 RLS（Tenant 表是平台元数据，超管可访问，不启 RLS）
ALTER TABLE "Note" ENABLE ROW LEVEL SECURITY;

-- 创建策略：仅当 session 设置了 app.current_tenant 且与行 tenantId 匹配时可见
CREATE POLICY "Note_tenant_isolation" ON "Note"
  USING (
    nullif(current_setting('app.current_tenant', true), '') IS NOT NULL
    AND "tenantId" = nullif(current_setting('app.current_tenant', true), '')::int
  );

-- 创建一个非超级用户角色用于应用连接，强制 RLS 生效
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mall_app') THEN
    CREATE ROLE mall_app LOGIN PASSWORD 'mall_app';
  END IF;
END$$;
GRANT USAGE ON SCHEMA public TO mall_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "Note", "Tenant" TO mall_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO mall_app;
