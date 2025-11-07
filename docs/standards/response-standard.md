# API Response Standard

This document defines consistent response shapes, headers, and status codes for all HTTP endpoints in this repository. It applies to every module and service unless an explicit exception is noted.

## Success Envelope

- Shape: `{ data, meta? }`
- Single item (GET/POST/PUT/PATCH): return the resource in `data`.
- Lists: `data: []` plus `meta.nextCursor?` and `meta.limit`.
- Minimal payload: do not include `success` or `message` fields.

## Errors (RFC 7807)

- Content type: `application/problem+json`.
- Shape: `{ type, title, status, detail?, instance?, code, traceId }`.
- Always include `traceId` (the `X-Request-Id` value) and a stable `code` for programmatic handling.

## Headers

- `X-Request-Id`: accepted and echoed on every response; generated if absent.
- `Location`: on 201 Created, absolute or path URL of the new resource.
- `Idempotency-Key`: accepted on POST/DELETE for safe retries.
- `Idempotency-Replayed: true`: set when a POST is de-duplicated and returns an existing result.
- `ETag`: optional for cacheable GETs (introduce when we add caching).

## Status Codes (by method)

- GET (single/list): `200` with `{ data, meta? }`.
- POST (create): `201` with `{ data }` and `Location`; if replay via Idempotency-Key, return `200` with `Idempotency-Replayed: true`.
- PUT/PATCH: `200` with `{ data }`.
- DELETE: `204` No Content (no body).
- Async operations (if any): `202` with `{ data: { jobId } }`.

## Pagination (cursor-based)

- Request: `?cursor=&limit=` (default limit 25, max 250).
- Response: `{ data: [...], meta: { nextCursor?, limit } }`.
- Omit `nextCursor` when no further results exist.

## Exceptions (allowed)

- `/health`: returns `{ status: "ok" }` (no envelope).
- `DELETE 204`: no body.
- File/stream endpoints: may bypass envelope; document explicitly in OpenAPI.

## OpenAPI Requirements

- Define success responses as envelope `{ data, meta? }` (except the noted exceptions).
- Errors reference the shared `ProblemDetails` schema.
- Document `X-Request-Id`, `Idempotency-Key`, and `Idempotency-Replayed` where applicable.

## Implementation Notes (for developers)

- A global response interceptor will wrap controller returns into the envelope; opt-out with a `@SkipEnvelope` decorator when necessary.
- A global exception filter will produce RFC 7807 with `traceId`.
- Keep DTOs clean; the envelope is applied at the transport layer.

