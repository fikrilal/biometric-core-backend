# Framework Choice – Express vs NestJS

## Summary

Both Express and NestJS can meet our biometric platform’s needs. Given your Express experience, two viable paths are:

- Option A: Express 5 with an opinionated foundation (“Express+”) to cover DI, validation, OpenAPI, guards, and testing.
- Option B: NestJS with the Express adapter for familiarity today, with the ability to switch to Fastify later without refactors.

Recommendation: Start with NestJS (Express adapter) for structure and security/maintainability out of the box. If you prefer pure Express, adopt the checklist below to close gaps.

## Why NestJS (Pros)

- Modular architecture (modules/controllers/providers) maps cleanly to domain boundaries (Enrollment/Auth/Policy/Risk).
- First-class DI, interceptors, guards, and pipes for cross-cutting concerns (policy enforcement, validation, audit hooks).
- Auto-generated OpenAPI schemas from DTOs; consistent validation (class-validator / Zod integration) and exception filters.
- Simple adapter swap: Express today, Fastify for throughput later.
- Rich testing utilities for unit/e2e; consistent patterns across teams.

## Why Express (Pros)

- Minimal surface area; you already have patterns from Orymu.
- Flexibility to compose only what we need; smaller learning curve.

## Express “Gaps” and How to Close Them

If choosing Express, add these immediately to reach enterprise posture:

- DI/Composition: `tsyringe` or `inversify` with lightweight container per request.
- Validation/DTOs: Zod schemas + typed DTOs; response serializers; OpenAPI via `zod-to-openapi` or `express-zod-api`.
- Security middleware: `helmet`, HSTS, strict CORS, rate limiter (Sliding Window in Redis), IP allow/deny lists.
- AuthN/Z: Guards as middleware layers; policy checks via OPA client; standardized error mapping.
- Logging/Tracing: `pino-http` + OpenTelemetry SDK (HTTP + custom spans); correlation IDs.
- Testing: Jest + Supertest; contract tests for public APIs; load tests (k6/Artillery) for P95 targets.
- Background jobs: Dedicated worker process with graceful shutdown; Kafka/NATS client abstraction.
- Config: Typed configuration with strong validation; secrets via Vault/KMS.

## Decision Gate

- Choose NestJS if you want strong conventions, quicker onboarding, and easier cross-cutting policy enforcement.
- Choose Express if you value minimalism and are comfortable maintaining conventions and glue code.

We can proceed with either; the rest of the architecture (gateway, HSM/KMS, Kafka, Postgres, Redis, OPA, OTEL) is independent of this choice.

