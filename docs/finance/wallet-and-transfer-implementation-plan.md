# Wallet & Transfers – Implementation Plan (Phased TODO)

This document breaks down the implementation work for the wallet and internal P2P transfer features into phases. It is intended as a detailed checklist to keep scope explicit and ensure the implementation stays aligned with the product, technical design, and existing platform patterns.

> Status boxes (`[ ]` / `[x]`) are placeholders. Update them as work progresses.

## Phase 0 – Schema & Types

**Goal:** Introduce Prisma models and enums for wallet, transactions, and ledger without breaking existing functionality.

- [x] Update Prisma schema
  - [x] Add enums in `prisma/schema.prisma`:
    - [x] `WalletStatus { ACTIVE, SUSPENDED, CLOSED }`.
    - [x] `WalletTransactionType { P2P_TRANSFER, ADJUSTMENT, PROMO_CREDIT }`.
    - [x] `WalletTransactionStatus { PENDING, COMPLETED, FAILED, REVERSED }`.
    - [x] `WalletLedgerDirection { DEBIT, CREDIT }`.
  - [x] Add `Wallet` model:
    - [x] Fields:
      - [x] `id String @id @default(cuid())`.
      - [x] `userId String @unique`.
      - [x] `currency String`.
      - [x] `status WalletStatus @default(ACTIVE)`.
      - [x] `availableBalanceMinor BigInt @default(0)`.
      - [x] `createdAt DateTime @default(now())`.
      - [x] `updatedAt DateTime @updatedAt`.
    - [x] Relations:
      - [x] `user User @relation(fields: [userId], references: [id], onDelete: Cascade)`.
      - [x] `outgoingTransactions WalletTransaction[] @relation("WalletOutgoing")`.
      - [x] `incomingTransactions WalletTransaction[] @relation("WalletIncoming")`.
      - [x] `ledgerEntries WalletLedgerEntry[]`.
    - [x] Indexes:
      - [x] `@@index([currency])`.
  - [x] Add `WalletTransaction` model:
    - [x] Fields:
      - [x] `id String @id @default(cuid())`.
      - [x] `type WalletTransactionType`.
      - [x] `status WalletTransactionStatus @default(COMPLETED)`.
      - [x] `fromWalletId String?`.
      - [x] `toWalletId String?`.
      - [x] `amountMinor BigInt`.
      - [x] `feeMinor BigInt @default(0)`.
      - [x] `currency String`.
      - [x] `note String?`.
      - [x] `clientReference String?`.
      - [x] `stepUpUsed Boolean @default(false)`.
      - [x] `createdAt DateTime @default(now())`.
      - [x] `completedAt DateTime?`.
    - [x] Relations:
      - [x] `fromWallet Wallet? @relation("WalletOutgoing", fields: [fromWalletId], references: [id])`.
      - [x] `toWallet Wallet? @relation("WalletIncoming", fields: [toWalletId], references: [id])`.
      - [x] `ledgerEntries WalletLedgerEntry[]`.
    - [x] Indexes:
      - [x] `@@index([fromWalletId, createdAt])`.
      - [x] `@@index([toWalletId, createdAt])`.
      - [x] `@@index([clientReference])`.
  - [x] Add `WalletLedgerEntry` model:
    - [x] Fields:
      - [x] `id String @id @default(cuid())`.
      - [x] `transactionId String`.
      - [x] `walletId String`.
      - [x] `direction WalletLedgerDirection`.
      - [x] `amountMinor BigInt`.
      - [x] `balanceAfterMinor BigInt`.
      - [x] `createdAt DateTime @default(now())`.
    - [x] Relations:
      - [x] `transaction WalletTransaction @relation(fields: [transactionId], references: [id], onDelete: Cascade)`.
      - [x] `wallet Wallet @relation(fields: [walletId], references: [id], onDelete: Cascade)`.
    - [x] Indexes:
      - [x] `@@index([walletId, createdAt, id])`.
- [x] Run Prisma migration
  - [x] `npx prisma migrate dev --name wallet_transfers_init`.
  - [x] `npx prisma generate`.
  - [x] Confirm generated client types for new models (no backfill needed because there are no existing users yet).

## Phase 1 – Configuration & Error Codes

**Goal:** Introduce configuration keys and error codes needed for limits and transfer validation.

- [x] Extend environment validation in `src/config/env.validation.ts`
  - [x] Add optional numeric config values:
    - [x] `TRANSFER_MIN_AMOUNT_MINOR` (default a safe small value).
    - [x] `TRANSFER_MAX_AMOUNT_MINOR` (per‑transaction limit).
    - [x] `TRANSFER_DAILY_LIMIT_MINOR` (per‑day outgoing limit).
    - [x] `HIGH_VALUE_TRANSFER_THRESHOLD_MINOR` (amount that always requires step‑up).
  - [x] Ensure they:
    - [x] Parse as numbers (or strings representing integers).
    - [x] Have sensible defaults for local/dev environments.
- [x] Extend `ErrorCode` enum in `src/common/errors/error-codes.ts`
  - [x] Add:
    - [x] `INSUFFICIENT_FUNDS`.
    - [x] `LIMIT_EXCEEDED`.
    - [x] `WALLET_BLOCKED`.
    - [x] `RECIPIENT_NOT_FOUND`.
    - [x] `SAME_WALLET_TRANSFER`.
  - [x] Ensure no typos and codes are stable strings.
- [x] Document new configuration and error codes
  - [x] Update `docs/finance/wallet-and-transfer-technical.md` if needed.
  - [ ] (Optional) Add a short section to the main `README.md` for new env keys.

## Phase 2 – WalletsModule (Balance & History)

**Goal:** Implement read‑only wallet balance and transaction history endpoints.

- [ ] Create module skeleton under `src/wallets/`
  - [ ] `wallets.module.ts`
    - [ ] Import `PrismaModule`.
    - [ ] Import `AuthModule` to access `JwtAuthGuard` and `CurrentUser`.
    - [ ] Provide `WalletsService`.
    - [ ] Register `WalletsController`.
  - [ ] `wallets.service.ts`
  - [ ] `wallets.controller.ts`
  - [ ] DTOs:
    - [ ] `dto/wallet.response.ts`.
    - [ ] `dto/wallet-transaction.response.ts`.
- [ ] Implement `WalletsService`
  - [ ] `getOrCreateWalletForUser(userId: string)`:
    - [ ] Try to find existing wallet.
    - [ ] If none:
      - [ ] Create a wallet with:
        - [ ] `availableBalanceMinor = 0`.
        - [ ] `status = ACTIVE`.
        - [ ] `currency` from environment or default constant.
    - [ ] Return wallet entity.
  - [ ] `getWalletView(userId: string)`:
    - [ ] Use `getOrCreateWalletForUser`.
    - [ ] Map to `WalletResponseDto`:
      - [ ] `walletId`, `userId`, `currency`, `availableBalanceMinor`, `status`.
      - [ ] Embed effective limits from config (`perTransactionMaxMinor`, `dailyMaxMinor`, `dailyUsedMinor`).
    - [ ] Compute `dailyUsedMinor` by summing outgoing transfers for “today”.
  - [ ] `getTransactionsForUser(userId: string, cursor?: string, limit?: number)`:
    - [ ] Find wallet for `userId`.
    - [ ] Query `WalletTransaction` where:
      - [ ] `fromWalletId = wallet.id OR toWalletId = wallet.id`.
    - [ ] Apply cursor‑based pagination using `createdAt` + `id`.
    - [ ] Map each transaction to `WalletTransactionResponseDto`:
      - [ ] `transactionId`, `type`, `direction` (`INCOMING`/`OUTGOING`).
      - [ ] `counterpartyUserId`.
      - [ ] `counterpartyMaskedName` + `counterpartyMaskedIdentifier`, using `User` data.
      - [ ] `amountMinor`, `feeMinor`, `currency`, `note`, `status`, `createdAt`, `stepUpUsed`.
    - [ ] Wrap in `toPaginated(...)` and rely on the global response envelope.
- [ ] Implement `WalletsController`
  - [ ] Apply `@UseGuards(JwtAuthGuard)` at controller or method level.
  - [ ] `GET /v1/wallets/me`:
    - [ ] Route under `@Controller('wallets')`.
    - [ ] Handler `getMe(@CurrentUser() user)`:
      - [ ] Validate `user` presence.
      - [ ] Delegate to `walletsService.getWalletView(user.userId)`.
  - [ ] `GET /v1/wallets/me/transactions`:
    - [ ] Use `PageQueryDto` for query parameters.
    - [ ] Delegate to `walletsService.getTransactionsForUser(user.userId, q.cursor, q.limit)`.
  - [ ] Add Swagger decorators:
    - [ ] `@ApiTags('wallets')`.
    - [ ] `@ApiOperation` for each endpoint.
- [ ] Wire module into `AppModule`
  - [ ] Import `WalletsModule` in `src/app.module.ts`.
- [ ] Update docs
  - [ ] Ensure `docs/openapi/openapi.yaml` reflects `GET /v1/wallets/me` and `/v1/wallets/me/transactions`.

## Phase 3 – TransactionsModule (Create & Read Transfers)

**Goal:** Implement the core P2P transfer endpoints and transactional logic.

- [ ] Create module skeleton under `src/transactions/`
  - [ ] `transactions.module.ts`
    - [ ] Import `PrismaModule`.
    - [ ] Import `AuthModule`.
    - [ ] Import `WalletsModule` if needed for shared logic (or call Prisma directly).
    - [ ] Provide `TransactionsService`.
    - [ ] Register `TransactionsController`.
  - [ ] `transactions.service.ts`.
  - [ ] `transactions.controller.ts`.
  - [ ] DTOs:
    - [ ] `dto/create-transfer.dto.ts` (request).
    - [ ] `dto/transfer.response.ts` (response).
    - [ ] `dto/resolve-recipient.dto.ts` (optional resolve endpoint).
- [ ] Implement DTO validation
  - [ ] `CreateTransferDto`:
    - [ ] `recipient.userId?: string`.
    - [ ] `recipient.email?: string`.
    - [ ] `amountMinor: number` (or string) with validation:
      - [ ] Positive integer.
    - [ ] `currency: string`.
    - [ ] `note?: string`.
    - [ ] `clientReference?: string`.
    - [ ] `stepUpToken?: string` (if using body instead of header).
    - [ ] Custom validator to ensure exactly one of `recipient.userId` or `recipient.email` is provided.
- [ ] Implement `TransactionsService`
  - [ ] Helper: `resolveWalletForUser(userId: string)`:
    - [ ] Delegates to `WalletsService.getOrCreateWalletForUser`.
  - [ ] Helper: `resolveRecipient(dtoRecipient)`:
    - [ ] If `userId` provided:
      - [ ] Fetch user by `id`.
    - [ ] Else if `email` provided:
      - [ ] Normalize email (trim + lowercase).
      - [ ] Fetch user by `email`.
    - [ ] If not found:
      - [ ] Throw `ProblemException.notFound('Recipient not found')` with `RECIPIENT_NOT_FOUND`.
  - [ ] Helper: `checkWalletStatuses(senderWallet, recipientWallet)`:
    - [ ] Ensure sender `status === ACTIVE`.
    - [ ] Ensure recipient `status !== CLOSED`.
    - [ ] Throw `WALLET_BLOCKED` as appropriate.
  - [ ] Helper: `checkCurrency(senderWallet, recipientWallet, dtoCurrency)`:
    - [ ] Ensure all three currencies match; reject otherwise.
  - [ ] Helper: `checkLimitsAndBalance(senderWallet, amountMinor, now)`:
    - [ ] Compare `amountMinor` against `TRANSFER_MIN_AMOUNT_MINOR` and `TRANSFER_MAX_AMOUNT_MINOR`.
    - [ ] Query outgoing transfers for current day and compute `dailyTotal`.
    - [ ] Ensure `dailyTotal + amountMinor <= TRANSFER_DAILY_LIMIT_MINOR`.
    - [ ] Ensure `senderWallet.availableBalanceMinor >= amountMinor`.
    - [ ] Throw `LIMIT_EXCEEDED` or `INSUFFICIENT_FUNDS` as needed.
  - [ ] Helper: `needsStepUp(amountMinor, dailyTotal)`:
    - [ ] Evaluate against `HIGH_VALUE_TRANSFER_THRESHOLD_MINOR` and other criteria.
  - [ ] `createTransfer(senderUserId, dto, stepUpPayload?)`:
    - [ ] Resolve sender user and recipient user.
    - [ ] Resolve sender/recipient wallets.
    - [ ] Check `senderUserId !== recipientUser.id` (throw `SAME_WALLET_TRANSFER` if violated).
    - [ ] Check wallet statuses and currency.
    - [ ] Pre‑compute amount and `now`.
    - [ ] Check idempotency using `clientReference`:
      - [ ] If provided, look up existing transaction for `(fromWalletId, clientReference)`.
      - [ ] If found:
        - [ ] If recipient/amount/currency match, return existing transaction.
        - [ ] Otherwise throw `409 Conflict`.
    - [ ] Compute `dailyTotal` for outgoing transfers.
    - [ ] Decide whether step‑up is required via `needsStepUp`.
    - [ ] If step‑up required:
      - [ ] Validate `stepUpPayload` (see Phase 4) or require `stepUpToken` from caller.
    - [ ] Execute Prisma `$transaction`:
      - [ ] Reload sender and recipient wallets inside the transaction.
      - [ ] Re‑validate balance and limits with up‑to‑date values.
      - [ ] Compute new balances.
      - [ ] Create `WalletTransaction` record.
      - [ ] Create corresponding `WalletLedgerEntry` rows for sender (`DEBIT`) and recipient (`CREDIT`).
      - [ ] Update `Wallet.availableBalanceMinor` for both wallets to match computed balances.
    - [ ] Return a DTO mapped from the created `WalletTransaction`.
  - [ ] `getTransactionForUser(userId, transactionId)`:
    - [ ] Resolve wallet for `userId`.
    - [ ] Find `WalletTransaction` where:
      - [ ] `id = transactionId` AND
      - [ ] `fromWalletId = wallet.id OR toWalletId = wallet.id`.
    - [ ] If not found → `404 Not Found`.
    - [ ] Determine role: `SENDER` or `RECIPIENT`.
    - [ ] Map to `TransferResponseDto`.
- [ ] Implement `TransactionsController`
  - [ ] Apply `@UseGuards(JwtAuthGuard)` at controller level.
  - [ ] `POST /v1/transactions/transfer`:
    - [ ] Accept `CreateTransferDto`.
    - [ ] Accept step‑up token from header or body (as designed).
    - [ ] Call `transactionsService.createTransfer(user.userId, dto, stepUpPayload)`.
  - [ ] `GET /v1/transactions/:id`:
    - [ ] Call `transactionsService.getTransactionForUser(user.userId, id)`.
  - [ ] Optional: `POST /v1/recipients/resolve`:
    - [ ] Allow clients to resolve identifiers to recipient details before sending.
  - [ ] Add Swagger annotations and ensure response shapes match envelope standard.
- [ ] Wire module into `AppModule`
  - [ ] Import `TransactionsModule` in `src/app.module.ts`.
- [ ] Update `docs/openapi/openapi.yaml`
  - [ ] Add schemas for wallet and transfer DTOs.
  - [ ] Add paths for new endpoints with correct security, headers, and responses.

## Phase 4 – Step‑Up Integration

**Goal:** Enforce biometric step‑up for high‑risk transfers using existing step‑up tokens.

- [ ] Decide on step‑up policy
  - [ ] Choose thresholds and rules for when step‑up is required:
    - [ ] Always for transfers ≥ `HIGH_VALUE_TRANSFER_THRESHOLD_MINOR`.
    - [ ] Optionally when daily total approaches `TRANSFER_DAILY_LIMIT_MINOR`.
  - [ ] Document these rules in `docs/finance/wallet-and-transfer-product.md`.
- [ ] Integrate with `TokenService` in `TransactionsService`
  - [ ] Inject `TokenService` from `AuthPasswordModule`.
  - [ ] Add helper `verifyStepUpToken(token: string, userId: string)`:
    - [ ] Call `tokens.verifyStepUpToken`.
    - [ ] Ensure:
      - [ ] `type === 'step_up'`.
      - [ ] `sub === userId`.
      - [ ] `purpose` is `"transaction:transfer"` (or acceptable variant).
    - [ ] Throw `ProblemException` with `UNAUTHORIZED`/`FORBIDDEN` on failure.
  - [ ] Modify `createTransfer`:
    - [ ] If `needsStepUp(...)` returns `true`:
      - [ ] Require a valid step‑up token (from header/body).
      - [ ] Call `verifyStepUpToken`.
      - [ ] Set `stepUpUsed = true` on `WalletTransaction`.
- [ ] Controller wiring
  - [ ] Accept `X-Step-Up-Token` header (and optionally body field).
  - [ ] Pass token to `TransactionsService` in a consistent way.
- [ ] Update docs and OpenAPI
  - [ ] Ensure `POST /v1/transactions/transfer` documents:
    - [ ] When step‑up is required.
    - [ ] How to supply `stepUpToken`.

## Phase 5 – Testing (Unit + E2E)

**Goal:** Ensure high coverage of happy paths, validation, error handling, idempotency, and step‑up behaviour.

- [ ] Unit tests
  - [ ] `wallets.service.spec.ts`:
    - [ ] `getOrCreateWalletForUser` creates wallets for new users.
    - [ ] `getWalletView` returns correct balances and limits.
    - [ ] Daily usage calculation logic.
  - [ ] `transactions.service.spec.ts`:
    - [ ] Successful P2P transfer updates both wallets and ledger.
    - [ ] Self‑transfer rejected (`SAME_WALLET_TRANSFER`).
    - [ ] Insufficient funds rejected (`INSUFFICIENT_FUNDS`).
    - [ ] Limits exceeded rejected (`LIMIT_EXCEEDED`).
    - [ ] Idempotency with `clientReference` returns same transaction on retry.
    - [ ] Conflicting `clientReference` produces conflict error.
    - [ ] `needsStepUp` returns correct result for threshold boundaries.
    - [ ] `verifyStepUpToken` enforces type, subject, purpose, and expiry.
- [ ] E2E tests (extend `test/app.e2e-spec.ts` or add new file)
  - [ ] Happy path:
    - [ ] Register two users; verify both emails.
    - [ ] Seed balance for sender (either via direct DB or placeholder top‑up helper).
    - [ ] Perform a transfer:
      - [ ] `POST /v1/transactions/transfer` without step‑up (small amount).
      - [ ] Assert:
        - [ ] Sender balance decreased by amount.
        - [ ] Recipient balance increased by amount.
        - [ ] Transaction shows up in both histories with correct roles.
  - [ ] Step‑up path:
    - [ ] Use existing WebAuthn fake to obtain `stepUpToken`.
    - [ ] Perform a high‑value transfer:
      - [ ] Without token → expect 401/403.
      - [ ] With valid token → expect success, `stepUpUsed = true`.
  - [ ] Limits and errors:
    - [ ] Attempt transfer above per‑transaction limit → `LIMIT_EXCEEDED`.
    - [ ] Attempt transfer that exceeds daily limit → `LIMIT_EXCEEDED`.
    - [ ] Attempt transfer with insufficient funds → `INSUFFICIENT_FUNDS`.
    - [ ] Attempt transfer to non‑existent recipient → `RECIPIENT_NOT_FOUND`.
  - [ ] Idempotency:
    - [ ] Use same `Idempotency-Key` and `clientReference` for two requests:
      - [ ] Ensure only one transfer is created.
      - [ ] Second call returns same transaction and response.

## Phase 6 – Observability & Hardening

**Goal:** Add logging, metrics, and guardrails to operate the wallet/transfer feature safely.

- [ ] Logging
  - [ ] Add structured logs in `TransactionsService`:
    - [ ] On transfer creation:
      - [ ] `transactionId`, `fromWalletId`, `toWalletId`, `amountMinor`, `currency`, `stepUpUsed`.
    - [ ] On failures:
      - [ ] Reason (`INSUFFICIENT_FUNDS`, `LIMIT_EXCEEDED`, etc.).
      - [ ] `userId` and IP (without PII in messages).
  - [ ] Ensure logs do not contain:
    - [ ] Access tokens.
    - [ ] Step‑up tokens.
    - [ ] Raw WebAuthn data.
- [ ] Metrics (if observability stack is wired)
  - [ ] Add counters/gauges:
    - [ ] Total transfers per day.
    - [ ] Total transferred amount.
    - [ ] Transfers requiring step‑up vs not.
    - [ ] Failed transfers by error code.
- [ ] Safety checks
  - [ ] Consider adding a global max limit per environment (e.g., if config is mis‑set).
  - [ ] Ensure any future adjustment/credit operations also go through double‑entry ledger and respect invariants.
- [ ] Documentation
  - [ ] Update `docs/finance/wallet-and-transfer-product.md` and `docs/finance/wallet-and-transfer-technical.md` with:
    - [ ] Finalized limits.
    - [ ] Behaviour of step‑up under different thresholds.
    - [ ] Any operational runbooks (e.g., how to investigate a disputed transfer).

Once these phases are complete, the platform will have a robust internal wallet and P2P transfer feature that aligns with existing biometric auth, response standards, and operational practices.
