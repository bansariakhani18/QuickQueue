# QuickQueue — Local Development & Setup Guide

QuickQueue uses an npm-workspaces monorepo containing independent frontend and backend applications, backed by PostgreSQL 16.

---

## 1. Prerequisites

* **Node.js:** v22 or newer (Node 24 supported)
* **npm:** v10 or newer
* **Docker Desktop:** Required for running the local PostgreSQL container
* **Git:** Required for version control

---

## 2. Services Overview

| Service | Local Address | Command | Description |
|---|---|---|---|
| **Frontend** | `http://localhost:5173` | `npm run dev:frontend` | React 19 + TypeScript + Vite SPA |
| **Backend** | `http://localhost:3000` | `npm run dev:backend` | Node.js + Express + Prisma API & Processor |
| **PostgreSQL 16** | `localhost:5433` | `docker compose up -d postgres` | PostgreSQL 16 Alpine Docker container |

---

## 3. PostgreSQL & Port Configuration

### Why Host Port 5433 is Used
A native Windows PostgreSQL installation often occupies host port `5432`. To avoid port collision without interfering with existing developer services, QuickQueue maps its Docker container port `5432` to host port **`5433`**.
* This mapping is consistently configured in `docker-compose.yml`, `.env.example`, and `backend/.env`.
* **Important:** Do NOT change this port back to `5432` without checking for a native conflict first.

### Container & Persistence
* **Image:** `postgres:16-alpine`
* **Container Name:** `quickqueue-postgres`
* **Volume:** `quickqueue_postgres-data` (persists database state across container reboots)

---

## 4. Fresh Clone Setup (Step-by-Step)

```powershell
# 1. Clone repository and install dependencies
git clone <repo-url>
cd QuickQueue
npm install

# 2. Configure environment variables
# Copy root .env.example to .env for Docker Compose:
Copy-Item .env.example .env

# Create backend/.env with the local database connection:
# (backend/.env is Git-ignored)
Set-Content backend/.env "DATABASE_URL=postgresql://quickqueue:quickqueue_dev_only@localhost:5433/quickqueue?schema=public"

# 3. Start local PostgreSQL
docker compose up -d postgres

# 4. Apply Prisma migrations
cd backend
npx prisma migrate deploy
cd ..

# 5. Start development servers (in separate terminals)
# Terminal A (Backend):
npm run dev:backend

# Terminal B (Frontend):
npm run dev:frontend
```

---

## 5. Backend Architecture & Endpoints

The backend is an Express 5.2.1 + TypeScript application running on port `3000`:
* **Health & DB Check:** `GET /health` returns `200 {"status":"ok"}` after confirming database connectivity (NFR-015).
* **Authentication (`/auth`):** Restaurant signup (`POST /auth/signup`), login (`POST /auth/login`), logout (`POST /auth/logout`), and password reset with token verification.
* **Order Operations (`/orders`):** Order creation, active order queue with tenant isolation, and status transition endpoints (`/ready`, `/collected`, `/cancel`, `/recall`).
* **WhatsApp Connections (`/connections`):** Multi-tenant Embedded Signup endpoints (`/signup/initiate`, `/signup/complete`, and read-only `/status`).
* **Webhooks (`/webhook/whatsapp`):** Meta webhook handshake and HMAC-SHA256 signature-verified event receiver.
* **Background Worker:** `startProcessor()` runs inside `server.ts` to claim and dispatch pending notification attempts.

---

## 6. Frontend Architecture & Vite Proxy

The frontend is a React 19 + TypeScript single-page application built with Vite:
* Runs locally at `http://localhost:5173`.
* Communicates with the backend via the Vite dev proxy: requests to `/api/*` are transparently rewritten to `http://localhost:3000/*`.
* The proxy preserves `credentials: 'include'` for same-origin session cookie handling, satisfying backend origin validation (`ALLOWED_ORIGINS`).
* Active orders automatically poll every 5 seconds via `@tanstack/react-query`.

---

## 7. Useful Database & Verification Commands

### Database & Prisma (from `backend/`)
* `npx prisma migrate status` — Check whether migrations are up to date
* `npx prisma migrate deploy` — Apply pending migrations
* `npx prisma studio` — Launch browser-based database viewer at `http://localhost:5555`

### Quality Checks (from repository root)
* `npm run typecheck` — Run TypeScript compiler check on all workspaces
* `npm run build` — Build backend and frontend production bundles
* `npm run test` — Run the full automated test suite (224 tests passing)
* `git diff --check` — Check for whitespace errors or uncommitted artifacts

---

## 8. Current Project Status

As of Phase 18 completion:
* **Phases 0–18:** ✅ Complete and committed (HEAD: `1cf7635`).
* **Test Suite:** 224/224 automated backend tests passing across 13 test files.
* **Frontend:** Fully implemented with authentication, active queue, WhatsApp connection panel, and dedicated visual/UX review.
* **Next Steps:** Phase 19 (Documentation) in progress; Phase 20 (Test Suite Audit) pending.
