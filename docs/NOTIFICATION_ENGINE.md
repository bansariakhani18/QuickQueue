# QuickQueue V1 — Notification Engine Specification

The Notification Engine is QuickQueue's reliable dispatch subsystem. It guarantees that when an order is marked `READY`, an automated WhatsApp notification is created, claimed, dispatched via Meta Cloud API, and tracked to final delivery without duplicate sends or stuck jobs.

---

## 1. State Machine & Lifecycle

Every notification attempt passes through the `NotificationJobStatus` enum:

```
                  +---------+
                  | PENDING | <-----------------------+
                  +----+----+                         |
                       | Worker claim                 | Transient failure
                       v                              | (exponential backoff)
                +--------------+                      |
                |  PROCESSING  +----------------------+
                +---+------+---+
                    |      |
  Meta HTTP 200 OK  |      | Permanent failure / Max retries
                    v      v
                 +------+ +--------+
                 | SENT | | FAILED |
                 +---+--+ +--------+
                     |
       Webhook event |
                     v
               +-----------+
               | DELIVERED |
               +-----+-----+
                     |
       Webhook event |
                     v
                 +------+
                 | READ |
                 +------+
```

* **`PENDING`:** Attempt created transactionally when order transitions to `READY`. Awaiting worker claim.
* **`PROCESSING`:** Worker has claimed the row with a locked timestamp (`claimedAt`). Dispatch is in-flight.
* **`SENT`:** Meta Cloud API acknowledged receipt (HTTP 200) with a `providerMessageId` (e.g. `wamid.HBg...`).
* **`DELIVERED`:** Recipient device confirmed message receipt via inbound webhook.
* **`READ`:** Recipient opened/read the message via inbound webhook.
* **`FAILED`:** Permanent failure encountered, or automatic retries exhausted. Triggers staff alert in UI.

---

## 2. Worker Claiming Mechanics (`backend/src/processor.ts`)

The background processor runs continuously via `startProcessor()` on a configurable interval (default: 2,000ms).

### Concurrency & SKIP LOCKED
To ensure that multiple concurrent workers or fast polling intervals never claim the same notification attempt, the engine executes a PostgreSQL atomic row-lock:

```sql
SELECT * FROM "NotificationAttempt"
WHERE "status" = 'PENDING'
  AND ("nextRetryAt" IS NULL OR "nextRetryAt" <= NOW())
ORDER BY "createdAt" ASC
LIMIT 1
FOR UPDATE SKIP LOCKED;
```

* **`FOR UPDATE SKIP LOCKED`:** Guarantees cluster-safe claiming without deadlocks or double-processing.
* When claimed, the worker immediately updates the row inside the transaction:
  * `status = 'PROCESSING'`
  * `claimedAt = NOW()`

---

## 3. Provider Message ID Persistence & Sending

* The worker calls `sendRestaurantOrderReadyNotification(attempt.id, prisma)` in `backend/src/restaurantSender.ts`.
* The sender decrypts the restaurant's AES-256-GCM access token and calls Meta's Graph API `POST /{phoneNumberId}/messages`.
* Upon a successful response, the engine records:
  * `status = 'SENT'`
  * `providerMessageId = response.messages[0].id`
  * `sentAt = NOW()`
  * Clears `claimedAt = NULL`
* Storing `providerMessageId` is critical: incoming webhooks match asynchronous `delivered` and `read` events by this exact ID.

---

## 4. Failure Handling & Automatic Retries (`backend/src/retry.ts`)

When an error occurs during dispatch, `classifyError(error)` categorizes it:

### A. Permanent Failure (No Retry)
* **Causes:** Invalid phone number (HTTP 400), recipient opted out, template nonexistent, token revoked/invalid, restaurant missing WhatsApp connection.
* **Action:**
  * `status = 'FAILED'`
  * `failureReason = error.message`
  * `nextRetryAt = NULL`
  * Card in UI displays `"Failed — notify the customer manually"`.

### B. Transient Failure (Automatic Retry with Backoff)
* **Causes:** Meta 5xx internal server errors, rate limiting (HTTP 429), network timeouts.
* **Action:**
  * Checks if `retryCount < MAX_RETRIES` (default: 3 retries).
  * If retries remain:
    * `status = 'PENDING'`
    * `retryCount = retryCount + 1`
    * `nextRetryAt = NOW() + (RETRY_BACKOFF_MS * 2^(retryCount - 1))` (default base: 60s, doubling each attempt).
  * If max retries reached:
    * `status = 'FAILED'`
    * `failureReason = 'Max automatic retries exceeded'`

---

## 5. Automatic Retries vs. Manual Recalls

It is critical to distinguish automatic retries from manual staff recalls:

| Property | Automatic Retry | Manual Staff RECALL |
|---|---|---|
| **Trigger** | Automatic background detection of transient network/Meta error | Manual button click by restaurant staff in the UI (`POST /orders/:id/recall`) |
| **Row Identity** | Updates the **existing** `NotificationAttempt` row (`retryCount++`) | Creates a **new** `NotificationAttempt` row (`attemptNumber = attemptNumber + 1`) |
| **Pre-Conditions** | Existing attempt has `status = 'PROCESSING'` and transient error | Order must be currently `READY`; no existing attempt is `PENDING` or `PROCESSING` |
| **Eligibility Recheck** | None | Full re-check: validates customer verbal consent, active opt-out records, and restaurant active status |
| **Cap / Limit** | Max 3 retries per attempt | Up to 4 total attempts (`MAX_RECALL_ATTEMPTS = 4`: 1 initial + 3 manual recalls) |

---

## 6. Stuck Job Recovery (`recoverStuckJobs`)

If a backend node crashes, restarts, or hangs while a job is in `PROCESSING`, the row would remain locked indefinitely without recovery.

* `recoverStuckJobs(stuckTimeoutMs = 30000)` executes before each processor cycle:
  ```sql
  UPDATE "NotificationAttempt"
  SET "status" = 'PENDING', "claimedAt" = NULL
  WHERE "status" = 'PROCESSING'
    AND "claimedAt" <= NOW() - INTERVAL '30 seconds';
  ```
* Resets stale in-flight jobs back to `PENDING` so another worker can safely pick them up.

---

## 7. Restaurant Deactivation Interaction (FR-053)

When a restaurant is deactivated (`status = 'DEACTIVATED'`):
1. **In-Flight Dispatches:** Any attempt currently in `PROCESSING` that was already claimed before deactivation completes its send cleanly without being aborted mid-flight.
2. **Transient Errors on Deactivated Tenants:** If an in-flight send experiences a transient error, the engine does **not** reschedule a retry; it immediately finalizes the attempt as `FAILED`.
3. **Stuck Recovery:** If a stuck job is reset to `PENDING` for a now-deactivated restaurant, `claimAndProcessOne()` explicitly skips claiming it.
4. **Action Block:** Staff cannot trigger RECALL or mark orders READY while deactivated.

---

## 8. Source Code References

* `backend/src/processor.ts`: `startProcessor()`, `claimAndProcessOne()`, `recoverStuckJobs()`.
* `backend/src/retry.ts`: `classifyError()`, `calculateNextRetry()`, `MAX_RETRIES`, `MAX_RECALL_ATTEMPTS`.
* `backend/src/restaurantSender.ts`: `sendRestaurantOrderReadyNotification()`, per-restaurant credential resolution.
* `backend/src/orders.ts`: `createOrder()`, `setOrderReady()`, `recallOrder()`.
