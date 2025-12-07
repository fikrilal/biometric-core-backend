# Wallet & Transfers – Product Overview

This document defines the product and business behaviour for the internal wallet, balance, and peer‑to‑peer transfer features, including how biometric approval (WebAuthn step‑up) fits into the flows. It is written from a product perspective and should stay implementation‑agnostic where possible.

## Goals

- Provide an in‑app balance for each user that behaves like a digital wallet (similar to GoPay/OVO/DANA/Jago).
- Allow users to send and receive money **within the system only** (user → user), with no outbound transfers to external banks or e‑money providers in this phase.
- Make high‑risk actions (sending money, especially above certain thresholds) **biometrically approved** using existing WebAuthn step‑up.
- Ensure behaviour is intuitive and consistent with mainstream wallets: clear states, predictable limits, strong protection against duplicate or lost transfers.

## Non‑Goals (Phase 1)

- No external top‑up or cash‑out rails (no cards, bank transfers, VA, etc.).
- No merchant payments, QRIS, bill pay, or subscriptions.
- No multi‑currency wallets; assume a single fiat currency (e.g., IDR) per environment.
- No chargebacks or dispute resolution flows beyond basic auditability.

These can be layered on later once the core wallet/ledger and P2P transfers are stable.

## Core Concepts

### User & Wallet

- Each user gets **one primary wallet** in this phase.
- The wallet represents the user’s **system balance**.
- Future phases may introduce:
  - Multiple wallets per user (e.g., “main” vs “jar”/“savings”).
  - Different currencies or “pockets” (promotional vs cash).

### Balance Semantics

- The product exposes a single **available balance** per wallet.
- Internally, balance is backed by an immutable ledger; the exposed balance is the result of confirmed transactions.
- Phase 1 assumes synchronous, final transfers:
  - No “pending” or “hold” states visible to the user.
  - A transfer either succeeds and updates balances immediately, or fails and does not affect balances.

### Transfer Types (Phase 1)

- **P2P Transfer (Internal)**
  - From: one user’s wallet.
  - To: another user’s wallet within the same system.
  - Initiated by the sender, with optional note/description.
  - May be free or subject to configurable fees (fees can be added later).

Planned but out of scope for this iteration:

- Top‑up from external instruments (bank, cards, etc.).
- Cash‑out / withdraw to bank or other wallets.
- Merchant payments and refunds.

### Identity & Recipient Resolution

- Users are primarily identified by `userId`, but product UX will typically use a more human‑friendly identifier:
  - Email address (already present).
  - Phone number or username (future enhancement).
- Sending flow is always:
  1. User provides an identifier (email / phone / user handle).
  2. Backend resolves this to a specific user and wallet.
  3. Client UI shows a **confirmation screen** with:
     - Recipient display name (e.g., first name + masked info).
     - Recipient masked identifier (e.g., email `foo****@example.com`).
     - Transfer amount and any fee.
  4. User approves the transfer (with biometric step‑up where required).

## User Journeys

### 1. View Wallet Balance & History

1. User opens the wallet screen.
2. Client calls the “current wallet” endpoint to fetch:
   - Available balance.
   - Currency.
   - Flags such as `walletStatus`, `dailyLimitRemaining`, etc. (as needed).
3. Client calls a paginated “transaction history” endpoint to display:
   - Incoming transfers.
   - Outgoing transfers.
   - Other movements (e.g., adjustments or promotional credits in future).

### 2. Send Money to Another User

1. User opens “Send” flow and enters:
   - Recipient identifier (email/phone/username).
   - Amount.
   - Optional note.
2. Client calls a **quote/preview** endpoint or directly prepares a transfer request:
   - Backend resolves the recipient.
   - Backend computes applicable fees and checks basic rules (min/max amount, supported currency, self‑transfer).
3. Client shows a confirmation screen with:
   - Recipient display name and masked identifier.
   - Amount and fee.
   - Final total to be debited.
4. If the transfer **requires biometric step‑up**:
   - Client first calls the existing `/v1/auth/step-up/challenge` and `/v1/auth/step-up/verify` flow.
   - Backend returns a `stepUpToken` scoped to the transfer purpose (e.g., `transaction:transfer`).
   - Client immediately uses this token when calling the transfer endpoint.
5. Client submits the transfer request with:
   - Access token (Authorization header).
   - Transfer details (recipient, amount, note).
   - Optional `stepUpToken` (header or body) when required.
6. Backend performs checks atomically:
   - Validate step‑up requirements.
   - Validate wallet status and limits.
   - Validate sufficient balance.
   - Create the transfer transaction and corresponding ledger entries.
7. Client shows success state with:
   - Amount debited, remaining balance, and basic transaction details.

### 3. Receive Money

1. Sender completes a transfer to the recipient’s wallet.
2. Recipient’s wallet balance increases immediately after the transaction commits.
3. Recipient sees the incoming transfer in their transaction history.
4. Optional: recipient receives a notification via the notification service (future integration).

### 4. Failed Transfer (Insufficient Funds / Policy)

1. Sender attempts a transfer but:
   - Available balance is lower than the transfer amount + fee; or
   - Transaction exceeds per‑transaction or daily limit; or
   - Wallet is blocked/suspended.
2. Backend rejects the request with a clear error code and message (e.g., `INSUFFICIENT_FUNDS`, `LIMIT_EXCEEDED`, `WALLET_BLOCKED`).
3. No money is moved; no partial ledger entries are left in a “dangling” state.
4. Client displays a friendly message with suggested next steps (e.g., “reduce amount”).

## Biometric Approval & Risk

### When Step‑Up Is Required

The platform already supports WebAuthn step‑up. For wallet transfers, we use it as follows:

- **Always require step‑up** when:
  - Transfer amount is at or above `HIGH_VALUE_TRANSFER_THRESHOLD_MINOR`.
  - Outgoing transfers for the current UTC day (including the pending request) would exceed **80%** of `TRANSFER_DAILY_LIMIT_MINOR`. This gives us a buffer before hitting the hard limit while still treating “near daily cap” activity as high risk.
  - The recipient is considered “new” or “untrusted” (first time transfer; future enhancement).
- **Optional step‑up** for:
  - Very small amounts (e.g., “coffee money”).
  - Transfers between a user’s own wallets (if multi‑wallet is introduced).

Rules must be:

- Configurable per environment.
- Expressed in a way that business/product teams can reason about and update without deep code changes.

### Step‑Up Token Usage

- Step‑up workflow is handled by existing endpoints:
  - `POST /v1/auth/step-up/challenge`
  - `POST /v1/auth/step-up/verify`
- On success, backend issues a **short‑lived step‑up token** with claims:
  - `type: "step_up"`
  - `sub: userId`
  - `purpose: "transaction:transfer"` (or related value)
  - `exp`: small TTL (e.g., 60–120 seconds)
- Transfer endpoints that require step‑up will:
  - Accept the token via header (e.g., `X-Step-Up-Token`) or request body.
  - Validate signature, expiry, `type`, and `sub` (must match the access token user).
  - Validate that `purpose` is appropriate for the operation.
- If a step‑up token is **missing or invalid** when required, the transfer request is rejected with 401/403. The client should:
  - Trigger a fresh step‑up flow.
  - Retry the transfer once a new token is obtained.

### Fraud & Abuse Considerations (Initial)

- The wallet system should protect against:
  - Rapid drain of a compromised account.
  - Abuse via repeated small transfers (velocity).
  - Accidental double submissions due to network issues or client retries.
- Initial mitigations:
  - Per‑transaction and daily limits.
  - Step‑up for high‑value or velocity‑based triggers.
  - Idempotency keys for transfer creation (see below).
  - Strong logging and audit trails.

More advanced risk scoring (device posture, behaviour analytics, third‑party risk engines) can be integrated later.

## Idempotency & Reliability

Transfers are **high‑risk** and must be resilient to:

- Client retries due to flaky networks.
- Duplicate submissions (e.g., double‑tap on “send”).
- Backend timeouts/delays where the client is unsure whether the request succeeded.

Key behaviours:

- Transfer creation uses the existing `Idempotency-Key` header.
- For a given user + idempotency key, the backend will:
  - Process the transfer once.
  - On replay, return the original result with `Idempotency-Replayed: true`.
- Internally, each transfer has a stable identifier that ties together:
  - Transaction record.
  - Ledger entries.
  - Any outward notifications or audit logs.

From the product perspective, this means:

- Users will not be charged twice for the same logical transfer, even if they or their app retry.
- Support and operations have a clear ID to use when investigating issues.

## Limits & Configurable Policies

The wallet should support configurable limits that can be tuned per environment (and later per user tier):

- **Per‑transaction limit**
  - Maximum amount for a single transfer.
- **Daily/period transfer limit**
  - Maximum total value a user can send per day (or other period).
- **Minimum transfer amount**
  - To avoid spam and round‑off issues.
- **Wallet status**
  - `active`: all operations allowed (subject to limits).
  - `suspended`: no outgoing transfers, but incoming credits still allowed.
  - `closed`: no operations; usually final state for regulatory reasons.

These limits should be surfaced to the client where appropriate (e.g., “You can send up to X today”) so UX can pre‑validate and show helpful messaging.

## Error Handling & User Messaging

Common error scenarios and expected behaviour:

- **Insufficient funds**
  - Trigger: requested amount + fees > available balance.
  - Behaviour: reject transfer, no partial debits.
  - User message: “Insufficient balance; top up or reduce amount.”
- **Limits exceeded**
  - Trigger: per‑transaction or daily limits breached.
  - Behaviour: reject, with specific error code.
  - User message: “Transfer exceeds your limit; try a smaller amount or tomorrow.”
- **Recipient not found or not eligible**
  - Trigger: target user does not exist, or their wallet is not active.
  - Behaviour: reject; do not reveal sensitive details about whether the identifier exists beyond what is safe.
- **Wallet blocked/suspended**
  - Trigger: KYC issues, fraud flags, compliance holds.
  - Behaviour: reject new outgoing transfers; allow incoming based on policy.

All errors should map to stable `ErrorCode` values and RFC 7807 `ProblemDetails` responses, consistent with the rest of the API.

## Audit & Compliance

Even in a purely internal wallet, we need to ensure:

- Every movement of funds is traceable:
  - Who sent money to whom.
  - When, from which device/IP, and with which authentication method.
- Biometric approvals are auditable:
  - Link step‑up tokens and WebAuthn events to the transfer transactions.
- Ledger entries are immutable:
  - Corrections use compensating transactions rather than editing historical entries.

These properties enable:

- Internal reconciliation with external financial systems when top‑ups/cash‑outs are introduced.
- Forensic analysis in case of suspected fraud or technical incidents.

This product overview will guide the more detailed API and implementation specs in the companion documents for endpoints, data models, and flows.
