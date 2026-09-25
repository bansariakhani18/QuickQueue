# QuickQueue

QuickQueue is a SaaS order-ready notification system (a virtual pickup queue) that notifies customers via WhatsApp when their restaurant or food-court order is ready for collection. The frozen [SRS.md](SRS.md) is the project's single source of truth.

---

## Repository Layout

* `frontend/` — React 19, TypeScript, and Vite single-page application.
* `backend/` — Node.js, Express, TypeScript, and Prisma backend API and background processor.
* `docs/` — System architecture and developer documentation.
* `docker-compose.yml` — Local PostgreSQL 16 Alpine database container (mapped to host port `5433`).

---

## Prerequisites

* **Node.js:** v22 or newer (Node 24 supported)
* **npm:** v10 or newer
* **Docker Desktop:** For running local PostgreSQL 16

---

## Local Development

```powershell
# Install dependencies
npm install

# Start local PostgreSQL 16 (runs on host port 5433)
docker compose up -d postgres

# Start backend server (runs on port 3000)
npm run dev:backend

# Start frontend application (runs on port 5173 with /api proxy)
npm run dev:frontend
```

---

## Quality & Test Checks

```powershell
npm run typecheck    # TypeScript verification across backend and frontend
npm run build        # Build production bundles
npm run test         # Full Vitest test suite (224/224 tests passing)
```

---

## Current Status: Phase 18 Complete

QuickQueue is implemented and verified through **Phase 18** (commit: `1cf7635`):

* **Authentication & Security:** Restaurant signup, login, session management with versioned invalidation, rate limiting, and origin protection.
* **Order Lifecycle Machine:** `PREPARING` → `READY` → `COLLECTED` / `CANCELLED` transitions with PostgreSQL row locking and duplicate-token support.
* **Notification Engine:** Background processor using PostgreSQL `SELECT ... FOR UPDATE SKIP LOCKED`, stuck-job recovery, exponential retry backoff, and manual `RECALL` (up to 4 total attempts).
* **Multi-Tenant WhatsApp Integration:** Per-restaurant WhatsApp Business Account onboarding via Embedded Signup, AES-256-GCM encrypted token storage, display-name registration orchestration, template provisioning, and HMAC-SHA256 verified webhook processing.
* **Restaurant Core UI & UX Pass:** High-contrast, mobile-first React interface featuring an active order queue (5s polling), live relative waiting times, duplicate-token badges, and accessible controls.
* **External Meta Dependency Note:** Live Cloud API dispatches in local development run against verified test doubles and sandbox replays because the previous development access token expired on 2026-09-22 and Meta Tech Provider verification is pending.

---

## Detailed Documentation

* [Local Development & Setup Guide](docs/development.md)
* [System Architecture Overview](docs/ARCHITECTURE.md)
* [Environment Variables Reference](docs/ENVIRONMENT_VARIABLES.md)
* [Notification Engine Specification](docs/NOTIFICATION_ENGINE.md)
* [WhatsApp Cloud API Integration](docs/WHATSAPP_INTEGRATION.md)
* [Known Limitations & Trade-Offs](docs/KNOWN_LIMITATIONS.md)
* [Troubleshooting Guide](docs/TROUBLESHOOTING.md)
* [Phase-by-Phase Progress Log](docs/PROGRESS.md)
