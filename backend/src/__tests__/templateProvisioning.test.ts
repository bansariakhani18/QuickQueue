import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { vi } from 'vitest'
import {
  provisionRestaurantWhatsAppTemplate,
  TemplateProvisioningError,
} from '../connections.js'
import {
  submitWhatsAppTemplateProvisioning,
  getTemplateIdentifierFromEnv,
  TemplateProvisioningUnavailableError,
} from '../whatsappClient.js'
import { encryptToken, TOKEN_ENCRYPTION_KEY_ENV } from '../crypto.js'
import { WhatsAppSenderUnavailableError } from '../processor.js'

vi.mock('../whatsappClient.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../whatsappClient.js')>()
  return {
    ...actual,
    submitWhatsAppTemplateProvisioning: vi.fn(),
  }
})

const prisma = new PrismaClient()

const TEMPLATE_NAME = 'quickqueue_order_ready_v1'
const TEMPLATE_LANGUAGE = 'en_US'
const API_VERSION = 'v21.0'

const ENV_KEYS = [
  TOKEN_ENCRYPTION_KEY_ENV,
  'WHATSAPP_API_VERSION',
  'WHATSAPP_TEMPLATE_NAME',
  'WHATSAPP_TEMPLATE_LANGUAGE',
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
] as const

const originalEnv: Record<string, string | undefined> = {}

async function createRestaurant(email: string) {
  return prisma.restaurant.create({
    data: { name: 'Template Test', email, passwordHash: 'hash' },
  })
}

async function createConnection(
  restaurantId: string,
  fields: { wabaId?: string | null; phoneNumberId?: string | null; token?: string | null },
) {
  return prisma.whatsAppConnection.create({
    data: {
      restaurantId,
      wabaId: fields.wabaId ?? null,
      phoneNumberId: fields.phoneNumberId ?? null,
      accessTokenEncrypted: fields.token === undefined || fields.token === null ? null : encryptToken(fields.token),
      connectionStatus: 'CONNECTED',
      connectedAt: new Date(),
    },
  })
}

async function cleanup(restaurant: { id: string }, connection?: { id: string }) {
  if (connection) {
    await prisma.whatsAppConnection.delete({ where: { id: connection.id } })
  }
  await prisma.restaurant.delete({ where: { id: restaurant.id } })
}

describe('Template provisioning orchestration (Phase 15 step 5, FR-045)', () => {
  beforeAll(async () => {
    for (const key of ENV_KEYS) {
      originalEnv[key] = process.env[key]
    }
    process.env[TOKEN_ENCRYPTION_KEY_ENV] = 'QuickQueue-phase-15-step-5-test-encryption-key-0005'
    process.env.WHATSAPP_API_VERSION = API_VERSION
    process.env.WHATSAPP_TEMPLATE_NAME = TEMPLATE_NAME
    process.env.WHATSAPP_TEMPLATE_LANGUAGE = TEMPLATE_LANGUAGE
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
    vi.mocked(submitWhatsAppTemplateProvisioning).mockReset()
    vi.mocked(submitWhatsAppTemplateProvisioning).mockResolvedValue({ status: 'PROVISIONED' })
  })

  it('builds the env-derived template identifier from the preserved env conventions', () => {
    expect(getTemplateIdentifierFromEnv()).toBe(`${TEMPLATE_NAME}|${TEMPLATE_LANGUAGE}|${API_VERSION}`)

    const original = process.env.WHATSAPP_TEMPLATE_NAME
    delete process.env.WHATSAPP_TEMPLATE_NAME
    expect(getTemplateIdentifierFromEnv()).toBeNull()
    process.env.WHATSAPP_TEMPLATE_NAME = original as string
  })

  it('uses the restaurant\'s own WABA/token and the configured template identity', async () => {
    const restaurant = await createRestaurant(`tp-a-${Date.now()}@ex.com`)
    const connection = await createConnection(restaurant.id, {
      wabaId: 'WABA-TP-A',
      phoneNumberId: 'PHONE-TP-A',
      token: 'EAAX-template-provisioning-a-secret',
    })

    const result = await provisionRestaurantWhatsAppTemplate(restaurant.id)

    expect(result.status).toBe('PROVISIONED')
    expect(submitWhatsAppTemplateProvisioning).toHaveBeenCalledTimes(1)
    expect(submitWhatsAppTemplateProvisioning).toHaveBeenCalledWith({
      apiVersion: API_VERSION,
      wabaId: 'WABA-TP-A',
      accessToken: 'EAAX-template-provisioning-a-secret',
      templateName: TEMPLATE_NAME,
      templateLanguage: TEMPLATE_LANGUAGE,
    })

    await cleanup(restaurant, connection)
  })

  it('isolates restaurants: A provisions only against A\'s WABA/token', async () => {
    const restaurantA = await createRestaurant(`tp-iso-a-${Date.now()}@ex.com`)
    const connectionA = await createConnection(restaurantA.id, {
      wabaId: 'WABA-TP-A1',
      phoneNumberId: 'PHONE-TP-A1',
      token: 'EAAX-secret-a',
    })
    const restaurantB = await createRestaurant(`tp-iso-b-${Date.now()}@ex.com`)
    const connectionB = await createConnection(restaurantB.id, {
      wabaId: 'WABA-TP-B1',
      phoneNumberId: 'PHONE-TP-B1',
      token: 'EAAX-secret-b',
    })

    const outcome = await provisionRestaurantWhatsAppTemplate(restaurantA.id)

    expect(outcome.status).toBe('PROVISIONED')
    expect(submitWhatsAppTemplateProvisioning).toHaveBeenCalledTimes(1)
    expect(submitWhatsAppTemplateProvisioning).toHaveBeenCalledWith(
      expect.objectContaining({ wabaId: 'WABA-TP-A1', accessToken: 'EAAX-secret-a' }),
    )
    expect(submitWhatsAppTemplateProvisioning).not.toHaveBeenCalledWith(
      expect.objectContaining({ wabaId: 'WABA-TP-B1', accessToken: 'EAAX-secret-b' }),
    )

    await cleanup(restaurantA, connectionA)
    await cleanup(restaurantB, connectionB)
  })

  it('does not use global WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID', async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = 'ENV-TOKEN-MUST-NOT-BE-USED'
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'ENV-PHONE-MUST-NOT-BE-USED'
    try {
      const restaurant = await createRestaurant(`tp-env-${Date.now()}@ex.com`)
      const connection = await createConnection(restaurant.id, {
        wabaId: 'WABA-TP-ENV',
        phoneNumberId: 'PHONE-TP-ENV',
        token: 'EAAX-connection-token',
      })

      await provisionRestaurantWhatsAppTemplate(restaurant.id)

      expect(submitWhatsAppTemplateProvisioning).toHaveBeenCalledWith(
        expect.objectContaining({ wabaId: 'WABA-TP-ENV', accessToken: 'EAAX-connection-token' }),
      )
      expect(submitWhatsAppTemplateProvisioning).not.toHaveBeenCalledWith(
        expect.objectContaining({ accessToken: 'ENV-TOKEN-MUST-NOT-BE-USED' }),
      )

      await cleanup(restaurant, connection)
    } finally {
      delete process.env.WHATSAPP_ACCESS_TOKEN
      delete process.env.WHATSAPP_PHONE_NUMBER_ID
    }
  })

  it('does not claim provisioning when the Meta boundary reports failure or rejection', async () => {
    const restaurant = await createRestaurant(`tp-reject-${Date.now()}@ex.com`)
    const connection = await createConnection(restaurant.id, {
      wabaId: 'WABA-TP-REJ',
      phoneNumberId: 'PHONE-TP-REJ',
      token: 'EAAX-reject-token',
    })

    vi.mocked(submitWhatsAppTemplateProvisioning).mockResolvedValue({ status: 'NOT_PROVISIONED' })

    const outcome = await provisionRestaurantWhatsAppTemplate(restaurant.id)

    expect(outcome.status).toBe('NOT_PROVISIONED')
    expect(JSON.stringify(outcome)).not.toContain('EAAX')

    const row = await prisma.whatsAppConnection.findUnique({ where: { restaurantId: restaurant.id } })
    expect(row!.connectionStatus).toBe('CONNECTED')

    await cleanup(restaurant, connection)
  })

  it('never claims provisioning when the Meta boundary is unavailable', async () => {
    const restaurant = await createRestaurant(`tp-unavail-${Date.now()}@ex.com`)
    const connection = await createConnection(restaurant.id, {
      wabaId: 'WABA-TP-UNA',
      phoneNumberId: 'PHONE-TP-UNA',
      token: 'EAAX-unavailable-token',
    })

    vi.mocked(submitWhatsAppTemplateProvisioning).mockRejectedValue(
      new TemplateProvisioningUnavailableError(),
    )

    await expect(provisionRestaurantWhatsAppTemplate(restaurant.id)).rejects.toBeInstanceOf(
      TemplateProvisioningUnavailableError,
    )

    await cleanup(restaurant, connection)
  })

  it('is idempotent: repeated provisioning does not duplicate or error', async () => {
    const restaurant = await createRestaurant(`tp-idem-${Date.now()}@ex.com`)
    const connection = await createConnection(restaurant.id, {
      wabaId: 'WABA-TP-IDEM',
      phoneNumberId: 'PHONE-TP-IDEM',
      token: 'EAAX-idem-token',
    })

    const first = await provisionRestaurantWhatsAppTemplate(restaurant.id)
    const second = await provisionRestaurantWhatsAppTemplate(restaurant.id)

    expect(first.status).toBe('PROVISIONED')
    expect(second.status).toBe('PROVISIONED')
    expect(submitWhatsAppTemplateProvisioning).toHaveBeenCalledTimes(2)

    const rows = await prisma.whatsAppConnection.findMany({ where: { restaurantId: restaurant.id } })
    expect(rows).toHaveLength(1)

    await cleanup(restaurant, connection)
  })

  it('fails safely when the restaurant has no connection', async () => {
    const restaurant = await createRestaurant(`tp-noconn-${Date.now()}@ex.com`)

    await expect(provisionRestaurantWhatsAppTemplate(restaurant.id)).rejects.toBeInstanceOf(
      WhatsAppSenderUnavailableError,
    )
    await expect(provisionRestaurantWhatsAppTemplate(restaurant.id)).rejects.toMatchObject({
      code: 'CONNECTION_NOT_FOUND',
    })
    expect(submitWhatsAppTemplateProvisioning).not.toHaveBeenCalled()

    await cleanup(restaurant)
  })

  it('fails safely when the decrypted token cannot be recovered and never leaks it', async () => {
    const restaurant = await createRestaurant(`tp-badtoken-${Date.now()}@ex.com`)
    const connection = await prisma.whatsAppConnection.create({
      data: {
        restaurantId: restaurant.id,
        wabaId: 'WABA-TP-BAD',
        phoneNumberId: 'PHONE-TP-BAD',
        accessTokenEncrypted: 'not-an-encrypted-token',
        connectionStatus: 'CONNECTED',
        connectedAt: new Date(),
      },
    })

    await expect(provisionRestaurantWhatsAppTemplate(restaurant.id)).rejects.toMatchObject({
      code: 'TOKEN_DECRYPTION_FAILED',
    })

    try {
      await provisionRestaurantWhatsAppTemplate(restaurant.id)
    } catch (err) {
      expect((err as Error).message).not.toContain('not-an-encrypted-token')
    }
    expect(submitWhatsAppTemplateProvisioning).not.toHaveBeenCalled()

    await cleanup(restaurant, connection)
  })

  it('fails safely when the connection has no WABA ID', async () => {
    const restaurant = await createRestaurant(`tp-nowaba-${Date.now()}@ex.com`)
    const connection = await createConnection(restaurant.id, {
      phoneNumberId: 'PHONE-TP-NOWABA',
      token: 'EAAX-nowaba-token',
    })

    await expect(provisionRestaurantWhatsAppTemplate(restaurant.id)).rejects.toBeInstanceOf(
      TemplateProvisioningError,
    )
    expect(submitWhatsAppTemplateProvisioning).not.toHaveBeenCalled()

    await cleanup(restaurant, connection)
  })
})