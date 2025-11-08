# Developer Guide – Patterns, Helpers, and Utilities

This guide explains the core patterns used across the codebase so new features follow the same conventions.

## Routing & Versioning
- Global prefix: `/v1` for all routes; `/health` stays unversioned.
- File paths: controllers live under `src/**/modules/<feature>`.

## Response Envelope
- Success shape: `{ data, meta? }` applied globally by interceptor.
- Auto-list support: return `{ items, nextCursor?, limit? }` and it becomes `{ data, meta }`.
- Bypass envelope when needed with `@SkipEnvelope()` (e.g., health, file/stream).
- Code references:
  - Interceptor: `src/common/http/interceptors/response-envelope.interceptor.ts`
  - Decorator: `src/common/http/decorators/skip-envelope.decorator.ts`
- Standard details: `docs/standards/response-standard.md`.

## Errors (Problem Details)
- Errors are returned as `application/problem+json` with `traceId`.
- Use `ProblemException` (prefer) or Nest `HttpException`—both map to RFC 7807.
- Error codes live in `ErrorCode` enum for stability.
- 404 for unknown routes is handled globally.
- Code references:
  - Filter: `src/common/http/filters/problem-details.filter.ts`
  - Base exception: `src/common/errors/problem.exception.ts`
  - Codes: `src/common/errors/error-codes.ts`

## Request Correlation & Logging
- `X-Request-Id` is accepted and echoed; generated if missing.
- Structured logs via `nestjs-pino` (level via `LOG_LEVEL`).
- Code reference: `src/common/http/interceptors/request-id.interceptor.ts`.

## Idempotency (POST/DELETE)
- Header: `Idempotency-Key` (string). On replay, response is `200/201` with `Idempotency-Replayed: true`.
- Uses Redis with a short lock to dedupe concurrent requests; caches result for 24h.
- Code reference: `src/common/http/interceptors/idempotency.interceptor.ts`.

## Pagination (Cursor-Based)
- Query DTO: `PageQueryDto` supports `cursor` and `limit` (1–250).
- Utilities: `encodeCursor()` / `decodeCursor()`, `toPaginated(items, nextCursor?, limit?)`.
- Controller pattern:
  - `@Get()` → `(@Query() q: PageQueryDto)`
  - Return `toPaginated(items, nextCursor, q.limit)`; envelope adds `{ data, meta }`.
- Code references:
  - `src/common/pagination/page-query.dto.ts`
  - `src/common/pagination/cursor.util.ts`
  - `src/common/pagination/pagination.util.ts`

## OpenAPI & Docs
- Source of truth: `docs/openapi/openapi.yaml` (3.1).
- Lint: `npm run spec:lint` (Spectral).
- Swagger UI is served at `/docs` from code-first decorators.

## Auth Password Module
- Specs: `docs/features/auth-password.md`.
- Password hashing: Argon2id (see `auth-password/auth-password.service.ts`).
- Token signing: `TokenService` (jose) issues access/refresh tokens.

## Data & Integrations
- Prisma (Postgres): `src/prisma/*`, schema at `prisma/schema.prisma`.
- Redis client: `src/redis/*` (lazy connect; `REDIS_URL` in `.env`).

## Testing Notes
- E2E uses the global envelope and Problem Details (404 assertions include `status` and `traceId`).
- Health is intentionally raw `{ status: "ok" }`.

## Quick Checklist for New Endpoints
- Use DTOs with class-validator/class-transformer.
- Accept `PageQueryDto` for lists; return `toPaginated(...)`.
- Throw `ProblemException.*` for errors; include stable `ErrorCode`.
- Respect `Idempotency-Key` on POST/DELETE (interceptor is global).
- Add Swagger decorators to document the route; ensure OpenAPI stays aligned.
