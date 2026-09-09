import express from 'express'
import { PrismaClient } from '@prisma/client'
import { sessionMiddleware, authRouter } from './auth.js'
import { originValidation } from './origin.js'
import { createRateLimiter } from './rateLimit.js'
import { ordersRouter } from './ordersRouter.js'

const app = express()
const prisma = new PrismaClient()

const loginRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyPrefix: 'rl:login',
})

const resetRequestRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyPrefix: 'rl:reset',
})

app.use(express.json())
app.use(sessionMiddleware)
app.use(originValidation)

app.get('/health', async (_request, response) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    response.status(200).json({ status: 'ok' })
  } catch {
    response.status(503).json({ status: 'error', message: 'Database unreachable' })
  }
})

app.post('/auth/login', loginRateLimiter)
app.post('/auth/password-reset/request', resetRequestRateLimiter)
app.use('/auth', authRouter)
app.use('/orders', ordersRouter)

export { app }
