import type { Request, Response, NextFunction } from 'express'

function getAllowedOrigins(): string[] {
  return (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
}

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export function originValidation(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin
  const allowedOrigins = getAllowedOrigins()

  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Credentials', 'true')
    res.setHeader('Vary', 'Origin')
  }

  if (req.method === 'OPTIONS') {
    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    )
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type,Authorization,X-Requested-With,Accept,Origin',
    )
    res.setHeader('Access-Control-Max-Age', '86400')
    res.sendStatus(204)
    return
  }

  if (!STATE_CHANGING_METHODS.has(req.method)) {
    next()
    return
  }

  if (!origin || !allowedOrigins.includes(origin)) {
    res.status(403).json({ error: 'Origin not allowed' })
    return
  }

  next()
}
