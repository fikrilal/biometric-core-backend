# Wallet & Transfers – API Endpoints

This document lists the HTTP endpoints required to support the wallet balance and internal peer‑to‑peer transfer features described in the product overview. It focuses on contract shape (paths, methods, request/response fields, and behaviours) and should align with the global response, error, pagination, and idempotency standards.

All endpoints:

- Use the global envelope `{ data, meta? }`.
- Return RFC 7807 `ProblemDetails` for errors.
- Accept `X-Request-Id` and optionally `Idempotency-Key` as per existing conventions.
- Require JWT bearer auth (`Authorization: Bearer <accessToken>`) unless explicitly stated otherwise.

## Wallet Endpoints

### GET `/v1/wallets/me`

**Purpose**
- Fetch the current user’s primary wallet and balance.

**Auth**
- Requires access token (JWT).

**Request**
- Headers:
  - `Authorization: Bearer <accessToken>`
  - `X-Request-Id?`
- Query: none.

**Response**
- `200 OK`
  ```json
  {
    "data": {
      "walletId": "wal_xxx",
      "userId": "usr_xxx",
      "currency": "IDR",
      "availableBalanceMinor": 125000, // e.g. 1_250.00 IDR in minor units
      "status": "active",
      "limits": {
        "perTransactionMaxMinor": 50000000,
        "dailyMaxMinor": 200000000,
        "dailyUsedMinor": 500000
      }
    },
    "meta": {}
  }
  ```

**Errors (examples)**
- `401 Unauthorized` – invalid/missing access token.
- `404 Not Found` – wallet not found (should be rare).

### GET `/v1/wallets/me/transactions`

**Purpose**
- List the current user’s wallet transactions in reverse chronological order, with cursor‑based pagination.

**Auth**
- Requires access token (JWT).

**Request**
- Headers:
  - `Authorization: Bearer <accessToken>`
  - `X-Request-Id?`
- Query:
  - `cursor?` – opaque cursor (see pagination util).
  - `limit?` – number of items (1–250, default 25).

**Response**
- `200 OK`
  ```json
  {
    "data": [
      {
        "transactionId": "txn_123",
        "type": "P2P_TRANSFER",
        "direction": "OUTGOING",         // or "INCOMING"
        "counterpartyUserId": "usr_456", // recipient or sender
        "counterpartyMaskedName": "John D.",
        "counterpartyMaskedIdentifier": "john***@example.com",
        "amountMinor": 100000,
        "feeMinor": 0,
        "currency": "IDR",
        "note": "Dinner",
        "status": "COMPLETED",
        "createdAt": "2025-01-01T12:34:56.000Z"
      }
    ],
    "meta": {
      "nextCursor": "opaque-cursor-or-null",
      "limit": 25
    }
  }
  ```

**Errors (examples)**
- `401 Unauthorized` – invalid/missing access token.

## Transfer Endpoints

### POST `/v1/transactions/transfer`

**Purpose**
- Create a P2P transfer from the authenticated user’s wallet to another user’s wallet within the system.

**Auth**
- Requires access token (JWT).
- May additionally require a **step‑up token** for high‑risk transfers (see below).

**Headers**
- `Authorization: Bearer <accessToken>` – required.
- `X-Request-Id?`
- `Idempotency-Key?` – recommended for safe retries.
- `X-Step-Up-Token?` – required when step‑up is enforced (high‑value or risky transfer).

**Request Body**
- Content type: `application/json`
  ```json
  {
    "recipient": {
      "userId": "usr_456",
      "email": "recipient@example.com"
    },
    "amountMinor": 100000,
    "currency": "IDR",
    "note": "Dinner",
    "clientReference": "mobile-uuid-123", // optional, for client-side idempotency
    "stepUpToken": "optional-if-header-used"
  }
  ```

Notes:
- Either `recipient.userId` or `recipient.email` (or another identifier such as phone/username in future) is required; only one should be provided.
- `clientReference` enables clients to correlate retries with a specific transfer; the server can use it as an additional idempotency key.
- `stepUpToken` may be passed in the header **or** in the body; implementation should support one canonical source and reject conflicting values.

**Behaviour**
- Resolve recipient to a specific user and wallet.
- Validate:
  - Sender and recipient are different users.
  - Wallet statuses (sender must be active; recipient must not be closed).
  - Currency compatibility.
  - Amount is within configured min/max limits.
  - Sender has sufficient available balance for `amountMinor + feeMinor`.
  - Step‑up token when required:
    - Verify signature and expiry.
    - Ensure `type === "step_up"` and `sub` matches the authenticated user.
    - Ensure `purpose` is acceptable (e.g., contains `transaction:transfer`).
- Execute the transfer atomically:
  - Debit sender wallet; credit recipient wallet.
  - Record transaction and ledger entries.
- Enforce idempotency:
  - Requests with the same `Idempotency-Key` (and same sender) must not create duplicate transfers.
  - On a retry, return the original transaction with `Idempotency-Replayed: true`.

**Response**
- `201 Created` on first success:
  ```json
  {
    "data": {
      "transactionId": "txn_123",
      "status": "COMPLETED",
      "fromWalletId": "wal_sender",
      "toWalletId": "wal_recipient",
      "amountMinor": 100000,
      "feeMinor": 0,
      "currency": "IDR",
      "note": "Dinner",
      "createdAt": "2025-01-01T12:34:56.000Z",
      "stepUpUsed": true,
      "clientReference": "mobile-uuid-123"
    },
    "meta": {}
  }
  ```
- `200 OK` with `Idempotency-Replayed: true` when returning a cached result for the same logical transfer.

**Errors (examples)**
- `400 Bad Request`
  - Invalid recipient specification (both or neither of `userId` and `email`).
  - Amount too small or invalid currency.
- `401 Unauthorized`
  - Invalid/missing access token.
  - Missing/invalid step‑up token when required (with `ErrorCode.UNAUTHORIZED` or `FORBIDDEN` as appropriate).
- `403 Forbidden`
  - Wallet blocked/suspended.
- `404 Not Found`
  - Recipient not found (`ErrorCode.NOT_FOUND`).
- `409 Conflict`
  - Client reference reused inconsistently.
- `422 Unprocessable Entity` (optional)
  - Business rule violations not covered by other codes.

### GET `/v1/transactions/{id}`

**Purpose**
- Fetch details of a specific transaction belonging to the authenticated user (either as sender or recipient).

**Auth**
- Requires access token (JWT).

**Request**
- Headers:
  - `Authorization: Bearer <accessToken>`
  - `X-Request-Id?`
- Path parameters:
  - `id` – transaction identifier.

**Response**
- `200 OK`
  ```json
  {
    "data": {
      "transactionId": "txn_123",
      "type": "P2P_TRANSFER",
      "role": "SENDER",   // or "RECIPIENT"
      "fromWalletId": "wal_sender",
      "toWalletId": "wal_recipient",
      "amountMinor": 100000,
      "feeMinor": 0,
      "currency": "IDR",
      "note": "Dinner",
      "status": "COMPLETED",
      "createdAt": "2025-01-01T12:34:56.000Z",
      "stepUpUsed": true
    },
    "meta": {}
  }
  ```

**Errors (examples)**
- `401 Unauthorized` – invalid/missing access token.
- `404 Not Found` – transaction not found or does not belong to the user.

## Recipient Resolution (Optional but Recommended)

### POST `/v1/recipients/resolve`

**Purpose**
- Resolve a user‑friendly identifier into a recipient suitable for transfers, without creating a transaction. This enables a safe “review screen” before final confirmation.

**Auth**
- Requires access token (JWT).

**Request**
- Headers:
  - `Authorization: Bearer <accessToken>`
  - `X-Request-Id?`
- Body:
  ```json
  {
    "identifier": {
      "email": "recipient@example.com"
    }
  }
  ```

**Response**
- `200 OK`
  ```json
  {
    "data": {
      "userId": "usr_456",
      "displayName": "John Doe",
      "maskedIdentifier": "john***@example.com",
      "canReceiveTransfers": true
    },
    "meta": {}
  }
  ```

**Errors (examples)**
- `404 Not Found` – identifier does not map to an eligible recipient.

## Step‑Up Integration Notes

- Transfer endpoints do **not** directly generate step‑up challenges; they consume `stepUpToken` produced by the existing `/v1/auth/step-up/*` endpoints.
- The expected flow for clients is:
  1. Evaluate whether step‑up is required (via configuration returned by wallet endpoints or error responses).
  2. If required, call:
     - `POST /v1/auth/step-up/challenge`
     - `POST /v1/auth/step-up/verify`
  3. Receive `stepUpToken` and immediately call `POST /v1/transactions/transfer` with the token attached.
- Sensitive endpoints (like transfer creation) must:
  - Reject stale or missing step‑up tokens when a policy requires them.
  - Allow transfers without step‑up when policy explicitly permits it (e.g., small amounts).

These endpoint definitions are the foundation for updating `docs/openapi/openapi.yaml` and implementing the corresponding Nest modules (`WalletsModule`, `TransactionsModule`) in the next phase.

