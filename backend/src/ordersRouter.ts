import { Router } from 'express'
import { requireAuth, type SessionData } from './auth.js'
import { createOrder, listActiveOrders, PhoneNormalizationError, ValidationError } from './orders.js'
import type { Request, Response } from 'express'

export const ordersRouter = Router()

ordersRouter.use(requireAuth)

ordersRouter.post('/', (req: Request, res: Response) => {
  const session = req.session as SessionData
  const restaurantId = session.restaurantId

  const { displayToken, customerPhone, consentGiven } = req.body as {
    displayToken?: string
    customerPhone?: string
    consentGiven?: boolean
  }

  if (!displayToken || typeof displayToken !== 'string') {
    res.status(400).json({ error: 'Display token is required' })
    return
  }

  if (!customerPhone || typeof customerPhone !== 'string') {
    res.status(400).json({ error: 'Customer phone is required' })
    return
  }

  if (typeof consentGiven !== 'boolean') {
    res.status(400).json({ error: 'Consent must be an explicit true or false value' })
    return
  }

  createOrder(restaurantId, { displayToken, customerPhone, consentGiven })
    .then((order) => {
      res.status(201).json({
        id: order.id,
        displayToken: order.displayToken,
        customerPhone: order.customerPhone,
        consentGiven: order.consentGiven,
        consentMethod: order.consentMethod,
        consentCapturedAt: order.consentCapturedAt,
        status: order.status,
        createdAt: order.createdAt,
      })
    })
    .catch((err) => {
      if (err instanceof PhoneNormalizationError) {
        res.status(400).json({ error: err.message })
        return
      }
      if (err instanceof ValidationError) {
        res.status(400).json({ error: err.message })
        return
      }
      console.error('Create order error:', err)
      res.status(500).json({ error: 'Internal server error' })
    })
})

ordersRouter.get('/', (req: Request, res: Response) => {
  const session = req.session as SessionData
  const restaurantId = session.restaurantId

  const { search } = req.query as { search?: string }

  const options = search ? { search } : undefined

  listActiveOrders(restaurantId, options)
    .then((orders) => {
      res.status(200).json({
        orders: orders.map((o) => ({
          id: o.id,
          displayToken: o.displayToken,
          customerPhone: o.customerPhone,
          consentGiven: o.consentGiven,
          status: o.status,
          createdAt: o.createdAt,
        })),
      })
    })
    .catch((err) => {
      console.error('List orders error:', err)
      res.status(500).json({ error: 'Internal server error' })
    })
})
