import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import express from 'express'
import request from 'supertest'
import { app } from '../app.js'
import { sessionMiddleware, requireAuth } from '../auth.js'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

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
        .send({ name: testName, email: testEmail, password: testPassword })

      expect(res.status).toBe(409)
      expect(res.body.error).toContain('already registered')
    })

    it('should reject missing fields', async () => {
      const res = await request(app)
        .post('/auth/signup')
        .send({ name: testName })

      expect(res.status).toBe(400)
      expect(res.body.error).toBeDefined()
    })
  })

  describe('POST /auth/login', () => {
    it('should login with valid credentials and set session cookie', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({ email: testEmail, password: testPassword })

      expect(res.status).toBe(200)
      expect(res.body.id).toBeDefined()
      expect(res.body.email).toBe(testEmail)
      expect(res.headers['set-cookie']).toBeDefined()
    })

    it('should reject wrong password', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({ email: testEmail, password: 'wrongpassword' })

      expect(res.status).toBe(401)
      expect(res.body.error).toContain('Invalid email or password')
    })

    it('should reject non-existent email', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({ email: 'nonexistent@example.com', password: testPassword })

      expect(res.status).toBe(401)
      expect(res.body.error).toContain('Invalid email or password')
    })

    it('should reject missing fields', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({ email: testEmail })

      expect(res.status).toBe(400)
      expect(res.body.error).toBeDefined()
    })
  })

  describe('POST /auth/logout', () => {
    it('should clear session cookie', async () => {
      const loginRes = await request(app)
        .post('/auth/login')
        .send({ email: testEmail, password: testPassword })

      const cookie = extractCookies(loginRes)

      const logoutRes = await request(app)
        .post('/auth/logout')
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
        .send({ email: testEmail, password: testPassword })

      const cookie = extractCookies(loginRes)

      const res = await request(testApp)
        .get('/protected')
        .set('Cookie', cookie)

      expect(res.status).toBe(200)
      expect(res.body.message).toBe('protected resource')
    })
  })
})
