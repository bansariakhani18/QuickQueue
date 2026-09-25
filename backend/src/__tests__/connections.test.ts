import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import { app } from '../app.js'
import { clearRateLimitStore } from '../rateLimit.js'
import { decryptToken, TOKEN_ENCRYPTION_KEY_ENV } from '../crypto.js'
import type { EncryptedToken } from '../crypto.js'
import { PrismaClient } from '@prisma/client'
import type { Response } from 'supertest'

const prisma = new PrismaClient()
const ORIGIN = 'http://localhost:5173'
const TEST_KEY = 'QuickQueue-phase-15-step-2-test-encryption-key-0002'

function extractCookies(res: Response): string {
  const setCookie = res.headers['set-cookie'] as string[] | undefined
  if (!setCookie) return ''
  return setCookie.map((c) => c.split(';')[0]).join('; ')
}

describe('WhatsApp connections (Phase 15 step 2)', () => {
  const restaurantA = {
    email: `conn-a-${Date.now()}@example.com`,
    password: 'password123',
    name: 'Restaurant A',
  }
  const restaurantB = {
    email: `conn-b-${Date.now()}@example.com`,
    password: 'password456',
    name: 'Restaurant B',
  }
  const restaurantC = {
    email: `conn-c-${Date.now()}@example.com`,
    password: 'password789',
    name: 'Restaurant C',
  }

  const A_WABA = '102290129340398'
  const A_PHONE = '15550001111'
  const A_TOKEN = 'EAAXtest-access-token-for-restaurant-a'
  const B_WABA = '102290129340399'
  const B_PHONE = '15550002222'
  const B_TOKEN = 'EAAXtest-access-token-for-restaurant-b'
  const C_WABA = '102290129340400'
  const C_PHONE = '15550003333'
  const C_TOKEN = 'EAAXtest-access-token-for-restaurant-c'

  let cookieA: string
  let cookieB: string
  let cookieC: string
  let restaurantAId: string
  let restaurantBId: string
  let restaurantCId: string

  beforeAll(async () => {
    process.env[TOKEN_ENCRYPTION_KEY_ENV] = TEST_KEY
    await prisma.$connect()

    const signupARes = await request(app)
      .post('/auth/signup')
      .set('Origin', ORIGIN)
      .send(restaurantA)
    restaurantAId = signupARes.body.id
    const loginARes = await request(app)
      .post('/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: restaurantA.email, password: restaurantA.password })
    cookieA = extractCookies(loginARes)

    const signupBRes = await request(app)
      .post('/auth/signup')
      .set('Origin', ORIGIN)
      .send(restaurantB)
    restaurantBId = signupBRes.body.id
    const loginBRes = await request(app)
      .post('/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: restaurantB.email, password: restaurantB.password })
    cookieB = extractCookies(loginBRes)

    const signupCRes = await request(app)
      .post('/auth/signup')
      .set('Origin', ORIGIN)
      .send(restaurantC)
    restaurantCId = signupCRes.body.id
    const loginCRes = await request(app)
      .post('/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: restaurantC.email, password: restaurantC.password })
    cookieC = extractCookies(loginCRes)
  })

  afterAll(async () => {
    await prisma.whatsAppConnection.deleteMany({
      where: { restaurantId: { in: [restaurantAId, restaurantBId, restaurantCId] } },
    })
    await prisma.restaurant.deleteMany({
      where: { email: { in: [restaurantA.email, restaurantB.email, restaurantC.email] } },
    })
    delete process.env[TOKEN_ENCRYPTION_KEY_ENV]
  })

  beforeEach(clearRateLimitStore)

  describe('POST /connections/signup/initiate', () => {
    it('creates a PENDING connection row for the authenticated restaurant', async () => {
      const res = await request(app)
        .post('/connections/signup/initiate')
        .set('Origin', ORIGIN)
        .set('Cookie', cookieA)

      expect(res.status).toBe(200)
      expect(res.body.connectionStatus).toBe('PENDING')

      const row = await prisma.whatsAppConnection.findUnique({ where: { restaurantId: restaurantAId } })
      expect(row).not.toBeNull()
      expect(row!.connectionStatus).toBe('PENDING')
    })

    it('is idempotent across repeated calls', async () => {
      await request(app)
        .post('/connections/signup/initiate')
        .set('Origin', ORIGIN)
        .set('Cookie', cookieB)
      await request(app)
        .post('/connections/signup/initiate')
        .set('Origin', ORIGIN)
        .set('Cookie', cookieB)

      const count = await prisma.whatsAppConnection.count({ where: { restaurantId: restaurantBId } })
      expect(count).toBe(1)
    })

    it('returns 401 when unauthenticated', async () => {
      const res = await request(app)
        .post('/connections/signup/initiate')
        .set('Origin', ORIGIN)

      expect(res.status).toBe(401)
    })

    it('returns 403 when the Origin header is missing', async () => {
      const res = await request(app)
        .post('/connections/signup/initiate')
        .set('Cookie', cookieA)

      expect(res.status).toBe(403)
    })
  })

  describe('POST /connections/signup/complete', () => {
    it('stores the connection and encrypts the access token (no plaintext stored)', async () => {
      const res = await request(app)
        .post('/connections/signup/complete')
        .set('Origin', ORIGIN)
        .set('Cookie', cookieA)
        .send({ wabaId: A_WABA, phoneNumberId: A_PHONE, accessToken: A_TOKEN })

      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({
        connectionStatus: 'CONNECTED',
        wabaId: A_WABA,
        phoneNumberId: A_PHONE,
      })
      expect(res.body.connectedAt).toBeDefined()
      expect(new Date(res.body.connectedAt).getTime()).toBeGreaterThan(0)
      expect(res.body.accessToken).toBeUndefined()
      expect(res.body.accessTokenEncrypted).toBeUndefined()
      expect(JSON.stringify(res.body)).not.toContain(A_TOKEN)

      const row = await prisma.whatsAppConnection.findUnique({ where: { restaurantId: restaurantAId } })
      expect(row).not.toBeNull()
      expect(row!.wabaId).toBe(A_WABA)
      expect(row!.phoneNumberId).toBe(A_PHONE)
      expect(row!.connectionStatus).toBe('CONNECTED')
      expect(row!.connectedAt).not.toBeNull()
      expect(row!.accessTokenEncrypted).toBeDefined()
      expect(row!.accessTokenEncrypted).not.toBe(A_TOKEN)
      expect(decryptToken(row!.accessTokenEncrypted as EncryptedToken)).toBe(A_TOKEN)
    })

    it('handles repeated completion idempotently (single row, same credential)', async () => {
      const first = await request(app)
        .post('/connections/signup/complete')
        .set('Origin', ORIGIN)
        .set('Cookie', cookieB)
        .send({ wabaId: B_WABA, phoneNumberId: B_PHONE, accessToken: B_TOKEN })
      const second = await request(app)
        .post('/connections/signup/complete')
        .set('Origin', ORIGIN)
        .set('Cookie', cookieB)
        .send({ wabaId: B_WABA, phoneNumberId: B_PHONE, accessToken: B_TOKEN })

      expect(first.status).toBe(200)
      expect(second.status).toBe(200)

      const rows = await prisma.whatsAppConnection.findMany({ where: { restaurantId: restaurantBId } })
      expect(rows).toHaveLength(1)
      const row = rows[0]
      expect(row!.wabaId).toBe(B_WABA)
      expect(row!.phoneNumberId).toBe(B_PHONE)
      expect(decryptToken(row!.accessTokenEncrypted as EncryptedToken)).toBe(B_TOKEN)
    })

    it('scopes storage to the authenticated restaurant and ignores client-supplied restaurant/connection IDs', async () => {
      await request(app)
        .post('/connections/signup/complete')
        .set('Origin', ORIGIN)
        .set('Cookie', cookieA)
        .send({ wabaId: A_WABA, phoneNumberId: A_PHONE, accessToken: A_TOKEN })

      const res = await request(app)
        .post('/connections/signup/complete')
        .set('Origin', ORIGIN)
        .set('Cookie', cookieB)
        .send({
          wabaId: B_WABA,
          phoneNumberId: B_PHONE,
          accessToken: B_TOKEN,
          restaurantId: restaurantAId,
        })

      expect(res.status).toBe(200)

      const aRow = await prisma.whatsAppConnection.findUnique({ where: { restaurantId: restaurantAId } })
      expect(aRow!.wabaId).toBe(A_WABA)
      expect(aRow!.phoneNumberId).toBe(A_PHONE)
      expect(decryptToken(aRow!.accessTokenEncrypted as EncryptedToken)).toBe(A_TOKEN)

      const bRow = await prisma.whatsAppConnection.findUnique({ where: { restaurantId: restaurantBId } })
      expect(bRow).not.toBeNull()
      expect(bRow!.wabaId).toBe(B_WABA)
      expect(bRow!.phoneNumberId).toBe(B_PHONE)
      expect(decryptToken(bRow!.accessTokenEncrypted as EncryptedToken)).toBe(B_TOKEN)
    })

    it('rejects a request missing any required field', async () => {
      const base: { wabaId: string; phoneNumberId: string; accessToken: string } = {
        wabaId: A_WABA,
        phoneNumberId: A_PHONE,
        accessToken: A_TOKEN,
      }

      for (const missing of ['wabaId', 'phoneNumberId', 'accessToken'] as const) {
        const body = { ...base } as Record<string, unknown>
        delete body[missing]

        const res = await request(app)
          .post('/connections/signup/complete')
          .set('Origin', ORIGIN)
          .set('Cookie', cookieA)
          .send(body)

        expect(res.status).toBe(400)
        expect(String(res.body.error)).toContain('required')
      }
    })

    it('rejects malformed callback data and stores nothing', async () => {
      const malformed = [
        { wabaId: '', phoneNumberId: A_PHONE, accessToken: A_TOKEN },
        { wabaId: '   ', phoneNumberId: A_PHONE, accessToken: A_TOKEN },
        { wabaId: 12345, phoneNumberId: A_PHONE, accessToken: A_TOKEN },
        { wabaId: A_WABA, phoneNumberId: '', accessToken: A_TOKEN },
        { wabaId: A_WABA, phoneNumberId: '  ', accessToken: A_TOKEN },
        { wabaId: A_WABA, phoneNumberId: A_PHONE, accessToken: '' },
        { wabaId: A_WABA, phoneNumberId: A_PHONE, accessToken: 42 },
      ]

      for (const body of malformed) {
        const res = await request(app)
          .post('/connections/signup/complete')
          .set('Origin', ORIGIN)
          .set('Cookie', cookieA)
          .send(body)

        expect(res.status).toBe(400)
      }

      const row = await prisma.whatsAppConnection.findUnique({ where: { restaurantId: restaurantCId } })
      expect(row).toBeNull()
    })

    it('returns 401 when unauthenticated', async () => {
      const res = await request(app)
        .post('/connections/signup/complete')
        .set('Origin', ORIGIN)
        .send({ wabaId: A_WABA, phoneNumberId: A_PHONE, accessToken: A_TOKEN })

      expect(res.status).toBe(401)
    })

    it('returns 403 when the Origin header is missing', async () => {
      const res = await request(app)
        .post('/connections/signup/complete')
        .set('Cookie', cookieA)
        .send({ wabaId: A_WABA, phoneNumberId: A_PHONE, accessToken: A_TOKEN })

      expect(res.status).toBe(403)
    })

    it('fails safely (500) and stores nothing when token encryption is not configured', async () => {
      const previousKey = process.env[TOKEN_ENCRYPTION_KEY_ENV]
      delete process.env[TOKEN_ENCRYPTION_KEY_ENV]
      try {
        const res = await request(app)
          .post('/connections/signup/complete')
          .set('Origin', ORIGIN)
          .set('Cookie', cookieA)
          .send({ wabaId: A_WABA, phoneNumberId: A_PHONE, accessToken: A_TOKEN })

        expect(res.status).toBe(500)
        expect(String(res.body.error)).toContain('Token encryption')
      } finally {
        process.env[TOKEN_ENCRYPTION_KEY_ENV] = previousKey
      }

      const row = await prisma.whatsAppConnection.findUnique({ where: { restaurantId: restaurantAId } })
      expect(decryptToken(row!.accessTokenEncrypted as EncryptedToken)).toBe(A_TOKEN)
    })

    it('succeeds without a prior initiate call (completion creates the row if absent)', async () => {
      const res = await request(app)
        .post('/connections/signup/complete')
        .set('Origin', ORIGIN)
        .set('Cookie', cookieC)
        .send({ wabaId: C_WABA, phoneNumberId: C_PHONE, accessToken: C_TOKEN })

      expect(res.status).toBe(200)

      const row = await prisma.whatsAppConnection.findUnique({ where: { restaurantId: restaurantCId } })
      expect(row).not.toBeNull()
      expect(row!.wabaId).toBe(C_WABA)
      expect(row!.phoneNumberId).toBe(C_PHONE)
      expect(row!.connectionStatus).toBe('CONNECTED')
      expect(decryptToken(row!.accessTokenEncrypted as EncryptedToken)).toBe(C_TOKEN)
    })
  })
})