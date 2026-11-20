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

Uncommitted changes: Phase 8 (notification attempt creation), Phase 9 (background processor, claiming, crash recovery), Phase 10 (retry classification & RECALL with backoff enforcement), Phase 11 (retention / phone scrubbing), Phase 13 (webhook receiver), Phase 14 (STOP / opt-out).

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

### Phase 11 — Retention / Phone Scrubbing: ✅ COMPLETE (uncommitted)

- `scrubExpiredPhones(retentionHours?)` in `processor.ts`: Finds orders where `terminalAt` is older than configurable retention window (default 72h, env `RETENTION_HOURS`) and `customerPhone` is not null; sets `customerPhone` to null and `phoneScrubbedAt` to current timestamp ✅
- Uses `(status, terminalAt)` index via Prisma `updateMany` with `terminalAt: { not: null, lt: cutoff }` and `customerPhone: { not: null }` — no full table scan ✅
- Idempotent: already-scrubbed rows (`customerPhone IS NULL`) excluded by filter, safe to run repeatedly ✅
- `RETENTION_HOURS` env var parsed at call time (default 72), configurable per environment ✅
- Wired into processor interval via separate hourly `scrubIntervalHandle`, controlled by `SCRUB_INTERVAL_MS` env var (default 3,600,000ms) ✅
- `startProcessor` / `stopProcessor` manage both the notification processor and scrubber intervals ✅
- 5 tests: past window scrubbed, within window untouched, null terminalAt untouched, idempotent, notificationAttempts preserved after scrub ✅
- Typecheck passes ✅
- Build passes ✅
- 90 tests total across all suites ✅

### Phase 12 — Real WhatsApp Integration: ✅ COMPLETE AND VERIFIED (uncommitted)

Implementation, tests, and real-Meta live verification are complete (uncommitted).

- `backend/src/whatsappClient.ts`: Real Meta WhatsApp Cloud API sender — `sendWhatsAppTemplate` POSTs to `https://graph.facebook.com/{apiVersion}/{phoneNumberId}/messages` with the access token as `Bearer`; parses the real `messages[0].id` as the provider message ID; structured `WhatsAppApiError` carrying HTTP status + Meta error metadata; `getConfigFromEnv()` fail-closed (returns null when any required env var is missing) ✅
- `backend/src/processor.ts`: `createRealWhatsAppSender` wraps the real client and returns the real provider message ID; `classifySendError` maps failures to transient/permanent/unknown with codes (`HTTP_*`, `META_*`, `NO_RESPONSE`, `RATE_LIMITED`, `UNKNOWN`) written to `NotificationAttempt.errorCode`/`errorMessage` (truncated, never containing the token) ✅
- `backend/src/server.ts`: installs the real sender at startup when the env config is present; otherwise the mock sender stays (fail-closed) ✅
- Real test notification successfully sent through the real Cloud API: the correct `NotificationAttempt` was persisted as `SENT` with `sentAt` and the **real provider message ID** (`providerMessageId`) stored; stale `errorCode`/`errorMessage` cleared; the WhatsApp message was actually received on the recipient phone ✅
- Live verification performed in the earlier session: two real sends returned SENT with real wamids (Phase 13 prerequisites confirmed) ✅
- Sender/error-handling tests pass: `backend/src/__tests__/whatsappSender.test.ts` (5 tests) and the Phase 12 suite in `backend/src/__tests__/processor.test.ts` (6 tests) ✅
- Full suite 123/123 pass; typecheck and build pass ✅
- **FR-045 (real send → real provider message ID persisted → attempt SENT → message received): validated** ✅
- **FR-046 (dynamic restaurant/display-token content in the message template): NOT validated** — the static test template did not demonstrate dynamic restaurant/display-token content.

### Phase 13 — Webhook Receiver: ✅ COMPLETE AND VERIFIED (uncommitted)

Implementation and tests exist (uncommitted). The Playbook's live verification step — "send a real test notification, let the real delivery/read webhook events arrive, and confirm the attempt's status updated correctly in the database" — has been satisfied by real Meta events (see live evidence below).

- `backend/src/webhook.ts`: `webhookRouter` mounted in `app.ts` **before** `express.json()` (fail-closed by design — no body parser can run before signature verification) ✅
- GET challenge-response handshake (`hub.mode`/`hub.verify_token`/`hub.challenge`) ✅
- POST signature verification via `X-Hub-Signature-256` (HMAC-SHA256, `timingSafeEqual`), rejecting before any parsing per NFR-009 ✅
- Correlation via real `providerMessageId` on `NotificationAttempt` — never any client-supplied tenant identifier ✅
- Status mapping: `sent` → acknowledged/no state change; `delivered` → `DELIVERED` (only from `SENT`); `read` → `READ` (only from `SENT`/`DELIVERED`); `failed` → logged/no state change; unknown → ignored ✅
- Idempotency: duplicate events no-op; out-of-order events never regress `jobStatus` backward ✅
- Unknown attempt, deactivated restaurant, disconnected connection, phone-number mismatch all safely ignored + logged (return 200) ✅
- `backend/src/__tests__/webhook.test.ts`: **22 tests pass** (re-run in the audit; full suite previously 123/123 across 3 runs, typecheck/build clean) — tests use the **real observed** payload structure (`entry[].changes[].value.statuses[]`, `statuses[].id` = providerMessageId, `metadata.phone_number_id`, WABA id 1436125048387918, recipient wa_id 919712238366), not a guessed one ✅
- Live evidence — handshake/subscription: Meta callback (`GET /webhook`) verification succeeded; QuickQueue app is subscribed to the correct WABA; real `POST /webhook` events received; real `X-Hub-Signature-256` validation succeeded ✅
- Live evidence — real `delivered` and `read` events (previously unrecorded): real Meta `message_status` events for prior live attempts `72836a8a-fc1a-4861-abb4-2181485dbcef` (attempt 2) and `626dca3b-6007-4f4e-9748-966ec833736c` (attempt 3) are confirmed in the database: both are `jobStatus = READ`, `deliveredAt = 2026-09-22T19:23:05Z`, `readAt = 2026-09-22T19:23:16Z`. The ngrok log shows the corresponding real webhook POSTs (`delivered` at ~00:53:05/06 +05:30, `read` at ~00:53:16/17 +05:30), all HTTP 200. Correlation was through `providerMessageId`; both correct attempts transitioned `SENT → DELIVERED → READ` with timestamps populated, and no unrelated attempt was modified. **This demonstrates the real delivered/read path end-to-end.**
- Distinction (latest attempt): the most recent disposable test attempt `abd5fc36-0eeb-46a8-bd25-9976457fae28` remained `SENT` during its ~28-minute observation window and received no subsequent webhook. That lack of a delivered/read event for that single attempt is not an implementation failure — earlier real attempts did subsequently produce actual `delivered` and `read` events whose DB transitions were observed. The live delivered/read path is demonstrated; the `sent` event for the latest attempt was correctly acknowledged (no state change, per design).
- Phase 12 (real WhatsApp sender) prerequisites all confirmed live during earlier session (two real sends SENT with real wamids).

### Phase 14 — STOP / Opt-Out: ✅ COMPLETE (uncommitted)

Implementation, tests, and webhook-path live verification (via the real captured Meta payload) are complete (uncommitted).

- `backend/src/webhook.ts`: processes inbound `value.messages[]` webhook events in addition to status events (FR-043/044 webhook surface) ✅
- Opt-out detection: only supported text inbound messages whose `text.body`, trimmed and case-insensitively, equals `STOP` (FR-048; lowercase/mixed-case/whitespace handled, non-text and non-STOP text ignored) ✅
- Restaurant resolution strictly from the provider-side `metadata.phone_number_id` via the existing `WhatsAppConnection` mapping (`findFirst({ where: { phoneNumberId } })`), never trusting any restaurant/order ID in the payload and never using the customer phone alone (NFR-009) ✅
- Phone normalization reuses the existing `normalizePhone` from `orders.ts` (single source of truth, no second implementation); the Meta inbound sender is E.164 without a leading `+`, so the raw sender is prefixed with `+` before the existing normalizer → `919712238366` → `+919712238366` ✅
- Safe-ignore paths (all logged, return 200): unknown/unmapped `phone_number_id`, deactivated restaurant, non-CONNECTED `WhatsAppConnection` (covers disconnected/inactive), unparseable sender ✅
- Idempotent creation via the `@@unique([restaurantId, phoneNormalized])` upsert — repeated STOP creates exactly one `NotificationOptOut`, scoped per restaurant (FR-049) ✅
- Signature-gated before any parsing: the Phase 13 `X-Hub-Signature-256` verification (raw body, `timingSafeEqual`, NFR-009) is untouched and applies to inbound messages too; invalid/missing signature → 403, malformed validly-signed JSON → 400 ✅
- `backend/src/__tests__/webhook.test.ts`: **15 new Phase 14 tests pass** (real captured payload structure), plus all existing 22 Phase 13 tests remain green (full suite now **138/138**) ✅
- Full suite 138/138 pass; typecheck passes; build passes; `git diff --check` clean ✅
- **FR-048/FR-049 (webhook STOP → NotificationOptOut, per-restaurant scope): validated** via automated tests AND live replay ✅
- **FR-028 (opt-out → READY creates no attempt; same phone at another restaurant not suppressed): validated** via the real order path (`createOrder` + `transitionOrderStatus`) in both automated tests and live fixture ✅
- **Live webhook capability caveat:** the Meta platform token expired 2026-09-22 (Graph 401/error 190) and the free-tier ngrok URL has since rotated, so the Meta webhook subscription can no longer be reached or re-registered this session. Fresh live delivery is therefore blocked. To keep validation real, the **exact previously captured Meta-signed STOP payload** (real body + real `X-Hub-Signature-256` header) was replayed against the running backend: HTTP 200 and a real `NotificationOptOut` row (`restaurantId=eb8171be…`, `phoneNormalized=+919712238366`) was created; a second identical replay remained idempotent (still exactly 1 row). The live fixture restaurant got a `WhatsAppConnection` row (`phone_number_id=1226137183925646`, CONNECTED) via the existing schema — the same setup the integration tests use — because that is the architecture's only provider-side mapping and no production endpoint creates connections yet (Phase 15). Live READY-after-opt-out and cross-restaurant freedom were then confirmed against that fixture (opt-out row kept as evidence; the temporary live connection row was removed afterward to keep the automated test suite hermetic). ✅

### Phase 15 — Embedded Signup: IN PROGRESS (steps 1–5 done; uncommitted)

Steps 1–5 of this phase are implemented and unit-tested (uncommitted). All Phase 15 steps are now implemented; remaining Phase 15 work is live validation against real Meta.

**Step 1 — NFR-004 AES-256-GCM crypto foundation** (crypto.ts + 15 tests, see previous section above for detail) ✅

**Step 2 — Embedded Signup connection endpoints** ✅

- `backend/src/connections.ts`: domain logic — `initiateEmbeddedSignup(restaurantId)` creates/upserts the restaurant's `WhatsAppConnection` to `PENDING` (no-op if already `CONNECTED`); `completeEmbeddedSignup(restaurantId, { wabaId, phoneNumberId, accessToken })` encrypts the token via `encryptToken()` from `crypto.ts` **before any DB write**, then upserts the connection to `CONNECTED` with `wabaId`, `phoneNumberId`, `accessTokenEncrypted`, `connectedAt` set/refreshed and `disconnectedAt` cleared ✅
- `backend/src/connectionsRouter.ts` + mounted in `app.ts` at `/connections` (behind `requireAuth`, session + origin validation):
  - `POST /connections/signup/initiate` → 200 `{ connectionStatus }`; creates PENDING row or returns existing status ✅
  - `POST /connections/signup/complete` → 200 `{ message, connectionStatus, wabaId, phoneNumberId, connectedAt }`; **never returns the token or the encrypted representation**; 400 on missing/malformed `wabaId`/`phoneNumberId`/`accessToken` ✅
- Restaurant is resolved **only from the authenticated session** (`requireAuth` → `req.session.restaurantId`); client-supplied `restaurantId`/`connectionId` are ignored ✅
- Plaintext access token is **never stored** — only `accessTokenEncrypted` (AES-256-GCM, IV + auth tag preserved); `TokenEncryptionError` → `ConnectionEncryptionError` → 500 "Token encryption is not configured", leaves the existing row untouched ✅
- Idempotent/repeated completion: upsert on the unique `restaurantId` keeps exactly one row per restaurant; no schema change (all needed fields already exist on `WhatsAppConnection`) ✅
- `backend/src/__tests__/connections.test.ts`: **13 tests** — initiate row creation + idempotency + 401/403 (missing Origin), complete stores+encrypts (round-trip verified), no plaintext in response/DB, repeated completion single-row, authenticated-scope isolation (client-supplied restaurantId ignored), completion without prior initiate, missing-field 400s, malformed-field 400s + no row stored, unauthenticated 401, missing-Origin 403, fail-closed 500 when encryption key absent ✅
- Results: connections suite 13/13; full backend suite **166/166**; typecheck passes; build passes; `git diff --check` clean ✅
- **Unresolved Meta contract (external validation dependency, SRS §22):** the exact Meta Embedded Signup flow — whether completion vends the system-user/access token to the client, its type/lifetime/required scopes, and the precise `onSuccess`/callback field contract — is NOT confirmed by any source in this repo (SRS §15/§22 mark it an External Validation Dependency). The endpoint contract (`wabaId`, `phoneNumberId`, `accessToken`) implements only what the Playbook/SRS docs require; the real onSuccess shape must be confirmed against Meta during live onboarding and any drift corrected then. Meta Tech Provider approval is still outstanding; Meta token expired 2026-09-22 → no live Embedded Signup validation possible this session.

**Step 3 — Per-restaurant WhatsApp sender (replaces the single env-based sender for production sends)** ✅

- `backend/src/processor.ts`:
  - `createRestaurantAwareWhatsAppSender()` — new `NotificationSender` factory. On `send()`, reads template identity from env via `getTemplateIdentityFromEnv()` (`WHATSAPP_TEMPLATE_NAME`/`WHATSAPP_TEMPLATE_LANGUAGE`/`WHATSAPP_API_VERSION`), resolves the restaurant's credentials via `resolveRestaurantWhatsAppCredentials(payload.restaurantId)`, then calls `sendWhatsAppTemplate` with the **connection's** `phoneNumberId` + **decrypted** access token (NOT the global `WHATSAPP_*` env token). Returns `{ providerMessageId }` as before ✅
  - `resolveRestaurantWhatsAppCredentials(restaurantId)` — looks up `WhatsAppConnection` by `restaurantId`; throws `WhatsAppSenderUnavailableError` with codes: `CONNECTION_NOT_FOUND`, `CONNECTION_DISCONNECTED`, `CONNECTION_NOT_CONNECTED` (any status other than `CONNECTED`), `MISSING_PHONE_NUMBER_ID`, `MISSING_ENCRYPTED_TOKEN`, `TOKEN_DECRYPTION_FAILED` (wraps `decryptToken()` from `crypto.ts`). Decrypted token is captured in a local variable only and never surfaces in errors/messages ✅
  - `classifySendError` — `WhatsAppSenderUnavailableError` → `{ kind: 'permanent' }` with the error code, so these paths fail the attempt permanently (`FAILED`, no retry) and the queue driver never re-processes them ✅
  - The legacy `createRealWhatsAppSender(config?)` env-based sender is **unchanged** (kept for existing Phase 12 tests); it is no longer wired into production runtime ✅
- `backend/src/server.ts`: now installs `setNotificationSender(createRestaurantAwareWhatsAppSender())` unconditionally ✅
- `backend/src/whatsappClient.ts`: added `WhatsAppTemplateIdentity` interface + `getTemplateIdentityFromEnv()` (template name/language/apiVersion from env; returns null if any missing) ✅
- `backend/src/__tests__/restaurantSender.test.ts`: **10 tests** — A uses A's own phone number ID + decrypted token (providerMessageId persisted), B uses B's credentials (assertion that A's credentials are NOT used → no cross-tenant leak), global `WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID` NOT used even when set to decoy values, no-connection → `CONNECTION_NOT_FOUND` FAILED retryCount 0, `DISCONNECTED` → `CONNECTION_DISCONNECTED`, not-yet-CONNECTED → `CONNECTION_NOT_CONNECTED`, missing encrypted token → `MISSING_ENCRYPTED_TOKEN`, undecryptable token → `TOKEN_DECRYPTION_FAILED` (asserts token/ciphertext never leaks into `errorMessage`/output), transient WhatsApp API 500 still retried via the new path (PENDING + `HTTP_500`), and `classifySendError` returns permanent for these errors ✅
- No WhatsAppConnection schema change needed (all fields already exist); Embedded Signup endpoints, webhook, and display-name registration untouched ✅
- Results: restaurantSender suite 10/10; whatsappSender + processor suites 51/51; full backend suite **176/176**; typecheck passes; build passes; `git diff --check` clean ✅

**Step 4 — WhatsApp display-name registration** ✅

- `backend/src/whatsappClient.ts` — Meta boundary for display-name registration:
  - `DisplayNameSubmissionInput` (`apiVersion`, `wabaId`, `phoneNumberId`, `accessToken`, `requestedDisplayName`), `DisplayNameSubmissionResult` (`APPROVED { approvedDisplayName }` | `REJECTED { rejectedDisplayName }`), `DisplayNameRegistrationUnavailableError` ✅
  - `submitWhatsAppDisplayName(input)` — the ONE place that will perform the real Meta Graph API registration call. Because the **exact endpoint, request body, response fields, and approval semantics are an unvalidated External Validation Dependency (SRS §22)** and no source in this repo documents them, the production implementation deliberately **does not fabricate a call**: it rejects with `DisplayNameRegistrationUnavailableError` (no token/identifiers ever enter an error surface). This guarantees a display name is **never marked approved without real Meta confirmation** ✅
- `backend/src/connections.ts` — display-name registration flow orchestration (`initiateEmbeddedSignup` / `completeEmbeddedSignup` untouched):
  - `buildRequestedWhatsAppDisplayName(restaurantName)` → exact `"<Restaurant Name> via QuickQueue"` (whitespace-trimmed; throws on empty) ✅
  - `registerWhatsAppDisplayName(restaurantId)` → loads the restaurant + its own `WhatsAppConnection`, reuses Phase 15 Step 3's `resolveRestaurantWhatsAppCredentials()` for the per-restaurant guard + credential unlock (CONNECTION_NOT_FOUND / DISCONNECTED / NOT_CONNECTED / missing phone / missing encrypted token / decryption failures fail safely, no cross-tenant fallback), requires `WHATSAPP_API_VERSION` from env and a connection `wabaId`, then submits `<Name> via QuickQueue` using the connection's own WABA/phone/token; on `APPROVED` persists to `approvedDisplayName` (records **Meta-confirmed** name), on `REJECTED` **falls back** to the plain restaurant name (second submission) and persists it only on `APPROVED`; both rejected → `NO_APPROVAL`, nothing persisted ✅
  - Idempotent: a row already holding `approvedDisplayName` returns `ALREADY_APPROVED` without re-submitting ✅
  - Outcomes never include the token; errors never leak it (NFR-013) ✅
- Integration note: the Playbook says "attempt during signup"; the completion endpoint is **not** changed (a failing/unvalidated registration must not break the signup-completion contract or its existing Step 2 tests). `registerWhatsAppDisplayName` is exposed as a domain function and is wired into the completion flow once the real Meta contract is confirmed. Embedded Signup endpoints, webhook, sender behavior, and crypto are untouched ✅
- `backend/src/__tests__/displayName.test.ts` — **11 tests** with the Meta boundary MOCKED (clear mocked-vs-real distinction): exact combined-name construction + trimming + empty throws; approved combined name persisted using the restaurant's own WABA/phone/decrypted token; `REJECTED` combined → plain-name fallback persisted; both rejected → `NO_APPROVAL` + nothing persisted + no token in outcome; boundary `DisplayNameRegistrationUnavailableError` → rejects, row stays null; tenant isolation (A registered with only A's credentials, never B's); global `WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID` decoys never used; idempotent `ALREADY_APPROVED` with zero boundary calls; no-connection → `CONNECTION_NOT_FOUND`; missing WABA ID → domain error, nothing persisted; not-found restaurant + no token leakage ✅
- `backend/src/__tests__/displayNameBoundary.test.ts` — **2 tests** against the REAL production boundary: `submitWhatsAppDisplayName` rejects with `DisplayNameRegistrationUnavailableError`, makes **no HTTP call** (fetch spy), and its error surface never embeds input credentials/identifiers ✅
- No WhatsAppConnection schema change (all needed fields already exist); no migration, no endpoints added ✅
- Results: display-name suites 13/13; connections/restaurantSender/whatsappSender suites still pass; full backend suite **189/189**; typecheck passes; build passes; `git diff --check` clean ✅
- **Exact Meta behavior that remains externally unvalidated (SRS §22):** the display-name registration endpoint, its request body (field names/shape), its success/rejection response fields, how a display-name submission transitions to a formal "approved" state, and what the "combined vs plain name" outcomes actually return — none are documented in this repo, so the production boundary intentionally performs **no** registration call until confirmed against a real Embedded Signup submission. Live validation remains blocked (Meta token expired 2026-09-22; Tech Provider approval outstanding).

**Step 5 — Template provisioning outcome (FR-045)** ✅

FR-045 requirements interpreted: (a) V1 uses exactly **one** QuickQueue-authored template — already enforced by the existing env conventions (`WHATSAPP_TEMPLATE_NAME`/`WHATSAPP_TEMPLATE_LANGUAGE`/`WHATSAPP_API_VERSION`), no template UI / custom templates / multi-template management; (b) the template's identifier shall be **recorded on every notification attempt** so history stays interpretable if the template is revised — implemented; (c) whether template creation/approval can be **automated programmatically** per restaurant WABA is an **External Validation Dependency (SRS §22)** — isolated behind an unvalidated boundary, never claimed.

- `backend/src/whatsappClient.ts`:
  - `getTemplateIdentifierFromEnv()` → `"<templateName>|<templateLanguage>|<apiVersion>"` from the existing env conventions (null when any part missing); `getTemplateIdentityFromEnv()` unchanged ✅
  - `TemplateProvisioningInput` (`apiVersion`, `wabaId`, `accessToken`, `templateName`, `templateLanguage`), `TemplateProvisioningResult` (`PROVISIONED` | `NOT_PROVISIONED`), `TemplateProvisioningUnavailableError` ✅
  - `submitWhatsAppTemplateProvisioning(input)` — the single Meta boundary for template creation/approval. Exact endpoint/request/response/approval semantics are **not** established anywhere in the repo (SRS §22), so the production implementation deliberately **does not fabricate a call**: rejects with `TemplateProvisioningUnavailableError`; tokens/identifiers never enter an error surface; nothing is claimed provisioned without real Meta confirmation ✅
- `backend/src/connections.ts`: `provisionRestaurantWhatsAppTemplate(restaurantId)` — orchestrates per-restaurant provisioning: loads the connection, requires a `wabaId`, requires the env-configured template identity, validates/unlocks credentials via `resolveRestaurantWhatsAppCredentials()` (tenant-scoped, no cross-tenant fallback; CONNECTION_NOT_FOUND / DISCONNECTED / NOT_CONNECTED / missing phone / missing encrypted token / `TOKEN_DECRYPTION_FAILED` fail safely), then submits with the **restaurant's own** WABA + decrypted token + the configured template name/language. Idempotent (no state persisted, repeated calls duplicate nothing). No schema change (the one field FR-045 needs, `templateIdentifierSnapshot`, already exists) ✅
- FR-045 snapshot recording (schema field already present; now written at **every** client-visible attempt creation): `orders.ts` READY transition and `processor.ts` `recallOrder` both set `templateIdentifierSnapshot: getTemplateIdentifierFromEnv()`; when the template env config is absent an attempt is still created with a null snapshot (order transitions never fail on template config) ✅
- `backend/src/__tests__/templateProvisioning.test.ts` — **10 tests** with the provisioning boundary MOCKED: env-derived template identifier construction (incl. null when config missing); provisioning uses the restaurant's own WABA/decrypted token + env template identity; tenant isolation (A provisioned only with A's credentials); global `WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID` decoys never used; boundary `NOT_PROVISIONED` → outcome says so, no false claim, no token in outcome; boundary unavailable → rejects, nothing claimed; repeated/idempotent calls → two `PROVISIONED` results, exactly one connection row, no duplication; no connection → `CONNECTION_NOT_FOUND`; undecryptable token → `TOKEN_DECRYPTION_FAILED` without leaking the stored value; missing WABA ID → domain error, boundary not called ✅
- `backend/src/__tests__/templateProvisioningBoundary.test.ts` — **2 tests** on the REAL production boundary: rejects with `TemplateProvisioningUnavailableError`, makes **no HTTP call** (fetch spy), error surface never embeds tokens/identifiers ✅
- `backend/src/__tests__/templateSnapshot.test.ts` — **3 tests** through the real order/recall flows: READY-created attempt records the configured `templateIdentifierSnapshot`; RECALL-created attempt records it too; missing template env → null snapshot (transition still succeeds) ✅
- Existing sender behavior untouched and preserved (`getTemplateIdentityFromEnv()` + per-restaurant sender unchanged; restaurantSender/whatsappSender/processor suites still green). Crypto, STOP/webhook, Embedded Signup endpoints, and display-name registration untouched; no Prisma schema change, no migration ✅
- **Mocked vs actually validated:** the provisioning call, approval/rejection semantics, rejection→retry/failure mapping, and per-WABA template-creation API are **unit-tested orchestration only** — the Meta boundary is mocked and the real production boundary intentionally performs no call. **No live Meta validation of FR-045** was or can be performed this session (Meta token expired 2026-09-22; Tech Provider approval outstanding) and none is claimed.
- Results: template suites 15/15; connections/display-name/restaurantSender/whatsappSender/orders/processor suites all pass; full backend suite **204/204**; typecheck passes; build passes; `git diff --check` clean ✅
- **Remaining Phase 15 work:** only live validation against a real Embedded Signup restaurant — Embedded Signup behavior, template provisioning outcome (FR-045), and sender display-name outcome (FR-037/FR-044/FR-047) remain External Validation Dependencies (SRS §22).
- **External Meta dependency/blocker:** Meta Tech Provider approval not obtained; Meta token expired 2026-09-22 → no live WABA/Embedded Signup calls possible; second real restaurant not available.

**Phase 15 closure review (final validation)** ✅

- Re-read frozen `SRS.md` (§9.10 FR-043–047, §15 WhatsApp architecture, §22 external dependencies), the authoritative Build Playbook (Phase 15 → "Verify and commit"; Playbook Phase 15 defines the Embedded Signup flow, credential encryption, per-restaurant sender, and display-name attempt — all implemented), `docs/PROGRESS.md`, and confirmed from the actual repository (not prior reports): Steps 1–5 code + tests; `templateIdentifierSnapshot` written on both READY-created (`orders.ts`) and RECALL-created (`processor.ts`) attempts; FR-045 provisioning isolated behind `submitWhatsAppTemplateProvisioning`, display-name behind `submitWhatsAppDisplayName` — both intentionally reject without a fabricated Meta call; tenant isolation via `resolveRestaurantWhatsAppCredentials`; tokens/encrypted tokens absent from API responses (`connectionsRouter`) and error/log surfaces; **no Prisma schema/migration change anywhere in the diff**; Phase 12–14 sender/webhook/opt-out behavior intact ✅
- Verification run: Phase 15 suites green (crypto 15, connections 13, restaurantSender 10, display-name+boundary 13, template-provisioning+boundary 15, templateSnapshot 3); full backend suite **204/204**; typecheck passes; build passes; `git diff --check` clean ✅ (one transient `connections.test.ts` `beforeAll` hook timeout under 10-parallel-worker DB contention during the first run — passed on isolation re-run and in the full suite; no code/test changes made for it)
- **Live validations confirmed: none performed this session.** Embedded Signup, per-WABA template provisioning/approval (FR-045), and sender display-name outcome remain **externally blocked/unvalidated** (SRS §22) — Meta token expired 2026-09-22, Meta Tech Provider approval outstanding, no second real restaurant/WABA available, and the concrete Embedded Signup/template-provisioning/display-name Meta contracts are not documented in the repository (boundaries deliberately perform no call until confirmed).
- Implemented and locally verified: Steps 1–5 (crypto foundations, signup endpoints, per-restaurant sender, display-name + fallback orchestration, FR-045 snapshots + provisioning orchestration) — all via deterministic unit/integration tests against the Docker PostgreSQL, with the two Meta boundaries mocked.
- Status per Playbook: Phase 15 implementation is complete and verified; the Playbook's ending step is "**Verify and commit**" — commit remains a human decision (nothing staged/committed/pushed in this session). Phase 15 is committed as `1940060`; **Phase 16 — Restaurant Deactivation** (FR-052/FR-053) is now in progress.

### Phase 16 — Restaurant Deactivation: IN PROGRESS (implementation + Playbook verification complete; uncommitted)

Implemented per frozen SRS §9.12 (FR-052/FR-053) and Playbook Phase 16 ("implement it exactly as written, not an approximation"). No schema change — `Restaurant.status` / `deactivatedAt` have existed since the initial schema migration.

**Step 1 — Blocking guards (FR-052)** ✅

- `auth.ts` `/login`: a correct-password login for a `DEACTIVATED` restaurant is rejected `401 { error: 'Account is deactivated' }`, no session set. `requireAuth` unchanged; existing sessions and authenticated reads are not blocked.
- `orders.ts` `createOrder`: rejects `DEACTIVATED` restaurants before any validation/create (409).
- `orders.ts` `transitionOrderStatus`: rejects only the `READY` target, checked inside the transaction (also blocks idempotent re-READY); `COLLECTED`/`CANCELLED` remain allowed (FR-052 does not require blocking them).
- `processor.ts` `recallOrder`: rejects `DEACTIVATED` inside the transaction; no new RECALL attempt is created.
- `processor.ts` `processAttempt` retry path: re-checks the restaurant's status (fresh read) before scheduling an automatic retry; a transient failure on a now-deactivated restaurant finalizes the attempt as `FAILED` (existing persistence semantics, `retryCount` unchanged, no `PENDING`/`nextRetryAt`) — FR-053 bullet 3.
- Error contract: one new `RestaurantDeactivatedError` mapped to `409 { error }` in `ordersRouter.ts`, reusing the repo's established conflict pattern (`TransitionError`/`RecallError`); login reuses the established 401 auth-failure pattern. No new HTTP status/API contract introduced.

**Step 2 — Focused guard tests** ✅: 7 added (auth 1, orders 4, processor 2).

**Step 3 — Playbook verification tests (FR-053)** ✅

- **Deactivated WHILE genuinely PROCESSING:** the test drives a real claim → `PROCESSING` → in-flight send; while the attempt is genuinely `PROCESSING` (confirmed by a row read inside the send hook) the restaurant is deactivated by the in-flight sender; the SAME attempt then completes normally → `SENT` with its `providerMessageId` recorded; the restaurant is left `DEACTIVATED`; exactly 1 attempt row — the in-flight attempt was neither cancelled/suppressed nor duplicated. ✅
- **Recovery respects deactivation:** a stuck attempt (`PROCESSING`, stale `claimedAt`) is recovered to `PENDING` via `recoverStuckJobs()` while its restaurant is `DEACTIVATED`; the subsequent `claimAndProcessOne()` does NOT claim it (stays `PENDING`, `claimedAt` null); exactly 1 attempt row — no re-send, no duplicate, no new attempt. ✅
- Existing required scenarios preserved/verified: DEACTIVATED login/create/READY/RECALL blocked; PENDING-attempt-never-claimed (Phase 9 test); no automatic retry created after deactivation; COLLECTED/CANCELLED allowed where SRS permits.

**Results:** full backend suite **213/213** (13 files); typecheck passes; build passes; `git diff --check` clean; **no Prisma schema/migration file changed**; nothing staged. Processor suite green both in isolation (40/40) and within the full run (no cross-file DB-concurrency flake this time).
**External limitation / uncertainty:** no live/production validation performed (no deployment exists); deactivation is pure application/DB logic and is fully covered by local integration tests. No deactivation/activation endpoint exists — SRS and Playbook define none (Phase 16 implements enforcement only; tests set `status` directly via Prisma).
**Status per Playbook:** implementation and verification complete; the Playbook's ending step is "**Verify and commit**" — commit remains a human decision. Next Playbook phase: **Phase 17 — Frontend: Core Application**.

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
| Phase 11 — Retention / Phone Scrubbing | ✅ Complete | terminalAt-based cleanup, configurable retention, idempotent, 5 tests |
| Phase 12 — Real WhatsApp Integration | ✅ Complete & verified | Real sender live-tested; real providerMessageId persisted; attempt SENT; message received; FR-045 validated, FR-046 not (static template) |
| Phase 11 — Retention / Phone Scrubbing | ⬜ Not started | |
| Phase 13 — Webhook Receiver | ✅ Complete & verified | 22 tests pass; real signature/sent + real delivered/read events confirmed (attempts 72836a8a/626dca3b → READ); latest disposable attempt stayed SENT |
| Phase 14 — STOP / Opt-Out | ✅ Complete | 15 new webhook tests + existing 22 intact (138/138); real captured STOP replay → opt-out created + READY suppressed; FR-048/049/028 validated live; live Meta delivery blocked (expired token/rotated ngrok URL) |
| Phase 15 — Embedded Signup | ✅ Complete | Multi-tenant onboarding, per-restaurant credentials, AES-256-GCM encryption, WABA display-name registration & template provisioning orchestration verified. Committed as `1940060`. Live validation subject to external Meta approvals (§22). |
| Phase 16 — Restaurant Deactivation | ✅ Complete | FR-052/FR-053 implemented + Playbook-verified (213/213, typecheck/build/diff-check clean, no schema change): login/create/READY/RECALL blocked for DEACTIVATED (established 401/409 patterns), no automatic retry created after deactivation, genuine PROCESSING attempt finishes to SENT even if deactivated mid-send, recovered stuck attempt never re-claimed after deactivation; COLLECTED/CANCELLED remain allowed. Committed as `cb90284` (8 files). |
| Phase 17 — Frontend Core | ✅ Complete | Core UI on React/TS/Vite with @tanstack/react-query, typed API client, auth flow, order creation, active queue polling, WhatsApp panel, and correction pass completed. Committed as `4d581c0` (28 files). |
| Phase 18 — Frontend Visual Review | ✅ Complete | Visual and ergonomic UX refinement completed: duplicate-token badges and creation/waiting time clarity, prominent display token hierarchy, distinct action states, exact FR-039 status mapping, active-order summary metrics, compact WhatsApp connection panel, transient creation & terminal action feedback, and accessibility enhancements. Verified across viewports. Committed as `1cf7635` (6 files). |
| Phase 19 — Documentation | ✅ Complete | Created comprehensive technical guides (`docs/ARCHITECTURE.md`, `docs/ENVIRONMENT_VARIABLES.md`, `docs/NOTIFICATION_ENGINE.md`, `docs/WHATSAPP_INTEGRATION.md`, `docs/KNOWN_LIMITATIONS.md`, `docs/TROUBLESHOOTING.md`); updated fresh-clone setup guide (`docs/development.md`) and high-level project summary (`README.md`). All documentation reflects real architecture, port 5433 mapping, AES-256-GCM encryption, actual Meta payload schemas, and external dependencies. Committed as `29234d2` (8 files). |
| Phase 20 — Test Suite Audit | ✅ Complete | Complete SRS Section 19 gap audit and test suite consolidation executed. Added 21 missing tests across 4 test suites: full cross-tenant transition isolation (COLLECTED, CANCELLED, RECALL, guessed/adjacent IDs), body restaurantId spoofing immunity, concurrent duplicate READY idempotency (AC-011), terminalAt immutability, RECALL rejection in COLLECTED and CANCELLED statuses, health check 503 failure mode on DB unreachable, Prisma migration expand-contract discipline, and environment configuration completeness. Full automated suite now 245/245 passing across 14 test files (up from 224 across 13 files). Workspace builds & typechecks clean. Uncommitted pending human review. |
| Phase 21 — Deployment (Render) | ⬜ Not started | |
| Phase 22 — Deployment (Vercel) | ⬜ Not started | |

---

## Phase 20 — Test Suite Consolidation and Gap Audit Summary

### Audit Methodology
Every requirement in **SRS Section 19 (Testing Requirements)** was audited against existing automated tests across the backend and frontend codebases. Identified gaps were resolved by adding explicit automated tests without deleting or weakening existing tests, changing product behavior, or modifying frozen requirements.

### Section 19 Coverage Audit Matrix

| Section 19 Area | SRS Requirements | Pre-Phase 20 State | Phase 20 Work & Verification |
|---|---|---|---|
| **1. Authentication** | Login success/failure; password reset request/confirm/expired/reused/superseded token; session invalidation on password change; deactivated restaurant blocked from login | Covered in `auth.test.ts` (26 tests) | Verified intact; added health check failure test (now 27 tests). |
| **2. Tenant Isolation** | Guessed/adjacent order IDs, notification attempt IDs, restaurant IDs across all endpoints; cross-tenant WhatsApp connection access | Partially covered: `orders.test.ts` tested GET `/orders` and READY transition | **Added:** cross-tenant transition tests for `COLLECTED` (404), `CANCELLED` (404), and `RECALL` (409); guessed/adjacent UUID tests across all transition endpoints; test confirming client-supplied `restaurantId` in `POST /orders` is ignored and strictly scoped to authenticated session. |
| **3. Order Lifecycle** | Valid/invalid transitions per FR-021; concurrent conflicting transitions under row locking (FR-022); duplicate READY (FR-023); cancellation after READY | Covered in `orders.test.ts` | Verified intact (15 lifecycle & concurrency tests). |
| **4. Consent** | `true` and `false` paths; `consentMethod` null-exactly-when-false invariant; suppression when consent false or opt-out active; no code path omits explicit consent value | Covered in `orders.test.ts` | Verified intact (6 consent tests). |
| **5. Notification Engine** | READY creates 1 attempt; concurrent READY requests do not create duplicate attempts; processor claiming under `FOR UPDATE SKIP LOCKED`; stuck recovery; retry classification (transient vs permanent) & exhaustion; RECALL rules (while PENDING/PROCESSING, max count, non-READY statuses); concurrent RECALL | Partially covered: duplicate READY was only tested sequentially; RECALL non-READY status only tested PREPARING | **Added:** concurrent simultaneous READY requests (`Promise.all([ready, ready])`) verifying exactly 1 attempt is created (AC-011); RECALL ineligibility tests for `COLLECTED` and `CANCELLED` statuses in `processor.test.ts`. |
| **6. Webhooks** | Valid/invalid signature handling; duplicate events; out-of-order delivery not regressing state; uncorrelatable/disconnected restaurant events safely ignored | Covered in `webhook.test.ts` (37 tests) | Verified intact (signature algorithm/tamper/missing secret, replay, out-of-order DELIVERED after READ, disconnected/deactivated ignore). |
| **7. Opt-Out** | Inbound STOP creates suppression; subsequent READY suppressed; same phone at different restaurant unaffected | Covered in `webhook.test.ts` (15 Phase 14 tests) | Verified intact (scoped opt-out, replay idempotency, cross-tenant independence). |
| **8. Retention** | `terminalAt` set correctly and immutably; phone scrubbing occurs past window; notification history intact post-scrub; cleanup process idempotent under repeated runs | Partially covered: immutability of `terminalAt` on terminal transitions not explicitly asserted; scrubbing test baseline sensitive to residual database entries | **Added:** `terminalAt` immutability tests for `COLLECTED` and `CANCELLED` (subsequent transition requests rejected, timestamp immutable); stabilized scrubbing test with baseline cleanup. |
| **9. WhatsApp Integration** | Pipeline validated against developer/test environment; Embedded Signup, template provisioning, and sender display name orchestration | Covered with mocks and recorded live validation evidence in `docs/WHATSAPP_INTEGRATION.md` | Verified intact across `displayName.test.ts`, `templateProvisioning.test.ts`, `connections.test.ts`, `restaurantSender.test.ts`. |
| **10. Deployment** | Migration apply/rollback under expand-contract discipline; health check behavior (200 & 503); environment configuration completeness | Partially covered: only 200 health check tested; migration expand-contract and env completeness not verified in automated tests | **Added:** new `deployment.test.ts` (10 tests) verifying migration ordering/lock, absence of destructive drops, non-breaking column additions, database constraints, environment variable inventory completeness, and fail-closed security behaviors. Added 503 unreachable DB test in `auth.test.ts`. |

### Test Suite Execution Summary
- **Backend automated tests:** 245 passed across 14 test suites (up from 224 across 13 suites, +21 tests).
- **Backend typecheck:** clean (`tsc -p tsconfig.json --noEmit`, 0 errors).
- **Backend build:** clean (`tsc -p tsconfig.json`, 0 errors).
- **Frontend typecheck:** clean (`tsc -b --pretty false`, 0 errors).
- **Frontend build:** clean (`tsc -b && vite build`, production bundle generated).
- **Git diff whitespace:** clean (`git diff --check`, 0 errors).

---

## Next Step

**Phase 20 — Test Suite Consolidation and Gap Audit** is complete and fully verified. All audited gaps against SRS Section 19 have been implemented as automated tests and pass cleanly. Working tree contains modified test files (`orders.test.ts`, `processor.test.ts`), new test file (`deployment.test.ts`), and updated `docs/PROGRESS.md`. Per the Standard Phase Protocol, committing is a human decision. Next step: human review and commit decision for Phase 20, then proceed to Phase 21 (Backend Deployment on Render).
