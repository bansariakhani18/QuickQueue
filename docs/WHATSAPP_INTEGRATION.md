# QuickQueue V1 — WhatsApp Cloud API Integration

This document serves as the permanent record of QuickQueue's integration with the Meta WhatsApp Cloud API (Graph API v21.0), documenting both the implemented multi-tenant architecture and the actual behaviors observed from Meta versus initial assumptions.

---

## 1. Multi-Tenant Integration Architecture

Under Meta's Business Platform policies, a multi-restaurant SaaS cannot send notifications from a single shared platform phone number while representing multiple independent food establishments. QuickQueue implements a multi-tenant onboarding and credential isolation architecture:

```
+-----------------------------------------------------------------------------------+
|                           EMBEDDED SIGNUP ONBOARDING                              |
|                                                                                   |
|  1. Staff initiates: POST /connections/signup/initiate                            |
|     -> Generates signed session state & Meta Embedded Signup URL                  |
|                                                                                   |
|  2. Merchant completes Meta OAuth popup:                                           |
|     -> Selects or creates WABA, registers Phone Number, grants permissions         |
|                                                                                   |
|  3. Callback completion: POST /connections/signup/complete                        |
|     -> Receives wabaId, phoneNumberId, accessToken                                |
|     -> AES-256-GCM encrypts accessToken with server WHATSAPP_TOKEN_ENCRYPTION_KEY |
|     -> Provisions order-ready utility template                                    |
|     -> Submits display name: "<Restaurant> via QuickQueue"                        |
|     -> Saves WhatsAppConnection row (status: CONNECTED)                           |
+-----------------------------------------------------------------------------------+
```

---

## 2. Token Security & AES-256-GCM (`backend/src/crypto.ts`)

Access tokens granting messaging authority are encrypted before persistence:
* **Algorithm:** AES-256-GCM (Authenticated Encryption with Associated Data).
* **Key:** 32-byte binary key derived from `WHATSAPP_TOKEN_ENCRYPTION_KEY`.
* **Database Columns in `WhatsAppConnection`:**
  * `encryptedAccessToken`: Base64 ciphertext.
  * `iv`: Base64 12-byte initialization vector (unique per encryption).
  * `authTag`: Base64 16-byte authentication tag ensuring integrity.
* **Decryption Scope:** Decrypted strictly in-memory during dispatch in `restaurantSender.ts`. Tokens are never logged, returned over APIs, or shared across tenants.

---

## 3. Display Name Registration (`backend/src/displayName.ts`)

Meta enforces strict Business Display Name rules for WABA phone numbers:
* **Standard Pattern:** `<Restaurant Name> via QuickQueue` (e.g. `Spice Garden via QuickQueue`).
* **Fallback Behavior:** If Meta rejects the compound name, the engine records the rejection and falls back cleanly to the plain restaurant name rather than halting the connection.
* **Verification:** Only Meta-confirmed display names are stored as approved.

---

## 4. Template Provisioning (`backend/src/templateProvisioning.ts`)

QuickQueue dispatches notifications using a pre-approved Meta Utility Template:
* **Template Name:** `quickqueue_order_ready_v1`
* **Category:** `UTILITY`
* **Components:**
  * Body: `Your order {{1}} at {{2}} is ready for pickup!`
  * Parameter 1 (`{{1}}`): Display Token (e.g. `A42`).
  * Parameter 2 (`{{2}}`): Restaurant Name (e.g. `Spice Garden`).
* During onboarding, `provisionOrderReadyTemplate()` calls Meta Graph API `POST /{wabaId}/message_templates` to ensure the template is provisioned in the merchant's WABA.

---

## 5. Webhook Processing (`backend/src/webhook.ts`)

Incoming notifications and delivery receipts enter via `POST /webhook/whatsapp`.

### A. HMAC-SHA256 Signature Verification
Every inbound request must include the `X-Hub-Signature-256` header:
```typescript
const signature = req.headers['x-hub-signature-256'] as string;
const expected = 'sha256=' + crypto.createHmac('sha256', process.env.WHATSAPP_APP_SECRET)
  .update(rawBody)
  .digest('hex');
if (signature !== expected) {
  return res.status(401).send('Signature mismatch');
}
```

### B. Status Event Handling (`DELIVERED` & `READ`)
Meta posts status changes asynchronously:
```json
{
  "entry": [{
    "changes": [{
      "value": {
        "statuses": [{
          "id": "wamid.HBgL...",
          "status": "delivered",
          "timestamp": "1727265600",
          "recipient_id": "919876543210"
        }]
      }
    }]
  }]
}
```
* Engine matches `statuses[0].id` against `NotificationAttempt.providerMessageId`.
* Atomically transitions the attempt status:
  * `"delivered"` → `DELIVERED` (`deliveredAt = NOW()`)
  * `"read"` → `READ` (`readAt = NOW()`)
* Unknown provider IDs or events for deactivated restaurants are acknowledged with HTTP 200 and ignored.

### C. Inbound STOP Opt-Out Handling (FR-048 / FR-049)
When a customer replies with the keyword `STOP` (or case-insensitive variations like `stop`, `Stop `):
* Extracted from `entry[0].changes[0].value.messages[0].text.body`.
* Resolves the restaurant owning the `phoneNumberId`.
* Inserts a `CustomerOptOut` row scoped to `(restaurantId, customerPhone)`.
* Subsequent orders for that phone at that restaurant suppress automatic notifications and prompt staff: `"Customer previously opted out — notify manually"`.
* Customer phone remains free to receive notifications from other distinct restaurants.

---

## 6. Observed Real Meta Behaviors vs. Initial SRS Assumptions

| Topic | SRS Assumption | Observed Reality in Integration |
|---|---|---|
| **Webhook Payload Hierarchy** | Assumed flat status arrays | Payloads have a strict 4-level nesting: `entry[0].changes[0].value.statuses[0]` and `.messages[0]`. |
| **Token Lifecycle** | Assumed static access tokens | Temporary User access tokens expire quickly (our initial live test token expired on 2026-09-22). Permanent dispatch requires System User tokens or live Tech Provider Embedded Signup tokens. |
| **Delivery Receipts Order** | Assumed strictly sequential `sent` → `delivered` → `read` | Out-of-order delivery can occur over mobile networks; the state machine permits direct transition to `READ` if `DELIVERED` was dropped or arrived later. |
| **STOP Keyword Ingress** | Assumed customer app interaction | Meta delivers keyword replies as inbound webhook messages with type `text`. |

---

## 7. Current External Limitations & Local Test Mode

* **Token Expiry Notice:** The live development access token used during Phase 12 validation expired on **2026-09-22**.
* **Tech Provider Status:** Full end-to-end live Embedded Signup popup flows require an approved Meta Tech Provider business account.
* **Current Operational Mode:**
  * All unit and integration suites run against verified test doubles and captured real-payload replays.
  * The frontend WhatsApp panel honestly displays `PENDING` or `NOT_CONNECTED` and explains that live Meta authorization is pending.
  * Outbound dispatches in dev mode safely log and record permanent or simulated transient failures without crashing.
