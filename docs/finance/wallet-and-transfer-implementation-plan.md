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

**Goal:** Implement read-only wallet balance and transaction history endpoints.

- [x] Create module skeleton under `src/wallets/`
  - [x] `wallets.module.ts`
    - [x] Import `PrismaModule`.
    - [x] Import `AuthModule` to access `JwtAuthGuard` and `CurrentUser`.
    - [x] Provide `WalletsService`.
    - [x] Register `WalletsController`.
  - [x] `wallets.service.ts`
  - [x] `wallets.controller.ts`
  - [x] DTOs:
    - [x] `dto/wallet.response.ts`.
    - [x] `dto/wallet-transaction.response.ts`.
- [x] Implement `WalletsService`
  - [x] `getOrCreateWalletForUser(userId: string)`:
    - [x] Try to find existing wallet.
    - [x] If none:
      - [x] Create a wallet with:
        - [x] `availableBalanceMinor = 0`.
        - [x] `status = ACTIVE`.
        - [x] `currency` from environment or default constant.
    - [x] Return wallet entity.
  - [x] `getWalletView(userId: string)`:
    - [x] Use `getOrCreateWalletForUser`.
    - [x] Map to `WalletResponseDto`:
      - [x] `walletId`, `userId`, `currency`, `availableBalanceMinor`, `status`.
      - [x] Embed effective limits from config (`perTransactionMaxMinor`, `dailyMaxMinor`, `dailyUsedMinor`).
    - [x] Compute `dailyUsedMinor` by summing outgoing transfers for “today”.
  - [x] `getTransactionsForUser(userId: string, cursor?: string, limit?: number)`:
    - [x] Find wallet for `userId`.
    - [x] Query `WalletTransaction` where:
      - [x] `fromWalletId = wallet.id OR toWalletId = wallet.id`.
    - [x] Apply cursor-based pagination using `createdAt` + `id`.
    - [x] Map each transaction to `WalletTransactionResponseDto`:
      - [x] `transactionId`, `type`, `direction` (`INCOMING`/`OUTGOING`).
      - [x] `counterpartyUserId`.
      - [x] `counterpartyMaskedName` + `counterpartyMaskedIdentifier`, using `User` data.
      - [x] `amountMinor`, `feeMinor`, `currency`, `note`, `status`, `createdAt`, `stepUpUsed`.
    - [x] Wrap in `toPaginated(...)` and rely on the global response envelope.
- [x] Implement `WalletsController`
  - [x] Apply `@UseGuards(JwtAuthGuard)` at controller or method level.
  - [x] `GET /v1/wallets/me`:
    - [x] Route under `@Controller('wallets')`.
    - [x] Handler `getMe(@CurrentUser() user)`:
      - [x] Validate `user` presence.
      - [x] Delegate to `walletsService.getWalletView(user.userId)`.
  - [x] `GET /v1/wallets/me/transactions`:
    - [x] Use `PageQueryDto` for query parameters.
    - [x] Delegate to `walletsService.getTransactionsForUser(user.userId, q.cursor, q.limit)`.
  - [x] Add Swagger decorators:
    - [x] `@ApiTags('wallets')`.
    - [x] `@ApiOperation` for each endpoint.
- [x] Wire module into `AppModule`
  - [x] Import `WalletsModule` in `src/app.module.ts`.
- [x] Update docs
  - [x] Ensure `docs/openapi/openapi.yaml` reflects `GET /v1/wallets/me` and `/v1/wallets/me/transactions`.

## Phase 3 – TransactionsModule (Create & Read Transfers)

**Goal:** Implement the core P2P transfer endpoints and transactional logic.

- [x] Create module skeleton under `src/transactions/`
  - [x] `transactions.module.ts`
    - [x] Import `PrismaModule`.
    - [x] Import `AuthModule`.
    - [x] Import `WalletsModule` if needed for shared logic (or call Prisma directly).
    - [x] Provide `TransactionsService`.
    - [x] Register `TransactionsController`.
  - [x] `transactions.service.ts`.
  - [x] `transactions.controller.ts`.
  - [x] DTOs:
    - [x] `dto/create-transfer.dto.ts` (request).
    - [x] `dto/transfer.response.ts` (response).
    - [x] `dto/resolve-recipient.dto.ts` (optional resolve endpoint).
- [ ] Implement DTO validation
  - [x] `CreateTransferDto`:
    - [x] `recipient.userId?: string`.
    - [x] `recipient.email?: string`.
    - [x] `amountMinor: number` (or string) with validation:
      - [x] Positive integer.
    - [x] `currency: string`.
    - [x] `note?: string`.
    - [x] `clientReference?: string`.
    - [x] `stepUpToken?: string` (if using body instead of header).
    - [ ] Custom validator to ensure exactly one of `recipient.userId` or `recipient.email` is provided.
- [x] Implement `TransactionsService`
  - [x] Helper: `resolveWalletForUser(userId: string)`:
    - [x] Delegates to `WalletsService.getOrCreateWalletForUser`.
  - [x] Helper: `resolveRecipient(dtoRecipient)`:
    - [x] If `userId` provided:
      - [x] Fetch user by `id`.
    - [x] Else if `email` provided:
      - [x] Normalize email (trim + lowercase).
      - [x] Fetch user by `email`.
    - [x] If not found:
      - [x] Throw `ProblemException.notFound('Recipient not found')` with `RECIPIENT_NOT_FOUND`.
  - [x] Helper: `checkWalletStatuses(senderWallet, recipientWallet)`:
    - [x] Ensure sender `status === ACTIVE`.
    - [x] Ensure recipient `status !== CLOSED`.
    - [x] Throw `WALLET_BLOCKED` as appropriate.
  - [x] Helper: `checkCurrency(senderWallet, recipientWallet, dtoCurrency)`:
    - [x] Ensure all three currencies match; reject otherwise.
  - [x] Helper: `checkLimitsAndBalance(senderWallet, amountMinor, now)`:
    - [x] Compare `amountMinor` against `TRANSFER_MIN_AMOUNT_MINOR` and `TRANSFER_MAX_AMOUNT_MINOR`.
    - [x] Query outgoing transfers for current day and compute `dailyTotal`.
    - [x] Ensure `dailyTotal + amountMinor <= TRANSFER_DAILY_LIMIT_MINOR`.
    - [x] Ensure `senderWallet.availableBalanceMinor >= amountMinor`.
    - [x] Throw `LIMIT_EXCEEDED` or `INSUFFICIENT_FUNDS` as needed.
  - [x] Helper: `needsStepUp(amountMinor, dailyTotal)`:
    - [x] Evaluate against `HIGH_VALUE_TRANSFER_THRESHOLD_MINOR` and other criteria.
  - [x] `createTransfer(senderUserId, dto, stepUpPayload?)`:
    - [x] Resolve sender user and recipient user.
    - [x] Resolve sender/recipient wallets.
    - [x] Check `senderUserId !== recipientUser.id` (throw `SAME_WALLET_TRANSFER` if violated).
    - [x] Check wallet statuses and currency.
    - [x] Pre‑compute amount and `now`.
    - [x] Check idempotency using `clientReference`:
      - [x] If provided, look up existing transaction for `(fromWalletId, clientReference)`.
      - [x] If found:
        - [x] If recipient/amount/currency match, return existing transaction.
        - [x] Otherwise throw `409 Conflict`.
    - [x] Compute `dailyTotal` for outgoing transfers.
    - [x] Decide whether step‑up is required via `needsStepUp`.
    - [x] If step‑up required:
      - [x] Validate `stepUpPayload` (see Phase 4) or require `stepUpToken` from caller.
    - [x] Execute Prisma `$transaction`:
      - [x] Reload sender and recipient wallets inside the transaction.
      - [x] Re‑validate balance and limits with up‑to‑date values.
      - [x] Compute new balances.
      - [x] Create `WalletTransaction` record.
      - [x] Create corresponding `WalletLedgerEntry` rows for sender (`DEBIT`) and recipient (`CREDIT`).
      - [x] Update `Wallet.availableBalanceMinor` for both wallets to match computed balances.
    - [x] Return a DTO mapped from the created `WalletTransaction`.
  - [x] `getTransactionForUser(userId, transactionId)`:
    - [x] Resolve wallet for `userId`.
    - [x] Find `WalletTransaction` where:
      - [x] `id = transactionId` AND
      - [x] `fromWalletId = wallet.id OR toWalletId = wallet.id`.
    - [x] If not found → `404 Not Found`.
    - [x] Determine role: `SENDER` or `RECIPIENT`.
    - [x] Map to `TransferResponseDto`.
- [x] Implement `TransactionsController`
  - [x] Apply `@UseGuards(JwtAuthGuard)` at controller level.
  - [x] `POST /v1/transactions/transfer`:
    - [x] Accept `CreateTransferDto`.
    - [x] Accept step‑up token from header or body (as designed).
    - [x] Call `transactionsService.createTransfer(user.userId, dto, stepUpPayload)`.
  - [x] `GET /v1/transactions/:id`:
    - [x] Call `transactionsService.getTransactionForUser(user.userId, id)`.
  - [x] Optional: `POST /v1/recipients/resolve`:
    - [x] Allow clients to resolve identifiers to recipient details before sending.
  - [x] Add Swagger annotations and ensure response shapes match envelope standard.
- [x] Wire module into `AppModule`
  - [x] Import `TransactionsModule` in `src/app.module.ts`.
- [x] Update `docs/openapi/openapi.yaml`
  - [x] Add schemas for wallet and transfer DTOs.
  - [x] Add paths for new endpoints with correct security, headers, and responses.

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
  - [x] Happy path:
    - [x] Register two users; verify both emails.
    - [x] Seed balance for sender (either via direct DB or placeholder top‑up helper).
    - [x] Perform a transfer:
      - [x] `POST /v1/transactions/transfer` without step‑up (small amount).
      - [x] Assert:
        - [x] Sender balance decreased by amount.
        - [x] Recipient balance increased by amount.
        - [x] Transaction shows up in both histories with correct roles.
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
