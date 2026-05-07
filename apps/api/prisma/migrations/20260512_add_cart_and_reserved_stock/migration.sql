-- 在 Product 上加预占字段；老数据默认 0
ALTER TABLE "Product" ADD COLUMN "reservedStock" INTEGER NOT NULL DEFAULT 0;

-- CartItem 表
CREATE TABLE "CartItem" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CartItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CartItem_tenantId_userId_idx" ON "CartItem"("tenantId", "userId");
CREATE UNIQUE INDEX "CartItem_tenantId_userId_productId_key" ON "CartItem"("tenantId", "userId", "productId");

ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 启用 RLS
ALTER TABLE "CartItem" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "CartItem_tenant_isolation" ON "CartItem"
  USING (
    nullif(current_setting('app.current_tenant', true), '') IS NOT NULL
    AND "tenantId" = nullif(current_setting('app.current_tenant', true), '')::int
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON "CartItem" TO mall_app;
GRANT USAGE, SELECT ON SEQUENCE "CartItem_id_seq" TO mall_app;
