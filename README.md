# Biometric Core Backend

This repository contains the backend for the Biometric Core platform, built with NestJS. The documentation is streamlined to focus on what matters for building and running the service.

- Project Overview: docs/core/project-overview.md
- Project Architecture: docs/core/project-architecture.md
- Project Stack: docs/core/project-stack.md
 - API Response Standard: docs/standards/response-standard.md
 - Developer Guide: docs/guide/README.md

Feature Plans
- Overview & priorities: docs/features/overview.md
- Users module: docs/features/users.md
- Auth (email/password): docs/features/auth-password.md
- Enrollment (WebAuthn create): docs/features/enrollment.md
- Auth (biometric assertion): docs/features/auth-biometric.md

Development
- Node.js 24 LTS is the project standard. Use `nvm use` (reads `.nvmrc`) to match the correct version.

Looking for previous notes (framework choices, language strategy, or Express layouts)? Those have been removed to avoid confusion and to fully embrace the NestJS stack.

Getting Started (Local)
- Prerequisites:
  - Docker Desktop (Compose v2)
  - Node.js 24 LTS + npm
  - Postgres and Redis run via Docker Compose
- 1) Copy env and review
  - `cp .env.example .env`
  - Defaults: Postgres `localhost:5432`, Redis `localhost:6380`
  - If your DB password contains special characters (e.g., `@`), URL‑encode it in `DATABASE_URL`.
- 2) Start dependencies
  - `docker compose up -d`
  - Note: Redis is mapped to host port `6380`; Postgres to `5432`.
- 3) Install dependencies
  - `npm install`
- 4) Initialize database (first run)
  - `npx prisma migrate dev --name init`
  - `npx prisma generate`
- 5) Run the API in watch mode
  - `npm run start:dev`
- 6) Verify
  - Health: `http://localhost:3000/health` → `{ "status": "ok" }`
  - Docs (Swagger UI): `http://localhost:3000/docs`

Testing
- End‑to‑end tests: `npm run test:e2e`
- Unit tests (when added): `npm run test`

Windows + WSL Tips
- If you develop inside WSL, prefer running Node/npm from Windows to avoid shim issues. See AGENTS.md for command examples.

Troubleshooting
- Redis port in use: edit `docker-compose.yml` to change `6380:6379` or free the port; update `REDIS_URL` accordingly.
- Postgres conflicts (port 5432 busy): stop the Windows Postgres service or remap Compose to `5433:5432` and set `DATABASE_URL` to port 5433.
- Prisma P1000 (auth failed): verify `DATABASE_URL` credentials and URL‑encode special characters.
- Compose warning about `version:`: safe to ignore; remove the `version:` line to silence it.
