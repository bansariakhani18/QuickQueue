import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { vi } from 'vitest'
import {
  buildRequestedWhatsAppDisplayName,
  registerWhatsAppDisplayName,
  DisplayNameRegistrationError,
} from '../connections.js'
import {
  submitWhatsAppDisplayName,
  DisplayNameRegistrationUnavailableError,
} from '../whatsappClient.js'
import { encryptToken, TOKEN_ENCRYPTION_KEY_ENV } from '../crypto.js'
import { WhatsAppSenderUnavailableError } from '../processor.js'

vi.mock('../whatsappClient.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../whatsappClient.js')>()
  return {
    ...actual,
    submitWhatsAppDisplayName: vi.fn(),
  }
})

const prisma = new PrismaClient()

const ENV_KEYS = [
  TOKEN_ENCRYPTION_KEY_ENV,
  'WHATSAPP_API_VERSION',
  'WHATSAPP_TEMPLATE_NAME',
  'WHATSAPP_TEMPLATE_LANGUAGE',
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
] as const

const originalEnv: Record<string, string | undefined> = {}

async function createRestaurant(email: string, name: string) {
  return prisma.restaurant.create({
    data: { name, email, passwordHash: 'hash' },
  })
}

async function createConnection(
  restaurantId: string,
  fields: { wabaId?: string; phoneNumberId?: string; token?: string; approvedDisplayName?: string | null },
) {
  return prisma.whatsAppConnection.create({
    data: {
      restaurantId,
      wabaId: fields.wabaId ?? null,
      phoneNumberId: fields.phoneNumberId ?? null,
      approvedDisplayName: fields.approvedDisplayName ?? null,
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

describe('WhatsApp display-name registration (Phase 15 step 4)', () => {
  beforeAll(async () => {
    for (const key of ENV_KEYS) {
      originalEnv[key] = process.env[key]
    }
    process.env[TOKEN_ENCRYPTION_KEY_ENV] = 'QuickQueue-phase-15-step-4-test-encryption-key-0004'
    process.env.WHATSAPP_API_VERSION = 'v21.0'
    process.env.WHATSAPP_TEMPLATE_NAME = 'jaspers_market_plain_text_v1'
    process.env.WHATSAPP_TEMPLATE_LANGUAGE = 'en_US'
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
    vi.mocked(submitWhatsAppDisplayName).mockReset()
    vi.mocked(submitWhatsAppDisplayName).mockResolvedValue({
      status: 'APPROVED',
      approvedDisplayName: 'Restaurant via QuickQueue',
    })
  })

  it('builds the exact combined display name and trims whitespace', () => {
    expect(buildRequestedWhatsAppDisplayName('Pizza Palace')).toBe('Pizza Palace via QuickQueue')
    expect(buildRequestedWhatsAppDisplayName('  Pizza Palace  ')).toBe('Pizza Palace via QuickQueue')
    expect(() => buildRequestedWhatsAppDisplayName('')).toThrow()
    expect(() => buildRequestedWhatsAppDisplayName('   ')).toThrow()
  })

  it('submits with the restaurant\'s own WABA credentials and persists the approved combined name', async () => {
    const restaurant = await createRestaurant(`dn-a-${Date.now()}@ex.com`, 'Pizza Palace')
    const connection = await createConnection(restaurant.id, {
      wabaId: 'WABA-A-111',
      phoneNumberId: 'PHONE-A-111',
      token: 'EAAX-display-name-restaurant-a-secret',
    })

    vi.mocked(submitWhatsAppDisplayName).mockResolvedValue({
      status: 'APPROVED',
      approvedDisplayName: 'Pizza Palace via QuickQueue',
    })

    const result = await registerWhatsAppDisplayName(restaurant.id)

    expect(result.status).toBe('APPROVED')
    if (result.status !== 'APPROVED') {
      throw new Error('expected APPROVED result')
    }
    expect(result.approvedDisplayName).toBe('Pizza Palace via QuickQueue')
    expect(result.requestedDisplayName).toBe('Pizza Palace via QuickQueue')

    const row = await prisma.whatsAppConnection.findUnique({ where: { restaurantId: restaurant.id } })
    expect(row!.approvedDisplayName).toBe('Pizza Palace via QuickQueue')

    expect(submitWhatsAppDisplayName).toHaveBeenCalledTimes(1)
    expect(submitWhatsAppDisplayName).toHaveBeenCalledWith({
      apiVersion: 'v21.0',
      wabaId: 'WABA-A-111',
      phoneNumberId: 'PHONE-A-111',
      accessToken: 'EAAX-display-name-restaurant-a-secret',
      requestedDisplayName: 'Pizza Palace via QuickQueue',
    })

    await cleanup(restaurant, connection)
  })

  it('falls back to the plain restaurant name when the combined name is rejected', async () => {
    const restaurant = await createRestaurant(`dn-b-${Date.now()}@ex.com`, 'Taco House')
    const connection = await createConnection(restaurant.id, {
      wabaId: 'WABA-B-222',
      phoneNumberId: 'PHONE-B-222',
      token: 'EAAX-display-name-restaurant-b-secret',
    })

    vi.mocked(submitWhatsAppDisplayName)
      .mockResolvedValueOnce({ status: 'REJECTED', rejectedDisplayName: 'Taco House via QuickQueue' })
      .mockResolvedValueOnce({ status: 'APPROVED', approvedDisplayName: 'Taco House' })

    const result = await registerWhatsAppDisplayName(restaurant.id)

    expect(result.status).toBe('APPROVED')
    if (result.status !== 'APPROVED') {
      throw new Error('expected APPROVED result')
    }
    expect(result.approvedDisplayName).toBe('Taco House')
    expect(result.requestedDisplayName).toBe('Taco House via QuickQueue')

    const row = await prisma.whatsAppConnection.findUnique({ where: { restaurantId: restaurant.id } })
    expect(row!.approvedDisplayName).toBe('Taco House')

    expect(submitWhatsAppDisplayName).toHaveBeenCalledTimes(2)
    expect(submitWhatsAppDisplayName).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ requestedDisplayName: 'Taco House' }),
    )

    await cleanup(restaurant, connection)
  })

  it('records no approval when both the combined and plain names are rejected', async () => {
    const restaurant = await createRestaurant(`dn-c-${Date.now()}@ex.com`, 'Sushi Spot')
    const connection = await createConnection(restaurant.id, {
      wabaId: 'WABA-C-333',
      phoneNumberId: 'PHONE-C-333',
      token: 'EAAX-display-name-restaurant-c-secret',
    })

    vi.mocked(submitWhatsAppDisplayName).mockResolvedValue({
      status: 'REJECTED',
      rejectedDisplayName: 'Sushi Spot via QuickQueue',
    })

    const result = await registerWhatsAppDisplayName(restaurant.id)

    expect(result.status).toBe('NO_APPROVAL')
    expect(result.approvedDisplayName).toBeNull()
    expect(submitWhatsAppDisplayName).toHaveBeenCalledTimes(2)

    const row = await prisma.whatsAppConnection.findUnique({ where: { restaurantId: restaurant.id } })
    expect(row!.approvedDisplayName).toBeNull()
    expect(JSON.stringify(result)).not.toContain('EAAX')

    await cleanup(restaurant, connection)
  })

  it('never claims approval when the Meta boundary is unavailable or fails', async () => {
    const restaurant = await createRestaurant(`dn-d-${Date.now()}@ex.com`, 'Burger Barn')
    const connection = await createConnection(restaurant.id, {
      wabaId: 'WABA-D-444',
      phoneNumberId: 'PHONE-D-444',
      token: 'EAAX-display-name-restaurant-d-secret',
    })

    vi.mocked(submitWhatsAppDisplayName).mockRejectedValue(
      new DisplayNameRegistrationUnavailableError(
        'Meta display-name registration contract is an unvalidated external dependency; no request issued',
      ),
    )

    await expect(registerWhatsAppDisplayName(restaurant.id)).rejects.toBeInstanceOf(
      DisplayNameRegistrationUnavailableError,
    )

    const row = await prisma.whatsAppConnection.findUnique({ where: { restaurantId: restaurant.id } })
    expect(row!.approvedDisplayName).toBeNull()

    await cleanup(restaurant, connection)
  })

  it('isolates restaurants: A is registered using only A\'s WABA credentials', async () => {
    const restaurantA = await createRestaurant(`dn-iso-a-${Date.now()}@ex.com`, 'Pizza A')
    const connectionA = await createConnection(restaurantA.id, {
      wabaId: 'WABA-ISO-A',
      phoneNumberId: 'PHONE-ISO-A',
      token: 'EAAX-secret-a',
    })
    const restaurantB = await createRestaurant(`dn-iso-b-${Date.now()}@ex.com`, 'Pizza B')
    const connectionB = await createConnection(restaurantB.id, {
      wabaId: 'WABA-ISO-B',
      phoneNumberId: 'PHONE-ISO-B',
      token: 'EAAX-secret-b',
    })

    const result = await registerWhatsAppDisplayName(restaurantA.id)

    expect(result.status).toBe('APPROVED')
    expect(submitWhatsAppDisplayName).toHaveBeenCalledTimes(1)
    expect(submitWhatsAppDisplayName).toHaveBeenCalledWith(
      expect.objectContaining({
        wabaId: 'WABA-ISO-A',
        phoneNumberId: 'PHONE-ISO-A',
        accessToken: 'EAAX-secret-a',
        requestedDisplayName: 'Pizza A via QuickQueue',
      }),
    )
    expect(submitWhatsAppDisplayName).not.toHaveBeenCalledWith(
      expect.objectContaining({
        wabaId: 'WABA-ISO-B',
        phoneNumberId: 'PHONE-ISO-B',
        accessToken: 'EAAX-secret-b',
      }),
    )

    await cleanup(restaurantA, connectionA)
    await cleanup(restaurantB, connectionB)
  })

  it('does not use global WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID', async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = 'ENV-TOKEN-MUST-NOT-BE-USED'
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'ENV-PHONE-MUST-NOT-BE-USED'
    try {
      const restaurant = await createRestaurant(`dn-env-${Date.now()}@ex.com`, 'Env Place')
      const connection = await createConnection(restaurant.id, {
        wabaId: 'WABA-ENV',
        phoneNumberId: 'PHONE-ENV',
        token: 'EAAX-connection-token',
      })

      await registerWhatsAppDisplayName(restaurant.id)

      expect(submitWhatsAppDisplayName).toHaveBeenCalledWith(
        expect.objectContaining({
          wabaId: 'WABA-ENV',
          phoneNumberId: 'PHONE-ENV',
          accessToken: 'EAAX-connection-token',
        }),
      )
      expect(submitWhatsAppDisplayName).not.toHaveBeenCalledWith(
        expect.objectContaining({
          phoneNumberId: 'ENV-PHONE-MUST-NOT-BE-USED',
          accessToken: 'ENV-TOKEN-MUST-NOT-BE-USED',
        }),
      )

      await cleanup(restaurant, connection)
    } finally {
      delete process.env.WHATSAPP_ACCESS_TOKEN
      delete process.env.WHATSAPP_PHONE_NUMBER_ID
    }
  })

  it('is idempotent: an already-approved row returns ALREADY_APPROVED without re-submitting', async () => {
    const restaurant = await createRestaurant(`dn-idem-${Date.now()}@ex.com`, 'Idem Cafe')
    const connection = await createConnection(restaurant.id, {
      wabaId: 'WABA-IDEM',
      phoneNumberId: 'PHONE-IDEM',
      token: 'EAAX-idem-token',
      approvedDisplayName: 'Idem Cafe via QuickQueue',
    })

    const result = await registerWhatsAppDisplayName(restaurant.id)

    expect(result.status).toBe('ALREADY_APPROVED')
    expect(result.approvedDisplayName).toBe('Idem Cafe via QuickQueue')
    expect(submitWhatsAppDisplayName).not.toHaveBeenCalled()

    await cleanup(restaurant, connection)
  })

  it('fails safely when the restaurant has no usable connection', async () => {
    const restaurant = await createRestaurant(`dn-noconn-${Date.now()}@ex.com`, 'NoConn')

    await expect(registerWhatsAppDisplayName(restaurant.id)).rejects.toBeInstanceOf(
      WhatsAppSenderUnavailableError,
    )
    await expect(registerWhatsAppDisplayName(restaurant.id)).rejects.toMatchObject({
      code: 'CONNECTION_NOT_FOUND',
    })

    await cleanup(restaurant)
  })

  it('fails safely when the connection has no WABA ID', async () => {
    const restaurant = await createRestaurant(`dn-nowaba-${Date.now()}@ex.com`, 'NoWaba')
    const connection = await createConnection(restaurant.id, {
      phoneNumberId: 'PHONE-NOWABA',
      token: 'EAAX-nowaba-token',
    })

    await expect(registerWhatsAppDisplayName(restaurant.id)).rejects.toBeInstanceOf(
      DisplayNameRegistrationError,
    )

    const row = await prisma.whatsAppConnection.findUnique({ where: { restaurantId: restaurant.id } })
    expect(row!.approvedDisplayName).toBeNull()

    await cleanup(restaurant, connection)
  })

  it('propagates domain errors without leaking the decrypted token', async () => {
    const restaurant = await createRestaurant(`dn-notfound-${Date.now()}@ex.com`, 'Ghost Cafe')

    await cleanup(restaurant)

    await expect(registerWhatsAppDisplayName(restaurant.id)).rejects.toBeInstanceOf(
      DisplayNameRegistrationError,
    )

    try {
      await registerWhatsAppDisplayName(restaurant.id)
    } catch (err) {
      expect((err as Error).message).not.toContain('EAAX')
    }
  })
})