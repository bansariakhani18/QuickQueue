import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { createHmac } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { app } from '../app.js'

const prisma = new PrismaClient()

const VERIFY_TOKEN = 'quickqueue-test-verify-token'
const APP_SECRET = 'quickqueue-test-app-secret'
const SAMPLE_TIMESTAMP = '1710000000'

const createdRestaurants: string[] = []

async function cleanup(): Promise<void> {
  if (createdRestaurants.length === 0) return
  await prisma.restaurant.deleteMany({ where: { email: { in: createdRestaurants } } })
  createdRestaurants.length = 0
}

function signBody(body: string, secret: string = APP_SECRET): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
}

function messageStatusPayload(
  providerMessageId: string,
  status: string,
  opts: { timestamp?: string; phoneNumberId?: string } = {},
): string {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '1436125048387918',
        changes: [
          {
            field: 'message_status',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '15551234567',
                phone_number_id: opts.phoneNumberId ?? '1226137183925646',
              },
              contacts: [{ profile: { name: 'Customer' }, wa_id: '919712238366' }],
              statuses: [
                {
                  id: providerMessageId,
                  status,
                  timestamp: opts.timestamp ?? SAMPLE_TIMESTAMP,
                  recipient_id: '919712238366',
                },
              ],
            },
          },
        ],
      },
    ],
  })
}

async function createRestaurant(email: string, status: 'ACTIVE' | 'DEACTIVATED' = 'ACTIVE') {
  createdRestaurants.push(email)
  return prisma.restaurant.create({
    data: {
      name: `Webhook Test ${email}`,
      email,
      passwordHash: 'hash',
      status,
    },
  })
}

async function createOrder(restaurantId: string) {
  return prisma.order.create({
    data: {
      restaurantId,
      displayToken: `wh-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      customerPhone: '+1919712238366',
      consentGiven: true,
      consentMethod: 'VERBAL_STAFF_CONFIRMED',
      status: 'READY',
    },
  })
}

async function createSentAttempt(orderId: string, providerMessageId: string) {
  return prisma.notificationAttempt.create({
    data: {
      orderId,
      attemptNumber: 1,
      channel: 'WHATSAPP',
      jobStatus: 'SENT',
      sentAt: new Date(),
      providerMessageId,
    },
  })
}

async function postWebhook(body: string) {
  return request(app)
    .post('/webhook')
    .set('X-Hub-Signature-256', signBody(body))
    .set('Content-Type', 'application/json')
    .send(body)
}

describe('WhatsApp webhook (Phase 13)', () => {
  beforeAll(async () => {
    await prisma.$connect()
    vi.stubEnv('WHATSAPP_WEBHOOK_VERIFY_TOKEN', VERIFY_TOKEN)
    vi.stubEnv('WHATSAPP_APP_SECRET', APP_SECRET)
  })

  afterAll(async () => {
    await cleanup()
    vi.unstubAllEnvs()
    await prisma.$disconnect()
  })

  afterEach(async () => {
    await cleanup()
  })

  it('echoes the challenge on GET /webhook for a valid verify token', async () => {
    const res = await request(app).get(
      `/webhook?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=9876543210`,
    )
    expect(res.status).toBe(200)
    expect(res.text).toBe('9876543210')
  })

  it('rejects the GET handshake when the verify token is wrong', async () => {
    const res = await request(app).get('/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=9876543210')
    expect(res.status).toBe(403)
  })

  it('rejects the GET handshake when hub.mode is not subscribe', async () => {
    const res = await request(app).get(`/webhook?hub.mode=noop&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=9876543210`)
    expect(res.status).toBe(403)
  })

  it('rejects the GET handshake when the verify token env var is missing', async () => {
    vi.stubEnv('WHATSAPP_WEBHOOK_VERIFY_TOKEN', '')
    try {
      const res = await request(app).get(
        `/webhook?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=9876543210`,
      )
      expect(res.status).toBe(403)
    } finally {
      vi.stubEnv('WHATSAPP_WEBHOOK_VERIFY_TOKEN', VERIFY_TOKEN)
    }
  })

  it('rejects a POST without a signature before any processing', async () => {
    const restaurant = await createRestaurant(`wh-missing-sig-${Date.now()}@example.com`)
    const order = await createOrder(restaurant.id)
    const providerMessageId = 'wamid-missing-sig'
    await createSentAttempt(order.id, providerMessageId)

    const res = await request(app)
      .post('/webhook')
      .set('Content-Type', 'application/json')
      .send(messageStatusPayload(providerMessageId, 'delivered'))

    expect(res.status).toBe(403)

    const attempt = await prisma.notificationAttempt.findUnique({ where: { providerMessageId } })
    expect(attempt?.jobStatus).toBe('SENT')
    expect(attempt?.deliveredAt).toBeNull()
  })

  it('rejects a POST with a tampered signature before any processing', async () => {
    const restaurant = await createRestaurant(`wh-tampered-${Date.now()}@example.com`)
    const order = await createOrder(restaurant.id)
    const providerMessageId = 'wamid-tampered'
    await createSentAttempt(order.id, providerMessageId)

    const res = await request(app)
      .post('/webhook')
      .set('X-Hub-Signature-256', 'sha256=' + 'a'.repeat(64))
      .set('Content-Type', 'application/json')
      .send(messageStatusPayload(providerMessageId, 'delivered'))

    expect(res.status).toBe(403)

    const attempt = await prisma.notificationAttempt.findUnique({ where: { providerMessageId } })
    expect(attempt?.jobStatus).toBe('SENT')
  })

  it('rejects a POST whose signature was derived with the wrong secret', async () => {
    const restaurant = await createRestaurant(`wh-wrong-secret-${Date.now()}@example.com`)
    const order = await createOrder(restaurant.id)
    const providerMessageId = 'wamid-wrong-secret'
    await createSentAttempt(order.id, providerMessageId)

    const bodyText = messageStatusPayload(providerMessageId, 'delivered')
    const wrongSig = 'sha256=' + createHmac('sha256', 'not-the-app-secret').update(bodyText).digest('hex')

    const res = await request(app)
      .post('/webhook')
      .set('X-Hub-Signature-256', wrongSig)
      .set('Content-Type', 'application/json')
      .send(bodyText)

    expect(res.status).toBe(403)

    const attempt = await prisma.notificationAttempt.findUnique({ where: { providerMessageId } })
    expect(attempt?.jobStatus).toBe('SENT')
  })

  it('rejects a POST with a non-sha256 signature algorithm header', async () => {
    const restaurant = await createRestaurant(`wh-sha1-${Date.now()}@example.com`)
    const order = await createOrder(restaurant.id)
    const providerMessageId = 'wamid-sha1'
    await createSentAttempt(order.id, providerMessageId)

    const bodyText = messageStatusPayload(providerMessageId, 'delivered')
    const sha1Sig = createHmac('sha1', APP_SECRET).update(bodyText).digest('hex')

    const res = await request(app)
      .post('/webhook')
      .set('X-Hub-Signature-256', `sha1=${sha1Sig}`)
      .set('Content-Type', 'application/json')
      .send(bodyText)

    expect(res.status).toBe(403)
  })

  it('rejects a POST when the app secret env var is missing', async () => {
    vi.stubEnv('WHATSAPP_APP_SECRET', '')
    try {
      const bodyText = messageStatusPayload('wamid-no-secret', 'delivered')
      const res = await request(app)
        .post('/webhook')
        .set('X-Hub-Signature-256', signBody(bodyText))
        .set('Content-Type', 'application/json')
        .send(bodyText)
      expect(res.status).toBe(403)
    } finally {
      vi.stubEnv('WHATSAPP_APP_SECRET', APP_SECRET)
    }
  })

  it('transitions an attempt to DELIVERED on a valid delivered event', async () => {
    const restaurant = await createRestaurant(`wh-delivered-${Date.now()}@example.com`)
    const order = await createOrder(restaurant.id)
    const providerMessageId = 'wamid-e2e-delivered'
    await createSentAttempt(order.id, providerMessageId)

    const res = await postWebhook(messageStatusPayload(providerMessageId, 'delivered'))

    expect(res.status).toBe(200)

    const attempt = await prisma.notificationAttempt.findUnique({ where: { providerMessageId } })
    expect(attempt?.jobStatus).toBe('DELIVERED')
    expect(attempt?.deliveredAt).not.toBeNull()
    expect(attempt?.readAt).toBeNull()
  })

  it('transitions an attempt to READ after DELIVERED', async () => {
    const restaurant = await createRestaurant(`wh-read-${Date.now()}@example.com`)
    const order = await createOrder(restaurant.id)
    const providerMessageId = 'wamid-e2e-read'
    await createSentAttempt(order.id, providerMessageId)

    const delivered = await postWebhook(messageStatusPayload(providerMessageId, 'delivered'))
    expect(delivered.status).toBe(200)

    const read = await postWebhook(messageStatusPayload(providerMessageId, 'read'))
    expect(read.status).toBe(200)

    const attempt = await prisma.notificationAttempt.findUnique({ where: { providerMessageId } })
    expect(attempt?.jobStatus).toBe('READ')
    expect(attempt?.readAt).not.toBeNull()
    expect(attempt?.deliveredAt).not.toBeNull()
  })

  it('does not regress state when an out-of-order delivered event follows a read event', async () => {
    const restaurant = await createRestaurant(`wh-out-of-order-${Date.now()}@example.com`)
    const order = await createOrder(restaurant.id)
    const providerMessageId = 'wamid-e2e-out-of-order'
    await createSentAttempt(order.id, providerMessageId)

    const read = await postWebhook(messageStatusPayload(providerMessageId, 'read'))
    expect(read.status).toBe(200)

    const delivered = await postWebhook(messageStatusPayload(providerMessageId, 'delivered'))
    expect(delivered.status).toBe(200)

    const attempt = await prisma.notificationAttempt.findUnique({ where: { providerMessageId } })
    expect(attempt?.jobStatus).toBe('READ')
    expect(attempt?.readAt).not.toBeNull()
    expect(attempt?.deliveredAt).toBeNull()
  })

  it('processes a duplicate delivered event idempotently', async () => {
    const restaurant = await createRestaurant(`wh-duplicate-${Date.now()}@example.com`)
    const order = await createOrder(restaurant.id)
    const providerMessageId = 'wamid-e2e-duplicate'
    await createSentAttempt(order.id, providerMessageId)

    const first = await postWebhook(messageStatusPayload(providerMessageId, 'delivered'))
    expect(first.status).toBe(200)

    const second = await postWebhook(messageStatusPayload(providerMessageId, 'delivered'))
    expect(second.status).toBe(200)

    const attempt = await prisma.notificationAttempt.findUnique({ where: { providerMessageId } })
    expect(attempt?.jobStatus).toBe('DELIVERED')
    const attempts = await prisma.notificationAttempt.count({ where: { providerMessageId } })
    expect(attempts).toBe(1)
  })

  it('does not regress state when a duplicate read event is replayed', async () => {
    const restaurant = await createRestaurant(`wh-dup-read-${Date.now()}@example.com`)
    const order = await createOrder(restaurant.id)
    const providerMessageId = 'wamid-e2e-dup-read'
    await createSentAttempt(order.id, providerMessageId)

    const first = await postWebhook(messageStatusPayload(providerMessageId, 'read'))
    expect(first.status).toBe(200)
    const readAtAfterFirst = (
      await prisma.notificationAttempt.findUnique({ where: { providerMessageId } })
    )?.readAt

    const second = await postWebhook(messageStatusPayload(providerMessageId, 'read'))
    expect(second.status).toBe(200)

    const attempt = await prisma.notificationAttempt.findUnique({ where: { providerMessageId } })
    expect(attempt?.jobStatus).toBe('READ')
    expect(attempt?.readAt?.toISOString()).toBe(readAtAfterFirst?.toISOString())
  })

  it('does not change state when a sent event arrives for an already-sent attempt', async () => {
    const restaurant = await createRestaurant(`wh-sent-ack-${Date.now()}@example.com`)
    const order = await createOrder(restaurant.id)
    const providerMessageId = 'wamid-e2e-sent-ack'
    await createSentAttempt(order.id, providerMessageId)

    const res = await postWebhook(messageStatusPayload(providerMessageId, 'sent'))
    expect(res.status).toBe(200)

    const attempt = await prisma.notificationAttempt.findUnique({ where: { providerMessageId } })
    expect(attempt?.jobStatus).toBe('SENT')
    expect(attempt?.deliveredAt).toBeNull()
  })

  it('logs a failure event without changing state', async () => {
    const restaurant = await createRestaurant(`wh-failed-${Date.now()}@example.com`)
    const order = await createOrder(restaurant.id)
    const providerMessageId = 'wamid-e2e-failed'
    await createSentAttempt(order.id, providerMessageId)

    const res = await postWebhook(messageStatusPayload(providerMessageId, 'failed'))
    expect(res.status).toBe(200)

    const attempt = await prisma.notificationAttempt.findUnique({ where: { providerMessageId } })
    expect(attempt?.jobStatus).toBe('SENT')
    expect(attempt?.failedAt).toBeNull()
  })

  it('safely ignores events for an unknown provider message id and returns 200', async () => {
    const res = await postWebhook(messageStatusPayload('wamid-unknown-attempt', 'delivered'))
    expect(res.status).toBe(200)

    const matches = await prisma.notificationAttempt.findMany({
      where: { providerMessageId: 'wamid-unknown-attempt' },
    })
    expect(matches).toHaveLength(0)
  })

  it('safely ignores events for a deactivated restaurant', async () => {
    const restaurant = await createRestaurant(`wh-deactivated-${Date.now()}@example.com`, 'DEACTIVATED')
    const order = await createOrder(restaurant.id)
    const providerMessageId = 'wamid-e2e-deactivated'
    await createSentAttempt(order.id, providerMessageId)

    const res = await postWebhook(messageStatusPayload(providerMessageId, 'delivered'))
    expect(res.status).toBe(200)

    const attempt = await prisma.notificationAttempt.findUnique({ where: { providerMessageId } })
    expect(attempt?.jobStatus).toBe('SENT')
    expect(attempt?.deliveredAt).toBeNull()
  })

  it('safely ignores events for a disconnected connection', async () => {
    const restaurant = await createRestaurant(`wh-disconnected-${Date.now()}@example.com`)
    await prisma.whatsAppConnection.create({
      data: {
        restaurantId: restaurant.id,
        phoneNumberId: '1226137183925646',
        connectionStatus: 'DISCONNECTED',
      },
    })
    const order = await createOrder(restaurant.id)
    const providerMessageId = 'wamid-e2e-disconnected'
    await createSentAttempt(order.id, providerMessageId)

    const res = await postWebhook(messageStatusPayload(providerMessageId, 'delivered'))
    expect(res.status).toBe(200)

    const attempt = await prisma.notificationAttempt.findUnique({ where: { providerMessageId } })
    expect(attempt?.jobStatus).toBe('SENT')
    expect(attempt?.deliveredAt).toBeNull()
  })

  it('safely ignores events whose phone number does not match the connection', async () => {
    const restaurant = await createRestaurant(`wh-mismatch-${Date.now()}@example.com`)
    await prisma.whatsAppConnection.create({
      data: {
        restaurantId: restaurant.id,
        phoneNumberId: 'different-phone-number-id',
        connectionStatus: 'CONNECTED',
      },
    })
    const order = await createOrder(restaurant.id)
    const providerMessageId = 'wamid-e2e-mismatch'
    await createSentAttempt(order.id, providerMessageId)

    const res = await postWebhook(messageStatusPayload(providerMessageId, 'delivered'))
    expect(res.status).toBe(200)

    const attempt = await prisma.notificationAttempt.findUnique({ where: { providerMessageId } })
    expect(attempt?.jobStatus).toBe('SENT')
    expect(attempt?.deliveredAt).toBeNull()
  })

  it('acknowledges a validly signed payload with no message_status entries', async () => {
    const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] })
    const res = await postWebhook(body)
    expect(res.status).toBe(200)
  })

  it('rejects a validly signed but non-JSON body with 400', async () => {
    const bodyText = 'not-json'
    const res = await request(app)
      .post('/webhook')
      .set('X-Hub-Signature-256', signBody(bodyText))
      .set('Content-Type', 'application/json')
      .send(bodyText)
    expect(res.status).toBe(400)
  })
})