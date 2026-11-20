import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { vi } from 'vitest'
import {
  claimAndProcessOne,
  createRestaurantAwareWhatsAppSender,
  classifySendError,
  clearSendFailurePredicate,
  setNotificationSender,
  WhatsAppSenderUnavailableError,
} from '../processor.js'
import { sendWhatsAppTemplate, WhatsAppApiError } from '../whatsappClient.js'
import { encryptToken, TOKEN_ENCRYPTION_KEY_ENV } from '../crypto.js'

vi.mock('../whatsappClient.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../whatsappClient.js')>()
  return {
    ...actual,
    sendWhatsAppTemplate: vi.fn(),
  }
})

const prisma = new PrismaClient()

const TEMPLATE_NAME = 'jaspers_market_plain_text_v1'
const TEMPLATE_LANGUAGE = 'en_US'
const API_VERSION = 'v21.0'

const ENV_KEYS = [
  TOKEN_ENCRYPTION_KEY_ENV,
  'WHATSAPP_TEMPLATE_NAME',
  'WHATSAPP_TEMPLATE_LANGUAGE',
  'WHATSAPP_API_VERSION',
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
] as const

const originalEnv: Record<string, string | undefined> = {}

async function createRestaurant(email: string) {
  return prisma.restaurant.create({
    data: {
      name: `Restaurant Sender ${email}`,
      email,
      passwordHash: 'hash',
    },
  })
}

async function createOrder(restaurantId: string, phone: string) {
  return prisma.order.create({
    data: {
      restaurantId,
      displayToken: `rs-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      customerPhone: phone,
      consentGiven: true,
      consentMethod: 'VERBAL_STAFF_CONFIRMED',
      status: 'READY',
    },
  })
}

async function createAttempt(orderId: string) {
  return prisma.notificationAttempt.create({
    data: {
      orderId,
      attemptNumber: 1,
      channel: 'WHATSAPP',
      jobStatus: 'PENDING',
    },
  })
}

async function createConnection(
  restaurantId: string,
  fields: { phoneNumberId?: string | null; token?: string | null; status?: 'CONNECTED' | 'DISCONNECTED' | 'PENDING' },
) {
  return prisma.whatsAppConnection.create({
    data: {
      restaurantId,
      phoneNumberId: fields.phoneNumberId ?? null,
      accessTokenEncrypted: fields.token === undefined || fields.token === null ? null : encryptToken(fields.token),
      connectionStatus: fields.status ?? 'CONNECTED',
      connectedAt: fields.status === 'CONNECTED' ? new Date() : null,
    },
  })
}

async function cleanup(
  restaurant: { id: string },
  order?: { id: string },
  connection?: { id: string },
) {
  if (connection) {
    await prisma.whatsAppConnection.delete({ where: { id: connection.id } })
  }
  if (order) {
    await prisma.order.delete({ where: { id: order.id } })
  }
  await prisma.restaurant.delete({ where: { id: restaurant.id } })
}

describe('Per-restaurant WhatsApp sender (Phase 15 step 3)', () => {
  beforeAll(async () => {
    for (const key of ENV_KEYS) {
      originalEnv[key] = process.env[key]
    }
    process.env[TOKEN_ENCRYPTION_KEY_ENV] = 'QuickQueue-phase-15-step-3-test-encryption-key-0003'
    process.env.WHATSAPP_TEMPLATE_NAME = TEMPLATE_NAME
    process.env.WHATSAPP_TEMPLATE_LANGUAGE = TEMPLATE_LANGUAGE
    process.env.WHATSAPP_API_VERSION = API_VERSION
    delete process.env.WHATSAPP_ACCESS_TOKEN
    delete process.env.WHATSAPP_PHONE_NUMBER_ID
    await prisma.$connect()
  })

  afterAll(async () => {
    for (const key of ENV_KEYS) {
      const original = originalEnv[key]
      if (original === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = original
      }
    }
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    clearSendFailurePredicate()
    setNotificationSender(createRestaurantAwareWhatsAppSender())
    vi.mocked(sendWhatsAppTemplate).mockReset()
    vi.mocked(sendWhatsAppTemplate).mockResolvedValue({ providerMessageId: 'wamid.test.default' })
    await prisma.notificationAttempt.deleteMany({ where: { jobStatus: { in: ['PENDING', 'PROCESSING'] } } })
  })

  it('uses restaurant A\'s own phone number ID and decrypted token and persists the provider message ID', async () => {
    const restaurant = await createRestaurant(`rs-a-${Date.now()}@ex.com`)
    const connection = await createConnection(restaurant.id, { phoneNumberId: '1226137183925646', token: 'EAAXtest-restaurant-a-secret' })
    const order = await createOrder(restaurant.id, '+14155558001')
    const attempt = await createAttempt(order.id)

    vi.mocked(sendWhatsAppTemplate).mockResolvedValue({ providerMessageId: 'wamid.test.aaa111' })

    expect(await claimAndProcessOne()).toBe(true)

    const a = await prisma.notificationAttempt.findUnique({ where: { id: attempt.id } })
    expect(a!.jobStatus).toBe('SENT')
    expect(a!.providerMessageId).toBe('wamid.test.aaa111')
    expect(a!.errorCode).toBeNull()
    expect(a!.errorMessage).toBeNull()

    expect(sendWhatsAppTemplate).toHaveBeenCalledTimes(1)
    expect(sendWhatsAppTemplate).toHaveBeenCalledWith(
      {
        phoneNumberId: '1226137183925646',
        accessToken: 'EAAXtest-restaurant-a-secret',
        templateName: TEMPLATE_NAME,
        templateLanguage: TEMPLATE_LANGUAGE,
        apiVersion: API_VERSION,
      },
      {
        to: '+14155558001',
        bodyParameters: [order.displayToken, restaurant.name],
      },
    )

    await cleanup(restaurant, order, connection)
  })

  it('uses restaurant B\'s own credentials (no cross-tenant credential use)', async () => {
    const restaurant = await createRestaurant(`rs-b-${Date.now()}@ex.com`)
    const connection = await createConnection(restaurant.id, { phoneNumberId: '1555123456789', token: 'EAAXtest-restaurant-b-secret' })
    const order = await createOrder(restaurant.id, '+14155558002')
    const attempt = await createAttempt(order.id)

    vi.mocked(sendWhatsAppTemplate).mockResolvedValue({ providerMessageId: 'wamid.test.bbb222' })

    expect(await claimAndProcessOne()).toBe(true)

    const a = await prisma.notificationAttempt.findUnique({ where: { id: attempt.id } })
    expect(a!.jobStatus).toBe('SENT')
    expect(a!.providerMessageId).toBe('wamid.test.bbb222')

    expect(sendWhatsAppTemplate).toHaveBeenCalledWith(
      {
        phoneNumberId: '1555123456789',
        accessToken: 'EAAXtest-restaurant-b-secret',
        templateName: TEMPLATE_NAME,
        templateLanguage: TEMPLATE_LANGUAGE,
        apiVersion: API_VERSION,
      },
      {
        to: '+14155558002',
        bodyParameters: [order.displayToken, restaurant.name],
      },
    )
    expect(sendWhatsAppTemplate).not.toHaveBeenCalledWith(
      expect.objectContaining({ phoneNumberId: '1226137183925646', accessToken: 'EAAXtest-restaurant-a-secret' }),
      expect.anything(),
    )

    await cleanup(restaurant, order, connection)
  })

  it('does not use global WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID', async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = 'ENV-SECRET-TOKEN-MUST-NOT-BE-USED'
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'ENV-PHONE-MUST-NOT-BE-USED'
    try {
      const restaurant = await createRestaurant(`rs-env-${Date.now()}@ex.com`)
      const connection = await createConnection(restaurant.id, { phoneNumberId: '1999888777666', token: 'EAAXtest-connection-token' })
      const order = await createOrder(restaurant.id, '+14155558003')
      const attempt = await createAttempt(order.id)

      vi.mocked(sendWhatsAppTemplate).mockResolvedValue({ providerMessageId: 'wamid.test.env000' })

      expect(await claimAndProcessOne()).toBe(true)

      const a = await prisma.notificationAttempt.findUnique({ where: { id: attempt.id } })
      expect(a!.jobStatus).toBe('SENT')

      expect(sendWhatsAppTemplate).toHaveBeenCalledWith(
        expect.objectContaining({
          phoneNumberId: '1999888777666',
          accessToken: 'EAAXtest-connection-token',
        }),
        expect.objectContaining({ to: '+14155558003' }),
      )
      expect(sendWhatsAppTemplate).not.toHaveBeenCalledWith(
        expect.objectContaining({ phoneNumberId: 'ENV-PHONE-MUST-NOT-BE-USED', accessToken: 'ENV-SECRET-TOKEN-MUST-NOT-BE-USED' }),
        expect.anything(),
      )

      await cleanup(restaurant, order, connection)
    } finally {
      delete process.env.WHATSAPP_ACCESS_TOKEN
      delete process.env.WHATSAPP_PHONE_NUMBER_ID
    }
  })

  it('fails safely (permanent, no retry) when the restaurant has no connection', async () => {
    const restaurant = await createRestaurant(`rs-missing-${Date.now()}@ex.com`)
    const order = await createOrder(restaurant.id, '+14155558004')
    const attempt = await createAttempt(order.id)

    expect(await claimAndProcessOne()).toBe(true)

    const a = await prisma.notificationAttempt.findUnique({ where: { id: attempt.id } })
    expect(a!.jobStatus).toBe('FAILED')
    expect(a!.retryCount).toBe(0)
    expect(a!.failedAt).not.toBeNull()
    expect(a!.errorCode).toBe('CONNECTION_NOT_FOUND')
    expect(sendWhatsAppTemplate).not.toHaveBeenCalled()

    expect(await claimAndProcessOne()).toBe(false)

    await cleanup(restaurant, order)
  })

  it('fails safely when the connection is DISCONNECTED', async () => {
    const restaurant = await createRestaurant(`rs-disc-${Date.now()}@ex.com`)
    const connection = await createConnection(restaurant.id, { phoneNumberId: '1226137183925646', token: 'EAAXtest-token', status: 'DISCONNECTED' })
    const order = await createOrder(restaurant.id, '+14155558005')
    const attempt = await createAttempt(order.id)

    expect(await claimAndProcessOne()).toBe(true)

    const a = await prisma.notificationAttempt.findUnique({ where: { id: attempt.id } })
    expect(a!.jobStatus).toBe('FAILED')
    expect(a!.retryCount).toBe(0)
    expect(a!.errorCode).toBe('CONNECTION_DISCONNECTED')
    expect(sendWhatsAppTemplate).not.toHaveBeenCalled()

    await cleanup(restaurant, order, connection)
  })

  it('fails safely when the connection is not yet CONNECTED', async () => {
    const restaurant = await createRestaurant(`rs-pending-${Date.now()}@ex.com`)
    const connection = await createConnection(restaurant.id, { phoneNumberId: '1226137183925646', token: 'EAAXtest-token', status: 'PENDING' })
    const order = await createOrder(restaurant.id, '+14155558006')
    const attempt = await createAttempt(order.id)

    expect(await claimAndProcessOne()).toBe(true)

    const a = await prisma.notificationAttempt.findUnique({ where: { id: attempt.id } })
    expect(a!.jobStatus).toBe('FAILED')
    expect(a!.retryCount).toBe(0)
    expect(a!.errorCode).toBe('CONNECTION_NOT_CONNECTED')
    expect(sendWhatsAppTemplate).not.toHaveBeenCalled()

    await cleanup(restaurant, order, connection)
  })

  it('fails safely when the encrypted token is missing', async () => {
    const restaurant = await createRestaurant(`rs-notoken-${Date.now()}@ex.com`)
    const connection = await createConnection(restaurant.id, { phoneNumberId: '1226137183925646', token: null })
    const order = await createOrder(restaurant.id, '+14155558007')
    const attempt = await createAttempt(order.id)

    expect(await claimAndProcessOne()).toBe(true)

    const a = await prisma.notificationAttempt.findUnique({ where: { id: attempt.id } })
    expect(a!.jobStatus).toBe('FAILED')
    expect(a!.retryCount).toBe(0)
    expect(a!.errorCode).toBe('MISSING_ENCRYPTED_TOKEN')
    expect(a!.errorMessage).not.toContain('EAAX')
    expect(sendWhatsAppTemplate).not.toHaveBeenCalled()

    await cleanup(restaurant, order, connection)
  })

  it('fails safely when the encrypted token cannot be decrypted', async () => {
    const restaurant = await createRestaurant(`rs-badtoken-${Date.now()}@ex.com`)
    const connection = await prisma.whatsAppConnection.create({
      data: {
        restaurantId: restaurant.id,
        phoneNumberId: '1226137183925646',
        accessTokenEncrypted: 'not-an-encrypted-token',
        connectionStatus: 'CONNECTED',
        connectedAt: new Date(),
      },
    })
    const order = await createOrder(restaurant.id, '+14155558008')
    const attempt = await createAttempt(order.id)

    expect(await claimAndProcessOne()).toBe(true)

    const a = await prisma.notificationAttempt.findUnique({ where: { id: attempt.id } })
    expect(a!.jobStatus).toBe('FAILED')
    expect(a!.retryCount).toBe(0)
    expect(a!.errorCode).toBe('TOKEN_DECRYPTION_FAILED')
    expect(a!.errorMessage).not.toContain('not-an-encrypted-token')
    expect(sendWhatsAppTemplate).not.toHaveBeenCalled()

    await cleanup(restaurant, order, connection)
  })

  it('still retries transient WhatsApp API errors through the restaurant-aware path', async () => {
    const restaurant = await createRestaurant(`rs-transient-${Date.now()}@ex.com`)
    const connection = await createConnection(restaurant.id, { phoneNumberId: '1226137183925646', token: 'EAAXtest-token' })
    const order = await createOrder(restaurant.id, '+14155558009')
    const attempt = await createAttempt(order.id)

    vi.mocked(sendWhatsAppTemplate).mockRejectedValue(
      new WhatsAppApiError('WhatsApp Cloud API returned HTTP 500', {
        status: 500,
        meta: { message: 'An internal server error occurred', code: 578 },
      }),
    )

    expect(await claimAndProcessOne()).toBe(true)

    const a = await prisma.notificationAttempt.findUnique({ where: { id: attempt.id } })
    expect(a!.jobStatus).toBe('PENDING')
    expect(a!.retryCount).toBe(1)
    expect(a!.errorCode).toBe('HTTP_500')
    expect(a!.errorMessage).toContain('An internal server error occurred')

    await cleanup(restaurant, order, connection)
  })

  it('classifies connection/decryption failures as permanent with a clear code', () => {
    const info = classifySendError(
      new WhatsAppSenderUnavailableError('TOKEN_DECRYPTION_FAILED', 'Failed to decrypt WhatsApp access token'),
    )
    expect(info.kind).toBe('permanent')
    expect(info.errorCode).toBe('TOKEN_DECRYPTION_FAILED')
  })
})