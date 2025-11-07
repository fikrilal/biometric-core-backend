# Biometric Core Backend – Architecture

## High-Level Concept

The platform exposes a unified API layer for biometric enrollment, authentication, and transaction authorization that delegates most cryptographic trust decisions to standards-based protocols (WebAuthn/FIDO2). Services are modularized within a TypeScript monorepo and communicate through well-defined interfaces, progressively evolving from a modular monolith to independently deployable services as scale demands.

## Logical Service Domains

- **API Gateway & Edge**
  - Kong or Envoy with mutual TLS, request signing, rate limiting, and threat detection.
  - Handles REST/OpenAPI traffic to downstream services.
- **Identity Service**
  - Manages user accounts, tenant isolation, and credential metadata.
  - Issues session tokens and short-lived challenge tokens bound to device assertions.
- **Enrollment Service**
  - Orchestrates device registration, attestation validation, and policy compliance.
  - Persists attested public keys and device attributes without storing raw biometric data.
- **Authentication Service**
  - Verifies signed assertions, enforces step-up policies, and integrates with risk scores.
  - Records authentication events for analytics and compliance.
- **Transaction Approval Service**
  - Coordinates biometric confirmation for high-risk actions; generates cryptographic proofs of approval.
  - Supports out-of-band confirmations (push notifications, email) as fallbacks.
- **Policy & Authorization**
  - Centralizes tenant-specific rules, RBAC, and ABAC.
  - Evaluates contextual signals (device trust, geolocation, transaction metadata) before granting access.
- **Risk & Anomaly Service**
  - Collects telemetry, device reputation, and behavioral signals; produces risk scores and recommendations.
  - Integrates optional third-party threat intelligence feeds.
- **Audit & Compliance Service**
  - Writes append-only, tamper-evident logs; surfaces audit queries and reports.
  - Streams data to SIEM and long-term archival storage with WORM retention.
- **Notification & Outbound Service**
  - Encapsulates push/email/SMS integrations; implements throttling and templating.
- **Admin & Tenant Portal**
  - Provides administrative APIs for policy tuning, device management, and compliance exports.

## Data Flow Highlights

1. **Enrollment**
   1. Client requests challenge via API Gateway → Enrollment Service.
   2. Enrollment Service generates challenge, stores in Redis, and returns to client.
   3. Client completes native biometric verification, sends attestation.
   4. Enrollment Service validates attestation (FIDO metadata), persists key in Postgres, emits audit event.
2. **Authentication**
   1. Client requests login challenge → Authentication Service issues signed challenge with risk context.
   2. Client signs with registered credential; Authentication Service verifies signature and policy outcome.
   3. Identity Service issues session token; Audit Service records event.
   4. Risk Service updates device trust score asynchronously.
3. **Transaction Approval**
   1. Core banking system initiates approval request via REST.
   2. Transaction Service triggers biometric challenge, optionally push notification.
   3. Upon successful assertion, service generates signed approval artifact, notifies initiator, and logs audit trail.
4. **Revocation**
   1. Device flagged (user request, anomaly).
   2. Policy Service updates allowlist/denylist; Enrollment Service marks credential inactive.
   3. Revocation propagated to dependent components; Identity Service invalidates outstanding sessions, clients prompted to re-enroll.

## Security Architecture

- Transport security – TLS on all external endpoints; optional mTLS at ingress or between components where required.
- Key management – cloud KMS for signing/encryption keys; rotate regularly and segment by environment/tenant.
- Secrets management – environment variables and cloud secret managers; avoid committing secrets.
- Policy enforcement – implemented in-app via Nest guards and interceptors.
- Data protection – pseudonymization for user identifiers, pgcrypto for sensitive fields, envelope encryption for stored artifacts when necessary.
- Continuous monitoring – anomaly detection, drift detection (Terraform + Conftest), and runtime protection as needed.

## Reliability & Scalability

- Scale the Nest application horizontally; stateful components (Postgres, Redis) run in HA configurations.
- Read replicas and partitioned tables support tenant isolation and high throughput.
- SLO-driven autoscaling triggered by custom metrics (challenge latency, queue backlogs).
- Load testing validates failover characteristics and backpressure handling.

## Deployment Model

- **Kubernetes (EKS/AKS/GKE)** or simple VM/container environments depending on scale.
- **GitOps** (ArgoCD/Flux) or CI-based deployments for declarative releases and progressive delivery.
- **Infrastructure as Code** (Terraform + Crossplane) for network segmentation and database provisioning.
- **Environment tiers** (dev, staging, prod) with promotion gates tied to automated checks and manual approval for prod.

## Nest Application Architecture (Modular Monolith)

- Module boundaries
  - AppModule composes feature modules and infrastructure modules.
  - Feature modules: Auth, Identity, Tenants, Enrollment, Authentication, Transaction, Policy, Risk, Audit, Notifications.
  - Infrastructure modules: Config, Database, Cache (Redis), Queue, Observability, Crypto, External Vendors.
- Request lifecycle
  - HTTP (Fastify) → global pipes (validation) → guards (authN/Z) → interceptors (logging, metrics) → controller → service → repository/client → response mapping.
  - Errors mapped via an HttpExceptionFilter; domain errors converted to canonical problem responses.
- Validation
  - DTOs validated with class-validator/class-transformer; strict whitelist and forbidUnknownValues globally.
  - Schema-level validation for cross-field constraints in services.
- Configuration
  - @nestjs/config provides typed config namespaces; environment validated on boot (Joi or Zod) and injected via ConfigService.
  - Secrets pulled from runtime environment or a cloud secret manager; never committed.
- Persistence
  - Prisma repositories encapsulated behind interfaces; services depend on repository ports, not Prisma directly.
  - Transactions handled in services; idempotency keys used for enrollment/auth flows.
- Messaging & jobs
  - BullMQ queues for heavy/async work (risk scoring, audit export, metadata sync).
  - Outbox pattern optional for reliable event publication if/when an event bus is introduced.
- Security controls in-process
  - Guards enforce tenant scoping and RBAC/ABAC policy checks.
  - Interceptors add request IDs, sanitize logs, and emit metrics/traces.
- Testing strategy
  - Unit: providers with in-memory fakes or test doubles.
  - Integration: Nest testing module + Supertest over Fastify adapter.
  - E2E: containerized Postgres/Redis via Testcontainers; seed fixtures and run Jest suites.

## Project Structure (Monorepo Proposal)

```text
biometric-core-backend/
├── apps/
│   ├── api-gateway/            # Edge adapters (REST, GraphQL, WebSockets)
│   ├── identity-service/       # User identity and session issuance
│   ├── enrollment-service/     # Device registration & attestation workflows
│   ├── authentication-service/ # Assertion validation & token issuance
│   ├── transaction-service/    # Transaction approval orchestration
│   ├── policy-service/         # Authorization decisions
│   ├── risk-service/           # Risk scoring pipelines & integrations
│   ├── audit-service/          # Audit logging, compliance exports
│   └── notification-service/   # Push/email transports and templates
├── libs/
│   ├── domain/                 # Aggregates, entities, domain events
│   ├── dtos/                   # Shared DTOs, Zod schemas, protobuf definitions
│   ├── crypto/                 # Cryptographic helpers, KMS adapters
│   ├── persistence/            # Database repositories, migrations, RLS utilities
│   ├── messaging/              # Event definitions (if/when an event bus is introduced)
│   ├── policy/                 # Policy evaluation clients, guard utilities
│   ├── observability/          # OTEL setup, logging formatters
│   └── sdk/                    # Client SDK scaffolding for web/mobile/server
├── docs/                       # Architectural docs, ADRs, compliance artifacts
├── infrastructure/
│   ├── terraform/              # IaC modules for cloud resources
│   ├── helm/                   # Helm charts/Kustomize overlays
│   └── pipelines/              # CI/CD configuration, GitHub Actions, Argo workflows
├── scripts/                    # Developer tooling, bootstrap scripts, health checks
├── tests/
│   ├── integration/            # Service integration suites
│   ├── contract/               # Consumer-driven contract tests
│   └── performance/            # Load & soak test scenarios
└── package.json
```

## Evolution Path

- **Phase 1:** Deploy as modular monolith within a single Nest application; enforce boundaries through module imports and shared library contracts.
- **Phase 2:** If needed, extract high-churn or high-load modules into separate Nest applications communicating over internal HTTP or simple queues.
- **Phase 3:** Consider additional services or languages only if performance data justifies, keeping interfaces simple.

## Documentation & Governance

- Architecture Decision Records maintained alongside code; every change references compliance controls.
- Threat modeling performed per feature (STRIDE/Kill Chain) with mitigations documented and tracked.
- Regular security reviews, tabletop exercises, and disaster recovery drills with postmortem process feeding back into roadmap.
- Response shape and error format are standardized; see `docs/standards/response-standard.md`.

## Monorepo Structure (Folders Only)

```text
biometric-core-backend/
├─ apps/
│  ├─ api-gateway/
│  │  ├─ src/
│  │  │  ├─ config/
│  │  │  ├─ common/
│  │  │  │  ├─ filters/
│  │  │  │  ├─ guards/
│  │  │  │  ├─ interceptors/
│  │  │  │  ├─ decorators/
│  │  │  │  └─ middleware/
│  │  │  ├─ modules/
│  │  │  │  ├─ health/
│  │  │  │  ├─ auth/
│  │  │  │  ├─ enrollment/
│  │  │  │  ├─ users/
│  │  │  │  ├─ devices/
│  │  │  │  └─ repositories/
│  │  │  └─ integrations/
│  │  │     ├─ redis/
│  │  │     ├─ prisma/
│  │  │     └─ crypto/
│  │  ├─ prisma/
│  │  │  └─ migrations/
│  │  ├─ test/
│  │  │  ├─ unit/
│  │  │  └─ e2e/
│  │  └─ openapi/
│  ├─ identity-service/
│  ├─ enrollment-service/
│  ├─ authentication-service/
│  ├─ transaction-service/
│  ├─ policy-service/
│  ├─ risk-service/
│  ├─ audit-service/
│  └─ notification-service/
├─ libs/
│  ├─ domain/
│  │  └─ src/
│  │     ├─ users/
│  │     ├─ devices/
│  │     ├─ credentials/
│  │     └─ challenges/
│  ├─ dtos/
│  │  └─ src/
│  │     ├─ users/
│  │     ├─ devices/
│  │     └─ common/
│  ├─ crypto/
│  │  └─ src/
│  │     ├─ jose/
│  │     └─ kms/
│  ├─ persistence/
│  │  └─ src/
│  │     ├─ prisma/
│  │     └─ repositories/
│  ├─ messaging/
│  │  └─ src/
│  │     ├─ events/
│  │     ├─ producers/
│  │     └─ consumers/
│  ├─ policy/
│  │  └─ src/
│  │     ├─ rbac/
│  │     └─ guards/
│  ├─ observability/
│  │  └─ src/
│  │     ├─ logging/
│  │     └─ tracing/
│  └─ sdk/
│        ├─ ts/
│        └─ examples/
├─ docs/
│  ├─ core/
│  ├─ openapi/
│  ├─ adr/
│  └─ runbooks/
├─ infrastructure/
│  ├─ terraform/
│  │  ├─ modules/
│  │  └─ envs/
│  ├─ helm/
│  │  ├─ charts/
│  │  └─ values/
│  └─ pipelines/
│     ├─ github-actions/
│     └─ scripts/
├─ scripts/
│  ├─ dev/
│  ├─ codegen/
│  └─ ci/
├─ tests/
│  ├─ integration/
│  ├─ contract/
│  └─ performance/
│     └─ k6/
└─ package.json
```
