# QuickQueue — Local Development Setup

QuickQueue uses an npm-workspaces repository with independent frontend and backend applications. The repository intentionally has no shared package yet; one should be introduced only when later phases create a genuine shared contract.

## Services

| Service | Local address | Command |
| --- | --- | --- |
| Frontend | `http://localhost:5173` | `npm run dev:frontend` |
| Backend | `http://localhost:3000` | `npm run dev:backend` |
| PostgreSQL 16 | `localhost:5433` | `docker compose up -d postgres` |

## PostgreSQL

A native Windows PostgreSQL installation already occupies host port `5432`. QuickQueue's Docker PostgreSQL is therefore mapped to host port `5433` → container port `5432`. This mapping must be consistent across `docker-compose.yml`, `.env.example`, and `backend/.env`.

PostgreSQL 16 is intentionally pinned in `docker-compose.yml`. The SRS requires identical database major versions locally and in production; production must therefore be provisioned on PostgreSQL 16 unless the frozen SRS is amended.

The Docker volume `quickqueue_postgres-data` persists database data across container restarts.

## Prisma

Prisma 6.19.3 is installed and configured. The schema (`backend/prisma/schema.prisma`) matches the frozen SRS §14.2 exactly. The initial migration (`20260908114604_initial_schema`) has been applied to the local database, including the hand-written partial unique index `one_active_attempt_per_order`.

Useful commands (run from `backend/`):
- `npx prisma generate` — regenerate the Prisma client
- `npx prisma migrate status` — check migration status
- `npx prisma db push` — push schema changes (dev only)
- `npx prisma studio` — open the browser-based data browser

## Backend

The backend is a Node.js + TypeScript + Express application. It currently exposes only `GET /health` returning `200 {"status":"ok"}`. The health check does not yet verify database connectivity (NFR-015) — that will be added when the backend gains database-dependent logic.

TypeScript strict mode is enabled. Run `npm run typecheck` from the backend or root to verify.

## Frontend

The frontend is a React + TypeScript + Vite application with a minimal scaffold. No product UI has been implemented yet.

## Environment Configuration

`.env.example` contains local development values for Docker Compose and reserved future application settings. Copy it to `.env` for Docker Compose overrides. Never commit `.env` or real credentials.

The backend's `backend/.env` contains only `DATABASE_URL` pointing at the local Docker PostgreSQL on port 5433.

## Quick Start

```powershell
# Start PostgreSQL
docker compose up -d postgres

# Install dependencies (from repo root)
npm install

# Start backend (from repo root)
npm run dev:backend

# Start frontend (from repo root)
npm run dev:frontend
```

## Phase Status

As of the latest state capture:
- **Phase 0 (Foundation):** Complete — project structure, Docker, workspaces
- **Phase 2 (Database Schema):** Complete — Prisma schema, migration applied, verified
- **Phase 1 (Backend Skeleton):** Not yet started — health check exists but no API endpoints
- **Phases 3–22:** Not started

See `docs/PROGRESS.md` for detailed phase tracking.
