-- AlterEnum
ALTER TYPE "GameStatus" ADD VALUE IF NOT EXISTS 'PUSH';
ALTER TYPE "GameStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

-- AlterEnum
ALTER TYPE "TxType" ADD VALUE IF NOT EXISTS 'REFUND';

-- CreateTable
CREATE TABLE IF NOT EXISTS "SlotRound" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bet" DECIMAL(18,8) NOT NULL,
    "payout" DECIMAL(18,8) NOT NULL DEFAULT 0,
    "multiplier" DECIMAL(18,8) NOT NULL DEFAULT 0,
    "grid" JSONB NOT NULL,
    "winningLines" JSONB NOT NULL,
    "isFreeSpin" BOOLEAN NOT NULL DEFAULT false,
    "freeSpinsWon" INTEGER NOT NULL DEFAULT 0,
    "serverSeed" TEXT NOT NULL,
    "serverSeedHash" TEXT NOT NULL,
    "clientSeed" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SlotRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "RouletteRound" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "totalBet" DECIMAL(18,8) NOT NULL,
    "winningNumber" INTEGER NOT NULL,
    "bets" JSONB NOT NULL,
    "payout" DECIMAL(18,8) NOT NULL DEFAULT 0,
    "multiplier" DECIMAL(18,8) NOT NULL DEFAULT 0,
    "serverSeed" TEXT NOT NULL,
    "serverSeedHash" TEXT NOT NULL,
    "clientSeed" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RouletteRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "BlackjackRound" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bet" DECIMAL(18,8) NOT NULL,
    "playerHands" JSONB NOT NULL,
    "dealerHand" JSONB NOT NULL,
    "currentHandIdx" INTEGER NOT NULL DEFAULT 0,
    "status" "GameStatus" NOT NULL DEFAULT 'ACTIVE',
    "payout" DECIMAL(18,8) NOT NULL DEFAULT 0,
    "serverSeed" TEXT NOT NULL,
    "serverSeedHash" TEXT NOT NULL,
    "clientSeed" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlackjackRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CoinFlipRound" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bet" DECIMAL(18,8) NOT NULL,
    "flips" JSONB NOT NULL,
    "streak" INTEGER NOT NULL DEFAULT 0,
    "multiplier" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "status" "GameStatus" NOT NULL DEFAULT 'ACTIVE',
    "payout" DECIMAL(18,8),
    "serverSeed" TEXT NOT NULL,
    "serverSeedHash" TEXT NOT NULL,
    "clientSeed" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoinFlipRound_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SlotRound_userId_createdAt_idx" ON "SlotRound"("userId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RouletteRound_userId_createdAt_idx" ON "RouletteRound"("userId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BlackjackRound_userId_createdAt_idx" ON "BlackjackRound"("userId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CoinFlipRound_userId_createdAt_idx" ON "CoinFlipRound"("userId", "createdAt");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "SlotRound" ADD CONSTRAINT "SlotRound_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "RouletteRound" ADD CONSTRAINT "RouletteRound_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "BlackjackRound" ADD CONSTRAINT "BlackjackRound_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "CoinFlipRound" ADD CONSTRAINT "CoinFlipRound_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
