# Wallet & Transfers – Technical Design (Prisma, Logic, Validation)

This document describes the technical design for the wallet and internal peer‑to‑peer transfer features. It specifies the data model (Prisma), invariants, validation rules, and core service behaviour. It complements the product overview and endpoint specs.

## Scope

- Single “primary wallet” per user (Phase 1).
- Single currency per environment (e.g., IDR).
- Internal P2P transfers only (user → user within the system).
- No external rails (top‑up/cash‑out) and no merchant payments in this phase.

## Data Model (Prisma)

### Enums

Proposed enums to be added in `prisma/schema.prisma`:

```prisma
enum WalletStatus {
  ACTIVE
  SUSPENDED
  CLOSED
}

enum WalletTransactionType {
  P2P_TRANSFER
  ADJUSTMENT
  PROMO_CREDIT
}

enum WalletTransactionStatus {
  PENDING
  COMPLETED
  FAILED
  REVERSED
}

enum WalletLedgerDirection {
  DEBIT
  CREDIT
}
```

Notes:

- Only `P2P_TRANSFER` is required in Phase 1; other types prepare for future use.
- `PENDING` and `REVERSED` are included for future extension; Phase 1 uses `COMPLETED` and `FAILED` only.

### Wallet

```prisma
model Wallet {
  id                  String              @id @default(cuid())
  userId              String              @unique
  currency            String              // e.g., "IDR"
  status              WalletStatus        @default(ACTIVE)
  availableBalanceMinor BigInt           @default(0)
  createdAt           DateTime            @default(now())
  updatedAt           DateTime            @updatedAt

  user                User                @relation(fields: [userId], references: [id], onDelete: Cascade)
  outgoingTransactions WalletTransaction[] @relation("WalletOutgoing")
  incomingTransactions WalletTransaction[] @relation("WalletIncoming")
  ledgerEntries       WalletLedgerEntry[]

  @@index([currency])
}
```

Key points:

- `availableBalanceMinor` stores the wallet balance in minor units (e.g., cents) as `BigInt`.
- Currency is stored as a simple string, assuming one currency per environment in Phase 1.
- `userId` is unique: one wallet per user in this phase.

### WalletTransaction

```prisma
model WalletTransaction {
  id              String                   @id @default(cuid())
  type            WalletTransactionType
  status          WalletTransactionStatus  @default(COMPLETED)
  fromWalletId    String?
  toWalletId      String?
  amountMinor     BigInt                   // positive integer, minor units
  feeMinor        BigInt                   @default(0) // positive or zero
  currency        String
  note            String?
  clientReference String?                  // optional client idempotency key
  stepUpUsed      Boolean                  @default(false)
  createdAt       DateTime                 @default(now())
  completedAt     DateTime?

  fromWallet      Wallet?                  @relation("WalletOutgoing", fields: [fromWalletId], references: [id])
  toWallet        Wallet?                  @relation("WalletIncoming", fields: [toWalletId], references: [id])
  ledgerEntries   WalletLedgerEntry[]

  @@index([fromWalletId, createdAt])
  @@index([toWalletId, createdAt])
  @@index([clientReference])
}
```

Key points:

- For normal P2P transfers both `fromWalletId` and `toWalletId` are non‑null.
- `amountMinor` is the gross amount moved from sender to recipient.
- `feeMinor` is reserved for future fee logic; in Phase 1 it can remain zero.
- `clientReference` allows correlating client‑side retries; it should be unique per sender for a given logical transfer.

### WalletLedgerEntry

```prisma
model WalletLedgerEntry {
  id                 String                 @id @default(cuid())
  transactionId      String
  walletId           String
  direction          WalletLedgerDirection
  amountMinor        BigInt                 // positive integer
  balanceAfterMinor  BigInt                 // wallet balance after this entry is applied
  createdAt          DateTime               @default(now())

  transaction        WalletTransaction      @relation(fields: [transactionId], references: [id], onDelete: Cascade)
  wallet             Wallet                 @relation(fields: [walletId], references: [id], onDelete: Cascade)

  @@index([walletId, createdAt, id])
}
```

Key points:

- Each ledger entry is either a `DEBIT` or `CREDIT` for a specific wallet.
- `balanceAfterMinor` is stored to make queries fast and to support point‑in‑time views.
- For a given transaction, the sum of `CREDIT` entries must equal the sum of `DEBIT` entries (double‑entry).

### Invariants

The implementation must enforce the following invariants:

- `amountMinor > 0` for all transfers and ledger entries.
- For each `WalletTransaction`:
  - The sum of credit entries equals the sum of debit entries (net zero).
  - All ledger entries share the same `currency` as the transaction and the affected wallets.
- For P2P transfers:
  - `fromWalletId != toWalletId`.
  - Both wallets exist, are in compatible status and currency.
- `Wallet.availableBalanceMinor` always equals:
  - The last `balanceAfterMinor` for that wallet in the ledger, OR
  - `0` if no entries exist.

## Service Architecture

### Modules & Services

New Nest modules (matching existing patterns):

- `src/wallets/`
  - `wallets.module.ts`
  - `wallets.controller.ts`
  - `wallets.service.ts`
  - DTOs under `src/wallets/dto/*`
- `src/transactions/`
  - `transactions.module.ts`
  - `transactions.controller.ts`
  - `transactions.service.ts`
  - DTOs under `src/transactions/dto/*`

Dependencies:

- Both modules import `PrismaModule`.
- Both require `AuthModule` (for `JwtAuthGuard` and `CurrentUser`).
- `transactions` may also use `RateLimiterService` and `TokenService` for step‑up verification.

### WalletsService

Responsibilities:

- Ensure a wallet exists for each user (for now via lazy creation the first time it is needed).
- Expose:
  - `getWalletForUser(userId: string)` → wallet view DTO.
  - `getTransactionsForWallet(userId: string, cursor?: string, limit?: number)` → paginated history DTO.
- Enforce that:
  - Users can only see their own wallet and transactions.

Implementation details:

- `getWalletForUser`:
  - Looks up wallet by `userId`.
  - If missing, creates a wallet with balance `0` (since this project has no existing users, a separate backfill step is not required).
  - Maps to a DTO with:
    - `walletId`, `userId`, `currency`, `availableBalanceMinor`, `status`, `limits`.
- `getTransactionsForWallet`:
  - Uses `WalletTransaction` + `WalletLedgerEntry` to project user‑centric view:
    - `direction` (`INCOMING`/`OUTGOING`).
    - `counterpartyUserId` and masked info (from `User`).
    - `amountMinor`, `feeMinor`, `status`, `createdAt`, `note`.
  - Uses `PageQueryDto` and `toPaginated` for cursor pagination:
    - Cursor can be composed of `createdAt + id`.

### TransactionsService

Responsibilities:

- Execute P2P transfers safely and atomically.
- Expose:
  - `createTransfer(senderUserId, dto, stepUpTokenPayload?)` → transaction DTO.
  - `getTransactionForUser(userId, transactionId)` → detail DTO.

High‑level algorithm for `createTransfer`:

1. Resolve sender wallet by `senderUserId`.
2. Resolve recipient by identifier (userId/email) and their wallet.
3. Validate business rules:
   - Self‑transfer disallowed.
   - Wallet statuses (`ACTIVE` only for outgoing; recipient must not be `CLOSED`).
   - Currency matches.
   - Amount within min/max limits.
   - Sender has sufficient available balance.
4. Evaluate whether step‑up is required:
   - Based on amount, daily totals, or other policies.
   - If required, validate step‑up token (see below).
5. Enforce idempotency:
   - Check for existing transaction with same `(senderWalletId, clientReference)` if `clientReference` is provided.
   - If found:
     - If compatible (same recipient/amount/currency) → return existing transaction.
     - If conflicting → throw conflict error.
6. Execute transfer within a single Prisma transaction:
   - Reload sender wallet with `availableBalanceMinor` to avoid stale data.
   - Re‑check balance and limits.
   - Compute new balances for sender and recipient.
   - Create `WalletTransaction` row.
   - Create two `WalletLedgerEntry` rows:
     - Sender: `DEBIT` amount, `balanceAfterMinor = senderBalance - amount`.
     - Recipient: `CREDIT` amount, `balanceAfterMinor = recipientBalance + amount`.
   - Update `Wallet.availableBalanceMinor` for both wallets to match ledger.
7. Return transaction DTO with `stepUpUsed` flag.

## Validation Rules

### Amounts & Currency

- `amountMinor`:
  - Required, integer, > 0.
  - Represented in API DTOs as `number` or `string` in minor units.
- `currency`:
  - Required, e.g., `"IDR"`.
  - Must match the wallet’s currency; environment can enforce a single currency.
- Minimum transfer amount:
  - Configurable (e.g., `TRANSFER_MIN_AMOUNT_MINOR`).
  - Transfers below this threshold are rejected with `VALIDATION_FAILED` or a dedicated error code.

### Recipient Validation

- Exactly one of `recipient.userId` or `recipient.email` is required.
- The resolved recipient:
  - Must exist.
  - Must have an associated wallet.
  - Must not be the same user as the sender.
  - Must not have a `CLOSED` wallet (policy can allow `SUSPENDED` recipients to receive funds or not, as decided).

### Wallet Status Rules

- `ACTIVE`:
  - All operations allowed (subject to limits).
- `SUSPENDED`:
  - Outgoing transfers are blocked.
  - Incoming transfers may be allowed based on policy (Phase 1: allowed by default).
- `CLOSED`:
  - No transfers in or out.

Outgoing transfers from non‑`ACTIVE` wallets must be rejected with `FORBIDDEN`/`WALLET_BLOCKED` error.

### Limits & Daily Totals

Suggested environment‑based configuration:

- `TRANSFER_MIN_AMOUNT_MINOR` – minimum allowed transfer.
- `TRANSFER_MAX_AMOUNT_MINOR` – per‑transaction maximum.
- `TRANSFER_DAILY_LIMIT_MINOR` – maximum total amount a user can send per day.
- `HIGH_VALUE_TRANSFER_THRESHOLD_MINOR` – transfers at/above this require biometric step‑up.

These values are provided via environment variables (validated in `src/config/env.validation.ts`) and can use sensible defaults for local development. Production should tune them per policy.

Implementation:

- Per‑transaction check:
  - `amountMinor <= TRANSFER_MAX_AMOUNT_MINOR`.
- Daily limit:
  - Sum of `amountMinor` for completed outgoing transfers for the sender’s wallet during the current day, plus `amountMinor` for the new transfer, must be `<= TRANSFER_DAILY_LIMIT_MINOR`.

Exceeding these limits should return a clear error (`LIMIT_EXCEEDED`).

## Step‑Up (Biometric) Enforcement

### Policy Evaluation

TransactionsService should decide whether step‑up is required for a particular transfer based on:

- Amount thresholds:
  - `amountMinor >= HIGH_VALUE_TRANSFER_THRESHOLD_MINOR` → requires step‑up.
- Daily usage:
  - `dailyTotalSent + amountMinor` close to `TRANSFER_DAILY_LIMIT_MINOR` → requires step‑up.
- Future criteria:
  - “First transfer to this recipient”.
  - Suspicious patterns surfaced by a risk engine.

The policy decision can be implemented in a helper method:

```ts
private needsStepUp(amountMinor: bigint, dailyTotal: bigint): boolean;
```

### Token Validation

If `needsStepUp(...)` returns `true`, the service must:

- Require a step‑up token from:
  - `X-Step-Up-Token` header, or
  - `stepUpToken` field in the request body (but avoid dual sources).
- Use `TokenService.verifyStepUpToken` to validate:
  - Signature and expiry.
  - `type === 'step_up'`.
  - `sub` equals the authenticated `userId`.
  - `purpose` is compatible (e.g., `"transaction:transfer"`).
- If token is missing or invalid:
  - Reject with `401 Unauthorized` or `403 Forbidden` and an appropriate error code (e.g., `UNAUTHORIZED` or `FORBIDDEN`).

When a valid step‑up token is used:

- Mark the transaction as `stepUpUsed = true`.
- Optionally log token metadata (without storing the token itself).

## Idempotency

The platform already uses a global idempotency interceptor with `Idempotency-Key` header. Transfers additionally use `clientReference` as an application‑level safeguard.

### Server Behaviour

- For `POST /v1/transactions/transfer`:
  - Respect `Idempotency-Key` header using the global interceptor.
  - Additionally, within the transaction service:
    - If `clientReference` is provided:
      - Query for an existing transaction with:
        - `fromWalletId = senderWalletId` and
        - `clientReference = dto.clientReference`.
      - If found and matches current request (same recipient, amount, currency):
        - Return that transaction (idempotent replay).
      - If found but parameters differ:
        - Reject with `409 Conflict`.

This dual approach protects against:

- Duplicate HTTP requests with the same idempotency key.
- App‑level retries where HTTP headers might be lost but `clientReference` remains stable.

## Error Codes & Problem Details

New `ErrorCode` values recommended (to be added to `src/common/errors/error-codes.ts` in implementation):

- `INSUFFICIENT_FUNDS`
  - Sender does not have enough balance for amount + fee.
- `LIMIT_EXCEEDED`
  - Per‑transaction or daily limit exceeded.
- `WALLET_BLOCKED`
  - Sender’s wallet not in `ACTIVE` status.
- `RECIPIENT_NOT_FOUND`
  - Recipient identifier does not resolve to an eligible wallet.
- `SAME_WALLET_TRANSFER`
  - Sender and recipient resolve to the same wallet.

All errors must:

- Use `ProblemException` with stable `code` values.
- Return `application/problem+json` with `traceId`, consistent with the global error filter.

## Concurrency & Consistency

Transfers must be safe under concurrent requests:

- Use a single Prisma transaction (`prisma.$transaction`) for:
  - Loading current balances.
  - Validating limits.
  - Creating transaction and ledger entries.
  - Updating wallet balances.
- Avoid read‑modify‑write outside the transaction.
- Consider ordering of operations:
  - Always re‑read wallet balances inside the transaction to avoid stale values.

If multiple transfers race from the same wallet:

- Only one should succeed if the combined amounts would overdraw.
- Others should fail with `INSUFFICIENT_FUNDS`.

## Logging & Observability

At minimum, log the following for each transfer:

- `transactionId`, `fromWalletId`, `toWalletId`.
- `amountMinor`, `currency`, `stepUpUsed`.
- `userId` (sender), and optionally `recipientUserId`.
- IP address and user agent (from request), without logging sensitive data like tokens.

Metrics/counters to consider:

- Number of transfers created (by status).
- Total transferred amount per day.
- Number of failed transfers due to:
  - Insufficient funds.
  - Limits exceeded.
  - Step‑up failures.

These technical rules ensure that wallet and transfer behaviour is consistent, auditable, and aligned with the rest of the platform’s standards.
