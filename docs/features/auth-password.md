# Auth Module – Email & Password

## Rationale
Biometric login requires an existing account. This module provides initial registration and classic login with refresh/access tokens.

## Endpoints (v1)
- POST `/v1/auth/register` — create account with email + password
- POST `/v1/auth/login` — login with email + password → `{ accessToken, refreshToken, expiresIn }`
- POST `/v1/auth/refresh` — rotate refresh token, return new tokens
- POST `/v1/auth/logout` — revoke refresh token (optional if using stateless short-lived refresh via denylist)
- POST `/v1/auth/verify/request` — send verification email (code/link)
- POST `/v1/auth/verify/confirm` — confirm email with token/code
- POST `/v1/auth/password/reset/request` — send password reset email
- POST `/v1/auth/password/reset/confirm` — set new password using token

## Security & Tokens
- Access token (JWT) short-lived (e.g., 15m);
- Refresh token long-lived (e.g., 7d) with rotation; on use, rotate and invalidate previous.
- Signing via `jose` (recommended) or `@nestjs/jwt`.
- Store refresh state in DB (token family) or maintain a denylist (Redis) to support logout.

## Passwords
- Hash: Argon2id (preferred) or bcrypt with strong cost.
- Store `passwordHash` on `User`; never store plaintext.
- Rate limit login attempts and consider delays/backoff.

## Validation
- Register: email (RFC compliant), password strength policy (min length, complexity as needed).
- Login: generic 401 for invalid credentials; do not leak which field failed.

## Errors
- 400: invalid input (`code: VALIDATION_FAILED`)
- 401: bad credentials (`code: UNAUTHORIZED`)
- 409: email already exists (`code: CONFLICT`)

## Headers
- `X-Request-Id` echoed; `Idempotency-Key` accepted for `/auth/register`.

## Account Verification & Lifecycle
- Verification tokens stored with expiry, one-time use; support both code (6 digits) and link (UUID) options.
- Registration response indicates `emailVerified` flag (false until confirmed).
- Password reset tokens stored separately; invalidated once used/reset.

## Acceptance Criteria
- Registering same email returns 409.
- Login returns access/refresh tokens; refresh rotates and invalidates prior token.
- Logout revokes refresh token/family.
- Verification tokens expire (e.g., 24h) and can be re-sent; verifying flips `emailVerified`.
- Password reset flow requires valid token and enforces new password requirements.

## Test Plan
- e2e: register → login → refresh → logout; invalid creds 401; re-register 409; verify email; request/confirm password reset.
- unit: password hashing/verification, token service, token generation/expiry logic.
