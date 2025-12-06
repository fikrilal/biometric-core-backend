# Biometric Auth – Implementation Plan

This document outlines the implementation plan for adding WebAuthn‑based biometric enrollment, login, and step‑up flows. It is intended as a living checklist to prevent scope drift and to keep implementation aligned with the architecture and flows.

## Phase 0 – Dependencies & Configuration

- [x] Add `@simplewebauthn/server` as a dependency.
- [x] Ensure Redis and Prisma are already configured (they are).
- [x] Extend env validation (`src/config/env.validation.ts`) with:
  - [x] `WEBAUTHN_RP_ID` (required in non‑test environments).
  - [x] `WEBAUTHN_RP_NAME` (optional, defaults to app name).
  - [x] `WEBAUTHN_ORIGINS` (comma‑separated list of allowed origins).
  - [x] `WEBAUTHN_CHALLENGE_TTL_MS` (optional; default 180000).
  - [x] `WEBAUTHN_SIGNCOUNT_MODE` (e.g., `strict` / `lenient` – optional).
- [x] Document these env vars in the main README and/or config docs.

## Phase 1 – Prisma Schema Changes

Files: `prisma/schema.prisma`.

- [x] Add `Credential` model:
  - [x] Fields:
    - `id String @id @default(cuid())`
    - `userId String`
    - `credentialId String` (unique per credential).
    - `publicKey Bytes`
    - `signCount Int @default(0)`
    - `aaguid String?`
    - `transports String?` (JSON or CSV string).
    - `deviceName String?`
    - `revoked Boolean @default(false)`
    - `revokedAt DateTime?`
    - `createdAt DateTime @default(now())`
  - [x] Relation:
    - `user User @relation(fields: [userId], references: [id], onDelete: Cascade)`
  - [x] Indexes:
    - `@@unique([credentialId])`
    - `@@index([userId])`

- [x] Add `Device` model:
  - [x] Fields:
    - `id String @id @default(cuid())`
    - `userId String`
    - `credentialId String`
    - `label String?`
    - `active Boolean @default(true)`
    - `createdAt DateTime @default(now())`
    - `deactivatedAt DateTime?`
    - `deactivatedReason String?`
  - [x] Relations:
    - `user User @relation(fields: [userId], references: [id], onDelete: Cascade)`
    - `credential Credential @relation(fields: [credentialId], references: [id], onDelete: Cascade)`
  - [x] Indexes:
    - `@@index([userId])`
    - `@@index([credentialId])`

- [x] Run `npx prisma migrate dev` and update `PrismaService` typings.

## Phase 2 – WebAuthn Service & Module

Files (proposed): `src/webauthn/webauthn.module.ts`, `src/webauthn/webauthn.service.ts`.

- [x] Create `WebAuthnModule`:
  - [x] Import `ConfigModule` and `RedisModule`.
  - [x] Provide `WebAuthnService`.

- [x] Implement `WebAuthnService`:
  - [x] Read RP configuration from env (`RP_ID`, `RP_NAME`, `ORIGINS`).
  - [x] Expose:
    - `generateRegistrationOptionsForUser(user, existingCredentials)`:
      - Wraps `@simplewebauthn/server.generateRegistrationOptions`.
    - `verifyRegistration(response, expectedChallenge)`:
      - Wraps `verifyRegistrationResponse`.
    - `generateAuthenticationOptionsForUser(credentials)`:
      - Wraps `generateAuthenticationOptions`.
    - `verifyAuthentication(response, expectedChallenge, credential)`:
      - Wraps `verifyAuthenticationResponse` and returns new signCount.
  - [x] Handle parsing/formatting of credential IDs (base64url vs Buffer-compatible Uint8Array conversion for user IDs).
  - [x] Respect configured challenge TTL and signCount mode where applicable (exposed via getters for use by higher-level services).

## Phase 3 – Shared Token Issuance & JWT Guard

Files (proposed): `src/auth-password/auth-tokens.service.ts`, `src/auth/jwt-auth.guard.ts`, `src/auth/current-user.decorator.ts`.

- [x] Create `AuthTokensService`:
  - [x] Depends on `TokenService` and `PrismaService`.
  - [x] Expose `issueTokensForUser(user: { id: string; emailVerified: boolean }): Promise<AuthTokensResponse>`.
  - [x] Internally:
    - [x] Signs access and refresh tokens using `TokenService`.
    - [x] Stores hashed refresh tokens in DB via Prisma (reusing pattern from `AuthPasswordService`).
  - [x] Refactor `AuthPasswordService` to use `AuthTokensService` instead of a private `issueTokens` helper.

- [x] Add `JwtAuthGuard` and `@CurrentUser` decorator:
  - [x] Verify access tokens via `TokenService.verifyAccessToken`.
  - [x] Attach `userId` and token payload to `FastifyRequest.user`.
  - [x] Provide `@CurrentUser()` decorator for controllers to access the attached user.

## Phase 4 – Enrollment Module

Files (proposed): `src/enrollment/enrollment.module.ts`, `src/enrollment/enrollment.controller.ts`, `src/enrollment/enrollment.service.ts`, DTOs under `src/enrollment/dto`.

- [x] Create `EnrollmentModule`:
  - [x] Import `PrismaModule`, `RedisModule`, `WebAuthnModule`, and `AuthModule` for JWT guard.

- [x] Define DTOs:
  - [x] `EnrollChallengeDto` (request):
    - `{ deviceName?: string }` (user derived from JWT).
  - [x] `EnrollChallengeResponse`:
    - `{ challengeId: string; publicKeyCredentialOptions: PublicKeyCredentialCreationOptionsJSON }`.
  - [x] `EnrollVerifyDto`:
    - `{ challengeId: string; credential: RegistrationResponseJSON }`.
  - [x] `EnrollVerifyResponse`:
    - `{ credentialId: string; deviceId: string }`.

- [x] Implement `EnrollmentService`:
  - [x] `createChallenge(userId, dto, ip?)`:
    - Resolve user.
    - Enforce `emailVerified`.
    - Load existing credentials.
    - Generate registration options via `WebAuthnService`.
    - Store Redis challenge (context `"enroll"`) with TTL via `WebAuthnService.getChallengeTtlMs()`.
    - Apply rate limiting via `RateLimiterService`.
  - [x] `verifyEnrollment(dto)`:
    - Load and delete Redis challenge.
    - Enforce TTL using stored `createdAt`.
    - Verify attestation via `WebAuthnService`.
    - Upsert `Credential` and create `Device`.
    - Handle conflicts when credential is already registered to a different user.

- [x] Implement `EnrollmentController`:
  - [x] `POST /v1/enroll/challenge` (guarded by `JwtAuthGuard`, user from `@CurrentUser()`).
  - [x] `POST /v1/enroll/verify`.
  - [x] Annotate with Swagger decorators.

- [x] Add module to `AppModule`.
- [x] Update OpenAPI spec to include enrollment endpoints and schemas.

## Phase 5 – Biometric Login Endpoints

Files: `src/auth/auth.module.ts`, `src/auth/auth.controller.ts`, `src/auth/auth.service.ts`, new DTOs under `src/auth/dto`.

- [x] Expand `AuthModule`:
  - [x] Import `PrismaModule`, `RedisModule`, `WebAuthnModule`, and `AuthPasswordModule` (for `AuthTokensService`).
  - [x] Export `JwtAuthGuard` for reuse by other modules.

- [x] Define DTOs:
  - [x] `BiometricChallengeDto`:
    - `{ email?: string; userId?: string }`.
  - [x] `BiometricChallengeResponse`:
    - `{ challengeId: string; publicKeyCredentialOptions: PublicKeyCredentialRequestOptionsJSON }`.
  - [x] `BiometricVerifyDto`:
    - `{ challengeId: string; credential: AuthenticationResponseJSON }`.
  - [x] `BiometricVerifyResponse`:
    - `AuthTokensResponse` (reuse existing DTO).

- [x] Implement `AuthService` methods:
  - [x] `createBiometricLoginChallenge(dto, ip)`:
    - Resolve user by email or userId.
    - Require `emailVerified`.
    - Load active credentials/devices.
    - Generate authentication options via `WebAuthnService`.
    - Store Redis challenge (`context: "login"`) with TTL via `WebAuthnService.getChallengeTtlMs()`.
    - Apply rate limiting via `RateLimiterService`.
  - [x] `verifyBiometricLogin(dto)`:
    - Load and delete Redis challenge.
    - Enforce TTL using stored `createdAt`.
    - Reload user and ensure `emailVerified`.
    - Load credential/device, verify association and active status.
    - Verify assertion via `WebAuthnService`.
    - Update `signCount` when the new counter is higher.
    - Issue tokens via `AuthTokensService`.

- [x] Implement controller endpoints:
  - [x] `POST /v1/auth/challenge`.
  - [x] `POST /v1/auth/verify`.
  - [x] Add Swagger annotations and align OpenAPI spec (use `AuthChallengeInput` and `AuthVerifyInput`, respond with `EnvelopeAuthTokens` on verify).

## Phase 6 – Step‑Up Tokens & Integration

Files: `src/auth-password/token.service.ts`, `src/auth/auth.service.ts`, `src/auth/auth.controller.ts`, sensitive modules that will use step‑up.

- [x] Extend `TokenService`:
  - [x] Add `signStepUpToken(userId, purpose, challengeId)` and `verifyStepUpToken(token)`.
  - [x] Define claims:
    - [x] `type: "step_up"`.
    - [x] `sub: userId`.
    - [x] `purpose: string | undefined`.
    - [x] `challengeId: string`.
    - [x] `iat`, `exp` (short lifetime; default 120 seconds).

- [x] Add DTOs:
  - [x] `StepUpChallengeDto` (`{ purpose?: string }`).
  - [x] `StepUpChallengeResponse` (`{ challengeId, publicKeyCredentialOptions }`).
  - [x] `StepUpVerifyDto` (`{ challengeId, credential }`).
  - [x] `StepUpVerifyResponse` (`{ stepUpToken: string }`).

- [x] Implement `AuthService` step‑up methods:
  - [x] `createStepUpChallenge(userId, dto, ip)`:
    - [x] Requires JWT (access token).
    - [x] Resolves user and enforces `emailVerified`.
    - [x] Loads active credentials/devices.
    - [x] Generates authentication options via `WebAuthnService`.
    - [x] Stores Redis challenge (reusing `context: "login"`) with TTL via `getChallengeTtlMs()`.
    - [x] Applies rate limiting via `RateLimiterService`.
  - [x] `verifyStepUp(userIdFromToken, dto)`:
    - [x] Validates Redis challenge and TTL.
    - [x] Ensures the challenge belongs to the same user.
    - [x] Verifies assertion and updates signCount when appropriate.
    - [x] Issues step‑up token via `TokenService.signStepUpToken`.

- [x] Implement controller endpoints:
  - [x] `POST /v1/auth/step-up/challenge` (guarded by `JwtAuthGuard`, user from `@CurrentUser()`).
  - [x] `POST /v1/auth/step-up/verify` (guarded by `JwtAuthGuard`, user from `@CurrentUser()`).

- [ ] Integrate step‑up into sensitive modules:
  - [ ] For each sensitive endpoint (e.g., `transactions`):
    - Require `Authorization: Bearer ...`.
    - Accept `stepUpToken` (header or body).
    - Validate via `TokenService.verifyStepUpToken`.
    - Check purpose matches allowed values.

## Phase 7 – Device Management Module

Files (proposed): `src/devices/devices.module.ts`, `src/devices/devices.controller.ts`, `src/devices/devices.service.ts`, DTOs under `src/devices/dto`.

- [x] Create `DevicesModule`:
  - [x] Import `PrismaModule` and `AuthModule`.

- [x] Endpoints:
  - [x] `GET /v1/devices`:
    - [x] Requires JWT.
    - [x] Returns paginated list of devices for current user via `toPaginated(...)`.
  - [x] `DELETE /v1/devices/{id}`:
    - [x] Requires JWT.
    - [x] Marks device as inactive and revokes associated credential.

- [x] OpenAPI:
  - [x] Use existing Device schemas and responses for device listing and revocation.

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
    - [x] Enrollment + biometric login happy path (fake WebAuthn).
    - [x] Step‑up happy path (fake WebAuthn).
    - [ ] Enrollment expired challenge.
    - [ ] Biometric login fallback to password.
    - [ ] Step‑up expired/missing/invalid step‑up token.
    - [ ] Revoked device behavior.

- [ ] Logging & Observability:
  - [ ] Ensure logs include:
    - `userId`, `credentialId`, `deviceId` where applicable.
    - IP and user agent (without leaking sensitive fields).
  - [ ] Add counters/metrics for:
    - Enrollment attempts/successes.
    - Biometric logins.
    - Step‑up requests.
    - Credential/device revocations.
