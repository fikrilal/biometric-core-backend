# Biometric Core Backend – Project Stack

## Runtime & Language

- **Node.js 24 LTS + TypeScript** for primary services (performance, modern language features, broad ecosystem).
- **TypeScript project references** via monorepo tooling to enforce explicit module boundaries.
- **Native extensions (Rust/WASM)** reserved for crypto-heavy paths if benchmarks prove necessary.

## Service Frameworks & Libraries

- **NestJS** as the application framework: modular architecture, dependency injection, guards/interceptors for policy enforcement.
- **Fastify adapter** for NestJS to maximize throughput and minimize overhead.
- **class-validator + class-transformer** for DTO validation in controllers; **Zod** optional for shared library schemas and codegen.

## API Contracts & Client Integration

- **REST + OpenAPI 3.1** exposed through API gateway; SDKs generated for web, mobile, and server-side clients.
- **FIDO2/WebAuthn** using `@simplewebauthn/server` for registration and assertion verification.
- **WebSockets/Server-Sent Events** for real-time challenge delivery and transaction status updates.

## Data & Storage

- **PostgreSQL 15** with partitioned tables, row-level security, and pgcrypto for high-risk fields.
- **Redis 7** for ephemeral challenge storage, rate limiting, and risk scoring caches.
- **Object storage (S3/Blob)** for encrypted artifacts (attestation evidence, compliance reports) with KMS-managed keys.
- **Optional document store** (MongoDB/DocumentDB) dedicated to analytics or unstructured risk signals if required.

## Security & Cryptography

- **Cloud KMS** (e.g., AWS KMS, GCP KMS) for managing signing/encryption keys.
- **JOSE tooling** (`jose`, `node-webauthn`, custom wrappers) for JWT/JWS/JWE operations.
- **Device attestation** verification libraries from FIDO Alliance metadata service; regularly sync metadata statements.

## Observability & Operations

- **OpenTelemetry SDK** for traces, metrics, and logs; exported to Tempo/Jaeger, Prometheus, and Loki/ELK respectively.
- **nestjs-pino** (Pino) for structured logging with redaction hooks for sensitive data.
- **Grafana** dashboards with SLO burn rate indicators and business KPIs (enrollment success, auth latency).
- **Feature flags** managed through LaunchDarkly or open-source alternatives (Unleash) to control rollouts.

## DevSecOps Toolchain

- **Nx** or **Turborepo** to manage build orchestration, dependency graph, and package boundaries.
- **ESLint + Prettier + TypeScript ESLint** for linting/formatting, with security-focused rulesets.
- **Jest + Supertest** for unit/integration testing; **k6** or **Artillery** for load testing.
- **GitHub Actions** CI pipelines with CodeQL, Trivy, and dependency scanning (Snyk/OWASP Dependency-Check).
- **Docker + Kubernetes** (EKS/AKS) for containerized deployment.
- **Terraform + Crossplane** for infrastructure as code and platform automation.
- **Sigstore/cosign** for container signing; **SBOM** generation (Syft) to support supply-chain attestations.

## Data Governance & Compliance

- **Vaulted audit logs** streamed to SIEM (Splunk/Elastic SIEM) with tamper-evident retention policies.
- **Data classification tooling** (e.g., Amazon Macie or Azure Purview) for discovery and compliance reporting.
- **DLP integrations** for outbound data monitoring where regulators require additional controls.

## Developer Experience

- **Storybook/Docs** for componentized SDK samples and integration guides.
- **Local dev environment** via Docker Compose or Tilt, including ephemeral dependencies (Postgres, Redis).
- **ADR (Architecture Decision Records)** tracked alongside documentation to capture rationale over time.
- **CLI tooling** (`oclif` or custom) to rotate keys and run diagnostic checks.

## Third-Party Integrations (Optional)

- **Mobile push providers** (Firebase Cloud Messaging, APNS) for out-of-band approvals.
- **Risk intelligence APIs** (ThreatMetrix, Feedzai) to complement in-house anomaly detection.
- **Ticketing/Alerting** (PagerDuty, Opsgenie) tied into observability stack for incident response.
