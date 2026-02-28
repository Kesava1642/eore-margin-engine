-- CreateTable
CREATE TABLE "SkuCost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "title" TEXT,
    "cogsUnit" REAL NOT NULL,
    "currency" TEXT,
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "SkuCost_shop_sku_key" ON "SkuCost"("shop", "sku");

-- CreateIndex
CREATE INDEX "SkuCost_shop_idx" ON "SkuCost"("shop");

-- CreateIndex
CREATE INDEX "SkuCost_sku_idx" ON "SkuCost"("sku");
