import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import { app } from '../app.js'
import { clearRateLimitStore } from '../rateLimit.js'
import { PrismaClient } from '@prisma/client'
import type { Response } from 'supertest'

const prisma = new PrismaClient()
const ORIGIN = 'http://localhost:5173'

function extractCookies(res: Response): string {
  const setCookie = res.headers['set-cookie'] as string[] | undefined
  if (!setCookie) return ''
  return setCookie.map((c) => c.split(';')[0]).join('; ')
}

describe('Orders', () => {
  const restaurantA = {
    email: `orders-a-${Date.now()}@example.com`,
    password: 'password123',
    name: 'Restaurant A',
  }
  const restaurantB = {
    email: `orders-b-${Date.now()}@example.com`,
    password: 'password456',
    name: 'Restaurant B',
  }

  let cookieA: string
  let cookieB: string
  let restaurantAId: string
  let restaurantBId: string

  beforeAll(async () => {
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
  })

  afterAll(async () => {
    await prisma.order.deleteMany({ where: { restaurantId: { in: [restaurantAId, restaurantBId] } } })
    await prisma.restaurant.deleteMany({ where: { email: { in: [restaurantA.email, restaurantB.email] } } })
  })

  beforeEach(clearRateLimitStore)

  describe('POST /orders', () => {
    it('should create an order with valid data', async () => {
      const res = await request(app)
        .post('/orders')
        .set('Origin', ORIGIN)
        .set('Cookie', cookieA)
        .send({
          displayToken: '42',
          customerPhone: '+14155551234',
          consentGiven: true,
        })

      expect(res.status).toBe(201)
      expect(res.body).toMatchObject({
        displayToken: '42',
        customerPhone: '+14155551234',
        consentGiven: true,
        consentMethod: 'VERBAL_STAFF_CONFIRMED',
        status: 'PREPARING',
      })
      expect(res.body.id).toBeDefined()
      expect(res.body.consentCapturedAt).toBeDefined()
    })

    it('should reject an invalid phone number', async () => {
      const res = await request(app)
        .post('/orders')
        .set('Origin', ORIGIN)
        .set('Cookie', cookieA)
        .send({
          displayToken: '43',
          customerPhone: 'not-a-phone',
          consentGiven: true,
        })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('Invalid phone number')
    })

    it('should reject a request with no explicit consent value', async () => {
      const res = await request(app)
        .post('/orders')
        .set('Origin', ORIGIN)
        .set('Cookie', cookieA)
        .send({
          displayToken: '44',
          customerPhone: '+14155551234',
        })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('Consent must be an explicit')
    })

    it('should reject consent given as a non-boolean value', async () => {
      const res = await request(app)
        .post('/orders')
        .set('Origin', ORIGIN)
        .set('Cookie', cookieA)
        .send({
          displayToken: '45',
          customerPhone: '+14155551234',
          consentGiven: 'yes',
        })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('Consent must be an explicit')
    })

    it('should record consentMethod as NULL when consent is false', async () => {
      const res = await request(app)
        .post('/orders')
        .set('Origin', ORIGIN)
        .set('Cookie', cookieA)
        .send({
          displayToken: '46',
          customerPhone: '+14155559999',
          consentGiven: false,
        })

      expect(res.status).toBe(201)
      expect(res.body.consentGiven).toBe(false)
      expect(res.body.consentMethod).toBeNull()
    })

    it('should allow two orders with the same displayToken for the same restaurant', async () => {
      const res1 = await request(app)
        .post('/orders')
        .set('Origin', ORIGIN)
        .set('Cookie', cookieA)
        .send({
          displayToken: '47',
          customerPhone: '+14155551111',
          consentGiven: true,
        })

      const res2 = await request(app)
        .post('/orders')
        .set('Origin', ORIGIN)
        .set('Cookie', cookieA)
        .send({
          displayToken: '47',
          customerPhone: '+14155552222',
          consentGiven: true,
        })

      expect(res1.status).toBe(201)
      expect(res2.status).toBe(201)
      expect(res1.body.id).not.toBe(res2.body.id)
      expect(res1.body.displayToken).toBe('47')
      expect(res2.body.displayToken).toBe('47')
    })

    it('should reject if not authenticated', async () => {
      const res = await request(app)
        .post('/orders')
        .set('Origin', ORIGIN)
        .send({
          displayToken: '99',
          customerPhone: '+14155551234',
          consentGiven: true,
        })

      expect(res.status).toBe(401)
    })

    it('should trim display token', async () => {
      const res = await request(app)
        .post('/orders')
        .set('Origin', ORIGIN)
        .set('Cookie', cookieA)
        .send({
          displayToken: '  48  ',
          customerPhone: '+14155551234',
          consentGiven: true,
        })

      expect(res.status).toBe(201)
      expect(res.body.displayToken).toBe('48')
    })

    it('should reject empty display token', async () => {
      const res = await request(app)
        .post('/orders')
        .set('Origin', ORIGIN)
        .set('Cookie', cookieA)
        .send({
          displayToken: '   ',
          customerPhone: '+14155551234',
          consentGiven: true,
        })

      expect(res.status).toBe(400)
    })
  })

  describe('GET /orders', () => {
    it('should return active orders for the authenticated restaurant', async () => {
      const res = await request(app)
        .get('/orders')
        .set('Origin', ORIGIN)
        .set('Cookie', cookieA)

      expect(res.status).toBe(200)
      expect(Array.isArray(res.body.orders)).toBe(true)
      for (const order of res.body.orders) {
        expect(['PREPARING', 'READY']).toContain(order.status)
      }
    })

    it('should sort READY orders before PREPARING', async () => {
      const createRes = await request(app)
        .post('/orders')
        .set('Origin', ORIGIN)
        .set('Cookie', cookieA)
        .send({
          displayToken: 'sort-test',
          customerPhone: '+14155553333',
          consentGiven: true,
        })

      await prisma.order.update({
        where: { id: createRes.body.id },
        data: { status: 'READY' },
      })

      const res = await request(app)
        .get('/orders')
        .set('Origin', ORIGIN)
        .set('Cookie', cookieA)

      expect(res.status).toBe(200)
      const statuses = res.body.orders.map((o: { status: string }) => o.status)
      const lastPreparing = statuses.lastIndexOf('PREPARING')
      const firstReady = statuses.indexOf('READY')
      if (lastPreparing !== -1 && firstReady !== -1) {
        expect(lastPreparing).toBeGreaterThan(firstReady)
      }
    })
  })

  describe('Cross-tenant isolation', () => {
    it('should not return restaurant B orders when querying as restaurant A', async () => {
      const bOrderRes = await request(app)
        .post('/orders')
        .set('Origin', ORIGIN)
        .set('Cookie', cookieB)
        .send({
          displayToken: 'B-only',
          customerPhone: '+14155554444',
          consentGiven: true,
        })
      expect(bOrderRes.status).toBe(201)

      const aListRes = await request(app)
        .get('/orders')
        .set('Origin', ORIGIN)
        .set('Cookie', cookieA)

      expect(aListRes.status).toBe(200)
      const bOrderIds = aListRes.body.orders.map((o: { id: string }) => o.id)
      expect(bOrderIds).not.toContain(bOrderRes.body.id)
    })

    it('should not return restaurant B orders when guessing an order id', async () => {
      const bOrderRes = await request(app)
        .post('/orders')
        .set('Origin', ORIGIN)
        .set('Cookie', cookieB)
        .send({
          displayToken: 'B-guess',
          customerPhone: '+14155555555',
          consentGiven: true,
        })
      expect(bOrderRes.status).toBe(201)

      const guessedId = bOrderRes.body.id

      const aListRes = await request(app)
        .get('/orders')
        .set('Origin', ORIGIN)
        .set('Cookie', cookieA)

      const aOrderIds = aListRes.body.orders.map((o: { id: string }) => o.id)
      expect(aOrderIds).not.toContain(guessedId)
    })

    it('should not allow restaurant A to access restaurant B orders by phone search', async () => {
      const phone = `+141555566${Math.floor(Math.random() * 100).toString().padStart(2, '0')}`

      await request(app)
        .post('/orders')
        .set('Origin', ORIGIN)
        .set('Cookie', cookieB)
        .send({
          displayToken: 'B-phone',
          customerPhone: phone,
          consentGiven: true,
        })

      const aSearchRes = await request(app)
        .get(`/orders?search=${encodeURIComponent(phone)}`)
        .set('Origin', ORIGIN)
        .set('Cookie', cookieA)

      expect(aSearchRes.status).toBe(200)
      expect(aSearchRes.body.orders).toHaveLength(0)
    })
  })
})
