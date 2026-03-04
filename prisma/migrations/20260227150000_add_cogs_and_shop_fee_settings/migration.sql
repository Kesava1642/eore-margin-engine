-- CreateTable
CREATE TABLE "Cogs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "sku" TEXT,
    "cogsPerUnit" REAL NOT NULL,
    "currency" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ShopFeeSettings" (
    "shopId" TEXT NOT NULL PRIMARY KEY,
    "shopifyFeePct" REAL NOT NULL DEFAULT 0,
    "gatewayFeePct" REAL NOT NULL DEFAULT 0,
    "shippingCostPct" REAL NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Cogs_shopId_variantId_key" ON "Cogs"("shopId", "variantId");

-- CreateIndex
CREATE INDEX "Cogs_shopId_idx" ON "Cogs"("shopId");
