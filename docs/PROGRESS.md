# QuickQueue V1 — Progress

## Repository State

- **Branch:** `main`
- **HEAD:** `abee3a6 chore: establish QuickQueue project foundation`
- **Commits (in order):**
  1. `56aca30 docs: add frozen QuickQueue V1 SRS`
  2. `abee3a6 chore: establish QuickQueue project foundation`

### Uncommitted / Untracked Work

The following files are modified or untracked in the working tree and have **not** been committed or pushed:

| Status | File | Description |
|--------|------|-------------|
| Modified | `.env.example` | Port changed from 5432 → 5433; DATABASE_URL updated |
| Modified | `backend/package.json` | Added `@prisma/client`, `prisma`, and `prisma` script |
| Modified | `docker-compose.yml` | Default port changed from 5432 → 5433 |
| Modified | `package-lock.json` | Updated with Prisma dependencies |
| Untracked | `QuickQueue_Build_Playbook.md` | Build playbook for the coding agent |
| Untracked | `backend/prisma/` | Prisma schema, migrations, and lock file |

These changes are intentionally uncommitted pending human review.

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

### Backend Foundation

- `backend/src/server.ts`: Express server with `GET /health` returning `200 {"status":"ok"}`
- TypeScript strict mode enabled
- Typecheck passes (frontend + backend)
- Build passes (backend)
- No API endpoints beyond health check
- No authentication, order lifecycle, notification logic, or WhatsApp integration

### Not Implemented

The following are **not** implemented — do not assume they exist:
- Phase 1 API implementation (authentication, CRUD endpoints)
- Notification processor
- WhatsApp integration / webhooks
- Frontend product UI
- Tests
- Rate limiting / CSRF protection
- Phone number scrubbing / retention cleanup

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
| Phase 1 — Backend Skeleton | ⬜ Not started | Next phase to implement |
| Phase 2 — Database Schema | ✅ Complete | Schema, migration, verified against live DB |
| Phase 3 — Authentication Core | ⬜ Not started | |
| Phase 4 — Password Reset | ⬜ Not started | |
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

**Phase 1 — Backend Skeleton** per `QuickQueue_Build_Playbook.md`.

Before starting: commit or discard the current uncommitted work, per human decision.
