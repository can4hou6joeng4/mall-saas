-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'user',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "User_tenantId_idx" ON "User"("tenantId");
CREATE UNIQUE INDEX "User_tenantId_email_key" ON "User"("tenantId", "email");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 启用 RLS
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "User_tenant_isolation" ON "User"
  USING (
    nullif(current_setting('app.current_tenant', true), '') IS NOT NULL
    AND "tenantId" = nullif(current_setting('app.current_tenant', true), '')::int
  );

-- mall_app 角色授权
GRANT SELECT, INSERT, UPDATE, DELETE ON "User" TO mall_app;
GRANT USAGE, SELECT ON SEQUENCE "User_id_seq" TO mall_app;
