# Repository Guidelines

## Project Structure & Module Organization

```
biometric-core-backend/
├─ src/
│  ├─ app.module.ts        # global wiring (interceptors, filters)
│  ├─ main.ts              # bootstrap, /v1 prefix, notFound handler
│  ├─ common/
│  │  ├─ errors/           # ProblemException, ErrorCode
│  │  ├─ http/
│  │  │  ├─ decorators/    # SkipEnvelope
│  │  │  ├─ filters/       # ProblemDetails filter
│  │  │  └─ interceptors/  # envelope, request-id, idempotency
│  │  └─ pagination/       # PageQueryDto, cursor, toPaginated
│  ├─ auth/                # placeholder module
│  ├─ health/              # GET /health (raw)
│  ├─ prisma/              # Prisma service/module
│  └─ redis/               # Redis service/module
├─ prisma/                 # schema.prisma, migrations
├─ test/                   # e2e tests
├─ docs/
│  ├─ core/                # overview, architecture, stack
│  ├─ openapi/             # openapi.yaml (source of truth)
│  ├─ standards/           # response standard
│  └─ guide/               # developer guide (patterns & usage)
├─ docker-compose.yml      # Postgres, Redis
└─ package.json
```

## Build, Test, and Development Commands

- Node version: use `nvm use` (Node 24 LTS). If needed: `nvm install 24`.
- After scaffold (package.json present):
  - `npm i` — install deps
  - `npm run start:dev` — run Nest (Fastify) in watch mode
  - `npm run test` / `npm run test:e2e` — run unit/e2e tests
  - `npm run build` — compile TypeScript to `dist/`
  - `npm run lint` / `npm run format` — lint and format code
- Env: `cp .env.example .env` and edit values. Optional: `docker compose up -d` for Postgres/Redis when added.

## Coding Style & Naming Conventions

- Language: TypeScript (2‑space indent, no semicolon preference enforced by Prettier).
- Tools: ESLint + Prettier + TypeScript ESLint.
- Naming: `camelCase` vars/functions, `PascalCase` classes, `SCREAMING_SNAKE_CASE` constants.
- Nest patterns: `feature.module.ts`, `feature.controller.ts`, `feature.service.ts`, DTOs end with `.dto.ts`.

See also: API response standard in `docs/standards/response-standard.md` and developer guide in `docs/guide/README.md`.

## Response & Utilities (Must Follow)

- Envelope: controllers return plain DTOs; interceptor wraps as `{ data, meta? }`.
- Skip envelope: add `@SkipEnvelope()` for endpoints like `/health` or streams.
- Errors: throw `ProblemException.*` with `ErrorCode` for RFC 7807 bodies.
- Idempotency: POST/DELETE honor `Idempotency-Key`; replays return `Idempotency-Replayed: true`.
- Pagination: accept `PageQueryDto` and return `toPaginated(items, nextCursor?, limit?)`; envelope adds `{ data, meta }`.
- Versioning: all routes under `/v1` (except `/health`).
- Spec: keep `docs/openapi/openapi.yaml` in sync; lint via `npm run spec:lint`.

## Testing Guidelines

- Frameworks: Jest (unit), Supertest (e2e).
- Location: `*.spec.ts` colocated with code or under `tests/`.
- Aim for ≥80% coverage on core modules; mock external IO.
- E2E tests may spin up Postgres/Redis via Docker/Testcontainers when introduced.

## Commit & Pull Request Guidelines

- Use Conventional Commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.
- PRs: include what/why, linked issues, and update docs when behavior or APIs change.
- Keep PRs focused and small; run lint/tests locally before opening.

## Security & Configuration Tips

- Never commit secrets. Use `.env` + `.env.example`; store real secrets in a secret manager.
- Validate env on boot; prefer least privilege for DB users.
- Do not store raw biometric data; persist only necessary, privacy‑preserving artifacts.

## Tooling Tips (Node & WSL)

- Standard Node: 24 LTS. Prefer running Node/NPM from Windows when developing inside WSL to avoid shim issues.
- Install Node 24 on Windows
  - nvm‑windows: `winget install CoreyButler.NVMforWindows` → `nvm install 24.11.0` → `nvm use 24.11.0`
  - Or install Node 24 LTS MSI from nodejs.org.
- Use Windows Node/NPM from WSL (run in repo root)
  - Install deps: `cmd.exe /C "%ProgramFiles%\nodejs\npm.cmd" ci`
  - Dev server: `cmd.exe /C "%ProgramFiles%\nodejs\npm.cmd" run start:dev`
  - Prisma generate: `cmd.exe /C "%APPDATA%\npm\npx.cmd" prisma generate`
  - Prisma migrate: `cmd.exe /C "%APPDATA%\npm\npx.cmd" prisma migrate dev`
  - Tests (e2e): `cmd.exe /C "%ProgramFiles%\nodejs\npm.cmd" run test:e2e --silent`
  - Build: `cmd.exe /C "%ProgramFiles%\nodejs\npm.cmd" run build`
- Environment & services
  - `cp .env.example .env` and set `REDIS_URL=redis://localhost:6380` (compose maps 6380→6379).
  - Start deps: `docker compose up -d`. Remove `version:` from compose to silence the warning.
- If commands fail due to environment or permissions, don’t force execution—surface the error and request access/approval instead.
