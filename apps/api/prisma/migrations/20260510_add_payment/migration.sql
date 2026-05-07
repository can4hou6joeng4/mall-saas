-- CreateTable
CREATE TABLE "Payment" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "orderId" INTEGER NOT NULL,
    "providerName" TEXT NOT NULL,
    "providerRef" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Payment_tenantId_idx" ON "Payment"("tenantId");
CREATE INDEX "Payment_orderId_idx" ON "Payment"("orderId");
CREATE UNIQUE INDEX "Payment_providerName_providerRef_key" ON "Payment"("providerName", "providerRef");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 启用 RLS（按 tenantId 直接判定）
ALTER TABLE "Payment" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Payment_tenant_isolation" ON "Payment"
  USING (
    nullif(current_setting('app.current_tenant', true), '') IS NOT NULL
    AND "tenantId" = nullif(current_setting('app.current_tenant', true), '')::int
  );

-- mall_app 角色授权
GRANT SELECT, INSERT, UPDATE, DELETE ON "Payment" TO mall_app;
GRANT USAGE, SELECT ON SEQUENCE "Payment_id_seq" TO mall_app;
