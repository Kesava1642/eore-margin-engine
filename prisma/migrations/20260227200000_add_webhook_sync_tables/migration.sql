-- CreateTable
CREATE TABLE "WebhookShop" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "uninstalledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "WebhookOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "totalPrice" TEXT,
    "subtotalPrice" TEXT,
    "totalTax" TEXT,
    "currency" TEXT,
    "financialStatus" TEXT,
    "createdAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WebhookOrder_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "WebhookShop" ("shopId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WebhookLineItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "lineItemId" TEXT NOT NULL,
    "variantId" TEXT,
    "productId" TEXT,
    "sku" TEXT,
    "title" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "price" TEXT,
    "total" TEXT,
    CONSTRAINT "WebhookLineItem_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "WebhookShop" ("shopId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WebhookLineItem_shopId_orderId_fkey" FOREIGN KEY ("shopId", "orderId") REFERENCES "WebhookOrder" ("shopId", "orderId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WebhookProduct" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "title" TEXT,
    "status" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WebhookProduct_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "WebhookShop" ("shopId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WebhookProductVariant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sku" TEXT,
    "title" TEXT,
    "price" TEXT,
    "status" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WebhookProductVariant_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "WebhookShop" ("shopId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WebhookProductVariant_shopId_productId_fkey" FOREIGN KEY ("shopId", "productId") REFERENCES "WebhookProduct" ("shopId", "productId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "WebhookShop_shopId_key" ON "WebhookShop"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookOrder_shopId_orderId_key" ON "WebhookOrder"("shopId", "orderId");

-- CreateIndex
CREATE INDEX "WebhookOrder_shopId_idx" ON "WebhookOrder"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookLineItem_shopId_lineItemId_key" ON "WebhookLineItem"("shopId", "lineItemId");

-- CreateIndex
CREATE INDEX "WebhookLineItem_shopId_idx" ON "WebhookLineItem"("shopId");

-- CreateIndex
CREATE INDEX "WebhookLineItem_shopId_orderId_idx" ON "WebhookLineItem"("shopId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookProduct_shopId_productId_key" ON "WebhookProduct"("shopId", "productId");

-- CreateIndex
CREATE INDEX "WebhookProduct_shopId_idx" ON "WebhookProduct"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookProductVariant_shopId_variantId_key" ON "WebhookProductVariant"("shopId", "variantId");

-- CreateIndex
CREATE INDEX "WebhookProductVariant_shopId_idx" ON "WebhookProductVariant"("shopId");

-- CreateIndex
CREATE INDEX "WebhookProductVariant_shopId_productId_idx" ON "WebhookProductVariant"("shopId", "productId");
