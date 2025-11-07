# Project Structure – Express-First (Biometric Platform)

This structure adapts your Orymu layout to biometric domains and enterprise needs.

```text
biometric-core-backend/
├─ prisma/                         # Prisma schema + migrations
│  └─ schema.prisma
├─ src/
│  ├─ config/                      # Typed env config + validation
│  ├─ infrastructure/
│  │  ├─ http/                     # Express server, middlewares, rate limits
│  │  ├─ database/                 # Prisma client, RLS helpers, migrations
│  │  ├─ redis/                    # Redis client + challenge/rate helpers
│  │  ├─ mq/                       # Kafka/NATS client abstraction
│  │  ├─ crypto/                   # JOSE helpers, KMS/HSM adapters
│  │  ├─ opa/                      # OPA/Policy client (decision API), caching
│  │  ├─ fido/                     # WebAuthn utils, FIDO MDS sync & cache
│  │  ├─ logging/                  # pino logger, OTEL setup, redaction
│  │  └─ secrets/                  # Vault/KMS integration for secrets & tokens
│  ├─ modules/                     # Domain modules (controllers/services/repos)
│  │  ├─ identity/                 # Users, tenant isolation, sessions
│  │  ├─ enrollment/               # Device registration, attestation validation
│  │  ├─ authentication/           # Assertion verification, step-up
│  │  ├─ transactions/             # Biometric approvals, proofs, callbacks
│  │  ├─ devices/                  # Device lifecycle mgmt, revocation
│  │  ├─ policy/                   # Policy endpoints, admin management
│  │  ├─ risk/                     # Anomaly signals, risk scoring
│  │  ├─ audit/                    # Append-only logs, SIEM export
│  │  └─ notifications/            # Push/email/SMS integrations
│  ├─ processors/                  # Background workers (risk, audit, MDS sync)
│  ├─ presenters/                  # Response mappers
│  ├─ selects/                     # Prisma selects for public DTOs
│  ├─ shared/                      # Errors, middleware, DI container, utils
│  ├─ app.ts                       # Compose infrastructure + routes
│  └─ index.ts                     # Entrypoint + graceful shutdown
├─ scripts/                        # Admin/ops scripts, backfills
├─ tests/
│  ├─ integration/                 # Supertest suites
│  ├─ contract/                    # OpenAPI/consumer-driven tests
│  └─ performance/                 # k6/Artillery load tests
└─ docs/
```

## Conventions

- Controllers must not call Prisma directly—services orchestrate repositories and infrastructure clients.
- All requests validated via Zod schemas; responses serialized via presenters.
- Guard middleware enforces authN/Z and calls policy (OPA) with context.
- Every route emits audit events; sensitive operations include reason codes and actor/device context.
- Challenges stored in Redis with short TTL; signed with KMS where applicable.
- Per-tenant isolation via Postgres RLS; tenant set using session variables at connection scope.

## Migration Path to Services

- Extract high-load modules (authentication, enrollment) into standalone processes when needed; keep the rest in-process.
- Replace in-memory MQ with Kafka/NATS for audit/risk streams; workers subscribe with backpressure.
- Move KMS/HSM calls to a sidecar (gRPC) if vendor SDK compatibility or latency becomes an issue.

