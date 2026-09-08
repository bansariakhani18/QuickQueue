# QuickQueue

QuickQueue is a restaurant order-ready notification system. The frozen [SRS](./SRS.md) is the project's single source of truth.

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

```sh
npm install
docker compose up -d postgres
npm run dev:backend
npm run dev:frontend
```

The frontend runs at `http://localhost:5173`; the backend runs at `http://localhost:3000` and provides `GET /health`.

Copy `.env.example` to `.env` before starting Docker if you need to change its local database settings. The example values are development-only and must never be used in production.

## Checks

```sh
npm run typecheck
npm run build
docker compose ps
```

## Current phase boundary

This repository contains only the project foundation. It intentionally has no authentication, Prisma setup or database schema, order-management code, WhatsApp integration, background processor, or other product features.

PostgreSQL is pinned to major version 16 locally. Provision Render PostgreSQL 16 for production to satisfy SRS environment parity; the SRS itself does not specify a numeric major version.
