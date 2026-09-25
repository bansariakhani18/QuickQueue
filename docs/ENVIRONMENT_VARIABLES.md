# QuickQueue V1 — Environment Variables Reference

This document provides a comprehensive inventory of all configuration variables used by QuickQueue across backend services, frontend web applications, and Docker environments.

---

## 1. Security Classification & Rules

* **SECRET:** Credentials, private keys, authorization tokens, and signing secrets.
  * **Rule:** Must **NEVER** be committed to version control. Must live only in untracked local `.env` files or managed cloud secrets (e.g. Render/Vercel environment dashboards).
* **NON-SECRET:** Ports, hosts, URLs, timeouts, and public configuration switches.
  * **Rule:** May have sensible defaults in `.env.example` or code.

---

## 2. Backend Environment Variables

The backend application (`backend/`) loads configuration from process environment variables and `backend/.env` (which is git-ignored).

| Variable Name | Purpose | Required? | Default in Code | Classification | Notes |
|---|---|---|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string for Prisma ORM | **Required** | *None (Prisma fails if missing)* | **SECRET** | Local default: `postgresql://quickqueue:quickqueue_dev_only@localhost:5433/quickqueue?schema=public` |
| `BACKEND_PORT` | HTTP port the Express server listens on | Optional | `3000` | Non-Secret | Configurable for environments where port 3000 is occupied. |
| `ALLOWED_ORIGINS` | Comma-separated list of allowed origins for CSRF/Origin validation | Optional | `http://localhost:5173` | Non-Secret | Include production frontend domain when deployed. |
| `SESSION_SECRET` | Secret key used to sign session cookies (`cookie-session`) | **Required in Prod** | `'dev-session-secret-do-not-use-in-production'` | **SECRET** | Must be a long random string in production. |
| `NODE_ENV` | Runtime environment mode | Optional | `'development'` | Non-Secret | Setting to `'production'` enables `secure: true` on cookies (requires HTTPS). |
| `WHATSAPP_TOKEN_ENCRYPTION_KEY` | 32-byte (256-bit) secret for AES-256-GCM encryption of restaurant WABA tokens | **Required** | *None (Fails closed if missing)* | **SECRET** | Must be a secure random 32-character or hex-encoded string. |
| `WHATSAPP_APP_SECRET` | Meta App Secret for validating incoming webhook signatures | **Required for Webhooks** | `''` | **SECRET** | Used to calculate HMAC-SHA256 against `X-Hub-Signature-256`. |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Verification token for Meta webhook handshake challenge | **Required for Webhooks** | `''` | **SECRET** | Matched against `hub.verify_token` during `GET /webhook/whatsapp`. |
| `WHATSAPP_API_VERSION` | Meta WhatsApp Cloud API Graph version | Optional | `'v21.0'` | Non-Secret | Matches current supported Meta Graph API version. |
| `WHATSAPP_TEMPLATE_NAME` | WhatsApp Utility template name for order-ready alerts | Optional | `'quickqueue_order_ready_v1'` | Non-Secret | Template approved by Meta under Utility category. |
| `WHATSAPP_TEMPLATE_LANGUAGE` | Language code for the order-ready template | Optional | `'en_US'` | Non-Secret | Current template language. |
| `RETRY_BACKOFF_MS` | Base exponential backoff multiplier for transient failures | Optional | `60000` (1 minute) | Non-Secret | Backoff formula: `RETRY_BACKOFF_MS * 2^(retryCount - 1)`. |
| `RETENTION_HOURS` | Retention window for scrubbing customer phone numbers | Optional | `72` (hours) | Non-Secret | Terminal orders older than this window have `customerPhone` set to null. |
| `PROCESSOR_INTERVAL_MS` | Polling frequency for the background notification processor | Optional | `2000` (2 seconds) | Non-Secret | Background job tick interval. |
| `SCRUB_INTERVAL_MS` | Polling frequency for the phone scrubbing job | Optional | `3600000` (1 hour) | Non-Secret | Frequency of data cleanup passes. |

### Legacy / Single-Tenant Fallback Variables (Phase 12)
These variables were used during initial direct API testing prior to Phase 15 multi-tenant Embedded Signup. In production, credentials are read per-restaurant from `WhatsAppConnection` rows:

| Variable Name | Purpose | Required? | Default in Code | Classification |
|---|---|---|---|---|
| `WHATSAPP_PHONE_NUMBER_ID` | Fallback sender phone number ID | Optional | `''` | Non-Secret |
| `WHATSAPP_WABA_ID` | Fallback WhatsApp Business Account ID | Optional | `''` | Non-Secret |
| `WHATSAPP_ACCESS_TOKEN` | Fallback System User access token | Optional | `''` | **SECRET** |
| `WHATSAPP_RECIPIENT_PHONE` | Recipient phone for manual test scripts | Optional | `''` | Non-Secret |

---

## 3. Frontend Environment Variables

The frontend application (`frontend/`) is built with Vite.

| Variable Name | Purpose | Required? | Default | Classification | Notes |
|---|---|---|---|---|---|
| `VITE_API_BASE_URL` | Base backend API URL | Optional | `http://localhost:3000` | Non-Secret | In local development, the Vite dev proxy rewrites `/api/*` requests directly to `:3000`, so no explicit variable is required. |

---

## 4. Docker Compose Environment Variables

Used exclusively by `docker-compose.yml` to provision the local PostgreSQL 16 container.

| Variable Name | Purpose | Default in `.env.example` | Classification | Notes |
|---|---|---|---|---|
| `POSTGRES_DB` | Database name | `quickqueue` | Non-Secret | |
| `POSTGRES_USER` | PostgreSQL user | `quickqueue` | Non-Secret | |
| `POSTGRES_PASSWORD` | PostgreSQL user password | `quickqueue_dev_only` | **SECRET** (dev only) | Never use default password in production. |
| `POSTGRES_PORT` | Host port mapped to PostgreSQL container port 5432 | `5433` | Non-Secret | **Must remain 5433** locally to avoid native port 5432 conflict. |
