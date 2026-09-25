# QuickQueue V1 — Known Limitations and Accepted Trade-Offs

This document records the explicitly accepted product constraints, architectural trade-offs, and external dependencies of QuickQueue V1 as defined in the frozen [SRS.md](../SRS.md) and confirmed during implementation.

---

## 1. Product Boundaries & Feature Scope

* **Active-Board Only (No Order History):**
  QuickQueue V1 is an operational queue for in-flight orders. Once an order transitions to `COLLECTED` or `CANCELLED`, it is removed from the active board. There is no historical order log, analytics dashboard, reporting export, or staff audit screen in V1.
* **Opaque, Restaurant-Supplied Display Tokens:**
  QuickQueue does not generate order or token numbers. It accepts whatever reference string the restaurant counter already uses (e.g. `42`, `A-12`, `Takeout-3`).
* **Duplicate Display Tokens Permitted:**
  Multiple active orders may share the same display token simultaneously. The system highlights duplicate tokens with visual warnings and creation timestamps, but intentionally avoids enforcing unique token constraints at the database level.
* **No POS / KDS / Kitchen Management:**
  QuickQueue integrates with zero POS systems, Kitchen Display Systems (KDS), or third-party restaurant platforms (SRS §3, Constraint C3). It is purely a notification and pickup status layer.
* **No Menus, Items, Pricing, or Customer Accounts:**
  QuickQueue stores no food items, prices, payments, or customer profiles. Customers never log in, download an app, or scan a QR code (SRS §6, Goal G3).

---

## 2. Notification & Messaging Semantics

* **At-Least-Once Delivery (NFR-006):**
  Due to network retries, transient Meta API failures, or worker crashes during dispatch, a customer may occasionally receive more than one notification for the same order. Exactly-once messaging over distributed networks is technically impossible without end-to-end distributed transaction protocols. At-least-once delivery is the explicitly accepted trade-off.
* **Best-Effort Read Receipts:**
  WhatsApp message status tracking (`Sent` → `Delivered` → `Read`) relies entirely on recipient device configuration and Meta network delivery. If a customer disables read receipts in their WhatsApp privacy settings, the status will remain `Delivered` even after they have viewed the message.
* **English-Only V1 (Constraint C4):**
  The user interface and Meta utility notification templates are written in English only (`en_US`). Localization infrastructure is deferred to future releases.

---

## 3. Architecture & Infrastructure Constraints

* **Single Backend Instance (Constraint C2):**
  QuickQueue V1 is architected and tested to run as a single Node.js backend instance in production. While the notification claiming engine (`FOR UPDATE SKIP LOCKED`) and database schema are forward-compatible with multiple instances, horizontal autoscaling and distributed leader elections are not configured in V1.
* **Scheduled Data Retention (Phone Scrubbing):**
  To comply with privacy requirements, customer phone numbers (`customerPhone`) are automatically scrubbed (set to `NULL`) 72 hours after an order reaches a terminal state (`COLLECTED` or `CANCELLED`). After scrubbing, previous recipient phones cannot be retrieved or resent.

---

## 4. External Meta / WhatsApp Dependencies

* **Meta Access Token Expiry:**
  The development access token used during Phase 12 validation expired on **2026-09-22**. In local development, the backend operates in mock/test mode for outbound notifications, while the database, state machine, and error handling remain fully operational.
* **Tech Provider Approval Requirement:**
  Automated onboarding via Meta Embedded Signup requires an approved Meta Tech Provider business asset. Until production verification is finalized with Meta, live multi-tenant onboarding popups cannot be completed in an unverified staging sandbox.
