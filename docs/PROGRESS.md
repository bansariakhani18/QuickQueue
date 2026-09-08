# QuickQueue V1 — Progress

## Repository State

- **Branch:** `main`
- **HEAD:** `62dacb6 feat: implement authentication core (Phase 3)`
- **Commits (in order):**
  1. `56aca30 docs: add frozen QuickQueue V1 SRS`
  2. `abee3a6 chore: establish QuickQueue project foundation`
  3. `fd16cb1 chore: establish database foundation and build workflow`
  4. `62dacb6 feat: implement authentication core (Phase 3)`

### Working Tree

Clean — no uncommitted changes.

---

## Implementation State

### Phase 0 — Zero to First Local Run: ✅ COMPLETE

All Phase 0 goals are met:
- Git repository initialized with GitHub remote
- Project structure: `backend/`, `frontend/`, `docs/`, root config files
- Root `.gitignore` configured
- Docker PostgreSQL 16 running locally
- npm workspaces configured
- Backend skeleton: Express + TypeScript + minimal health check
- Frontend skeleton: React + TypeScript + Vite

### Phase 2 — Database Schema and First Migration: ✅ COMPLETE (locally)

- Prisma 6.19.3 installed and configured
- `backend/prisma/schema.prisma` matches frozen SRS §14.2 exactly (all 5 models, 6 enums, all indexes)
- Migration `20260908114604_initial_schema` applied to local database
- Hand-written partial unique index `one_active_attempt_per_order` included in migration
- Prisma client generates successfully

**Verified against live database:**
- All 5 tables exist: `restaurants`, `whatsapp_connections`, `orders`, `notification_attempts`, `notification_opt_outs`
- All 18 indexes present, including the partial unique index
- All 4 foreign keys use `ON DELETE CASCADE`
- Partial unique index enforcement tested live: blocks duplicate PENDING/PROCESSING attempts, allows new attempts after SENT/DELIVERED/READ/FAILED

### Phase 1 — Backend Skeleton: ✅ COMPLETE

Verified against `QuickQueue_Build_Playbook.md` Phase 1 requirements:
- `backend/package.json`: TypeScript, Express 5.2.1, tsx (hot reload), @types packages ✅
- `backend/tsconfig.json`: strict mode enabled, additional strict options ✅
- `backend/src/server.ts`: Express server on `BACKEND_PORT` (default 3000), `GET /health` returns `200 {"status":"ok"}` ✅
- npm scripts: `dev` (tsx watch), `build` (tsc), `typecheck` (tsc --noEmit) ✅
- Typecheck passes ✅
- Build passes ✅
- Server starts, `/health` responds correctly ✅

**Deviation from Playbook:** Playbook specifies default port 4000; code uses 3000 to match the committed `.env.example` (`BACKEND_PORT=3000`). This is a deliberate local configuration choice, not an error.

### Phase 3 — Authentication Core: ✅ COMPLETE

Verified against `QuickQueue_Build_Playbook.md` Phase 3 requirements:
- POST /auth/signup: creates restaurant, sets session cookie ✅
- POST /auth/login: validates credentials, sets session cookie ✅
- POST /auth/logout: clears session cookie ✅
- requireAuth middleware: validates session + sessionVersion against DB ✅
- cookie-session with HTTP-only, signed cookie ✅
- 11 tests: signup (3), login (4), logout (1), middleware (3) ✅
- Typecheck passes ✅
- Build passes ✅

### Not Implemented (Phase 4+)

The following are **not** implemented — do not assume they exist:
- CSRF / rate limiting (Phase 5)
- Order CRUD / tenant isolation (Phase 6)
- Order status transitions (Phase 7)
- Notification logic (Phase 8+)
- WhatsApp integration / webhooks (Phase 12+)
- Frontend product UI (Phase 17+)
- Phone number scrubbing / retention cleanup (Phase 11)

---

## PostgreSQL Environment

| Detail | Value |
|--------|-------|
| Engine | PostgreSQL 16 (Alpine) |
| Docker image | `postgres:16-alpine` |
| Container name | `quickqueue-postgres` |
| Host port | `5433` (mapped to container port 5432) |
| Container port | `5432` |
| Database name | `quickqueue` |
| Volume | `quickqueue_postgres-data` (named volume) |

**Port rationale:** A native Windows PostgreSQL installation already occupies host port 5432. QuickQueue's Docker PostgreSQL is mapped to host port 5433 to avoid conflict. This is reflected in `docker-compose.yml`, `.env.example`, and `backend/.env`.

**Do not change this port configuration without checking for a conflict first.**

---

## Current Phase Status

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 0 — Foundation | ✅ Complete | Project structure, Docker, workspaces |
| Phase 1 — Backend Skeleton | ✅ Complete | Express + TypeScript + health check verified |
| Phase 2 — Database Schema | ✅ Complete | Schema, migration, verified against live DB |
| Phase 3 — Authentication Core | ✅ Complete | Auth routes + middleware + 11 tests |
| Phase 4 — Password Reset | ⬜ Not started | Next phase to implement |
| Phase 5 — CSRF, Rate Limiting, Health+DB | ⬜ Not started | |
| Phase 6 — Order CRUD & Tenant Isolation | ⬜ Not started | |
| Phase 7 — Order Status Transitions | ⬜ Not started | |
| Phase 8 — Notification Attempt Creation | ⬜ Not started | |
| Phase 9 — Background Processor | ⬜ Not started | |
| Phase 10 — Retry Classification & RECALL | ⬜ Not started | |
| Phase 11 — Retention / Phone Scrubbing | ⬜ Not started | |
| Phase 12 — Real WhatsApp Integration | ⬜ Not started | |
| Phase 13 — Webhook Receiver | ⬜ Not started | |
| Phase 14 — STOP / Opt-Out | ⬜ Not started | |
| Phase 15 — Embedded Signup | ⬜ Not started | |
| Phase 16 — Restaurant Deactivation | ⬜ Not started | |
| Phase 17 — Frontend Core | ⬜ Not started | |
| Phase 18 — Frontend Visual Review | ⬜ Not started | |
| Phase 19 — Documentation | ⬜ Not started | |
| Phase 20 — Test Suite Audit | ⬜ Not started | |
| Phase 21 — Deployment (Render) | ⬜ Not started | |
| Phase 22 — Deployment (Vercel) | ⬜ Not started | |

---

## Next Step

**Phase 4 — Password Reset** per `QuickQueue_Build_Playbook.md`.
