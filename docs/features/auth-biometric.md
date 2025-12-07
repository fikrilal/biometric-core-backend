# Auth Module – Biometric (WebAuthn)

## Purpose
Authenticate users using previously enrolled WebAuthn credentials and issue JWT tokens for API access.

## Endpoints (v1)
- POST `/v1/auth/challenge` → `{ data: { challengeId, publicKeyCredentialOptions } }`
- POST `/v1/auth/verify` → `{ data: { accessToken, refreshToken, expiresIn } }`

## Flow
1) Client requests assertion options (identify user by `email` or `userId`).
2) Server generates options; stores a short‑lived challenge in Redis with TTL; returns options.
3) Client performs WebAuthn get; sends assertion response.
4) Server verifies assertion (`@simplewebauthn/server`), checks credential + signCount, mints tokens.

## Validation & Security
- Enforce RP ID, origin, and challenge one‑time/TTL rules.
- Update signCount to mitigate cloned authenticators; reject non‑monotonic counts when appropriate.

## Errors
- 400: invalid assertion (`code: VALIDATION_FAILED`)
- 401: no valid credential for user (`code: UNAUTHORIZED`)
- 404: user/credential not found (`code: NOT_FOUND`)

## Acceptance Criteria
- Valid assertion returns tokens with proper expiry.
- Invalid assertion returns 400; revoked device returns 401/404 as designed.

## Test Plan
- e2e: challenge → verify happy path (with test vectors/mocks); invalid assertion; stale signCount.
