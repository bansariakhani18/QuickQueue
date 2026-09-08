# Development foundation

QuickQueue uses an npm-workspaces repository with independent frontend and backend applications. The repository intentionally has no shared package yet; one should be introduced only when later phases create a genuine shared contract.

## Services

| Service | Local address | Command |
| --- | --- | --- |
| Frontend | `http://localhost:5173` | `npm run dev:frontend` |
| Backend | `http://localhost:3000` | `npm run dev:backend` |
| PostgreSQL 16 | `localhost:5432` | `docker compose up -d postgres` |

The backend currently exposes only `GET /health` as a process-level readiness placeholder. It does not yet verify database connectivity because the Prisma/database phase has not begun. Update it to verify PostgreSQL connectivity when that phase introduces the database client, as required by SRS NFR-015.

## Environment configuration

`.env.example` contains local development values for Docker Compose and reserved future application settings. Copy it to `.env` for Docker Compose overrides. Never commit `.env` or real credentials.

PostgreSQL 16 is intentionally pinned in `docker-compose.yml`. The SRS requires identical database major versions locally and in production but does not choose the version number; production must therefore be provisioned on PostgreSQL 16 unless the frozen SRS is amended.

## Phase boundaries

Do not add a Prisma schema or migration until the database phase. Do not add authentication, order lifecycle, WhatsApp, queues, Redis, Kafka, RabbitMQ, or microservices during the foundation phase.
