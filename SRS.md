# Software Requirements Specification (SRS)
## QuickQueue — Restaurant/Food-Court Order-Ready Notification System

**Version:** 1.0 FINAL — FROZEN FOR IMPLEMENTATION
**Status:** This document is the single source of truth for QuickQueue V1 implementation. All product, architecture, database, security, and process decisions reached during review are incorporated. No further re-derivation of these decisions should occur during implementation; if a genuine contradiction is discovered, it must be resolved by amending this document, not by silent deviation in code.

---

## 1. Introduction

QuickQueue is a SaaS product that notifies customers via WhatsApp when their restaurant or food-court order is ready for pickup. This document specifies the complete, implementation-ready requirements for QuickQueue V1.

## 2. Purpose

To eliminate the need for restaurant staff to repeatedly call out order/token numbers, and to prevent customers from missing their order because they could not hear an announcement or see a token display, by letting staff mark an order READY once and having the platform handle customer notification automatically and reliably.

## 3. Scope

QuickQueue V1 is a **notification and status layer**, not a restaurant management system. It does not take orders, manage menus, process payments, track food preparation detail, manage inventory, or handle delivery. It operates on the minimum data required to notify a customer: a restaurant-supplied reference/token, a phone number, and consent. It integrates with no POS, KDS, or third-party restaurant software in V1.

## 4. Problem Statement

In busy self-service restaurants and food courts, staff must repeatedly call out order/token numbers; customers seated far away may not hear or see this; missed notifications cause customers to interrupt staff to ask if their order is ready. QuickQueue replaces repeated verbal announcement with a single staff action (marking READY) followed by an automated WhatsApp notification.

## 5. Product Overview

QuickQueue is a responsive, mobile-first web application for restaurant staff, paired with a backend notification service. A restaurant creates a lightweight order record (existing token/reference + customer phone number + consent). When marked READY, QuickQueue sends a WhatsApp notification identifying the restaurant and order reference. The restaurant sees the real delivery status and may manually RECALL (resend) if needed. The customer requires no app, account, login, QR code, or website interaction of any kind.

## 6. Goals and Objectives

- **G1:** Eliminate repeated verbal token announcements.
- **G2:** Notify customers reliably, with honest, provider-accurate visibility into delivery status.
- **G3:** Zero new customer-side friction — no app, account, or web interaction.
- **G4:** Minimal restaurant-side friction — no new data collection beyond what staff already gather; no employee/device management overhead.
- **G5:** Sound multi-tenant architecture that protects data isolation as the product scales to many independent restaurants.
- **G6:** A V1 that is small, fast, reliable, understandable, and commercially deployable — not an over-engineered platform built ahead of proven need.

## 7. Stakeholders and Users

| Stakeholder | Role |
|---|---|
| Restaurant / stall staff | Primary user; creates orders, marks READY/COLLECTED/CANCELLED, monitors notification status, triggers RECALL |
| Customer | Passive recipient; gives phone number and verbal consent during normal ordering; receives a WhatsApp message; never interacts with QuickQueue software |
| QuickQueue platform operator | Owns the SaaS; manages the Meta Tech Provider relationship; onboards restaurants |
| Meta / WhatsApp Business Platform | Third-party infrastructure provider for message delivery |

## 8. Assumptions and Constraints

- **A1:** Restaurants already collect customer phone numbers during normal ordering; this is not new friction.
- **A2:** Restaurants already have their own order/token reference scheme, which QuickQueue treats as an opaque display string.
- **A3:** Each restaurant must independently connect its own WhatsApp Business Account via Embedded Signup; QuickQueue cannot message on a restaurant's behalf without this connection.
- **A4:** WhatsApp delivery/read status is best-effort; "Read" is never proof the customer consciously noticed the message (recipients may disable read receipts).
- **A5:** V1 targets the Indian market initially but the phone-number and architecture design remain internationally valid (E.164 storage; no country-specific data model).
- **C1 (Constraint):** WhatsApp sender identity and display-name rules are controlled by Meta. QuickQueue does not assume a single sender identity can represent multiple independent restaurants (see Section 22, External Validation Dependencies).
- **C2 (Constraint):** V1 runs a single backend instance in production. The notification-processing design is forward-compatible with multiple instances without architectural change, but horizontal scaling is not built in V1.
- **C3 (Constraint):** V1 integrates with no POS, KDS, or third-party restaurant software.
- **C4 (Constraint):** V1 is English-only; no localization infrastructure is built, though nothing in the architecture precludes adding it later.

## 9. Functional Requirements

### 9.1 Restaurant Account & Authentication

- **FR-001:** The system shall support exactly one business account per restaurant/stall (tenant). No employee accounts, staff roles, or per-employee authentication shall be implemented.
- **FR-002:** A restaurant account shall authenticate via email and password. Passwords shall be hashed using a standard password-hashing algorithm (e.g., bcrypt or argon2); plaintext passwords shall never be stored.
- **FR-003:** Upon successful authentication, the system shall issue a secure, HTTP-only session cookie. Authentication state shall never be stored in client-side-script-accessible storage (e.g., `localStorage`).
- **FR-004:** The session cookie shall encode information sufficient to identify the restaurant and the `sessionVersion` value in effect at issuance. Every authenticated request shall validate that this value matches the restaurant's current `sessionVersion`; a mismatch shall invalidate the session.
- **FR-005:** The same restaurant account credentials may be used concurrently on multiple devices. No device registration, device listing, or device revocation UI shall be implemented in V1.
- **FR-006:** Restaurant account email addresses shall be globally unique. A deactivated restaurant's email shall remain reserved and unavailable for new registration while the historical account record exists.
- **FR-007:** The system shall provide a password-reset flow: a restaurant requests a reset by email; the system generates a cryptographically random reset token, stores only its hash (never the plaintext token) along with an expiry, and emails a reset link. The token shall be single-use. If multiple reset requests are made, only the most recently issued token shall remain valid; issuing a new token invalidates any prior unused token for that account. A successful reset clears the stored token hash/expiry and increments `sessionVersion`, invalidating all previously issued sessions.
- **FR-008:** The system shall rate-limit login attempts and password-reset requests per account/IP to mitigate brute-force and abuse.
- **FR-009:** State-changing requests (see Section 24 for the full endpoint list) shall be rejected unless the request's `Origin` header matches a configured allowlist of trusted frontend origins, mitigating CSRF given the frontend and backend are deployed on separate origins.

### 9.2 Order Creation

- **FR-010:** The system shall allow a restaurant to create an order record consisting of: a required restaurant-supplied display token/reference, a required customer phone number, and a WhatsApp consent flag. The display token is required because both the staff pickup workflow and the customer-facing WhatsApp notification depend on a reference the customer recognizes; an order with no token gives staff no natural way to identify it at collection and leaves the notification unable to identify the order.
- **FR-011:** The restaurant-supplied display token shall not be required to be unique; the same value may be reused by the same restaurant at different times. Orders are always distinguished internally by a system-generated unique Order ID (UUID), never by the display token.
- **FR-012:** The customer phone number shall be normalized to E.164 format at the API boundary using a standard phone-number parsing library (not hand-written regex). Numbers that cannot be parsed as valid shall be rejected at order-creation time with a clear error. Exactly one canonical representation shall be stored per order; no duplicate representations of the same number shall be persisted.
- **FR-013:** The system shall permit the same phone number to appear on multiple, fully independent order records, and shall never merge, link, or deduplicate orders on the basis of shared phone number. No persistent Customer entity shall exist; phone number is order-level data only.
- **FR-014:** The system shall present a WhatsApp consent checkbox, defaulted to checked, at order-creation time, representing that staff have verbally confirmed the customer's agreement to receive a WhatsApp notification. Staff may uncheck this box if the customer declines.
- **FR-015:** The application shall require an explicit `true`/`false` value for consent on every order-creation request; the database shall enforce no default value for this field, so that no code path can silently create an order with implied consent.
- **FR-016:** When consent is `true`, the system shall record `consentMethod = VERBAL_STAFF_CONFIRMED`. When consent is `false`, `consentMethod` shall be `NULL` (no consent method exists to record when consent was not obtained). `consentCapturedAt` shall record the timestamp of order creation regardless of the consent value.
- **FR-017:** If consent is `false`, the order shall still be created and shall proceed through the normal order lifecycle, but no WhatsApp notification attempt shall ever be created for it. The restaurant interface shall visibly flag such an order (e.g., "No WhatsApp consent — notify manually") so staff know to handle notification themselves.
- **FR-018:** The system shall not collect, require, or store any food-item, pricing, tax, or payment information as part of order creation.
- **FR-019:** Before creating any notification attempt for an order (including on the initial READY transition), the system shall check the `NotificationOptOut` suppression record for that `(restaurantId, normalizedPhone)` pair (see Section 13). If a suppression record exists, no notification attempt shall be created, regardless of the order's own consent flag, and the restaurant interface shall display a clear "customer previously opted out — notify manually" state.

### 9.3 Order Lifecycle

- **FR-020:** Every order shall have a status of exactly one of: `PREPARING`, `READY`, `COLLECTED`, `CANCELLED`. A newly created order defaults to `PREPARING`.
- **FR-021:** The system shall permit only these status transitions: `PREPARING → READY`, `PREPARING → CANCELLED`, `READY → COLLECTED`, `READY → CANCELLED`. All other transitions (including `COLLECTED → READY`, `CANCELLED → READY`, `CANCELLED → COLLECTED`, and any transition out of `COLLECTED`) shall be rejected server-side, regardless of what the client requests. `COLLECTED` and `CANCELLED` are terminal.
- **FR-021a:** On every transition into a terminal state, the order's `terminalAt` field shall be set to the timestamp of that transition, in the same transaction as the status change. `terminalAt` shall remain `NULL` for as long as an order is `PREPARING` or `READY`. Because `COLLECTED` and `CANCELLED` are terminal (no further transition is permitted, FR-021), `terminalAt`, once set, shall never be modified again. `terminalAt` is the **single, exclusive retention clock** used by the phone-scrubbing cleanup process (NFR-002); `collectedAt` and `cancelledAt` are informational lifecycle timestamps recording which terminal state was reached and when, and are never independently consulted for retention purposes.
- **FR-022:** Every order status transition shall be performed inside a database transaction that first acquires a row lock (`SELECT ... FOR UPDATE`) on the target order, so that two concurrent requests (from different devices, tabs, or near-simultaneous clicks) attempting conflicting transitions on the same order resolve deterministically: the first to acquire the lock succeeds or fails according to the current state; the second re-reads the now-current state and is accepted or rejected accordingly. No transition decision shall be made from a client-cached or optimistic view of order state.
- **FR-023:** A repeated request to transition an order to `READY` when it is already `READY` shall be idempotent: it shall return the current state successfully without creating a duplicate notification attempt, rather than erroring or creating a second attempt.
- **FR-024:** Cancelling an order already marked `READY` (and potentially already notified) shall be permitted. No automatic cancellation notification shall be sent to the customer in V1; the order's internal status reflects `CANCELLED`, and staff handle any already-arrived customer verbally, consistent with existing practice.
- **FR-025:** The system shall allow a restaurant to search its own orders by display token and/or customer phone number. Token matching shall treat the token as an opaque string: matching shall be exact but shall tolerate leading/trailing whitespace normalization; matching shall not assume numeric tokens.
- **FR-026:** The active-orders view shall, by default, display orders with status `PREPARING` or `READY` for the authenticated restaurant only, ordered with `READY` orders (awaiting collection) prioritized above `PREPARING` orders, and within each group, oldest-first (the orders that have been waiting longest surface first, matching real staff urgency).

### 9.4 WhatsApp Notification — Creation and Transaction Guarantee

- **FR-027:** When an order with `consentGiven = true` and no active opt-out suppression (FR-019) transitions from `PREPARING` to `READY`, the system shall, within the **same database transaction** as the status change, create a `NotificationAttempt` record with `jobStatus = PENDING`. The system shall never persist an order as `READY` while failing to create its corresponding initial notification attempt due to a crash between two separate database operations — both writes succeed together or neither does.
- **FR-028:** Orders for which consent is `false`, or for which an opt-out suppression exists, shall transition to `READY` without any notification attempt being created, consistent with FR-017 and FR-019.

### 9.5 Notification Processing

- **FR-029:** A background notification processor, running in-process within the single backend instance, shall periodically claim eligible `PENDING` notification attempts using a concurrency-safe database mechanism (`SELECT ... FOR UPDATE SKIP LOCKED`), ensuring no two processing cycles (and, in a future multi-instance deployment, no two instances) ever claim the same attempt. The claim query shall exclude any `PENDING` attempt whose order belongs to a restaurant with `status = DEACTIVATED`, consistent with FR-053: such attempts are never claimed and therefore never sent.
- **FR-030:** Upon claiming an attempt, the processor shall transition it to `PROCESSING` and commit that state change **before** making the external call to the WhatsApp Cloud API. The processor shall not hold a database transaction open while waiting on the external API call.
- **FR-031:** Based on the outcome of the WhatsApp API call, the attempt shall transition to `SENT` (accepted by Meta) or, if the failure is classified as non-retryable (see FR-033), directly to `FAILED`. If the failure is classified as retryable, the attempt remains eligible for an automatic retry per FR-033, up to the defined maximum.
- **FR-032:** Subsequent delivery and read events received via Meta's webhook shall update the attempt to `DELIVERED` or `READ` as applicable. The system shall never represent `READ` as confirmation the customer consciously noticed the message.
- **FR-033 (Retry Classification):** Automatic retries apply only to failures classified as **transient**: network timeouts, 5xx responses from Meta, and transient rate-limiting responses that indicate retrying is appropriate. Failures classified as **permanent** — invalid/unparseable destination number, recipient not on WhatsApp, invalid template, or authorization/permission failures requiring human intervention — shall never be automatically retried and shall transition the attempt directly to `FAILED`. A maximum of **3 automatic retries** applies per attempt, with a fixed backoff of approximately 30 seconds between retries (configurable via environment setting). The `retryCount` field on the `NotificationAttempt` record tracks these automatic retries. Automatic retries remain part of the **same** attempt record (same `attemptNumber`) and do **not** consume the manual RECALL count (FR-035). If the maximum automatic retry count is exhausted without success, the attempt transitions to `FAILED`.
- **FR-034:** A notification attempt remaining in `PROCESSING` beyond a configurable recovery threshold (default: 2 minutes, environment-configurable) shall be automatically detected and returned to an eligible-for-reprocessing state, recovering from a backend crash or restart occurring mid-send. This may result in the message being sent more than once if Meta had, in fact, already accepted it before the crash; this is an accepted V1 limitation (see NFR-006). Consistent with FR-053, a recovered attempt shall not actually be re-claimed and re-sent if its restaurant has since become `DEACTIVATED`; the same exclusion applied to `PENDING` attempts in FR-029 applies equally to attempts returned to an eligible state by this recovery mechanism.

### 9.6 Automatic Retry vs. Manual RECALL — Explicit Distinction

These are two structurally different mechanisms and must never be conflated in implementation, schema, or UI:

**Automatic retries** happen *within* a single `NotificationAttempt` row, in response to a transient send failure (FR-033):

```text
Initial NotificationAttempt (attemptNumber = 1)
  → automatic retry #1  (retryCount = 1, same row)
  → automatic retry #2  (retryCount = 2, same row)
  → automatic retry #3  (retryCount = 3, same row)
  → FAILED if still unsuccessful after the maximum
```

**Manual RECALL** always creates a *new* `NotificationAttempt` row, triggered explicitly by staff (FR-035–037):

```text
Initial NotificationAttempt   (attemptNumber = 1)
RECALL #1 → new NotificationAttempt (attemptNumber = 2)
RECALL #2 → new NotificationAttempt (attemptNumber = 3)
RECALL #3 → new NotificationAttempt (attemptNumber = 4)
```

Automatic retries (tracked via `retryCount` on a single row) never increment `attemptNumber` and never count against the manual RECALL maximum (FR-036). Manual RECALL always increments `attemptNumber` via a new row and never resets or shares `retryCount` with any other attempt. The schema (Section 14), the functional requirements (FR-033, FR-036), the workflows (UC-002), and the acceptance criteria (AC-007) are all written to preserve this distinction consistently; no part of this document uses "retry" and "RECALL" interchangeably.

### 9.7 RECALL

- **FR-035:** RECALL (manual resend) shall be permitted only when **all** of the following hold: (a) the order's status is `READY`; (b) the order's most recent notification attempt is not currently `PENDING` or `PROCESSING`; (c) the number of prior manual RECALL-created attempts for this order has not reached the maximum (FR-036). RECALL shall be rejected server-side — not merely hidden in the UI — when status is `PREPARING`, `COLLECTED`, or `CANCELLED`, or when these conditions are otherwise unmet.
- **FR-036:** The maximum number of manual RECALL attempts per order is **3** (i.e., up to 4 total notification attempts per order: 1 initial + up to 3 recalls). This limit counts only manually triggered attempts (new `NotificationAttempt` rows created via the RECALL action); it does not count automatic transient retries within a single attempt (FR-033). Once the maximum is reached, the RECALL action shall be disabled in the UI with an explanatory message (e.g., "Maximum resend attempts reached — please notify the customer manually"), and the server shall reject any further RECALL request for that order with a clear error.
- **FR-037:** Each RECALL creates a new `NotificationAttempt` row with an incremented `attemptNumber`, generated inside a transaction that locks the parent order row (`SELECT ... FOR UPDATE`) before computing the next attempt number, preventing two near-simultaneous RECALL requests from generating a duplicate or colliding attempt number. All prior attempts for the order remain permanently intact and auditable; the restaurant interface displays the most recent attempt's status as the order's primary notification status, with full history available on request.
- **FR-038:** The database shall enforce, independent of application logic, that at most one notification attempt per order may be in `PENDING` or `PROCESSING` state at any time (see Section 14, partial unique index). This is the fundamental protection against duplicate concurrent sends from double-clicks, multiple browser tabs, or multiple devices, and RECALL/READY logic relies on this constraint rather than duplicating its protection at the request-rate-limiting layer.

### 9.8 Notification Status Visibility

- **FR-039:** The restaurant interface shall display, for each order with at least one notification attempt, the current status of the most recent attempt, mapped from internal states to user-facing labels as follows: `PENDING → Pending`, `PROCESSING → Sending`, `SENT → Sent`, `DELIVERED → Delivered`, `READ → Read`, `FAILED → Failed`. `Pending` and `Sending` reflect QuickQueue's own internal job lifecycle; `Sent`, `Delivered`, `Read`, and `Failed` are only shown once actually reported by Meta's API response or webhook, never inferred.
- **FR-040:** On `Failed` status, the interface shall display a clear, actionable message (e.g., "Failed — notify customer manually") rather than a bare status word.
- **FR-041:** No UI element shall imply "customer saw it," "customer confirmed," or "customer is coming" on the basis of any notification status; `Read` indicates only that WhatsApp reported a read receipt where the recipient has not disabled that feature.

### 9.9 Order Collection

- **FR-042:** The system shall allow a restaurant to mark an order `COLLECTED` regardless of its notification status, since collection may occur through means outside the notification (e.g., the customer noticed a physical board, or was informed verbally after a WhatsApp failure).

### 9.10 WhatsApp Connection / Onboarding

- **FR-043:** The system shall allow a restaurant to connect its own WhatsApp Business Account through an embedded onboarding flow (Meta Embedded Signup) requiring no restaurant-side interaction with Meta's developer console, API tokens, or webhook configuration.
- **FR-044:** The system shall store, per restaurant: WABA ID, phone number ID, connection status, and (once approved) sender display name. Access credential material shall be encrypted per NFR-004 before storage.
- **FR-045:** V1 shall use exactly **one** QuickQueue-authored WhatsApp notification template. No template-selection UI, no restaurant-created custom templates, and no multi-template management system shall be implemented. The template's identifier shall be recorded on every notification attempt (see Section 14) so historical records remain interpretable if the template is later revised. Whether template creation/approval can be automated programmatically for every connected restaurant's WABA is an **External Validation Dependency** (Section 22) and must be confirmed during actual Embedded Signup testing, not assumed.
- **FR-046:** Notification message content is authored and controlled entirely by QuickQueue and identifies both the restaurant and the order's display token (e.g., "Your order #47 from Pizza Palace is ready for pickup."). The message content is guaranteed and independent of whatever sender display name Meta ultimately approves for a given restaurant's WABA (see C1, Section 22).
- **FR-047:** If a restaurant disconnects or reconnects its WhatsApp integration (potentially with a different underlying WABA/phone number/display name), all historical `NotificationAttempt` records shall remain fully intact and interpretable via their own snapshot fields (Section 14), independent of the restaurant's current connection state.

### 9.11 STOP / Opt-Out

- **FR-048:** If Meta's webhook delivers a supported inbound WhatsApp message event, and the inbound message content qualifies as an opt-out command under the implemented policy (e.g., the word "STOP", case-insensitive), the system shall create or confirm a `NotificationOptOut` record for that `(restaurantId, normalizedPhone)` pair.
- **FR-049:** Opt-out suppression is scoped **per restaurant**, not globally, because each restaurant operates its own distinct WhatsApp conversation with the customer (each has its own WABA); an opt-out expressed to one restaurant does not suppress notifications from a different restaurant using QuickQueue.
- **FR-050:** No general inbound-message inbox, conversation history, customer preference center, or messaging UI shall be implemented. The only inbound-message processing in V1 is the narrow opt-out detection described in FR-048.
- **FR-051:** The exact Meta inbound-message webhook event shape and the specific payload fields required to implement FR-048 are an **External Validation Dependency** (Section 22) and must be confirmed in Meta's actual test environment before this feature is considered implementation-complete; they must not be assumed from documentation alone.

### 9.12 Restaurant Deactivation

- **FR-052:** When a restaurant's status is `DEACTIVATED`: login shall be blocked; new order creation shall be blocked; `READY` transitions shall be blocked; RECALL shall be blocked. All historical data (orders, notification attempts, WhatsApp connection record) shall remain preserved and unaffected.
- **FR-053:** The precise behavior of in-flight notification attempts at the moment of deactivation is as follows:
  - A `PENDING` attempt (not yet claimed by the processor, and therefore no external API call has been made) shall **not** be sent after its restaurant is deactivated. The processor's claim query shall exclude `PENDING` attempts belonging to a deactivated restaurant, so such attempts are never picked up and never transition to `PROCESSING`.
  - An attempt already in `PROCESSING` at the moment of deactivation (meaning the external WhatsApp API call has already been initiated or completed) shall be allowed to finish that in-flight call and record its outcome (`SENT`/`FAILED`) normally, since the external send has already crossed the point of no return and aborting it would leave the record in a permanently ambiguous state without preventing anything.
  - No **new** notification attempt of any kind — a `READY`-triggered initial attempt, a RECALL-created attempt, or an automatic retry of an existing attempt — shall ever be created for a deactivated restaurant's orders, under any circumstance, including via a queued RECALL request submitted just before deactivation or a retry cycle evaluated after deactivation.

## 10. Non-Functional Requirements

- **NFR-001 (Tenant Isolation):** No restaurant shall be able to view, query, or otherwise access another restaurant's orders, notification history, or WhatsApp connection data, under any circumstance. Every restaurant-scoped request shall derive `restaurantId` exclusively from the authenticated session — never from a client-supplied request body, query parameter, or path parameter. Order access shall first verify the order belongs to the authenticated restaurant before any read or write is permitted; notification-attempt access shall only be reachable through an order already verified to belong to the authenticated restaurant. This shall be enforced through a mandatory restaurant-scoped repository layer and verified through automated cross-tenant (IDOR-style) tests using guessed/adjacent IDs.
- **NFR-002 (Data Retention):** A scheduled cleanup process shall scrub (set to `NULL`) a customer's phone number and record `phoneScrubbedAt` on any order whose `terminalAt` timestamp is older than a configurable retention window (default: 72 hours), while preserving all other order and notification-attempt fields indefinitely. The cleanup process shall be idempotent (safe to run repeatedly without side effects on already-scrubbed rows) and shall use an index on `(status, terminalAt)` to avoid scanning the full orders table.
- **NFR-003 (Consent Auditability):** Every order records whether consent was given and when. Where consent was given, the method is recorded; where it was not, no method is recorded (see FR-016). No consent value is ever defaulted by the database; the application must supply it explicitly on every creation path.
- **NFR-004 (Secrets Handling):** Platform-level Meta application credentials (app ID, app secret) live only in environment configuration, never in the database. Per-restaurant WhatsApp access credentials, being per-tenant data rather than platform secrets, are stored in the database only after application-layer authenticated encryption (AES-256-GCM or equivalent standard authenticated encryption; no custom cryptographic primitives). The encryption key is sourced from environment/secret management and is never stored in the database. Each encrypted value stores its nonce/IV and authentication tag alongside the ciphertext. A decryption failure shall be treated as a connection error requiring restaurant re-authentication via Embedded Signup, not silently ignored. Key rotation for V1 is a manual, documented operational procedure (re-encrypt stored values under a new key during a maintenance window), not an automated system.
- **NFR-005 (Idempotency):** The database enforces, via a partial unique index (Section 14), that no more than one notification attempt per order can be in an active (`PENDING`/`PROCESSING`) state at any time. Webhook event processing shall be idempotent with respect to whatever provider-supplied correlation identifier is actually used (see NFR-009): replaying the same delivery/read/failure event shall not corrupt or regress attempt state.
- **NFR-006 (Reliability, Documented Limitation):** QuickQueue provides best-effort notification processing with database-enforced idempotency controls against duplicate *active* jobs. It does not, and cannot, guarantee exactly-once external message delivery: if Meta accepts and sends a message but the backend crashes before persisting that outcome, the automatic recovery mechanism (FR-034) may cause the message to be sent again upon reprocessing. This is an accepted V1 engineering trade-off, documented here rather than concealed, and is not to be "solved" via a distributed exactly-once architecture disproportionate to V1's scale.
- **NFR-007 (Availability/Failure Handling):** If the backend or database is temporarily unavailable, the client shall clearly indicate that the requested operation (order creation, READY, COLLECTED, CANCELLED, RECALL) could not be completed, and shall never report an operation as successfully saved when it was not. No offline synchronization or local queuing mechanism is implemented in V1. For ambiguous outcomes (e.g., a request timeout where the server may have processed the request despite the client not receiving a response), the client shall re-fetch the authoritative order state from the server rather than assume success or failure, and shall never blindly resubmit a state-changing request without first checking current state.
- **NFR-008 (Performance/Sync):** The active-orders view shall reflect state changes made by another device (e.g., a different device marking an order READY) within a few seconds via React Query polling. Sub-second real-time synchronization (WebSockets/SSE) is explicitly not a V1 requirement.
- **NFR-009 (Webhook Integrity):** Every incoming webhook request shall have its signature verified using Meta's documented webhook verification mechanism (e.g., an `X-Hub-Signature-256`-style header validated via HMAC using the platform's Meta application secret) before any parsing or processing occurs; requests failing verification shall be rejected outright with no further processing. This signature-verification requirement is non-negotiable regardless of the outcome of the External Validation Dependency below. QuickQueue shall correlate incoming webhook events to `NotificationAttempt` records, and to the owning restaurant, using the provider identifiers and verified mapping information actually supplied by Meta's API (expected to include a provider message identifier and a phone-number identifier, in the shape currently anticipated as `providerMessageId` and `phoneNumberId` in this document and the schema in Section 14) — **never** via any restaurant or order identifier supplied directly in the webhook payload, which shall never be trusted for authorization purposes under any circumstance. The exact payload structure, field names, and mapping mechanism are an **External Validation Dependency** (Section 22) and shall be confirmed against Meta's actual webhook payloads before this correlation logic is considered implementation-complete; the schema's `providerMessageId` field is retained as the current best-known correlation key and may require adjustment once verified. Duplicate events (the same correlation identifier and event type received more than once) shall not alter already-recorded state. Out-of-order events shall not be permitted to regress attempt state backward through the lifecycle (e.g., a `DELIVERED` event arriving after a `READ` event has already been recorded shall not erase the `READ` state); state progression is monotonic in the order `SENT → DELIVERED → READ`, and an event representing an earlier stage than the currently recorded stage shall be accepted for logging/timestamp purposes but shall not regress `jobStatus`. Events that cannot be correlated to a known attempt, or that reference a connection belonging to a disconnected or deactivated restaurant, shall be safely ignored (logged, not processed) rather than causing an error or unauthorized write. None of this softens or defers the signature-verification or tenant-isolation guarantees above, which apply regardless of the eventual confirmed payload shape.
- **NFR-010 (Honesty of Status Representation):** No user interface element shall imply certainty of customer awareness beyond what the underlying provider status supports (restated from FR-041 for completeness at the non-functional level).
- **NFR-011 (Migration Safety):** All schema changes are made exclusively through committed Prisma migration files, applied identically to local and production databases via `prisma migrate deploy`. Manual, dashboard-driven schema edits to the production database are prohibited. Migrations follow an additive-first (expand/contract) discipline: a destructive schema change (column/table removal) is never deployed in the same release as application code that depends on its absence, so that a deployment rollback to the previous release does not strand the database in a schema shape incompatible with the rolled-back code.
- **NFR-012 (Environment Parity):** The database engine (PostgreSQL) and major version are identical across local development (Docker) and production (Render-managed) environments at all times.
- **NFR-013 (Observability):** The system shall emit structured logs, keyed by restaurant ID and order ID where applicable, for: authentication failures, order status transitions, notification attempt state transitions, processor errors, webhook receipt and processing errors, database connection failures, and credential decryption failures. Raw customer phone numbers, WhatsApp access tokens/credentials, passwords, and password-reset tokens shall never appear in logs. A lightweight error-tracking service (e.g., Sentry or equivalent) is used for production error visibility; this is a minimal, low-overhead integration, not an observability platform build-out.
- **NFR-014 (Rate Limiting):** Login and password-reset-request endpoints are rate-limited per account and per IP (see FR-008). No additional client-facing rate limiter is applied to RECALL beyond the server-side eligibility rules and the database-level active-attempt constraint (FR-035, FR-038), since these already structurally prevent the abuse pattern a generic rate limiter would otherwise address. Webhook endpoint protection relies on signature verification (NFR-009), not generic rate limiting, since the caller is Meta's infrastructure, not an arbitrary client.
- **NFR-015 (Health Check):** The backend exposes a `GET /health` endpoint verifying database connectivity, for use by Render's deployment health-check mechanism.

## 11. Use Cases / Workflows

### UC-001: Create Order and Notify Customer (Happy Path)
Staff logs in (or has an existing session) → enters display token and customer phone number, consent checkbox defaults checked → taps Create → order recorded as `PREPARING` → food is prepared → staff taps READY → order transitions to `READY`; a `PENDING` notification attempt is created in the same transaction → the processor sends the WhatsApp message; status progresses to `Sent`, then `Delivered` (and possibly `Read`) as webhook events arrive → customer arrives; staff locates the order by token or phone and taps COLLECTED.

### UC-002: Notification Failure and Manual Recovery
As UC-001 through order creation and READY → WhatsApp send fails with a permanent classification (FR-033) → attempt transitions to `Failed`; UI shows "Failed — notify customer manually" → staff either taps RECALL (if eligible, FR-035) or handles the customer verbally → order is marked COLLECTED once resolved.

### UC-003: Consent Declined
Customer declines WhatsApp notification during ordering → staff unchecks the consent box → order is created with `consentGiven = false`, `consentMethod = NULL` → order proceeds through its normal lifecycle; when marked READY, no notification attempt is created; the UI flags the order for manual customer notification (FR-017) → staff notify the customer directly and mark COLLECTED when done.

### UC-004: Reused Display Token
At 1:00 PM, Restaurant A creates an order with display token "47" and Phone X. At 2:00 PM, the same restaurant creates a new, unrelated order also using display token "47" and Phone Y. Both orders exist independently with distinct internal Order IDs; searching by "47" surfaces both, distinguishable by creation time and status (FR-011, FR-025).

### UC-005: Same Customer, Multiple Orders
Phone X places Order #47, then minutes later places Order #52, at the same restaurant. Both proceed through their lifecycles entirely independently; no merging occurs (FR-013).

### UC-006: Customer Opts Out
Customer replies "STOP" to a Restaurant A notification → a `NotificationOptOut` record is created for `(Restaurant A, Phone X)` → a later order for Phone X at Restaurant A that reaches READY does not trigger a notification attempt, and the UI shows the opted-out state (FR-019, FR-048) → the same phone number placing an order at Restaurant B is unaffected, since suppression is per-restaurant (FR-049).

### UC-007: Restaurant Onboarding
Restaurant signs up (email/password) → clicks "Connect WhatsApp" → Meta's Embedded Signup flow opens within QuickQueue's UI; restaurant completes Meta's verification steps as prompted → control returns to QuickQueue; connection status shows Connected → QuickQueue attempts to provision the single approved notification template against the restaurant's WABA (FR-045; outcome subject to External Validation Dependency, Section 22) → restaurant can now create orders and trigger notifications.

### UC-008: Password Reset
Restaurant forgets password → requests reset by email → receives a single-use link → sets a new password → all previously issued sessions (on any device) are immediately invalidated via `sessionVersion` increment (FR-007) → restaurant logs in fresh on each device as needed.

## 12. System Architecture

```
                     CUSTOMER
                        │
                        │ WhatsApp
                        ▼
              ┌──────────────────────┐
              │ WhatsApp Business    │
              │ Platform / Cloud API │
              └──────────┬───────────┘
                         │
                    Webhooks (signature-verified)
                         │
                         ▼
┌─────────────────────────────────────────────┐
│                  QUICKQUEUE                  │
│                                               │
│  React + TypeScript + Vite   (Vercel)        │
│              │ HTTPS (Origin-validated)      │
│              ▼                               │
│  Node.js + TypeScript + Express  (Render)    │
│   ├── Auth (session cookie, sessionVersion)  │
│   ├── Order management (row-locked txns)     │
│   ├── WhatsApp integration module            │
│   ├── Notification job processor (in-proc)   │
│   └── Webhook receiver                       │
│              │                               │
│              ▼                               │
│         Prisma ORM                           │
│              │                               │
│              ▼                               │
│    PostgreSQL (Render, production)           │
│    PostgreSQL (Docker, local development)    │
└─────────────────────────────────────────────┘
```

Single backend service, single database, direct calls to Meta's API from within the same process, no separate queue service, no microservices. A single Render backend instance runs V1; the database-level claiming mechanism (FR-029) is forward-compatible with multiple instances without architectural change.

## 13. Technology Stack

| Layer | Choice |
|---|---|
| Frontend framework / language / build tool | React + TypeScript + Vite |
| Frontend hosting | Vercel |
| Backend runtime / language / framework | Node.js + TypeScript + Express |
| Backend hosting | Render (single instance, V1) |
| Database | PostgreSQL — Docker locally, Render-managed in production, identical major version |
| ORM / Migrations | Prisma / Prisma Migrate, committed to version control |
| Authentication | Email/password + HTTP-only secure session cookie + `sessionVersion` invalidation |
| Password reset | Hashed single-use token + email delivery (transactional email provider — new external dependency) |
| Messaging provider | WhatsApp Business Platform / Cloud API via Meta Tech Provider + Embedded Signup |
| Restaurant UI synchronization | React Query polling |
| Notification processing | PostgreSQL-backed job table, in-process interval processor, row-claiming (`FOR UPDATE SKIP LOCKED`) for concurrency safety |
| Error tracking | Lightweight service (e.g., Sentry), minimal integration |
| Version control | Git + GitHub |

This is a PERN-family stack (PostgreSQL, Express, React, Node), chosen because QuickQueue's data is inherently relational (Restaurant → Orders → NotificationAttempts, with real foreign keys, uniqueness constraints, and transactional consistency requirements), not document-shaped.

## 14. Database / Data Model

Five entities: `Restaurant`, `WhatsAppConnection`, `Order`, `NotificationAttempt`, `NotificationOptOut`. Every entity has a stable, system-generated UUID primary key, independent of any business-facing reference value.

### 14.1 Entity-Relationship Overview

```
Restaurant (1) ──────< (many) Order
Restaurant (1) ──────  (0 or 1) WhatsAppConnection
Restaurant (1) ──────< (many) NotificationOptOut
Order      (1) ──────< (many) NotificationAttempt
```

### 14.2 Authoritative Prisma Schema

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum RestaurantStatus {
  ACTIVE
  DEACTIVATED
}

enum ConnectionStatus {
  NOT_CONNECTED
  PENDING
  CONNECTED
  DISCONNECTED
  ERROR
}

enum OrderStatus {
  PREPARING
  READY
  COLLECTED
  CANCELLED
}

enum ConsentMethod {
  VERBAL_STAFF_CONFIRMED
}

enum NotificationChannel {
  WHATSAPP
}

enum NotificationJobStatus {
  PENDING
  PROCESSING
  SENT
  DELIVERED
  READ
  FAILED
}

model Restaurant {
  id                  String           @id @default(uuid())
  name                String
  email               String           @unique
  passwordHash        String           @map("password_hash")
  status              RestaurantStatus @default(ACTIVE)
  sessionVersion      Int              @default(1) @map("session_version")
  resetTokenHash      String?          @map("reset_token_hash")
  resetTokenExpiresAt DateTime?        @map("reset_token_expires_at")
  createdAt           DateTime         @default(now()) @map("created_at")
  updatedAt           DateTime         @updatedAt @map("updated_at")
  deactivatedAt       DateTime?        @map("deactivated_at")

  orders             Order[]
  whatsappConnection WhatsAppConnection?
  optOuts            NotificationOptOut[]

  @@map("restaurants")
}

model WhatsAppConnection {
  id                   String           @id @default(uuid())
  restaurantId         String           @unique @map("restaurant_id")
  restaurant           Restaurant       @relation(fields: [restaurantId], references: [id], onDelete: Cascade)
  wabaId               String?          @map("waba_id")
  phoneNumberId        String?          @map("phone_number_id")
  approvedDisplayName  String?          @map("approved_display_name")
  connectionStatus     ConnectionStatus @default(NOT_CONNECTED) @map("connection_status")
  accessTokenEncrypted String?          @map("access_token_encrypted")
  connectedAt          DateTime?        @map("connected_at")
  disconnectedAt       DateTime?        @map("disconnected_at")
  createdAt            DateTime         @default(now()) @map("created_at")
  updatedAt            DateTime         @updatedAt @map("updated_at")

  @@map("whatsapp_connections")
}

model Order {
  id                String        @id @default(uuid())
  restaurantId      String        @map("restaurant_id")
  restaurant        Restaurant    @relation(fields: [restaurantId], references: [id], onDelete: Cascade)
  displayToken      String        @map("display_token")
  customerPhone     String?       @map("customer_phone")
  consentGiven      Boolean       @map("consent_given")
  consentCapturedAt DateTime      @default(now()) @map("consent_captured_at")
  consentMethod     ConsentMethod? @map("consent_method")
  status            OrderStatus   @default(PREPARING)
  readyAt           DateTime?     @map("ready_at")
  collectedAt       DateTime?     @map("collected_at")
  cancelledAt       DateTime?     @map("cancelled_at")
  terminalAt        DateTime?     @map("terminal_at")
  phoneScrubbedAt   DateTime?     @map("phone_scrubbed_at")
  createdAt         DateTime      @default(now()) @map("created_at")
  updatedAt         DateTime      @updatedAt @map("updated_at")

  notificationAttempts NotificationAttempt[]

  @@index([restaurantId, status])
  @@index([restaurantId, displayToken])
  @@index([restaurantId, customerPhone])
  @@index([status, terminalAt])
  @@map("orders")
}

model NotificationAttempt {
  id                         String                @id @default(uuid())
  orderId                    String                @map("order_id")
  order                      Order                 @relation(fields: [orderId], references: [id], onDelete: Cascade)
  attemptNumber              Int                   @map("attempt_number")
  channel                    NotificationChannel   @default(WHATSAPP)
  jobStatus                  NotificationJobStatus @default(PENDING) @map("job_status")
  retryCount                 Int                   @default(0) @map("retry_count")
  claimedAt                  DateTime?             @map("claimed_at")
  sentAt                     DateTime?             @map("sent_at")
  deliveredAt                DateTime?             @map("delivered_at")
  readAt                     DateTime?             @map("read_at")
  failedAt                   DateTime?             @map("failed_at")
  providerMessageId          String?               @unique @map("provider_message_id")
  senderDisplayNameSnapshot  String?               @map("sender_display_name_snapshot")
  templateIdentifierSnapshot String?               @map("template_identifier_snapshot")
  renderedMessageSnapshot    String?               @map("rendered_message_snapshot")
  errorCode                  String?               @map("error_code")
  errorMessage               String?               @map("error_message")
  createdAt                  DateTime              @default(now()) @map("created_at")

  @@unique([orderId, attemptNumber])
  @@index([jobStatus])
  @@index([orderId])
  @@map("notification_attempts")
}

model NotificationOptOut {
  id              String     @id @default(uuid())
  restaurantId    String     @map("restaurant_id")
  restaurant      Restaurant @relation(fields: [restaurantId], references: [id], onDelete: Cascade)
  phoneNormalized String     @map("phone_normalized")
  optedOutAt      DateTime   @default(now()) @map("opted_out_at")

  @@unique([restaurantId, phoneNormalized])
  @@map("notification_opt_outs")
}
```

**Hand-added migration SQL** (partial unique index; not expressible in Prisma's schema DSL, added directly to the generated migration file and committed to version control like any other migration):

```sql
CREATE UNIQUE INDEX one_active_attempt_per_order
ON notification_attempts (order_id)
WHERE job_status IN ('PENDING', 'PROCESSING');
```

**Application-level invariant (not database-enforced):** `consentMethod` is required (non-null) when `consentGiven = true`, and must be null when `consentGiven = false`. This invariant is enforced by order-creation application logic, not by a database constraint, since Prisma/Postgres conditional-nullability-by-sibling-column constraints add migration complexity disproportionate to this single, well-tested code path.

**Note on `renderedMessageSnapshot` vs. separate restaurant-name/token snapshot fields:** a single field storing the exact rendered message text is sufficient to reconstruct what the customer saw (it already contains the restaurant name and display token as they appeared at send time), making separate `restaurantNameSnapshot`/`displayTokenSnapshot` fields redundant; they are deliberately omitted in favor of this single field plus `senderDisplayNameSnapshot` (which captures the separate, non-message-body concept of the WhatsApp sender identity shown in the customer's chat header).

### 14.3 Deletion and Retention Policy

| Table | Policy |
|---|---|
| `restaurants` | Soft-deactivated by default (`status = DEACTIVATED`, reversible); genuine hard deletion is a separate, deliberate, authorized administrative operation that cascades to all dependent records. |
| `whatsapp_connections` | Not deleted during ordinary business operation; disconnected via status transition, preserving history. Removable only via cascaded Restaurant hard deletion. |
| `orders` | Not deleted during ordinary business operation. `customerPhone` is scrubbed to `NULL` per NFR-002. Removable only via cascaded Restaurant hard deletion. |
| `notification_attempts` | Immutable audit records; not deleted during ordinary business operation. Removable only as part of an authorized restaurant-level data-erasure operation (cascade). |
| `notification_opt_outs` | Not deleted during ordinary business operation. Removable only via cascaded Restaurant hard deletion. |

### 14.4 Retention Mechanics (`terminalAt`)

`terminalAt` is `NULL` while an order is `PREPARING` or `READY`, and is set to the transition timestamp the moment an order becomes `COLLECTED` or `CANCELLED`. Because both target states are terminal (FR-021), `terminalAt`, once set, never changes. `terminalAt` is the single, exclusive retention clock (FR-021a); `collectedAt` and `cancelledAt` remain purely informational lifecycle timestamps and are never independently used to drive the cleanup process. The scheduled cleanup process (NFR-002) selects orders where `terminalAt` is older than the configured retention window, using the `(status, terminalAt)` index, and scrubs `customerPhone` on each, recording `phoneScrubbedAt`. This process is safe to run on any schedule (e.g., hourly) and safe to re-run, since already-scrubbed rows (`customerPhone IS NULL`) are naturally excluded from further matches.

### 14.5 Tenant Isolation

`restaurantId` is stored directly on `orders`, `whatsapp_connections`, and `notification_opt_outs`. All restaurant-scoped queries pass through a repository layer that mandates an explicit `restaurantId` argument sourced only from the authenticated session; no ad hoc inline query may omit this filter. `notification_attempts` isolation is enforced transitively through `order_id`, joined via the same repository layer, which verifies order ownership before any attempt-level read or write.

### 14.6 Migration Strategy

Local: schema change → `prisma migrate dev` against local Docker PostgreSQL → tested → committed to Git. Production: deployment pipeline runs `prisma migrate deploy`, applying the exact, already-tested migration files against Render-managed PostgreSQL. No manual schema edits occur through any dashboard. Additive-first/expand-contract discipline (NFR-011) governs the ordering of destructive changes relative to dependent code deployment.

## 15. WhatsApp Architecture

QuickQueue registers as a Meta **Tech Provider**. Each restaurant connects its own WhatsApp Business Account via **Embedded Signup**, embedded within the QuickQueue dashboard, requiring no restaurant-side developer interaction. Each restaurant's notifications are sent from that restaurant's own WABA and phone number, under QuickQueue's technical management — this reflects QuickQueue's working architectural model, which is treated as an **External Validation Dependency** (Section 22) pending confirmation against Meta's actual behavior during real onboarding, not as a documented certainty.

A single backend webhook endpoint receives all delivery/read/failure/inbound-message events across all connected restaurants, demultiplexed to the correct restaurant and `NotificationAttempt` using the provider identifiers and verified mapping information Meta's API actually supplies (currently anticipated to include a phone-number identifier and a provider message identifier, per NFR-009's External Validation Dependency).

Message content is always authored by QuickQueue and identifies the restaurant and order reference (FR-046). Sender display name is a best-effort, per-restaurant outcome subject to Meta's approval (Section 22) — the product requirement is that the customer notification clearly identifies the restaurant and order and appears trustworthy, which is satisfied by message content regardless of the sender-name outcome.

## 16. Notification Failure Handling

A notification attempt is marked `FAILED` when (a) Meta's API reports a permanent-classification error (FR-033), or (b) a transient-classification error persists beyond the maximum automatic retry count (FR-033). Failure is surfaced distinctly in the restaurant UI (FR-040) with an explicit manual-notification instruction. No automatic channel fallback (e.g., to SMS) exists in V1 — a deliberate scope decision (Section 21), not an oversight. A stuck `PROCESSING` attempt is automatically recovered per FR-034/NFR-006, with the associated at-least-once delivery caveat documented and accepted.

## 17. Security and Privacy

- Passwords hashed with a standard algorithm (bcrypt/argon2); never stored or logged in plaintext.
- Session authentication via HTTP-only, secure cookies; `sessionVersion` enables immediate invalidation on password change/reset without a sessions table.
- CSRF mitigated via `Origin` header validation on all state-changing endpoints (FR-009), given the separate-origin frontend/backend deployment.
- Per-restaurant WhatsApp credentials encrypted at the application layer (NFR-004); platform-level Meta credentials live only in environment configuration.
- Tenant isolation enforced per NFR-001, verified via automated IDOR-style tests.
- Webhook authenticity enforced via signature verification (NFR-009); webhook payloads never trusted for authorization decisions.
- Customer phone numbers retained only as long as operationally necessary, scrubbed per NFR-002.
- No customer account, profile, or cross-order customer identity is ever created or stored; the only customer-related persistent record beyond the order itself is the narrow opt-out suppression list (Section 13), which stores no identity beyond a normalized phone number and restaurant scope.
- Sensitive values (phone numbers, credentials, passwords, reset tokens) are excluded from all logging (NFR-013).
- Rate limiting applied to authentication-adjacent endpoints (FR-008, NFR-014).

## 18. Deployment and Environment Requirements

- Frontend: Vercel, built from the React/TypeScript/Vite codebase.
- Backend: Render, single instance for V1, running the Express application including the in-process notification processor.
- Database: Render-managed PostgreSQL in production; Docker PostgreSQL locally, matching production's major version.
- Schema changes deployed exclusively via `prisma migrate deploy` as part of the deployment pipeline, following expand/contract discipline (NFR-011).
- Environment-specific secrets (database connection string, Meta app credentials, cookie-signing secret, token-encryption key, transactional email provider credentials) managed through Render's environment variable configuration, never committed to source control.
- `GET /health` used for Render's deployment health checks (NFR-015).
- Database backup/retention capability is provided by Render's managed PostgreSQL plan; the specific retention window for the plan in use must be verified against Render's current documentation rather than assumed, and a basic manual restoration runbook should be documented once verified.

## 19. Testing Requirements

Testing shall, at minimum, cover the following, organized by area:

**Authentication:** login success/failure; password reset request, confirm, expired token, reused token, and multiple-request-invalidates-prior-token behavior; session invalidation after password change; deactivated restaurant blocked from login.

**Tenant isolation:** guessed/adjacent order IDs, notification attempt IDs, and restaurant IDs across all endpoints; cross-tenant WhatsApp connection access attempts.

**Order lifecycle:** every valid and invalid transition per FR-021; concurrent conflicting transitions (e.g., simultaneous READY and CANCELLED) resolving deterministically under row-locking (FR-022); duplicate/idempotent READY requests (FR-023); cancellation after READY.

**Consent:** `true` and `false` paths; the `consentMethod` null-exactly-when-`false` invariant; confirmation that no notification attempt is created when consent is `false` or when an opt-out exists; confirmation that no code path can omit an explicit consent value.

**Notification engine:** READY creates exactly one initial attempt; concurrent READY requests do not create duplicate attempts; processor claiming under `FOR UPDATE SKIP LOCKED`; crash-recovery of a stuck `PROCESSING` attempt; automatic retry classification (transient vs. permanent) and maximum-retry exhaustion; RECALL eligibility rules (FR-035) including rejection while `PENDING`/`PROCESSING`, after reaching maximum, and in non-`READY` statuses; concurrent RECALL requests do not create colliding attempt numbers.

**Webhooks:** valid and invalid signature handling; duplicate event delivery; out-of-order event delivery (e.g., `READ` before `DELIVERED`) not regressing state; events that cannot be correlated to a known attempt, or that reference a disconnected/deactivated restaurant's connection, safely ignored. (Exact correlation field names are validated against Meta's live payloads per the External Validation Dependency in Section 22, but the safe-ignore and non-regression behavior itself is a firm V1 requirement independent of that validation's outcome.)

**Opt-out:** inbound opt-out event creates suppression; subsequent READY for that `(restaurant, phone)` pair does not create an attempt; the same phone at a different restaurant is unaffected.

**Retention:** `terminalAt` set correctly and immutably on terminal transitions; phone scrubbing occurs after the configured window; notification history remains intact and interpretable post-scrub; cleanup process is idempotent under repeated runs.

**WhatsApp integration:** full pipeline validated against Meta's developer/test environment with allowlisted recipients before any production restaurant onboarding; Embedded Signup behavior, template provisioning, and sender-display-name outcome explicitly validated and documented once observed (Section 22).

**Deployment:** migration apply/rollback compatibility under expand-contract discipline; health check behavior; environment configuration completeness.

## 20. Future Enhancements (explicitly NOT V1)

SMS/voice fallback channels; RCS support; POS/KDS integration (e.g., Petpooja); customer-facing QR code or web status page; estimated wait time; employee/staff accounts and roles; device session management/revocation; multi-instance horizontal scaling (architecturally anticipated, not required); batch "mark stale ready orders collected" tooling; combining multiple simultaneous orders for the same phone number into a single notification; multiple/selectable WhatsApp templates; a general inbound-messaging or customer-preference system beyond the narrow opt-out mechanism; localization/i18n infrastructure; self-service account/data-deletion UI (handled manually/by support request in V1); in-app billing/subscription management.

## 21. Out of Scope

Customer mobile app; customer accounts or profiles; customer order history; QR-code-based customer interaction; customer-facing website; web push notifications; SMS; voice calls; RCS; email notifications (to customers); food ordering/menu/cart/checkout; online payment processing; food delivery; inventory management; maps/location features; ratings and reviews; estimated wait time; employee/staff account management; device management/session revocation dashboards; POS, KDS, or third-party restaurant software integration (including Petpooja); Redis, Kafka, RabbitMQ, or any external message-queue infrastructure; microservices architecture; offline synchronization; a general inbound-message inbox or customer preference center; arbitrary or restaurant-created WhatsApp templates; in-app billing/subscriptions; analytics dashboards.

## 22. External Dependencies and Risks

| Item | Type | Description |
|---|---|---|
| Meta Tech Provider approval | External Validation Dependency | Required before any real restaurant can be onboarded via Embedded Signup; uncontrolled review timeline; must be initiated early relative to any intended pilot date. |
| WhatsApp template approval | External Validation Dependency | The single V1 template (FR-045) must be submitted to and approved for each restaurant's WABA; whether this can be automated per-restaurant via API must be confirmed during testing, not assumed. |
| Exact Embedded Signup behavior, token type/lifetime, required scopes | External Validation Dependency | Must be confirmed in Meta's actual test/onboarding flow before the credential-lifecycle assumptions in NFR-004 are finalized in code (e.g., whether the issued token is a long-lived System User token or requires a refresh flow). |
| Webhook payload structure, field subscriptions, and event-to-attempt correlation mechanism | External Validation Dependency | The exact webhook subscription configuration required to receive `message_status` and inbound `messages` events, the exact payload field names and structure Meta actually delivers, and the precise mechanism for correlating an event to a `NotificationAttempt` and its owning restaurant (anticipated to involve a provider message identifier and a phone-number identifier, per NFR-009) must all be validated directly against Meta's live webhook payloads, not assumed from general documentation. Signature verification and tenant-isolation requirements (NFR-009) apply unconditionally regardless of this validation's outcome. |
| Sender display-name outcome ("Pizza Palace via QuickQueue" vs. restaurant-only name) | External Validation Dependency | Cannot be confirmed without a real Embedded Signup submission per restaurant; product messaging/marketing must not assume a specific outcome until validated per Section 15. |
| New WABA sending reputation/throughput limits | Risk | A newly connected restaurant's WhatsApp sender may face initial Meta-imposed messaging caution; high-volume day-one usage should not be promised to prospective restaurants without accounting for this. |
| WhatsApp read-receipt reliability | Documented limitation | Not guaranteed for all recipients (privacy-setting dependent); `Read` must never be represented as certain proof of customer awareness (FR-041, NFR-010). |
| Exactly-once delivery | Documented limitation | Cannot be guaranteed in all crash/restart scenarios (NFR-006); accepted V1 trade-off for architectural simplicity. |
| One shared sender identity across independent restaurants | Constraint, treated as not assumed possible | QuickQueue's working model is that each restaurant requires its own WABA/phone number under Meta's account and display-name rules; this is not documented here as a proven, absolute fact, but as the architecture QuickQueue is built around pending confirmation during real onboarding (C1). |
| Transactional email provider for password reset | New external dependency | Introduced by FR-007; requires selection and configuration of a provider (e.g., Resend or equivalent) as part of V1 deployment, not previously accounted for. |

## 23. Acceptance Criteria

- **AC-001:** A restaurant can create an account, log in, and remain authenticated via secure session cookie across multiple devices, with no employee-level accounts.
- **AC-002:** A restaurant can reset a forgotten password via a single-use, expiring, emailed token, after which all previously issued sessions are invalidated.
- **AC-003:** A restaurant can create an order with a required display token, phone number, and explicit consent value, correctly defaulting to `PREPARING`.
- **AC-004:** Marking a consented, non-suppressed order `READY` reliably and automatically creates a notification attempt within the same transaction as the status change, with no code path capable of persisting `READY` without a corresponding attempt.
- **AC-005:** An order with consent `false`, or with an active opt-out suppression, never receives a notification attempt, and is clearly flagged for manual staff notification.
- **AC-006:** The restaurant interface accurately reflects notification status using only the defined lifecycle states, with the internal-to-display mapping applied consistently, and with no state implying customer awareness beyond what the provider actually reported.
- **AC-007:** RECALL creates a new, independently tracked notification attempt when eligible, and is correctly rejected server-side when the order is not `READY`, when an attempt is already active, or when the maximum RECALL count has been reached.
- **AC-008:** Two orders sharing the same display token at the same restaurant, and two orders sharing the same phone number (at the same or different restaurants), are handled correctly and independently with no merging or collision.
- **AC-009:** No restaurant can, under any tested query path, access another restaurant's orders, notification attempts, WhatsApp connection data, or opt-out records.
- **AC-010:** A simulated backend crash mid-notification-send results in automatic recovery of the affected attempt rather than a permanently stuck job, with the at-least-once delivery caveat documented and accepted.
- **AC-011:** Concurrent conflicting requests (simultaneous READY/CANCELLED, simultaneous RECALL, duplicate READY) never produce two active notification attempts for the same order, nor an invalid order state.
- **AC-012:** A customer opt-out (STOP) reliably suppresses future notification attempts for that phone number at that specific restaurant only, without creating any general customer profile or affecting other restaurants.
- **AC-013:** Webhook events are only accepted with a valid signature, are processed idempotently, do not regress attempt state when arriving out of order, and are safely ignored when referencing unknown or disconnected-restaurant identifiers.
- **AC-014:** The full technical pipeline (order creation through RECALL) is demonstrable end-to-end against Meta's developer test environment prior to any production restaurant onboarding.
- **AC-015:** All schema changes exist as committed, ordered Prisma migration files, applied identically to local and production databases, following expand-contract discipline, with no manual production schema edits.
- **AC-016:** Customer phone numbers are automatically and idempotently scrubbed from terminal orders after the configured retention window, without loss of operational or notification history.
- **AC-017:** A deactivated restaurant is fully blocked from login, order creation, READY, and RECALL. Its historical data remains intact. A `PENDING` (unclaimed) notification attempt belonging to a deactivated restaurant is never claimed or sent; an attempt already `PROCESSING` at the moment of deactivation is allowed to finish its in-flight external call and record its outcome. No new notification attempt of any kind (initial, RECALL-created, or automatic retry) is ever created on a deactivated restaurant's behalf under any code path.

---

