-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "GameStatus" AS ENUM ('ACTIVE', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "TxType" AS ENUM ('BET', 'WIN', 'DEPOSIT', 'WITHDRAW');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "address" TEXT,
    "balance" DECIMAL(18,8) NOT NULL DEFAULT 1000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameRound" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bet" DECIMAL(18,8) NOT NULL,
    "mines" INTEGER NOT NULL,
    "boardSize" INTEGER NOT NULL DEFAULT 5,
    "status" "GameStatus" NOT NULL DEFAULT 'ACTIVE',
    "serverSeed" TEXT NOT NULL,
    "serverSeedHash" TEXT NOT NULL,
    "clientSeed" TEXT NOT NULL,
    "multiplier" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "payout" DECIMAL(18,8),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reveal" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "tileIndex" INTEGER NOT NULL,
    "isMine" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reveal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "TxType" NOT NULL,
    "amount" DECIMAL(18,8) NOT NULL,
    "roundId" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "GameRound_userId_createdAt_idx" ON "GameRound"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "GameRound_status_idx" ON "GameRound"("status");

-- CreateIndex
CREATE INDEX "Reveal_roundId_createdAt_idx" ON "Reveal"("roundId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Reveal_roundId_tileIndex_key" ON "Reveal"("roundId", "tileIndex");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_idempotencyKey_key" ON "Transaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Transaction_userId_createdAt_idx" ON "Transaction"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "GameRound" ADD CONSTRAINT "GameRound_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reveal" ADD CONSTRAINT "Reveal_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "GameRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;