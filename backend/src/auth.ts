import { Router } from 'express'
import bcrypt from 'bcryptjs'
import cookieSession from 'cookie-session'
import { createHash, randomBytes } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { getEmailSender } from './email.js'
import type { Request, Response, NextFunction } from 'express'

const prisma = new PrismaClient()

export interface SessionData {
  restaurantId: string
  sessionVersion: number
}

declare module 'express-serve-static-core' {
  interface Request {
    session?: SessionData | null
  }
}

const SESSION_SECRET = process.env.SESSION_SECRET ?? 'dev-session-secret-do-not-use-in-production'
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000 // 24 hours

export const sessionMiddleware = cookieSession({
  name: 'session',
  keys: [SESSION_SECRET],
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: SESSION_MAX_AGE_MS,
})

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const session = req.session as SessionData | undefined
  if (!session?.restaurantId) {
    res.status(401).json({ error: 'Not authenticated' })
    return
  }

  prisma.restaurant
    .findUnique({ where: { id: session.restaurantId } })
    .then((restaurant) => {
      if (!restaurant) {
        req.session = null
        res.status(401).json({ error: 'Not authenticated' })
        return
      }

      if (restaurant.sessionVersion !== session.sessionVersion) {
        req.session = null
        res.status(401).json({ error: 'Session invalidated' })
        return
      }

      req.session = session
      next()
    })
    .catch((err) => {
      console.error('Auth middleware error:', err)
      res.status(500).json({ error: 'Internal server error' })
    })
}

export const authRouter = Router()

authRouter.post('/signup', (req: Request, res: Response) => {
  const { name, email, password } = req.body as {
    name?: string
    email?: string
    password?: string
  }

  if (!name || !email || !password) {
    res.status(400).json({ error: 'Name, email, and password are required' })
    return
  }

  if (typeof email !== 'string' || !email.includes('@')) {
    res.status(400).json({ error: 'Invalid email format' })
    return
  }

  prisma.restaurant
    .findUnique({ where: { email } })
    .then((existing) => {
      if (existing) {
        res.status(409).json({ error: 'Email already registered' })
        return null
      }

      return bcrypt.hash(password, 12).then((passwordHash) => {
        return prisma.restaurant.create({
          data: {
            name,
            email,
            passwordHash,
          },
        })
      })
    })
    .then((restaurant) => {
      if (!restaurant) return

      req.session = {
        restaurantId: restaurant.id,
        sessionVersion: restaurant.sessionVersion,
      }

      res.status(201).json({
        id: restaurant.id,
        name: restaurant.name,
        email: restaurant.email,
      })
    })
    .catch((err) => {
      console.error('Signup error:', err)
      res.status(500).json({ error: 'Internal server error' })
    })
})

authRouter.post('/login', (req: Request, res: Response) => {
  const { email, password } = req.body as {
    email?: string
    password?: string
  }

  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required' })
    return
  }

  prisma.restaurant
    .findUnique({ where: { email } })
    .then((restaurant) => {
      if (!restaurant) {
        res.status(401).json({ error: 'Invalid email or password' })
        return null
      }

      return bcrypt.compare(password, restaurant.passwordHash).then((valid) => {
        if (!valid) {
          res.status(401).json({ error: 'Invalid email or password' })
          return null
        }

        req.session = {
          restaurantId: restaurant.id,
          sessionVersion: restaurant.sessionVersion,
        }

        res.status(200).json({
          id: restaurant.id,
          name: restaurant.name,
          email: restaurant.email,
        })
        return null
      })
    })
    .catch((err) => {
      console.error('Login error:', err)
      res.status(500).json({ error: 'Internal server error' })
    })
})

authRouter.post('/logout', (_req: Request, res: Response) => {
  _req.session = null
  res.status(200).json({ message: 'Logged out' })
})

const RESET_TOKEN_EXPIRY_MS = 60 * 60 * 1000 // 1 hour

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

authRouter.post('/password-reset/request', (req: Request, res: Response) => {
  const { email } = req.body as { email?: string }

  if (!email || typeof email !== 'string') {
    res.status(400).json({ error: 'Email is required' })
    return
  }

  const respondWithSuccess = () => {
    res.status(200).json({
      message: 'If an account with that email exists, a reset link has been sent.',
    })
  }

  prisma.restaurant
    .findUnique({ where: { email } })
    .then((restaurant) => {
      if (!restaurant) {
        respondWithSuccess()
        return null
      }

      const rawToken = randomBytes(32).toString('hex')
      const tokenHash = hashToken(rawToken)
      const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY_MS)

      return prisma.restaurant
        .update({
          where: { id: restaurant.id },
          data: {
            resetTokenHash: tokenHash,
            resetTokenExpiresAt: expiresAt,
          },
        })
        .then(() => {
          const resetLink = `/reset-password?token=${rawToken}`
          return getEmailSender().sendPasswordReset(restaurant.email, resetLink)
        })
        .then(() => {
          respondWithSuccess()
        })
    })
    .catch((err) => {
      console.error('Password reset request error:', err)
      res.status(500).json({ error: 'Internal server error' })
    })
})

authRouter.post('/password-reset/confirm', (req: Request, res: Response) => {
  const { token, newPassword } = req.body as {
    token?: string
    newPassword?: string
  }

  if (!token || !newPassword) {
    res.status(400).json({ error: 'Token and new password are required' })
    return
  }

  if (typeof token !== 'string' || typeof newPassword !== 'string') {
    res.status(400).json({ error: 'Token and new password must be strings' })
    return
  }

  const tokenHash = hashToken(token)

  bcrypt
    .hash(newPassword, 12)
    .then((passwordHash) => {
      return prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM restaurants WHERE reset_token_hash = ${tokenHash} AND reset_token_expires_at > now() FOR UPDATE`

        if (rows.length === 0) {
          return null
        }

        const row = rows[0]
        if (!row) {
          return null
        }

        await tx.restaurant.update({
          where: { id: row.id },
          data: {
            passwordHash,
            resetTokenHash: null,
            resetTokenExpiresAt: null,
            sessionVersion: { increment: 1 },
          },
        })

        return row.id
      })
    })
    .then((result) => {
      if (!result) {
        res.status(400).json({ error: 'Invalid or expired reset token' })
        return
      }
      res.status(200).json({ message: 'Password has been reset' })
    })
    .catch((err) => {
      console.error('Password reset confirm error:', err)
      res.status(500).json({ error: 'Internal server error' })
    })
})
