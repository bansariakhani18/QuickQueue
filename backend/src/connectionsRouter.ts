import { Router } from 'express'
import { requireAuth, type SessionData } from './auth.js'
import {
  completeEmbeddedSignup,
  ConnectionEncryptionError,
  initiateEmbeddedSignup,
} from './connections.js'
import type { Request, Response } from 'express'

export const connectionsRouter = Router()

connectionsRouter.use(requireAuth)

connectionsRouter.post('/signup/initiate', (req: Request, res: Response) => {
  const session = req.session as SessionData
  const restaurantId = session.restaurantId

  initiateEmbeddedSignup(restaurantId)
    .then((result) => {
      res.status(200).json({ connectionStatus: result.connectionStatus })
    })
    .catch((err) => {
      console.error('Embedded signup initiate error:', err)
      res.status(500).json({ error: 'Internal server error' })
    })
})

connectionsRouter.post('/signup/complete', (req: Request, res: Response) => {
  const session = req.session as SessionData
  const restaurantId = session.restaurantId

  const { wabaId, phoneNumberId, accessToken } = req.body as {
    wabaId?: unknown
    phoneNumberId?: unknown
    accessToken?: unknown
  }

  if (typeof wabaId !== 'string' || wabaId.trim() === '') {
    res.status(400).json({ error: 'wabaId is required' })
    return
  }
  if (typeof phoneNumberId !== 'string' || phoneNumberId.trim() === '') {
    res.status(400).json({ error: 'phoneNumberId is required' })
    return
  }
  if (typeof accessToken !== 'string' || accessToken.trim() === '') {
    res.status(400).json({ error: 'accessToken is required' })
    return
  }

  completeEmbeddedSignup(restaurantId, {
    wabaId: wabaId.trim(),
    phoneNumberId: phoneNumberId.trim(),
    accessToken,
  })
    .then((connection) => {
      res.status(200).json({
        message: 'WhatsApp connection completed',
        connectionStatus: connection.connectionStatus,
        wabaId: connection.wabaId,
        phoneNumberId: connection.phoneNumberId,
        connectedAt: connection.connectedAt,
      })
    })
    .catch((err) => {
      if (err instanceof ConnectionEncryptionError) {
        res.status(500).json({ error: err.message })
        return
      }
      console.error('Embedded signup complete error:', err)
      res.status(500).json({ error: 'Internal server error' })
    })
})