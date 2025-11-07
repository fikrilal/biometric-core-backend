# Language Strategy – TypeScript First, Native Where It Counts

## Position

- Core services in TypeScript (Node.js 20 LTS) for developer velocity, ecosystem breadth, and maintainability.
- Native extensions (Rust/Go or WASM) only for cryptographic hot paths or vendor-mandated HSM/PKCS#11 integrations.

## Offload Criteria

Introduce a native worker/sidecar when at least one holds true:

- P95 authentication latency > 300 ms under expected load after tuning.
- CPU saturation > 70% sustained on auth/enroll paths despite horizontal scaling and caching.
- Compliance requires FIPS 140-2/3 with vendor SDKs that lack robust Node bindings.
- Specialized parsing/verification (e.g., complex attestation chains) proves significantly faster natively (>3×).

## Offload Patterns

- Sidecar microservice exposing gRPC (preferred): isolate vendor SDK complexity; version independently; language-agnostic clients.
- Worker pool (Node `worker_threads`): offload CPU-bound tasks while staying inside the process; good for WebAuthn verification bursts.
- WASM module: for pure compute with minimal I/O; ship sandboxed routines where feasible.

## Key Management

- Sign/verify user-visible tokens with KMS/HSM-backed keys; never export private keys to app memory.
- Use KMS for JWS signing; cache public JWKS with short TTL.

## Tooling

- `jose` for JOSE suite (JWS/JWE/JWT) in Node.
- `@simplewebauthn/server` for WebAuthn registration/assertion; extend with FIDO Metadata Service sync.
- `pkcs11js` or gRPC sidecar to reach CloudHSM/Managed HSM when needed.

## Testing & Benchmarking

- Maintain k6/Artillery scenarios for enroll/auth/transaction signing; track SLO burn rates.
- Establish perf regression gates in CI before electing native offload.

