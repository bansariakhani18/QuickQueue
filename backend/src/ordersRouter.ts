import { Router } from 'express'
import { requireAuth, type SessionData } from './auth.js'
import { createOrder, listActiveOrders, transitionOrderStatus, PhoneNormalizationError, ValidationError, OrderNotFoundError, TransitionError } from './orders.js'
import type { TransitionStatus } from './orders.js'
import { recallOrder, RecallError } from './processor.js'
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

function handleTransition(
  req: Request,
  res: Response,
  targetStatus: TransitionStatus,
) {
  const session = req.session as SessionData
  const restaurantId = session.restaurantId
  const orderId = req.params.id as string

  transitionOrderStatus(restaurantId, orderId, targetStatus)
    .then((order) => {
      res.status(200).json({
        id: order.id,
        displayToken: order.displayToken,
        status: order.status,
        readyAt: order.readyAt,
        collectedAt: order.collectedAt,
        cancelledAt: order.cancelledAt,
        terminalAt: order.terminalAt,
      })
    })
    .catch((err) => {
      if (err instanceof OrderNotFoundError) {
        res.status(404).json({ error: err.message })
        return
      }
      if (err instanceof TransitionError) {
        res.status(409).json({ error: err.message })
        return
      }
      console.error('Transition error:', err)
      res.status(500).json({ error: 'Internal server error' })
    })
}

ordersRouter.post('/:id/ready', (req: Request, res: Response) => {
  handleTransition(req, res, 'READY')
})

ordersRouter.post('/:id/collected', (req: Request, res: Response) => {
  handleTransition(req, res, 'COLLECTED')
})

ordersRouter.post('/:id/cancel', (req: Request, res: Response) => {
  handleTransition(req, res, 'CANCELLED')
})

ordersRouter.post('/:id/recall', (req: Request, res: Response) => {
  const session = req.session as SessionData
  const restaurantId = session.restaurantId
  const orderId = req.params.id as string

  recallOrder(restaurantId, orderId)
    .then((result) => {
      res.status(200).json({
        message: 'Recall initiated',
        attemptNumber: result.attemptNumber,
      })
    })
    .catch((err) => {
      if (err instanceof RecallError) {
        res.status(409).json({ error: err.message })
        return
      }
      console.error('Recall error:', err)
      res.status(500).json({ error: 'Internal server error' })
    })
})
