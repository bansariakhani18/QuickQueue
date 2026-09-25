# QuickQueue V1 — Troubleshooting Guide

This guide covers common issues encountered during local development and testing, along with concrete, repository-supported remedies.

---

## 1. Database & Port Issues

### Issue: "Port 5432 is already in use" or Docker container fails to bind
* **Cause:** A native Windows PostgreSQL service (or another container) is already listening on host port `5432`.
* **Resolution:** QuickQueue's Docker Compose environment is deliberately mapped to host port **`5433`**:
  * `docker-compose.yml` maps `5433:5432`.
  * `.env.example` and `backend/.env` use `postgresql://...:5433/quickqueue`.
  * **Rule:** Do NOT edit the port back to `5432`. Ensure your local `.env` and connection strings specify `5433`.

### Issue: Database container is unhealthy or stopped
* **Diagnosis:** Check container status:
  ```powershell
  docker compose ps
  docker compose logs postgres
  ```
* **Resolution:** Restart the PostgreSQL container:
  ```powershell
  docker compose down
  docker compose up -d postgres
  ```

---

## 2. Prisma & Database Migrations

### Issue: "Schema out of sync" or "Table does not exist"
* **Diagnosis:** Check migration status from the `backend/` directory:
  ```powershell
  cd backend
  npx prisma migrate status
  ```
* **Resolution:** Apply pending migrations:
  ```powershell
  npx prisma migrate deploy
  ```
  *(Dev only)* If working with local test schema changes:
  ```powershell
  npx prisma db push
  ```

### Issue: Inspecting local database tables visually
* Run Prisma Studio to view database rows in your browser:
  ```powershell
  cd backend
  npx prisma studio
  ```
  Prisma Studio opens at `http://localhost:5555`.

---

## 3. Frontend & Vite Proxy

### Issue: Frontend requests to `/api/*` fail with 404 or connection refused
* **Cause:** The backend Express server is not running on port `3000`.
* **Diagnosis:** Test backend health directly:
  ```powershell
  curl http://localhost:3000/health
  ```
  Should return `{"status":"ok"}`.
* **Resolution:** Ensure the backend is started before using the frontend:
  ```powershell
  npm run dev:backend
  ```

### Issue: Frontend displays "Unauthorized" on protected actions
* **Cause:** Missing or expired session cookie.
* **Resolution:**
  1. Log in or create an account via the frontend login screen.
  2. The Vite dev proxy forwards `/api/*` to `http://localhost:3000` while preserving `credentials: 'include'`, ensuring session cookies match the origin.

---

## 4. Webhooks & Local Testing

### Issue: Inbound webhook rejected with "Signature mismatch" (HTTP 401)
* **Cause:** `POST /webhook/whatsapp` requires a valid HMAC-SHA256 signature in the `X-Hub-Signature-256` header calculated with `WHATSAPP_APP_SECRET`.
* **Resolution:** In local test suites, use the test helper in `backend/src/__tests__/webhook.test.ts` to compute valid signatures over the raw request payload:
  ```typescript
  import crypto from 'node:crypto';
  const signature = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
  ```

### Issue: Webhook verification challenge fails (GET /webhook/whatsapp)
* **Resolution:** Ensure `hub.verify_token` sent in the query parameters matches `WHATSAPP_WEBHOOK_VERIFY_TOKEN` configured in your environment.

---

## 5. Meta WhatsApp Connection & Testing

### Issue: WhatsApp Connection Panel shows "Pending" or "Not connected"
* **Normal Behavior:** In local development, Meta Embedded Signup popups cannot complete without an active Meta Tech Provider production asset and unexpired access token.
* **Explanation:** The frontend honestly reflects this state without faking connection data. The backend dispatches notifications safely using test/sandbox handlers.

---

## 6. Common Quality & Build Commands

Run these standard scripts from the repository root:

| Command | Action |
|---|---|
| `npm run typecheck` | Run TypeScript compiler checks across all workspaces |
| `npm run build` | Build production bundles for backend and frontend |
| `npm run test` | Execute the complete Vitest automated test suite |
| `npm --workspace=backend run test` | Run backend tests only (224 tests) |
| `npm --workspace=frontend run typecheck` | Run frontend typecheck only |
| `git diff --check` | Verify no whitespace errors or conflict markers |
