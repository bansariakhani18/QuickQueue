# QuickQueue

QuickQueue is a restaurant order-ready notification system (a virtual token/pickup queue) that notifies customers via WhatsApp when their order is ready for collection. The frozen [SRS](https://github.com/bansariakhani18/QuickQueue/blob/main/SRS.md) is the project's single source of truth.

## Repository layout

- `frontend/` — React, TypeScript, and Vite application.
- `backend/` — Node.js, TypeScript, and Express application.
- `docs/` — development documentation.
- `docker-compose.yml` — local PostgreSQL 16 database.

## Prerequisites

- Node.js 22 or newer (Node 24 is supported)
- npm 10 or newer
- Docker Desktop (for local PostgreSQL)

## Local development

```
npm install
docker compose up -d postgres
npm run dev:backend
npm run dev:frontend
```

The frontend runs at `http://localhost:5173`; the backend runs at `http://localhost:3000` and provides `GET /health`.

Copy `.env.example` to `.env` before starting Docker if you need to change its local database settings. The example values are development-only and must never be used in production.

## Checks

```
npm run typecheck
npm run build
npm run test
docker compose ps
```

Current status: 90/90 backend tests passing, typecheck and build green.

## Current status: backend through Phase 11

The backend is implemented and tested through the following:

- **Auth** — restaurant signup/login/logout, session-based auth with session-version invalidation, and password reset with hashed, expiring tokens.
- **Security** — origin/CSRF protection, rate limiting, DB health checks.
- **Orders** — order creation and active-order listing, with phone-number normalization and consent handling.
- **State machine** — PREPARING → READY → COLLECTED/CANCELLED lifecycle with locking and idempotency guarantees.
- **Notifications** — WhatsApp notification-attempt creation on READY, a background processor (`PENDING → PROCESSING → SENT/FAILED`) with row locking and stuck-job recovery, automatic transient retries with backoff, permanent-failure handling, and manual recall (max 3 attempts).
- **Data retention** — configurable (72h default) phone-number retention cleanup via a scheduled, idempotent scrubber.

PostgreSQL is pinned to major version 16 locally. Provision Render PostgreSQL 16 for production to satisfy SRS environment parity; the SRS itself does not specify a numeric major version.

## Not yet implemented

- **Real WhatsApp Cloud API integration** — the notification sender is currently mocked; real Meta Cloud API integration (auth, approved templates, webhook handling, delivery/read status, signature verification) is next, pending Meta developer/app/WABA setup.
- **Restaurant-facing frontend** — the React/TypeScript/Vite UI (login, order queue, READY/COLLECTED/RECALL actions, notification status visibility) has not been built yet.
- **Production deployment** — Render/Vercel deployment, production environment configuration, and end-to-end acceptance testing are pending.
