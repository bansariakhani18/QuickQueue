import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createHash, randomBytes } from 'node:crypto'
import { app } from '../app.js'
import { sessionMiddleware, requireAuth } from '../auth.js'
import { clearRateLimitStore } from '../rateLimit.js'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const ORIGIN = 'http://localhost:5173'

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

const testApp = express()
testApp.use(express.json())
testApp.use(sessionMiddleware)
testApp.get('/protected', requireAuth, (_req, res) => {
  res.status(200).json({ message: 'protected resource' })
})

function extractCookies(res: request.Response): string {
  const setCookies = res.headers['set-cookie']
  if (!setCookies) return ''
  const cookies = Array.isArray(setCookies) ? setCookies : [setCookies]
  return cookies.map((c: string) => c.split(';')[0]).join('; ')
}

describe('Auth', () => {
  const testEmail = `test-${Date.now()}@example.com`
  const testPassword = 'password123'
  const testName = 'Test Restaurant'

  beforeEach(clearRateLimitStore)

  beforeAll(async () => {
    await prisma.$connect()
  })

  afterAll(async () => {
    await prisma.restaurant.deleteMany({ where: { email: testEmail } })
    await prisma.$disconnect()
  })

  describe('POST /auth/signup', () => {
    it('should create a new restaurant and set session cookie', async () => {
      const res = await request(app)
        .post('/auth/signup')
        .set('Origin', ORIGIN)
        .send({ name: testName, email: testEmail, password: testPassword })

      expect(res.status).toBe(201)
      expect(res.body).toHaveProperty('id')
      expect(res.body.name).toBe(testName)
      expect(res.body.email).toBe(testEmail)
      expect(res.headers['set-cookie']).toBeDefined()
    })

    it('should reject duplicate email', async () => {
      const res = await request(app)
        .post('/auth/signup')
        .set('Origin', ORIGIN)
        .send({ name: testName, email: testEmail, password: testPassword })

      expect(res.status).toBe(409)
      expect(res.body.error).toContain('already registered')
    })

    it('should reject missing fields', async () => {
      const res = await request(app)
        .post('/auth/signup')
        .set('Origin', ORIGIN)
        .send({ name: testName })

      expect(res.status).toBe(400)
      expect(res.body.error).toBeDefined()
    })
  })

  describe('POST /auth/login', () => {
    it('should login with valid credentials and set session cookie', async () => {
      const res = await request(app)
        .post('/auth/login')
        .set('Origin', ORIGIN)
        .send({ email: testEmail, password: testPassword })

      expect(res.status).toBe(200)
      expect(res.body.id).toBeDefined()
      expect(res.body.email).toBe(testEmail)
      expect(res.headers['set-cookie']).toBeDefined()
    })

    it('should reject wrong password', async () => {
      const res = await request(app)
        .post('/auth/login')
        .set('Origin', ORIGIN)
        .send({ email: testEmail, password: 'wrongpassword' })

      expect(res.status).toBe(401)
      expect(res.body.error).toContain('Invalid email or password')
    })

    it('should reject non-existent email', async () => {
      const res = await request(app)
        .post('/auth/login')
        .set('Origin', ORIGIN)
        .send({ email: 'nonexistent@example.com', password: testPassword })

      expect(res.status).toBe(401)
      expect(res.body.error).toContain('Invalid email or password')
    })

    it('should reject missing fields', async () => {
      const res = await request(app)
        .post('/auth/login')
        .set('Origin', ORIGIN)
        .send({ email: testEmail })

      expect(res.status).toBe(400)
      expect(res.body.error).toBeDefined()
    })
  })

  describe('POST /auth/logout', () => {
    it('should clear session cookie', async () => {
      const loginRes = await request(app)
        .post('/auth/login')
        .set('Origin', ORIGIN)
        .send({ email: testEmail, password: testPassword })

      const cookie = extractCookies(loginRes)

      const logoutRes = await request(app)
        .post('/auth/logout')
        .set('Origin', ORIGIN)
        .set('Cookie', cookie)

      expect(logoutRes.status).toBe(200)
      expect(logoutRes.body.message).toBe('Logged out')
    })
  })

  describe('Authentication middleware', () => {
    it('should reject request with no session cookie', async () => {
      const res = await request(testApp)
        .get('/protected')

      expect(res.status).toBe(401)
      expect(res.body.error).toBe('Not authenticated')
    })

    it('should reject request with invalid session cookie', async () => {
      const res = await request(testApp)
        .get('/protected')
        .set('Cookie', 'session=invalidvalue; session.sig=invalidsig')

      expect(res.status).toBe(401)
      expect(res.body.error).toBe('Not authenticated')
    })

    it('should accept request with valid session', async () => {
      const loginRes = await request(app)
        .post('/auth/login')
        .set('Origin', ORIGIN)
        .send({ email: testEmail, password: testPassword })

      const cookie = extractCookies(loginRes)

      const res = await request(testApp)
        .get('/protected')
        .set('Cookie', cookie)

      expect(res.status).toBe(200)
      expect(res.body.message).toBe('protected resource')
    })
  })

  describe('POST /auth/password-reset/request', () => {
    it('should return success even for non-existent email', async () => {
      const res = await request(app)
        .post('/auth/password-reset/request')
        .set('Origin', ORIGIN)
        .send({ email: 'nonexistent@example.com' })

      expect(res.status).toBe(200)
      expect(res.body.message).toContain('reset link has been sent')
    })

    it('should store a token hash on the restaurant record', async () => {
      const res = await request(app)
        .post('/auth/password-reset/request')
        .set('Origin', ORIGIN)
        .send({ email: testEmail })

      expect(res.status).toBe(200)

      const restaurant = await prisma.restaurant.findUnique({
        where: { email: testEmail },
      })
      expect(restaurant).not.toBeNull()
      expect(restaurant!.resetTokenHash).not.toBeNull()
      expect(restaurant!.resetTokenExpiresAt).not.toBeNull()
      expect(restaurant!.resetTokenExpiresAt!.getTime()).toBeGreaterThan(Date.now())
    })
  })

  describe('POST /auth/password-reset/confirm', () => {
    it('should reset password with a valid token', async () => {
      const rawToken = randomBytes(32).toString('hex')
      const tokenHash = hashToken(rawToken)
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000)

      const restaurant = await prisma.restaurant.findUnique({
        where: { email: testEmail },
      })
      await prisma.restaurant.update({
        where: { id: restaurant!.id },
        data: { resetTokenHash: tokenHash, resetTokenExpiresAt: expiresAt },
      })

      const res = await request(app)
        .post('/auth/password-reset/confirm')
        .set('Origin', ORIGIN)
        .send({ token: rawToken, newPassword: 'newpassword456' })

      expect(res.status).toBe(200)
      expect(res.body.message).toBe('Password has been reset')

      const updated = await prisma.restaurant.findUnique({
        where: { email: testEmail },
      })
      expect(updated!.resetTokenHash).toBeNull()
      expect(updated!.resetTokenExpiresAt).toBeNull()

      const loginRes = await request(app)
        .post('/auth/login')
        .set('Origin', ORIGIN)
        .send({ email: testEmail, password: 'newpassword456' })
      expect(loginRes.status).toBe(200)
    })

    it('should reject an expired token', async () => {
      const rawToken = randomBytes(32).toString('hex')
      const tokenHash = hashToken(rawToken)
      const expiredDate = new Date(Date.now() - 1000)

      const restaurant = await prisma.restaurant.findUnique({
        where: { email: testEmail },
      })
      await prisma.restaurant.update({
        where: { id: restaurant!.id },
        data: { resetTokenHash: tokenHash, resetTokenExpiresAt: expiredDate },
      })

      const res = await request(app)
        .post('/auth/password-reset/confirm')
        .set('Origin', ORIGIN)
        .send({ token: rawToken, newPassword: 'newpassword789' })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('Invalid or expired')
    })

    it('should reject a reused (already-consumed) token', async () => {
      const rawToken = randomBytes(32).toString('hex')
      const tokenHash = hashToken(rawToken)
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000)

      const restaurant = await prisma.restaurant.findUnique({
        where: { email: testEmail },
      })
      await prisma.restaurant.update({
        where: { id: restaurant!.id },
        data: { resetTokenHash: tokenHash, resetTokenExpiresAt: expiresAt },
      })

      const firstRes = await request(app)
        .post('/auth/password-reset/confirm')
        .set('Origin', ORIGIN)
        .send({ token: rawToken, newPassword: 'reusedpassword1' })
      expect(firstRes.status).toBe(200)

      const secondRes = await request(app)
        .post('/auth/password-reset/confirm')
        .set('Origin', ORIGIN)
        .send({ token: rawToken, newPassword: 'reusedpassword2' })
      expect(secondRes.status).toBe(400)
      expect(secondRes.body.error).toContain('Invalid or expired')
    })

    it('should invalidate a prior token when a second reset is requested', async () => {
      const rawToken1 = randomBytes(32).toString('hex')
      const tokenHash1 = hashToken(rawToken1)
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000)

      const restaurant = await prisma.restaurant.findUnique({
        where: { email: testEmail },
      })
      await prisma.restaurant.update({
        where: { id: restaurant!.id },
        data: { resetTokenHash: tokenHash1, resetTokenExpiresAt: expiresAt },
      })

      await request(app)
        .post('/auth/password-reset/request')
        .set('Origin', ORIGIN)
        .send({ email: testEmail })

      const res = await request(app)
        .post('/auth/password-reset/confirm')
        .set('Origin', ORIGIN)
        .send({ token: rawToken1, newPassword: 'shouldfail123' })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('Invalid or expired')
    })

    it('should invalidate existing sessions via sessionVersion increment', async () => {
      const loginRes = await request(app)
        .post('/auth/login')
        .set('Origin', ORIGIN)
        .send({ email: testEmail, password: 'reusedpassword1' })

      const cookie = extractCookies(loginRes)
      expect(loginRes.status).toBe(200)

      const sessionCheck = await request(testApp)
        .get('/protected')
        .set('Cookie', cookie)
      expect(sessionCheck.status).toBe(200)

      const rawToken = randomBytes(32).toString('hex')
      const tokenHash = hashToken(rawToken)
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000)

      const restaurant = await prisma.restaurant.findUnique({
        where: { email: testEmail },
      })
      await prisma.restaurant.update({
        where: { id: restaurant!.id },
        data: { resetTokenHash: tokenHash, resetTokenExpiresAt: expiresAt },
      })

      const resetRes = await request(app)
        .post('/auth/password-reset/confirm')
        .set('Origin', ORIGIN)
        .send({ token: rawToken, newPassword: 'finalpassword789' })
      expect(resetRes.status).toBe(200)

      const staleSessionCheck = await request(testApp)
        .get('/protected')
        .set('Cookie', cookie)
      expect(staleSessionCheck.status).toBe(401)
      expect(staleSessionCheck.body.error).toBe('Session invalidated')
    })

    it('should reject concurrent duplicate token consumption', async () => {
      const rawToken = randomBytes(32).toString('hex')
      const tokenHash = hashToken(rawToken)
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000)

      const restaurant = await prisma.restaurant.findUnique({
        where: { email: testEmail },
      })
      await prisma.restaurant.update({
        where: { id: restaurant!.id },
        data: { resetTokenHash: tokenHash, resetTokenExpiresAt: expiresAt },
      })

      const [resA, resB] = await Promise.all([
        request(app)
          .post('/auth/password-reset/confirm')
          .set('Origin', ORIGIN)
          .send({ token: rawToken, newPassword: 'concurrent1' }),
        request(app)
          .post('/auth/password-reset/confirm')
          .set('Origin', ORIGIN)
          .send({ token: rawToken, newPassword: 'concurrent2' }),
      ])

      const statuses = [resA.status, resB.status].sort()
      expect(statuses).toEqual([200, 400])

      const updated = await prisma.restaurant.findUnique({
        where: { email: testEmail },
      })
      expect(updated!.resetTokenHash).toBeNull()
      expect(updated!.resetTokenExpiresAt).toBeNull()

      const login1 = await request(app)
        .post('/auth/login')
        .set('Origin', ORIGIN)
        .send({ email: testEmail, password: 'concurrent1' })
      const login2 = await request(app)
        .post('/auth/login')
        .set('Origin', ORIGIN)
        .send({ email: testEmail, password: 'concurrent2' })
      const loginStatuses = [login1.status, login2.status].sort()
      expect(loginStatuses).toEqual([200, 401])
    })
  })

  describe('Origin validation (FR-009)', () => {
    it('should reject state-changing request from disallowed origin', async () => {
      const res = await request(app)
        .post('/auth/login')
        .set('Origin', 'https://evil.example.com')
        .send({ email: testEmail, password: testPassword })

      expect(res.status).toBe(403)
      expect(res.body.error).toBe('Origin not allowed')
    })

    it('should allow state-changing request from allowed origin', async () => {
      const uniqueEmail = `origin-${Date.now()}@example.com`
      await request(app)
        .post('/auth/signup')
        .set('Origin', ORIGIN)
        .send({ name: 'Origin Test', email: uniqueEmail, password: 'pass123' })

      const res = await request(app)
        .post('/auth/login')
        .set('Origin', ORIGIN)
        .send({ email: uniqueEmail, password: 'pass123' })

      expect(res.status).toBe(200)
    })

    it('should allow GET requests without origin header', async () => {
      const res = await request(app).get('/health')
      expect(res.status).toBe(200)
    })
  })

  describe('Rate limiting (FR-008)', () => {
    it('should block login after exceeding rate limit', async () => {
      const uniqueEmail = `ratelimit-${Date.now()}@example.com`

      for (let i = 0; i < 5; i++) {
        await request(app)
          .post('/auth/login')
          .set('Origin', ORIGIN)
          .send({ email: uniqueEmail, password: 'wrong' })
      }

      const res = await request(app)
        .post('/auth/login')
        .set('Origin', ORIGIN)
        .send({ email: uniqueEmail, password: 'wrong' })

      expect(res.status).toBe(429)
      expect(res.body.error).toContain('Too many requests')
    })

    it('should block password-reset-request after exceeding rate limit', async () => {
      const uniqueEmail = `rl-reset-${Date.now()}@example.com`

      for (let i = 0; i < 5; i++) {
        await request(app)
          .post('/auth/password-reset/request')
          .set('Origin', ORIGIN)
          .send({ email: uniqueEmail })
      }

      const res = await request(app)
        .post('/auth/password-reset/request')
        .set('Origin', ORIGIN)
        .send({ email: uniqueEmail })

      expect(res.status).toBe(429)
      expect(res.body.error).toContain('Too many requests')
    })
  })

  describe('Health check with DB (NFR-015)', () => {
    it('should return 200 when database is reachable', async () => {
      const res = await request(app).get('/health')
      expect(res.status).toBe(200)
      expect(res.body.status).toBe('ok')
    })
  })
})
