# Auth Module – Email & Password

## Rationale
Biometric login requires an existing account. This module provides initial registration and classic login with refresh/access tokens.

## Endpoints (v1)
- POST `/v1/auth/register` — create account with email + password
- POST `/v1/auth/login` — login with email + password → `{ accessToken, refreshToken, expiresIn }`
- POST `/v1/auth/refresh` — rotate refresh token, return new tokens
- POST `/v1/auth/logout` — revoke refresh token (optional if using stateless short-lived refresh via denylist)

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

## Acceptance Criteria
- Registering same email returns 409.
- Login returns access/refresh tokens; refresh rotates and invalidates prior token.
- Logout revokes refresh token/family.

## Test Plan
- e2e: register → login → refresh → logout; invalid creds 401; re-register 409.
- unit: password hashing/verification, token service.
