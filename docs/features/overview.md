# Feature Overview & Build Plan

This document summarizes feature modules to implement and their priorities. Use this as the roadmap and entry point to the per‑feature guides.

## Priorities (Phase 1)
- Users (account model, lookup, pagination) — High
- Auth: Email + Password (access/refresh tokens) — High
- Enrollment (WebAuthn Create/attestation) — High
- Auth: Biometric (WebAuthn Get/assertion) — High
- Devices (list/revoke) — Medium

## Conventions (applies to all features)
- Response: use the envelope `{ data, meta? }` and RFC 7807 errors.
- Headers: echo `X-Request-Id`, accept `Idempotency-Key` on POST/DELETE.
- Pagination: cursor (`?cursor=&limit=`) with `meta.nextCursor`.
- Security: JWT bearer for protected routes.
- Spec: keep `docs/openapi/openapi.yaml` aligned.

## Modules Summary
- Users
  - Create user (admin/service context), list, get by id.
  - Email unique; later enrich with profile.
- Auth (Email/Password)
  - Registration (email + password), login, refresh, logout.
  - Argon2 password hashing, refresh token rotation.
- Enrollment (Biometric)
  - Issue WebAuthn creation options, verify attestation, persist credential.
- Auth (Biometric)
  - Issue WebAuthn assertion options, verify assertion, mint tokens.
- Devices
  - List user devices and revoke.

See per‑feature documents under `docs/features/` for details and acceptance criteria.
