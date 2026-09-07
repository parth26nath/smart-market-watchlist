-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Session" (
    "token" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Watchlist" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Watchlist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WatchlistItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "watchlistId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "alias" TEXT,
    "thresholdHigh" REAL,
    "thresholdLow" REAL,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WatchlistItem_watchlistId_fkey" FOREIGN KEY ("watchlistId") REFERENCES "Watchlist" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WatchlistItem_symbol_fkey" FOREIGN KEY ("symbol") REFERENCES "Symbol" ("symbol") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Symbol" (
    "symbol" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "sector" TEXT NOT NULL,
    "tier" TEXT NOT NULL DEFAULT 'warm',
    "tierUpdatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Observation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "symbol" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "observedAt" DATETIME NOT NULL,
    "asOf" DATETIME NOT NULL,
    "price" REAL NOT NULL,
    "volume" REAL,
    "quality" TEXT NOT NULL DEFAULT 'ok',
    "rawPayload" TEXT,
    CONSTRAINT "Observation_symbol_fkey" FOREIGN KEY ("symbol") REFERENCES "Symbol" ("symbol") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DailyBar" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "symbol" TEXT NOT NULL,
    "sessionDate" TEXT NOT NULL,
    "open" REAL NOT NULL,
    "high" REAL NOT NULL,
    "low" REAL NOT NULL,
    "close" REAL NOT NULL,
    "volume" REAL NOT NULL,
    "source" TEXT NOT NULL,
    "isProvisional" BOOLEAN NOT NULL DEFAULT true,
    "quality" TEXT NOT NULL DEFAULT 'ok',
    "corporateActionSuspected" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DailyBar_symbol_fkey" FOREIGN KEY ("symbol") REFERENCES "Symbol" ("symbol") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Watermark" (
    "userId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "lastAckAsOf" DATETIME,
    "lastAckPrice" REAL,
    "lastAckObservationId" TEXT,
    "acknowledgedAt" DATETIME,
    "lastRenderedAt" DATETIME,

    PRIMARY KEY ("userId", "symbol"),
    CONSTRAINT "Watermark_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Watermark_symbol_fkey" FOREIGN KEY ("symbol") REFERENCES "Symbol" ("symbol") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChangeEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "windowKey" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "score" REAL NOT NULL DEFAULT 0,
    "headline" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "metricsJson" TEXT NOT NULL,
    "windowStart" DATETIME NOT NULL,
    "detectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" DATETIME,
    CONSTRAINT "ChangeEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChangeEvent_symbol_fkey" FOREIGN KEY ("symbol") REFERENCES "Symbol" ("symbol") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "IngestionConflict" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "symbol" TEXT NOT NULL,
    "asOf" DATETIME NOT NULL,
    "sourceA" TEXT NOT NULL,
    "valueA" REAL NOT NULL,
    "sourceB" TEXT NOT NULL,
    "valueB" REAL NOT NULL,
    "resolution" TEXT NOT NULL,
    "loggedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IngestionConflict_symbol_fkey" FOREIGN KEY ("symbol") REFERENCES "Symbol" ("symbol") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Watchlist_userId_idx" ON "Watchlist"("userId");

-- CreateIndex
CREATE INDEX "WatchlistItem_symbol_idx" ON "WatchlistItem"("symbol");

-- CreateIndex
CREATE UNIQUE INDEX "WatchlistItem_watchlistId_symbol_key" ON "WatchlistItem"("watchlistId", "symbol");

-- CreateIndex
CREATE INDEX "Observation_symbol_asOf_idx" ON "Observation"("symbol", "asOf");

-- CreateIndex
CREATE INDEX "Observation_symbol_observedAt_idx" ON "Observation"("symbol", "observedAt");

-- CreateIndex
CREATE INDEX "DailyBar_symbol_sessionDate_idx" ON "DailyBar"("symbol", "sessionDate");

-- CreateIndex
CREATE UNIQUE INDEX "DailyBar_symbol_sessionDate_key" ON "DailyBar"("symbol", "sessionDate");

-- CreateIndex
CREATE UNIQUE INDEX "ChangeEvent_signature_key" ON "ChangeEvent"("signature");

-- CreateIndex
CREATE INDEX "ChangeEvent_userId_acknowledgedAt_idx" ON "ChangeEvent"("userId", "acknowledgedAt");

-- CreateIndex
CREATE INDEX "ChangeEvent_symbol_idx" ON "ChangeEvent"("symbol");

-- CreateIndex
CREATE INDEX "IngestionConflict_symbol_idx" ON "IngestionConflict"("symbol");
