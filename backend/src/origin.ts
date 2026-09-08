import type { Request, Response, NextFunction } from 'express'

const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export function originValidation(req: Request, res: Response, next: NextFunction): void {
  if (!STATE_CHANGING_METHODS.has(req.method)) {
    next()
    return
  }

  const origin = req.headers.origin

  if (!origin || !allowedOrigins.includes(origin)) {
    res.status(403).json({ error: 'Origin not allowed' })
    return
  }

  next()
}
