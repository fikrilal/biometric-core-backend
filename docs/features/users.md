# Users Module – Specification

## Purpose
Manage user accounts with unique email, minimal profile, and lookups supporting pagination. Used by both password-based auth and biometric linking.

## Endpoints (v1)
- POST `/v1/users` — create user (admin/service context)
- GET `/v1/users` — list users (cursor pagination)
- GET `/v1/users/{id}` — get user by id

All responses use the envelope `{ data, meta? }`. Errors follow RFC 7807.

## Requests & Validation
- CreateUserInput
  - `email` (string, email)
  - Reject duplicates with 409 Conflict (`code: CONFLICT`).
- List
  - `cursor?` (string, base64url), `limit?` (1–250; default 25)

## Persistence
- Prisma `User { id String @id @default(cuid()), email String @unique, createdAt DateTime @default(now()) }`
- Optional: add `passwordHash String?` when password auth is implemented.

## Security
- Requires bearer JWT in production (role-guarded). In dev, can be open until the auth module lands.

## Headers
- `X-Request-Id` echoed; `Idempotency-Key` supported on POST (201) with `Location: /v1/users/{id}`.

## Pagination
- Request: `?cursor=&limit=`
- Response: `{ data: User[], meta: { nextCursor?, limit } }`
- Cursor encodes last item id or createdAt + id (stable ordering).

## Errors
- 400: validation (`code: VALIDATION_FAILED`)
- 404: user not found (`code: NOT_FOUND`)
- 409: duplicate email (`code: CONFLICT`)

## Acceptance Criteria
- Creating the same email twice returns 409.
- GET list returns stable ordering and `meta.nextCursor` when more items exist.
- GET by id returns 404 for unknown id.

## Test Plan
- e2e: create → get → list pagination; duplicate email 409; unknown id 404.
- unit: repository/mapper tests when applicable.
