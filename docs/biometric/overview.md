# Biometric Auth – Overview

This document describes the role of WebAuthn/biometric authentication in the Biometric Core Backend, how it relates to existing email/password auth, and the high‑level architecture for enrollment, login, and step‑up.

## Goals

- Provide a **high‑assurance factor** built on WebAuthn (FIDO2) that can be used for:
  - Passwordless login (optional, in addition to email/password).
  - Step‑up authentication for sensitive actions (e.g., transfers, PII export).
- Preserve the existing **email + password** flow as the primary recovery and baseline login path.
- Avoid storing raw biometric data; persist only public keys and non‑sensitive metadata.
- Fit cleanly into existing patterns:
  - Prisma for persistence.
  - Redis for ephemeral challenge storage and rate limiting.
  - RFC 7807 errors and the response envelope.
  - OpenAPI as the contract source of truth.

## Scope

Biometric/WebAuthn in this codebase covers:

- **Enrollment**
  - Adding one or more WebAuthn authenticators (devices) to an existing user account.
  - Each enrollment creates a credential and a device record.
- **Biometric Login**
  - Logging in using a registered WebAuthn credential instead of (or in addition to) email/password.
- **Step‑Up Authentication**
  - Performing a fresh WebAuthn assertion on top of an existing session to authorize high‑risk operations.
  - Producing a short‑lived, purpose‑scoped step‑up token that sensitive endpoints can require.
- **Device Management** (future module)
  - Listing enrolled devices and revoking them.

Out of scope for this iteration:

- Full risk scoring pipelines, adaptive policies, or FIDO metadata attestation enforcement (these can be layered on later).
- Mobile SDK and frontend details (browser/native flows are assumed but documented separately).

## Relationship to Existing Auth

- **Email/Password Auth (existing)**
  - Primary login and recovery path.
  - Issues access/refresh tokens via `TokenService`.
  - Responsible for:
    - Account bootstrap (registration).
    - Email verification and password resets.
    - Baseline session for adding/removing biometric devices.

- **Biometric/WebAuthn Auth (new)**
  - **Optional** but recommended for users.
  - Depends on an existing, verified user account.
  - Provides:
    - Passwordless login, issuing the **same kind** of access/refresh tokens as password login.
    - Step‑up tokens that prove a fresh biometric check for a specific purpose.
  - Never replaces email/password; if a device or credential is blocked, users can still log in with password and re‑enroll.

## High‑Level Architecture

- **Prisma Models**
  - `Credential`
    - Represents a WebAuthn credential (public key, signCount, metadata).
    - Associated to a single `User`.
  - `Device`
    - Represents a user‑visible device entry wrapping a credential (label, active flag, timestamps).
    - Associated to a single `Credential` and `User`.

- **Redis**
  - Stores short‑lived WebAuthn challenges for:
    - Enrollment (`context: "enroll"`).
    - Login (`context: "login"`).
    - Step‑up (`context: "step_up"`).
  - Keys are one‑time‑use and have strict TTLs (2–5 minutes).

- **Modules**
  - `EnrollmentModule`
    - Endpoints:
      - `POST /v1/enroll/challenge`
      - `POST /v1/enroll/verify`
    - Responsible for WebAuthn registration and creating Credential/Device records.
  - `AuthModule` (expanded)
    - Endpoints:
      - `POST /v1/auth/challenge` (biometric login).
      - `POST /v1/auth/verify` (biometric login verification).
      - `POST /v1/auth/step-up/challenge` (requires session).
      - `POST /v1/auth/step-up/verify` (requires session; returns step‑up token).
    - Contains shared token issuance helpers and JWT guards.
  - `WebAuthnModule` (or `auth/webauthn`)
    - Wraps `@simplewebauthn/server` for generating and verifying options/responses.
    - Reads configuration such as RP ID, allowed origins, challenge TTL.
  - `DevicesModule` (future)
    - Handles listing and revoking devices.

## Primary Use Cases

- **Add Biometric to an Account**
  - User logs in with email/password.
  - User initiates “Add biometric device”.
  - Backend issues an enrollment challenge; user completes WebAuthn registration.
  - Backend persists credential and device metadata.

- **Login with Biometric**
  - User chooses “Login with biometric” instead of typing password.
  - Backend issues a WebAuthn authentication challenge for that user.
  - On successful assertion, backend issues access/refresh tokens as if the user had logged in with password.
  - If biometric login fails (no credentials, revoked, compromised), the client falls back to password login.

- **Step‑Up for Sensitive Operations**
  - User has an existing access token from password or biometric login.
  - Before a high‑risk operation, the client asks for a step‑up challenge.
  - User completes a WebAuthn assertion; backend returns a short‑lived step‑up token scoped to a purpose.
  - Sensitive endpoints require both the access token and a valid step‑up token.

## Design Principles

- **Defense in Depth**
  - Challenges are single‑use, short‑lived, and bound to a specific user and context.
  - WebAuthn is layered on top of existing auth, not used in isolation.
  - Strict error handling and `ErrorCode`s make mis‑use observable and auditable.

- **User Safety**
  - Blocking or revoking a credential/device never locks the user out of the account.
  - Password login and recovery flows remain the fallback path.

- **Auditability**
  - Enrollment, login, and step‑up events can be logged with userId, credentialId, deviceId, IP, and user agent.
  - Step‑up tokens can serve as cryptographic evidence of user approval for specific actions.

- **Configurability**
  - SignCount handling, attestation strictness, maximum devices per user, and step‑up token TTL are all configuration‑driven and can evolve without schema changes.

