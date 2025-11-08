# Enrollment Module – WebAuthn (Create)

## Purpose
Allow users to enroll a device credential (public key) via WebAuthn attestation. This links a biometric-capable authenticator to a user account.

## Endpoints (v1)
- POST `/v1/enroll/challenge` → `{ data: { challengeId, publicKeyCredentialOptions } }`
- POST `/v1/enroll/verify` → `{ data: { credentialId, deviceId } }`

## Flow
1) Client requests challenge (identify user by `email` or `userId`).
2) Server generates creation options; stores a short‑lived challenge in Redis with TTL; returns options.
3) Client performs WebAuthn create; sends attestation response.
4) Server verifies attestation (`@simplewebauthn/server`), persists credential and device, emits audit event.

## Persistence
- `Credential { id, userId, credentialId, publicKey, signCount, aaguid?, transports?, createdAt }`
- `Device { id, userId, credentialId, active, createdAt }`

## Validation & Security
- Enforce RP ID and origin checks; verify attestation statements; update FIDO metadata when needed.
- TTL for challenges (e.g., 2–5 minutes). One‑time use.

## Errors
- 400: invalid attestation (`code: VALIDATION_FAILED`)
- 404: user not found (`code: NOT_FOUND`) or challenge expired
- 409: credentialId already registered (`code: CONFLICT`)

## Acceptance Criteria
- Successful verify persists credential and device and returns ids.
- Reuse of challenge is rejected; expired challenges rejected.

## Test Plan
- e2e: challenge → verify happy path (with test vectors/mocks); expired and replay checks.
