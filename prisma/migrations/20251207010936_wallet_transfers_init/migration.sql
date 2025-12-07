-- CreateEnum
CREATE TYPE "WalletStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "WalletTransactionType" AS ENUM ('P2P_TRANSFER', 'ADJUSTMENT', 'PROMO_CREDIT');

-- CreateEnum
CREATE TYPE "WalletTransactionStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'REVERSED');

-- CreateEnum
CREATE TYPE "WalletLedgerDirection" AS ENUM ('DEBIT', 'CREDIT');

-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "WalletStatus" NOT NULL DEFAULT 'ACTIVE',
    "availableBalanceMinor" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletTransaction" (
    "id" TEXT NOT NULL,
    "type" "WalletTransactionType" NOT NULL,
    "status" "WalletTransactionStatus" NOT NULL DEFAULT 'COMPLETED',
    "fromWalletId" TEXT,
    "toWalletId" TEXT,
    "amountMinor" BIGINT NOT NULL,
    "feeMinor" BIGINT NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL,
    "note" TEXT,
    "clientReference" TEXT,
    "stepUpUsed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "WalletTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletLedgerEntry" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "direction" "WalletLedgerDirection" NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "balanceAfterMinor" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_userId_key" ON "Wallet"("userId");

-- CreateIndex
CREATE INDEX "Wallet_currency_idx" ON "Wallet"("currency");

-- CreateIndex
CREATE INDEX "WalletTransaction_fromWalletId_createdAt_idx" ON "WalletTransaction"("fromWalletId", "createdAt");

-- CreateIndex
CREATE INDEX "WalletTransaction_toWalletId_createdAt_idx" ON "WalletTransaction"("toWalletId", "createdAt");

-- CreateIndex
CREATE INDEX "WalletTransaction_clientReference_idx" ON "WalletTransaction"("clientReference");

-- CreateIndex
CREATE INDEX "WalletLedgerEntry_walletId_createdAt_id_idx" ON "WalletLedgerEntry"("walletId", "createdAt", "id");

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_fromWalletId_fkey" FOREIGN KEY ("fromWalletId") REFERENCES "Wallet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_toWalletId_fkey" FOREIGN KEY ("toWalletId") REFERENCES "Wallet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletLedgerEntry" ADD CONSTRAINT "WalletLedgerEntry_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "WalletTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletLedgerEntry" ADD CONSTRAINT "WalletLedgerEntry_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
