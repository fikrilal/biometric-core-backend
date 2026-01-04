# Error Codes (Problem Details)

This backend uses RFC 7807-style “Problem Details” for error responses and a stable `code` field (`ErrorCode`) so clients can handle errors deterministically without scraping `title`/`detail`.

Source of truth for codes: `src/common/errors/error-codes.ts`.

OpenAPI convention: every operation should list its expected `code` values in `x-error-codes` within `docs/openapi/openapi.yaml`.

## Error Response Shape

All non-2xx responses should be returned as `application/problem+json`:

```json
{
  "type": "about:blank",
  "title": "Invalid credentials",
  "status": 401,
  "detail": "Optional human-readable explanation",
  "code": "UNAUTHORIZED",
  "traceId": "x-request-id value"
}
```

- `code` is the primary machine-readable signal for clients.
- `detail` is optional and must not leak sensitive information.
- `traceId` matches `X-Request-Id`.
- `INTERNAL` may occur on any endpoint (unexpected failures); clients should handle it generically.

## Error Code Catalog

| Code | Meaning (client-facing) |
| --- | --- |
| `VALIDATION_FAILED` | Request payload/query/header is invalid (DTO validation, malformed input, business validation). |
| `UNAUTHORIZED` | Missing/invalid credentials (generic). Prefer a more specific auth code when available. |
| `INVALID_CREDENTIALS` | Email/password credentials are invalid. |
| `INVALID_REFRESH_TOKEN` | Refresh token is invalid, expired, revoked, or malformed. |
| `FORBIDDEN` | Authenticated but not allowed for this action (policy/purpose mismatch). |
| `NOT_FOUND` | Requested resource does not exist or is not accessible. |
| `CONFLICT` | Resource conflict (uniqueness, idempotency mismatch, already exists). |
| `RATE_LIMITED` | Too many requests; retry later. |
| `IDEMPOTENCY_IN_PROGRESS` | Same `Idempotency-Key` request is currently being processed. |
| `EMAIL_NOT_VERIFIED` | Account email must be verified before continuing. |
| `CHALLENGE_EXPIRED` | WebAuthn challenge is missing/expired/consumed. |
| `NO_CREDENTIALS` | No active WebAuthn credentials exist for the user. |
| `CREDENTIAL_REVOKED` | Reserved: credential/device is revoked. (Not currently emitted.) |
| `CREDENTIAL_COMPROMISED` | WebAuthn signCount regression detected; credential revoked and must be re-enrolled. |
| `INSUFFICIENT_FUNDS` | Wallet balance is insufficient for transfer. |
| `LIMIT_EXCEEDED` | Transfer violates per-transaction or daily limits. |
| `WALLET_BLOCKED` | Wallet is not in an allowed state for transfers (e.g., suspended/closed). |
| `RECIPIENT_NOT_FOUND` | Transfer recipient cannot be resolved. |
| `SAME_WALLET_TRANSFER` | Transfers to self are not allowed. |
| `INTERNAL` | Unexpected server error; retry may succeed. |

## Endpoint → Error Codes (Current)

Notes:
- Any `POST`/`DELETE` endpoint may return `IDEMPOTENCY_IN_PROGRESS` (409) when `Idempotency-Key` is used and a concurrent request is running.
- Any endpoint protected by Bearer auth may return `UNAUTHORIZED` (401) from the JWT guard.

### Auth: Email/Password (`/v1/auth/password/*`)

- `POST /v1/auth/password/register`
  - `VALIDATION_FAILED`, `CONFLICT`, `INTERNAL` (email provider failures)
- `POST /v1/auth/password/login`
  - `VALIDATION_FAILED`, `INVALID_CREDENTIALS`, `EMAIL_NOT_VERIFIED`, `RATE_LIMITED`
- `POST /v1/auth/password/refresh`
  - `VALIDATION_FAILED`, `INVALID_REFRESH_TOKEN`, `EMAIL_NOT_VERIFIED`, `RATE_LIMITED`
- `POST /v1/auth/password/logout`
  - `VALIDATION_FAILED`
- `POST /v1/auth/password/verify/request`
  - `VALIDATION_FAILED`, `INTERNAL` (email provider failures)
- `POST /v1/auth/password/verify/confirm`
  - `VALIDATION_FAILED`
- `POST /v1/auth/password/reset/request`
  - `VALIDATION_FAILED`, `INTERNAL` (email provider failures)
- `POST /v1/auth/password/reset/confirm`
  - `VALIDATION_FAILED`, `NOT_FOUND`

### Auth: Google (`/v1/auth/google*`)

- `POST /v1/auth/google`
  - `VALIDATION_FAILED`, `UNAUTHORIZED`, `EMAIL_NOT_VERIFIED`, `CONFLICT`
- `POST /v1/auth/google/connect`
  - `VALIDATION_FAILED`, `UNAUTHORIZED`, `FORBIDDEN`, `EMAIL_NOT_VERIFIED`, `CONFLICT`

### Auth: WebAuthn (`/v1/auth/*`)

- `POST /v1/auth/challenge`
  - `VALIDATION_FAILED`, `NOT_FOUND`, `EMAIL_NOT_VERIFIED`, `NO_CREDENTIALS`, `RATE_LIMITED`
- `POST /v1/auth/verify`
  - `VALIDATION_FAILED`, `NOT_FOUND`, `EMAIL_NOT_VERIFIED`, `UNAUTHORIZED`, `CREDENTIAL_COMPROMISED`, `INTERNAL`
- `POST /v1/auth/step-up/challenge`
  - `VALIDATION_FAILED`, `NOT_FOUND`, `EMAIL_NOT_VERIFIED`, `NO_CREDENTIALS`, `RATE_LIMITED`
- `POST /v1/auth/step-up/verify`
  - `VALIDATION_FAILED`, `CHALLENGE_EXPIRED`, `NOT_FOUND`, `EMAIL_NOT_VERIFIED`, `UNAUTHORIZED`, `CREDENTIAL_COMPROMISED`, `INTERNAL`

### Enrollment (`/v1/enroll/*`)

- `POST /v1/enroll/challenge`
  - `VALIDATION_FAILED`, `NOT_FOUND`, `EMAIL_NOT_VERIFIED`, `RATE_LIMITED`
- `POST /v1/enroll/verify`
  - `VALIDATION_FAILED`, `CHALLENGE_EXPIRED`, `NOT_FOUND`, `CONFLICT`, `INTERNAL`

### Users (`/v1/users/*`)

- `POST /v1/users`
  - `VALIDATION_FAILED`, `CONFLICT`
- `GET /v1/users`
  - `VALIDATION_FAILED`
- `GET /v1/users/:id`
  - `NOT_FOUND`
- `GET /v1/users/me`
  - `UNAUTHORIZED`

### Devices (`/v1/devices/*`)

- `GET /v1/devices`
  - `VALIDATION_FAILED`, `UNAUTHORIZED`
- `DELETE /v1/devices/:id`
  - `NOT_FOUND`, `UNAUTHORIZED`

### Wallets (`/v1/wallets/*`)

- `GET /v1/wallets/me`
  - `UNAUTHORIZED`
- `GET /v1/wallets/me/transactions`
  - `VALIDATION_FAILED`, `UNAUTHORIZED`

### Transactions (`/v1/transactions/*`)

- `POST /v1/transactions/recipients/resolve`
  - `VALIDATION_FAILED`, `NOT_FOUND`, `UNAUTHORIZED`
- `POST /v1/transactions/transfer`
  - `VALIDATION_FAILED`, `RECIPIENT_NOT_FOUND`, `SAME_WALLET_TRANSFER`, `WALLET_BLOCKED`, `LIMIT_EXCEEDED`, `INSUFFICIENT_FUNDS`, `UNAUTHORIZED`, `FORBIDDEN`, `CONFLICT`
- `GET /v1/transactions/:id`
  - `NOT_FOUND`, `UNAUTHORIZED`

## When Adding/Changing Errors

1. Reuse an existing `ErrorCode` when possible.
2. If a new code is needed:
   - Add it to `src/common/errors/error-codes.ts`.
   - Document it in this file.
   - Update `docs/openapi/openapi.yaml` endpoint docs to include it (either in descriptions or via a consistent extension like `x-error-codes`).
