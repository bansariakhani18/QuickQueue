# QuickQueue V1 — Progress

## Repository State

- **Branch:** `main`
- **HEAD:** `b8e4ea5 feat: implement order status transitions (Phase 7)`
- **Commits (in order):**
  1. `56aca30 docs: add frozen QuickQueue V1 SRS`
  2. `abee3a6 chore: establish QuickQueue project foundation`
  3. `fd16cb1 chore: establish database foundation and build workflow`
  4. `62dacb6 feat: implement authentication core (Phase 3)`
  5. `0801b26 feat: implement password reset flow (Phase 4)`
  6. `092aa64 feat: implement password reset and security protections (Phase 4-5)`
  7. `2f48616 feat: implement order creation and active order listing (Phase 6)`
  8. `b8e4ea5 feat: implement order status transitions (Phase 7)`

### Working Tree

Uncommitted changes: Phase 8 (notification attempt creation), Phase 9 (background processor, claiming, crash recovery), Phase 10 (retry classification & RECALL with backoff enforcement).

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

### Phase 2 — Database Schema and First Migration: ✅ COMPLETE

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

### Phase 4 — Password Reset: ✅ COMPLETE

- `backend/src/email.ts`: EmailSender interface + ConsoleEmailSender ✅
- POST /auth/password-reset/request: token generation, SHA-256 hash, 1hr expiry ✅
- POST /auth/password-reset/confirm: `prisma.$transaction` with `SELECT ... FOR UPDATE`, bcrypt hash before lock ✅
- 8 tests: non-existent email, token stored, valid reset, expired token, reused token, second reset invalidates first, session invalidation, concurrent duplicate ✅

### Phase 5 — CSRF, Rate Limiting, Health Check with DB: ✅ COMPLETE

- `backend/src/origin.ts`: Origin validation middleware (POST/PUT/PATCH/DELETE only) ✅
- `backend/src/rateLimit.ts`: In-memory rate limiter (login: 5/15min, reset-request: 5/15min) ✅
- `GET /health`: Async DB connectivity check via `SELECT 1`, returns 503 on failure ✅
- Test isolation: `clearRateLimitStore()` in `beforeEach` ✅
- 6 tests: origin rejection (403), origin allow (200), GET without origin, login rate limit (429), reset-request rate limit (429), health DB check (200) ✅

### Phase 6 — Order CRUD & Tenant Isolation: ✅ COMPLETE

- `backend/src/orders.ts`: Repository layer — `createOrder`, `listActiveOrders` with `restaurantId`-first pattern ✅
- `backend/src/ordersRouter.ts`: `POST /orders`, `GET /orders` behind `requireAuth` ✅
- Phone normalization via `libphonenumber-js` (E.164, US default) ✅
- Consent: explicit boolean, no default, `consentMethod` per FR-016 ✅
- Active orders: PREPARING + READY only, READY before PREPARING, oldest-first ✅
- Search: exact match on `displayToken` or `customerPhone` (FR-025) ✅
- Cross-tenant isolation: automated IDOR-style tests ✅
- 14 tests: creation (9), listing (2), cross-tenant (3) ✅

### Phase 7 — Order Status Transitions with Row Locking: ✅ COMPLETE

- `transitionOrderStatus(restaurantId, orderId, targetStatus)` in `orders.ts` ✅
- `SELECT ... FOR UPDATE` via `prisma.$transaction` (FR-022) ✅
- Allowed transitions enforced per FR-021 ✅
- Idempotent READY: returns current state, no error, no duplicate (FR-023) ✅
- `terminalAt` set on COLLECTED/CANCELLED transitions (FR-021a) ✅
- Routes: `POST /orders/:id/ready`, `/:id/collected`, `/:id/cancel` ✅
- 15 tests: valid transitions (4), invalid transitions (5), idempotent READY (2), terminalAt (3), cross-tenant (1), concurrency (1) ✅

### Phase 8 — Notification Attempt Creation: ✅ COMPLETE (uncommitted)

- `backend/src/notification.ts`: Mock notification sender with `NotificationSender` interface ✅
- READY transition gated on `consentGiven` + `NotificationOptOut` check (FR-019, FR-028) ✅
- `NotificationAttempt` created in same transaction as READY status change (FR-027) ✅
- `onBeforeAttemptInsert` hook for rollback testing ✅
- 5 tests: consent+no optout, consent=false, optout exists, transactional rollback, idempotent READY no duplicate ✅
- Typecheck passes ✅
- Build passes ✅
- 60 tests total across all suites ✅

### Phase 9 — Background Processor, Claiming, and Crash Recovery: ✅ COMPLETE (uncommitted)

- `backend/src/processor.ts`: In-process background processor with configurable interval ✅
- `claimAndProcessOne()`: Claims one PENDING attempt using `SELECT ... FOR UPDATE SKIP LOCKED` (FR-029) ✅
- Deactivated-restaurant exclusion: claim query joins restaurants table, excludes `status = DEACTIVATED` (FR-029) ✅
- PROCESSING committed before external call, no transaction across send (FR-030) ✅
- Mock send → SENT on success, FAILED on sender throw ✅
- `recoverStuckJobs(thresholdMs)`: Returns PROCESSING jobs stuck beyond threshold to PENDING (FR-034) ✅
- `startProcessor(intervalMs)` / `stopProcessor()`: Configurable via `PROCESSOR_INTERVAL_MS` env var ✅
- `setSendFailurePredicate()` / `clearSendFailurePredicate()`: Test-only mock failure injection ✅
- Processor loop calls both `claimAndProcessOne()` and `recoverStuckJobs()` each tick ✅
- 9 tests: claiming (4), sender failure (1), stuck recovery (2), deactivated exclusion (2), processor loop (1) ✅
- Typecheck passes ✅
- Build passes ✅
- 69 tests total across all suites ✅

### Phase 10 — Retry Classification & RECALL: ✅ COMPLETE (uncommitted)

- `FailureType` (`'transient' | 'permanent'`) exported from `processor.ts` ✅
- `setSendFailurePredicate` signature updated: returns `FailureType | null` instead of `boolean` ✅
- Transient failure: same row increments `retryCount`, `jobStatus` reset to `PENDING`, up to 3 retries (FR-033) ✅
- **Backoff enforcement**: `nextRetryAt` field on `NotificationAttempt`, set to `now + RETRY_BACKOFF_MS` (default 30s, env-configurable) on transient retry; `claimOne` query excludes attempts where `next_retry_at > NOW()` (FR-033) ✅
- Permanent failure: immediate `FAILED`, no retry (FR-033) ✅
- `recallOrder(restaurantId, orderId)`: `SELECT ... FOR UPDATE` on parent order, creates new `NotificationAttempt` with incremented `attemptNumber` (FR-035, FR-037) ✅
- Eligibility checks: status=READY, no active PENDING/PROCESSING attempt, max 3 recalls per order (FR-035, FR-036) ✅
- `RecallError` class for server-side rejection with clear messages ✅
- `POST /orders/:id/recall` route in `ordersRouter.ts` ✅
- Schema migration `20260909134413_add_next_retry_at` applied ✅
- 16 tests: transient retry (4), permanent failure (2), recall-eligible (3), recall-ineligible (5), concurrent recall (1), retry vs recall distinction (1) ✅
- Typecheck passes ✅
- Build passes ✅
- 85 tests total across all suites ✅

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
| Phase 4 — Password Reset | ✅ Complete | Token flow + 8 tests |
| Phase 5 — CSRF, Rate Limiting, Health+DB | ✅ Complete | Origin validation, rate limiters, DB health check |
| Phase 6 — Order CRUD & Tenant Isolation | ✅ Complete | Repository layer, 14 tests, cross-tenant IDOR |
| Phase 7 — Order Status Transitions | ✅ Complete | Row locking, 15 tests, concurrency |
| Phase 8 — Notification Attempt Creation | ✅ Complete | Consent/opt-out gating, transactional guarantee, 5 tests |
| Phase 9 — Background Processor | ✅ Complete | SKIP LOCKED claiming, stuck recovery, 9 tests |
| Phase 10 — Retry Classification & RECALL | ✅ Complete | Transient retry with backoff, permanent fail, RECALL, 16 tests |
| Phase 11 — Retention / Phone Scrubbing | ⬜ Not started | Next phase to implement |
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

**Phase 11 — Retention / Phone Scrubbing** per `QuickQueue_Build_Playbook.md`.
