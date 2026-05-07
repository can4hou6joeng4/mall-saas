-- CreateTable
CREATE TABLE "Order" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "totalCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "subtotalCents" INTEGER NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Order_tenantId_idx" ON "Order"("tenantId");
CREATE INDEX "Order_tenantId_status_idx" ON "Order"("tenantId", "status");
CREATE INDEX "Order_tenantId_userId_idx" ON "Order"("tenantId", "userId");
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");
CREATE INDEX "OrderItem_productId_idx" ON "OrderItem"("productId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 启用 RLS：Order 直接按 tenantId；OrderItem 通过其 orderId 反查 tenantId
ALTER TABLE "Order" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrderItem" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Order_tenant_isolation" ON "Order"
  USING (
    nullif(current_setting('app.current_tenant', true), '') IS NOT NULL
    AND "tenantId" = nullif(current_setting('app.current_tenant', true), '')::int
  );

CREATE POLICY "OrderItem_tenant_isolation" ON "OrderItem"
  USING (
    EXISTS (
      SELECT 1 FROM "Order" o
      WHERE o.id = "OrderItem"."orderId"
        AND o."tenantId" = nullif(current_setting('app.current_tenant', true), '')::int
    )
  );

-- mall_app 角色授权
GRANT SELECT, INSERT, UPDATE, DELETE ON "Order", "OrderItem" TO mall_app;
GRANT USAGE, SELECT ON SEQUENCE "Order_id_seq", "OrderItem_id_seq" TO mall_app;
