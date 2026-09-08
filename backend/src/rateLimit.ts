import type { Request, Response, NextFunction } from 'express'

interface RateLimitEntry {
  count: number
  windowStart: number
}

const store = new Map<string, RateLimitEntry>()

function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string') {
    const first = forwarded.split(',')[0]
    return first?.trim() ?? 'unknown'
  }
  return req.socket.remoteAddress ?? 'unknown'
}

export function clearRateLimitStore(): void {
  store.clear()
}

export function createRateLimiter(opts: {
  windowMs: number
  max: number
  keyPrefix: string
}) {
  const { windowMs, max, keyPrefix } = opts

  const cleanup = setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of store) {
      if (key.startsWith(keyPrefix) && now - entry.windowStart > windowMs) {
        store.delete(key)
      }
    }
  }, windowMs)

  if (cleanup.unref) {
    cleanup.unref()
  }

  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = getClientIp(req)
    const email = (req.body as Record<string, unknown> | undefined)?.email
    const emailPart = typeof email === 'string' ? email : ''
    const key = `${keyPrefix}:${ip}:${emailPart}`

    const now = Date.now()
    const entry = store.get(key)

    if (!entry || now - entry.windowStart > windowMs) {
      store.set(key, { count: 1, windowStart: now })
      next()
      return
    }

    entry.count++

    if (entry.count > max) {
      res.status(429).json({ error: 'Too many requests. Please try again later.' })
      return
    }

    next()
  }
}
