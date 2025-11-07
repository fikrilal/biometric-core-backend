# Biometric Core Backend – Architecture

## High-Level Concept

The platform exposes a unified API layer for biometric enrollment, authentication, and transaction authorization that delegates most cryptographic trust decisions to standards-based protocols (WebAuthn/FIDO2). Services are modularized within a TypeScript monorepo and communicate through well-defined interfaces, progressively evolving from a modular monolith to independently deployable services as scale demands.

## Logical Service Domains

- **API Gateway & Edge**
  - Kong or Envoy with mutual TLS, request signing, rate limiting, and threat detection.
  - Handles REST/OpenAPI traffic, forwarding gRPC and event streams to downstream services.
- **Identity Service**
  - Manages user accounts, tenant isolation, and credential metadata.
  - Issues session tokens and short-lived challenge tokens bound to device assertions.
- **Enrollment Service**
  - Orchestrates device registration, attestation validation, and policy compliance.
  - Persists attested public keys and device attributes without storing raw biometric data.
- **Authentication Service**
  - Verifies signed assertions, enforces step-up policies, and integrates with risk scores.
  - Publishes auth events to Kafka for analytics and compliance.
- **Transaction Approval Service**
  - Coordinates biometric confirmation for high-risk actions; generates cryptographic proofs of approval.
  - Supports out-of-band confirmations (push notifications, email) as fallbacks.
- **Policy & Authorization Service**
  - Policy-as-code (OPA) engine; centralizes tenant-specific rules, RBAC, and ABAC.
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
   4. Risk Service updates device trust score asynchronously via Kafka.
3. **Transaction Approval**
   1. Core banking system initiates approval request via gRPC/REST.
   2. Transaction Service triggers biometric challenge, optionally push notification.
   3. Upon successful assertion, service generates signed approval artifact, notifies initiator, and logs audit trail.
4. **Revocation**
   1. Device flagged (user request, anomaly).
   2. Policy Service updates allowlist/denylist; Enrollment Service marks credential inactive.
   3. Revocation broadcast on Kafka; Identity Service invalidates outstanding sessions, clients prompted to re-enroll.

## Security Architecture

- **Zero Trust Network** – service mesh enforces mTLS, SPIFFE-issued identities, and per-route authorization.
- **Hardware Security Modules** – signing keys, encryption keys, and token secrets managed within HSM/KMS.
- **Secrets Management** – Vault brokers dynamic credentials and short-lived certificates.
- **Policy Enforcement Points** – Nest guards/interceptors and Istio authorization policies call Policy Service/OPA.
- **Data Protection** – Pseudonymization for user identifiers, transparent encryption (pgcrypto) for sensitive fields, envelope encryption for stored artifacts.
- **Continuous Monitoring** – anomaly detection, drift detection (Terraform + Conftest), runtime protection (Falco/Aqua).

## Reliability & Scalability

- Stateless services scale horizontally behind autoscalers; stateful components (Postgres, Redis, Kafka) deployed in HA clusters.
- Read replicas and partitioned tables support tenant isolation and high throughput.
- SLO-driven autoscaling triggered by custom metrics (challenge latency, queue backlogs).
- Chaos engineering and load testing pipelines validate failover characteristics and backpressure handling.

## Deployment Model

- **Kubernetes (EKS/AKS/GKE)** with multi-tenant namespaces; dedicated clusters for regulated tenants if required.
- **GitOps** (ArgoCD/Flux) for declarative deployments; progressive delivery (canary, blue/green) via service mesh.
- **Infrastructure as Code** (Terraform + Crossplane) controls network segmentation, HSM, database provisioning.
- **Environment tiers** (dev, staging, prod) with promotion gates tied to automated checks and manual approval for prod.

## Project Structure (Monorepo Proposal)

```text
biometric-core-backend/
├── apps/
│   ├── api-gateway/            # Edge adapters (REST, GraphQL, WebSockets)
│   ├── identity-service/       # User identity and session issuance
│   ├── enrollment-service/     # Device registration & attestation workflows
│   ├── authentication-service/ # Assertion validation & token issuance
│   ├── transaction-service/    # Transaction approval orchestration
│   ├── policy-service/         # OPA policies, authorization decisions
│   ├── risk-service/           # Risk scoring pipelines & integrations
│   ├── audit-service/          # Audit logging, compliance exports
│   └── notification-service/   # Push/email transports and templates
├── libs/
│   ├── domain/                 # Aggregates, entities, domain events
│   ├── dtos/                   # Shared DTOs, Zod schemas, protobuf definitions
│   ├── crypto/                 # Cryptographic helpers, HSM/KMS adapters
│   ├── persistence/            # Database repositories, migrations, RLS utilities
│   ├── messaging/              # Kafka producers/consumers, event definitions
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

- **Phase 1:** Deploy as modular monolith within single Nest application; enforce boundaries through module imports and shared library contracts.
- **Phase 2:** Extract high-churn or high-load services (Authentication, Enrollment) into independently deployable Nest applications communicating over gRPC.
- **Phase 3:** Introduce polyglot services (e.g., Go risk scoring pipelines or Rust crypto workers) behind stable interfaces when performance data justifies.
- **Phase 4:** Full multi-region active-active deployment with global load balancing and regional data residency controls.

## Documentation & Governance

- Architecture Decision Records maintained alongside code; every change references compliance controls.
- Threat modeling performed per feature (STRIDE/Kill Chain) with mitigations documented and tracked.
- Regular security reviews, tabletop exercises, and disaster recovery drills with postmortem process feeding back into roadmap.

