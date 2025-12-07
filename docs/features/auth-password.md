# Auth Module – Email & Password

## Rationale
Biometric login requires an existing account. This module provides initial registration and classic login with refresh/access tokens.

## Endpoints (v1)
- POST `/v1/auth/register` — create account with email + password
- POST `/v1/auth/login` — login with email + password → `{ accessToken, refreshToken, expiresIn }`
- POST `/v1/auth/refresh` — rotate refresh token, return new tokens
- POST `/v1/auth/logout` — revoke refresh token (optional if using stateless short-lived refresh via denylist)
- POST `/v1/auth/verify/request` — send verification email (code/link)
- POST `/v1/auth/verify/confirm` — confirm email with opaque token (no additional identifiers)
- POST `/v1/auth/password/reset/request` — send password reset email
- POST `/v1/auth/password/reset/confirm` — set new password using the opaque token

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
- Rate limiting: `/v1/auth/password/login` limited to 5 attempts per minute per (email + IP); `/v1/auth/password/refresh` limited to 20 per minute per (refresh token + IP). Exceeding the budget returns `429` with `code: RATE_LIMITED`.

## Errors
- 400: invalid input (`code: VALIDATION_FAILED`)
- 401: bad credentials (`code: UNAUTHORIZED`)
- 409: email already exists (`code: CONFLICT`)

## Headers
- `X-Request-Id` echoed; `Idempotency-Key` accepted for `/auth/register`.

## Account Verification & Lifecycle
- Verification tokens stored with expiry, one-time use; distributed as opaque tokens embedded in a link (no email parameter required).
- Registration response indicates `emailVerified` flag (false until confirmed).
- Password reset tokens stored separately; invalidated once used/reset.

## Email Delivery
- Local/dev flows use the in-memory `MockEmailService` (tokens logged to stdout and captured by tests).
- Set `RESEND_API_KEY` + `EMAIL_FROM_ADDRESS` to enable the Resend API; optional `EMAIL_FROM_NAME`, `EMAIL_VERIFICATION_URL`, and `PASSWORD_RESET_URL` customize branding/links.
- Verification/password-reset endpoints always send opaque tokens; when URLs are configured the service appends `?token=` automatically.

## Acceptance Criteria
- Registering same email returns 409.
- Login returns access/refresh tokens; refresh rotates and invalidates prior token.
- Logout revokes refresh token/family.
- Verification tokens expire (e.g., 24h) and can be re-sent; verifying flips `emailVerified`.
- Password reset flow requires valid token and enforces new password requirements.

## Test Plan
- e2e: register → login → refresh → logout; invalid creds 401; re-register 409; verify email; request/confirm password reset.
- unit: password hashing/verification, token service, token generation/expiry logic.
