# Biometric Auth – Implementation Plan

This document outlines the implementation plan for adding WebAuthn‑based biometric enrollment, login, and step‑up flows. It is intended as a living checklist to prevent scope drift and to keep implementation aligned with the architecture and flows.

## Phase 0 – Dependencies & Configuration

- [ ] Add `@simplewebauthn/server` as a dependency.
- [ ] Ensure Redis and Prisma are already configured (they are).
- [ ] Extend env validation (`src/config/env.validation.ts`) with:
  - [ ] `WEBAUTHN_RP_ID` (required in non‑test environments).
  - [ ] `WEBAUTHN_RP_NAME` (optional, defaults to app name).
  - [ ] `WEBAUTHN_ORIGINS` (comma‑separated list of allowed origins).
  - [ ] `WEBAUTHN_CHALLENGE_TTL_MS` (optional; default 180000).
  - [ ] `WEBAUTHN_SIGNCOUNT_MODE` (e.g., `strict` / `lenient` – optional).
- [ ] Document these env vars in the main README and/or config docs.

## Phase 1 – Prisma Schema Changes

Files: `prisma/schema.prisma`.

- [ ] Add `Credential` model:
  - [ ] Fields:
    - `id String @id @default(cuid())`
    - `userId String`
    - `credentialId String` (unique per credential).
    - `publicKey String` or `Bytes`.
    - `signCount Int @default(0)`
    - `aaguid String?`
    - `transports String?` (JSON or CSV string).
    - `deviceName String?`
    - `revoked Boolean @default(false)`
    - `revokedAt DateTime?`
    - `createdAt DateTime @default(now())`
  - [ ] Relation:
    - `user User @relation(fields: [userId], references: [id], onDelete: Cascade)`
  - [ ] Indexes:
    - `@@unique([credentialId])`
    - `@@index([userId])`

- [ ] Add `Device` model:
  - [ ] Fields:
    - `id String @id @default(cuid())`
    - `userId String`
    - `credentialId String`
    - `label String?`
    - `active Boolean @default(true)`
    - `createdAt DateTime @default(now())`
    - `deactivatedAt DateTime?`
    - `deactivatedReason String?`
  - [ ] Relations:
    - `user User @relation(fields: [userId], references: [id], onDelete: Cascade)`
    - `credential Credential @relation(fields: [credentialId], references: [id], onDelete: Cascade)`
  - [ ] Indexes:
    - `@@index([userId])`
    - `@@index([credentialId])`

- [ ] Run `npx prisma migrate dev` and update `PrismaService` typings.

## Phase 2 – WebAuthn Service & Module

Files (proposed): `src/webauthn/webauthn.module.ts`, `src/webauthn/webauthn.service.ts`.

- [ ] Create `WebAuthnModule`:
  - [ ] Import `ConfigModule` and `RedisModule`.
  - [ ] Provide `WebAuthnService`.

- [ ] Implement `WebAuthnService`:
  - [ ] Read RP configuration from env (`RP_ID`, `RP_NAME`, `ORIGINS`).
  - [ ] Expose:
    - `generateRegistrationOptions(user, existingCredentials)`:
      - Wraps `@simplewebauthn/server.generateRegistrationOptions`.
    - `verifyRegistrationResponse({ expectedChallenge, expectedOrigin, expectedRPID, credential })`.
    - `generateAuthenticationOptions(credentials)`:
      - Wraps `generateAuthenticationOptions`.
    - `verifyAuthenticationResponse({ expectedChallenge, expectedOrigin, expectedRPID, credential, credentialPublicKey, credentialCurrentSignCount })`.
  - [ ] Handle parsing/formatting of credential IDs (base64url vs Buffer).
  - [ ] Respect configured challenge TTL and signCount mode where applicable.

## Phase 3 – Shared Token Issuance & JWT Guard

Files (proposed): `src/auth/auth-tokens.service.ts`, `src/auth/jwt.strategy.ts`, `src/auth/jwt-auth.guard.ts`, `src/auth/current-user.decorator.ts`.

- [ ] Create `AuthTokensService`:
  - [ ] Depends on `TokenService` and `PrismaService`.
  - [ ] Expose `issueTokensForUser(userId: string): Promise<AuthTokensResponse>`.
  - [ ] Internally:
    - Loads user from Prisma.
    - Enforces `emailVerified` before issuing tokens.
    - Signs access and refresh tokens, storing hashed refresh tokens in DB (reusing pattern from `AuthPasswordService`).
  - [ ] Refactor `AuthPasswordService` to use `AuthTokensService` instead of a private `issueTokens` helper.

- [ ] Add `JwtStrategy` / `JwtAuthGuard`:
  - [ ] Verify access tokens via `TokenService` (new `verifyAccessToken` method).
  - [ ] Attach `userId` and optional metadata to the request.
  - [ ] Provide `@CurrentUser()` decorator for controllers.

## Phase 4 – Enrollment Module

Files (proposed): `src/enrollment/enrollment.module.ts`, `src/enrollment/enrollment.controller.ts`, `src/enrollment/enrollment.service.ts`, DTOs under `src/enrollment/dto`.

- [ ] Create `EnrollmentModule`:
  - [ ] Import `PrismaModule`, `RedisModule`, `WebAuthnModule`, `ConfigModule`, and `AuthModule` (if JWT guard used).

- [ ] Define DTOs:
  - [ ] `EnrollChallengeDto` (request):
    - Option A: `{ email?: string; userId?: string; deviceName?: string }`.
    - Option B: empty, if using JWT and ignoring body identifiers.
  - [ ] `EnrollChallengeResponse`:
    - `{ challengeId: string; publicKeyCredentialOptions: any }`.
  - [ ] `EnrollVerifyDto`:
    - `{ challengeId: string; credential: WebAuthnAttestationDto }`.
  - [ ] `EnrollVerifyResponse`:
    - `{ credentialId: string; deviceId: string }`.

- [ ] Implement `EnrollmentService`:
  - [ ] `createChallenge(...)`:
    - Resolve user.
    - Load existing credentials.
    - Generate registration options.
    - Store Redis challenge (context `"enroll"`).
    - Apply rate limiting.
  - [ ] `verifyEnrollment(...)`:
    - Load and delete Redis challenge.
    - Verify attestation via `WebAuthnService`.
    - Create `Credential` and `Device`.
    - Handle conflicts and idempotency.

- [ ] Implement `EnrollmentController`:
  - [ ] `POST /v1/enroll/challenge`.
  - [ ] `POST /v1/enroll/verify`.
  - [ ] Annotate with Swagger decorators.

- [ ] Add module to `AppModule`.
- [ ] Update OpenAPI spec to include enrollment endpoints and schemas.

## Phase 5 – Biometric Login Endpoints

Files: `src/auth/auth.module.ts`, `src/auth/auth.controller.ts`, `src/auth/auth.service.ts`, new DTOs under `src/auth/dto`.

- [ ] Expand `AuthModule`:
  - [ ] Import `PrismaModule`, `RedisModule`, `WebAuthnModule`, `ConfigModule`, and `AuthTokensService`.
  - [ ] Export `JwtAuthGuard` and `AuthTokensService` if needed by other modules.

- [ ] Define DTOs:
  - [ ] `BiometricChallengeDto`:
    - `{ email?: string; userId?: string }`.
  - [ ] `BiometricChallengeResponse`:
    - `{ challengeId: string; publicKeyCredentialOptions: any }`.
  - [ ] `BiometricVerifyDto`:
    - `{ challengeId: string; credential: WebAuthnAssertionDto }`.
  - [ ] `BiometricVerifyResponse`:
    - `AuthTokensResponse` (reuse existing DTO).

- [ ] Implement `AuthService` methods:
  - [ ] `createBiometricLoginChallenge(dto, ip)`:
    - Resolve user.
    - Load active credentials/devices.
    - Generate authentication options.
    - Store Redis challenge (`context: "login"`).
    - Apply rate limiting.
  - [ ] `verifyBiometricLogin(dto, ip)`:
    - Load and delete Redis challenge.
    - Load credential/device and verify assertion.
    - Apply signCount policy (revoking credential if compromised).
    - Issue tokens via `AuthTokensService`.

- [ ] Implement controller endpoints:
  - [ ] `POST /v1/auth/challenge`.
  - [ ] `POST /v1/auth/verify`.
  - [ ] Add Swagger annotations and align OpenAPI spec.

## Phase 6 – Step‑Up Tokens & Integration

Files: `src/auth/token.service.ts`, `src/auth/auth.service.ts`, `src/auth/auth.controller.ts`, sensitive modules that will use step‑up.

- [ ] Extend `TokenService`:
  - [ ] Add `signStepUpToken(payload)` and `verifyStepUpToken(token)`.
  - [ ] Define claims:
    - `type: "step_up"`.
    - `sub: userId`.
    - `purpose: string`.
    - `challengeId: string`.
    - `iat`, `exp` (short lifetime).

- [ ] Add DTOs:
  - [ ] `StepUpChallengeDto` (e.g., `{ purpose?: string }`).
  - [ ] `StepUpChallengeResponse` (`{ challengeId, publicKeyCredentialOptions }`).
  - [ ] `StepUpVerifyDto` (`{ challengeId, credential }`).
  - [ ] `StepUpVerifyResponse` (`{ stepUpToken: string }`).

- [ ] Implement `AuthService` step‑up methods:
  - [ ] `createStepUpChallenge(userId, purpose, ip)`:
    - Requires JWT (access token).
  - [ ] `verifyStepUp(userIdFromToken, dto, ip)`:
    - Validates Redis challenge (`context: "step_up"`).
    - Verifies assertion and signCount.
    - Issues step‑up token with purpose and short TTL.

- [ ] Implement controller endpoints:
  - [ ] `POST /v1/auth/step-up/challenge` (guarded by `JwtAuthGuard`).
  - [ ] `POST /v1/auth/step-up/verify` (guarded by `JwtAuthGuard`).

- [ ] Integrate step‑up into sensitive modules:
  - [ ] For each sensitive endpoint (e.g., `transactions`):
    - Require `Authorization: Bearer ...`.
    - Accept `stepUpToken` (header or body).
    - Validate via `TokenService.verifyStepUpToken`.
    - Check purpose matches allowed values.

## Phase 7 – Device Management Module

Files (proposed): `src/devices/devices.module.ts`, `src/devices/devices.controller.ts`, `src/devices/devices.service.ts`, DTOs under `src/devices/dto`.

- [ ] Create `DevicesModule`:
  - [ ] Import `PrismaModule` and `AuthModule`.

- [ ] Endpoints:
  - [ ] `GET /v1/devices`:
    - Requires JWT.
    - Returns paginated list of devices for current user via `toPaginated(...)`.
  - [ ] `DELETE /v1/devices/{id}`:
    - Requires JWT.
    - Optionally requires step‑up token for certain operations.
    - Marks device as inactive and optionally revokes credential.

- [ ] OpenAPI:
  - [ ] Add schemas and responses for device listing and revocation.

## Phase 8 – Error Codes, Testing, and Hardening

- [ ] Extend `ErrorCode` enum with WebAuthn‑specific codes:
  - [ ] `CHALLENGE_EXPIRED`.
  - [ ] `NO_CREDENTIALS`.
  - [ ] `CREDENTIAL_REVOKED`.
  - [ ] `CREDENTIAL_COMPROMISED`.

- [ ] Testing:
  - [ ] Unit tests for:
    - `WebAuthnService`.
    - `AuthTokensService`.
    - SignCount policy logic.
    - Step‑up token generation/verification.
  - [ ] E2E tests for:
    - Enrollment happy path and expired challenge.
    - Biometric login happy path and fallback to password.
    - Step‑up happy path and expired/missing/invalid step‑up token.
    - Revoked device behavior.

- [ ] Logging & Observability:
  - [ ] Ensure logs include:
    - `userId`, `credentialId`, `deviceId` where applicable.
    - IP and user agent (without leaking sensitive fields).
  - [ ] Add counters/metrics for:
    - Enrollment attempts/successes.
    - Biometric logins.
    - Step‑up requests.
    - Credential/device revocations.

