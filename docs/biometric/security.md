# Biometric Auth – Security & Risk Considerations

This document captures the security posture, tradeoffs, and configuration points for the biometric/WebAuthn flows. It complements the overview and flows documents and should be kept in sync with implementation and policy decisions.

## Threat Model (High Level)

Biometric/WebAuthn features aim to mitigate:

- Credential phishing and replay.
- Session hijacking where only a password is compromised.
- Unauthorized use of devices (lost or stolen devices, cloned authenticators).

Threats not fully addressed in this layer alone:

- Compromised client devices (malware, rooted phones).
- Social engineering leading to user‑approved high‑risk actions.
- Advanced hardware attacks against secure elements.

These must be handled via broader policies, risk scoring, and client‑side controls.

## SignCount Handling Strategy

`signCount` is a counter maintained by authenticators; it is not uniformly implemented across all devices. Some always return `0`, while others behave as expected (monotonic increments). The backend should:

### Policy Overview

- Maintain a **configurable signCount mode** (e.g., `WEBAUTHN_SIGNCOUNT_MODE= "strict" | "lenient"`).
- Default to **strict** mode in production, using the following rules:

1. **No prior signCount (0 stored)**
   - If authenticator returns `0`:
     - Accept and keep `signCount = 0` (authenticator does not support meaningful counters).
   - If authenticator returns `> 0`:
     - Accept and set stored `signCount` to the returned value (start tracking).

2. **Monotonic or equal**
   - If `newSignCount > storedSignCount`:
     - Accept and update the stored value.
   - If `newSignCount === storedSignCount`:
     - Accept; some authenticators increment slowly or only in certain cases.

3. **Regression (Potential Clone)**
   - If `newSignCount < storedSignCount`:
     - Treat as a possible cloned authenticator or misconfigured device.
     - In **strict** mode:
       - Reject the authentication attempt with 401 and an error code such as `CREDENTIAL_COMPROMISED`.
       - Mark the credential as revoked (and optionally the associated device as inactive).
       - Log detailed context: userId, credentialId, storedSignCount, newSignCount, IP, user agent.
     - In **lenient** mode:
       - At minimum, log the event with high severity and consider additional tenant‑specific rules.

This policy is possible because email/password login remains available as a fallback, so revoking a credential does not lock the user out entirely.

## Attestation Policy

### Common Baseline

- Always verify:
  - Challenge matches the one issued and stored in Redis.
  - RP ID matches `WEBAUTHN_RP_ID`.
  - Origin is in the configured allowlist (`WEBAUTHN_ORIGINS`).
  - Signature is valid with the stored public key.

### Development Environments

- Use relaxed attestation:
  - `attestation: "none"` in registration options.
  - Do not enforce AAGUID or trust root checks.
- Focus on correctness and flow validation rather than hardware trust.

### Production (Initial)

- Start with similarly relaxed attestation:
  - Continue using `attestation: "none"` or permissive values.
  - Still store AAGUID and attestation data where possible for visibility.
- Log authenticator metadata and classify known AAGUIDs for future policies.

### Future Hardening

When needed, integrate FIDO metadata and implement:

- Allowlist/denylist of authenticators per tenant.
- Minimum security requirements (e.g., platform authenticators only, hardware keys only).
- Stronger policies for specific high‑risk tenants or regions.

These controls should be driven by configuration and/or tenant policies, not hard‑coded.

## Challenges & Redis Storage

- Use distinct Redis key prefixes to avoid collisions:
  - Enrollment: `webauthn:enroll:challenge:{challengeId}`.
  - Login / step‑up: `webauthn:auth:challenge:{challengeId}`.
- Enforce:
  - Single‑use semantics:
    - Challenges are **deleted** immediately upon verification (success or failure).
  - TTL enforcement:
    - Application‑level check on `createdAt` plus Redis TTL.
  - Context binding:
    - Each record includes `context: "enroll" | "login" | "step_up"`.
    - Verify endpoints ensure the context matches the expected flow.

## Rate Limiting

Use the existing `RateLimiterService` to protect WebAuthn endpoints:

- Enrollment:
  - Limit `POST /v1/enroll/challenge` by `(userId/email + IP)` (e.g., 10/minute).
- Biometric login:
  - Limit `POST /v1/auth/challenge` by `(email + IP)` (e.g., 10/minute).
- Step‑up:
  - Limit `POST /v1/auth/step-up/challenge` by `(userId + IP)` (e.g., 20/minute).

On exceeding a limit, return 429 with `ErrorCode.RATE_LIMITED`, consistent with existing patterns.

## Step‑Up Token Design

Step‑up tokens are intended to be:

- **Short‑lived** (on the order of 60–120 seconds).
- **Purpose‑scoped** (bound to a specific high‑risk action or class of actions).
- **Bound to the session** (same `sub` as the access token).

### Claims (Example)

- `type: "step_up"` – distinguishes from access/refresh tokens.
- `sub: string` – userId.
- `purpose: string` – e.g., `transaction:transfer`, `pii:export`.
- `challengeId: string` – links back to the WebAuthn challenge used.
- `iat: number` – issued at (epoch seconds).
- `exp: number` – short expiry.

### Validation Rules

Sensitive endpoints must:

- Verify:
  - Token signature and expiry.
  - `type === "step_up"`.
  - `sub` matches the `sub` from the access token.
  - `purpose` is allowed for this endpoint (exact match or controlled mapping).
- Ensure:
  - Step‑up token is recent enough for the action (enforced via `exp`).
  - The access token used belongs to the same user and represents a valid session.

Failure to present or validate a step‑up token should result in 401/403 with an appropriate error code and clear messaging.

## Error Codes & Problem Details

The following `ErrorCode` additions are recommended for clarity and monitoring:

- `CHALLENGE_EXPIRED`
  - Used when a WebAuthn challenge is missing, expired, or already consumed.
  - Typical status: 404.
- `NO_CREDENTIALS`
  - Used when a user has no active credentials for biometric login or step‑up.
  - Typical status: 404.
- `CREDENTIAL_REVOKED`
  - Used when an explicitly revoked credential is used.
  - Typical status: 401 or 403, depending on policy.
- `CREDENTIAL_COMPROMISED`
  - Used when signCount regression or other strong signals indicate possible compromise.
  - Typical status: 401.

All errors should continue to use the existing `ProblemException` and Problem Details filter to ensure:

- Stable `code` fields for programmatic handling.
- `traceId` correlation (matching `X-Request-Id`).

## Logging, Audit, and Privacy

- Log key events:
  - Enrollment attempts and successes.
  - Biometric logins.
  - Step‑up challenges and verifications.
  - Credential/device revocations and compromises.
- Include:
  - `userId`, `credentialId`, `deviceId` where applicable.
  - IP and user agent, avoiding sensitive PII in log messages.
- Do **not** log:
  - Raw WebAuthn credential material (keys, secrets).
  - Biometric data (which is never sent to the backend).

Audit trails should allow reconstructing who approved what, when, and from which device, without exposing sensitive internals.

## Configuration & Tuning

The following knobs should be exposed as configuration (env or config service), with safe defaults:

- `WEBAUTHN_RP_ID`, `WEBAUTHN_RP_NAME`, `WEBAUTHN_ORIGINS`.
- `WEBAUTHN_CHALLENGE_TTL_MS` – challenge lifetime.
- `WEBAUTHN_SIGNCOUNT_MODE` – `strict` vs `lenient`.
- `WEBAUTHN_MAX_CREDENTIALS_PER_USER` – maximum active credentials/devices per user.
- `STEP_UP_TOKEN_TTL_SECONDS` – step‑up token lifetime.

These values may be adjusted per environment or tenant as the platform matures and gathers telemetry.

