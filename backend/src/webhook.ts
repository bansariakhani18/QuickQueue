import { createHmac, timingSafeEqual } from 'node:crypto'
import express from 'express'
import { PrismaClient } from '@prisma/client'
import { normalizePhone, PhoneNormalizationError } from './orders.js'

const prisma = new PrismaClient()

export const webhookRouter = express.Router()

webhookRouter.use(express.raw({ type: () => true, limit: '1mb' }))

const SIGNATURE_PREFIX = 'sha256='

function verifyWebhookSignature(secret: string, body: Buffer, header: string | undefined): boolean {
  if (secret === '' || !header || !header.startsWith(SIGNATURE_PREFIX)) return false
  const provided = Buffer.from(header.slice(SIGNATURE_PREFIX.length), 'hex')
  const expected = createHmac('sha256', secret).update(body).digest()
  return provided.length === expected.length && timingSafeEqual(provided, expected)
}

webhookRouter.get('/', (req, res) => {
  const mode = req.query['hub.mode']
  const token = req.query['hub.verify_token']
  const challenge = req.query['hub.challenge']
  const expectedToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? ''

  if (
    mode === 'subscribe' &&
    expectedToken !== '' &&
    typeof token === 'string' &&
    token === expectedToken &&
    typeof challenge === 'string'
  ) {
    res.status(200).send(challenge)
    return
  }

  res.status(403).end()
})

interface ParsedStatusEvent {
  providerMessageId: string
  status: string
  timestamp: string
  phoneNumberId: string
}

function parseStatusEvents(payload: unknown): ParsedStatusEvent[] {
  if (typeof payload !== 'object' || payload === null) return []
  const root = payload as Record<string, unknown>
  if (!Array.isArray(root.entry)) return []

  const events: ParsedStatusEvent[] = []

  for (const entry of root.entry) {
    if (typeof entry !== 'object' || entry === null) continue
    const changes = (entry as Record<string, unknown>).changes
    if (!Array.isArray(changes)) continue

    for (const change of changes) {
      if (typeof change !== 'object' || change === null) continue
      const value = (change as Record<string, unknown>).value
      if (typeof value !== 'object' || value === null) continue
      const valueRecord = value as Record<string, unknown>

      const metadata = valueRecord.metadata
      const phoneNumberId =
        typeof metadata === 'object' && metadata !== null
          ? typeof (metadata as Record<string, unknown>).phone_number_id === 'string'
            ? ((metadata as Record<string, unknown>).phone_number_id as string)
            : ''
          : ''

      const statuses = valueRecord.statuses
      if (!Array.isArray(statuses)) continue

      for (const status of statuses) {
        if (typeof status !== 'object' || status === null) continue
        const record = status as Record<string, unknown>
        const id = typeof record.id === 'string' ? record.id.trim() : ''
        const statusName = typeof record.status === 'string' ? record.status : ''
        const timestamp =
          typeof record.timestamp === 'string'
            ? record.timestamp
            : typeof record.timestamp === 'number'
              ? String(record.timestamp)
              : ''

        if (id === '' || statusName === '') continue
        events.push({ providerMessageId: id, status: statusName, timestamp, phoneNumberId })
      }
    }
  }

  return events
}

async function applyStatusEvent(event: ParsedStatusEvent): Promise<void> {
  const attempt = await prisma.notificationAttempt.findUnique({
    where: { providerMessageId: event.providerMessageId },
    select: {
      id: true,
      orderId: true,
      order: {
        select: {
          restaurantId: true,
          restaurant: { select: { status: true } },
        },
      },
    },
  })

  if (!attempt) {
    console.info(`[webhook] ignoring event for unknown providerMessageId=${event.providerMessageId}`)
    return
  }

  const restaurantId = attempt.order.restaurantId

  if (attempt.order.restaurant.status !== 'ACTIVE') {
    console.info(`[webhook] ignoring event for inactive restaurant restaurantId=${restaurantId}`)
    return
  }

  if (event.phoneNumberId !== '') {
    const connection = await prisma.whatsAppConnection.findUnique({
      where: { restaurantId },
    })

    if (connection) {
      if (connection.connectionStatus === 'DISCONNECTED') {
        console.info(`[webhook] ignoring event for disconnected connection restaurantId=${restaurantId}`)
        return
      }
      if (connection.phoneNumberId !== null && connection.phoneNumberId !== event.phoneNumberId) {
        console.info(`[webhook] ignoring event for phone number mismatch restaurantId=${restaurantId}`)
        return
      }
    }
  }

  await transitionAttempt(attempt.id, attempt.orderId, event)
}

interface ParsedInboundMessage {
  sender: string
  type: string
  textBody: string
  phoneNumberId: string
}

function parseInboundMessages(payload: unknown): ParsedInboundMessage[] {
  if (typeof payload !== 'object' || payload === null) return []
  const root = payload as Record<string, unknown>
  if (!Array.isArray(root.entry)) return []

  const messages: ParsedInboundMessage[] = []

  for (const entry of root.entry) {
    if (typeof entry !== 'object' || entry === null) continue
    const changes = (entry as Record<string, unknown>).changes
    if (!Array.isArray(changes)) continue

    for (const change of changes) {
      if (typeof change !== 'object' || change === null) continue
      const value = (change as Record<string, unknown>).value
      if (typeof value !== 'object' || value === null) continue
      const valueRecord = value as Record<string, unknown>

      const metadata = valueRecord.metadata
      const phoneNumberId =
        typeof metadata === 'object' && metadata !== null
          ? typeof (metadata as Record<string, unknown>).phone_number_id === 'string'
            ? ((metadata as Record<string, unknown>).phone_number_id as string)
            : ''
          : ''

      const messageList = valueRecord.messages
      if (!Array.isArray(messageList)) continue

      for (const message of messageList) {
        if (typeof message !== 'object' || message === null) continue
        const record = message as Record<string, unknown>
        const sender = typeof record.from === 'string' ? record.from.trim() : ''
        const type = typeof record.type === 'string' ? record.type : ''
        const text = record.text
        const textBody =
          typeof text === 'object' && text !== null
            ? typeof (text as Record<string, unknown>).body === 'string'
              ? ((text as Record<string, unknown>).body as string)
              : ''
            : ''

        if (sender === '' || type === '') continue
        messages.push({ sender, type, textBody, phoneNumberId })
      }
    }
  }

  return messages
}

async function applyInboundMessage(message: ParsedInboundMessage): Promise<void> {
  if (message.type !== 'text') {
    console.info(`[webhook] inbound message type=${message.type} acknowledged (no opt-out processing)`)
    return
  }

  const isOptOut = message.textBody.trim().toUpperCase() === 'STOP'
  if (!isOptOut) {
    console.info('[webhook] inbound text message acknowledged (not an opt-out keyword)')
    return
  }

  if (message.phoneNumberId === '') {
    console.info('[webhook] inbound opt-out has no phone_number_id metadata (ignored)')
    return
  }

  const connection = await prisma.whatsAppConnection.findFirst({
    where: { phoneNumberId: message.phoneNumberId },
    select: {
      restaurantId: true,
      connectionStatus: true,
      restaurant: { select: { status: true } },
    },
  })

  if (!connection) {
    console.info(`[webhook] inbound opt-out for unknown phoneNumberId=${message.phoneNumberId} (ignored)`)
    return
  }

  if (connection.restaurant.status !== 'ACTIVE') {
    console.info(`[webhook] inbound opt-out for inactive restaurant restaurantId=${connection.restaurantId} (ignored)`)
    return
  }

  if (connection.connectionStatus !== 'CONNECTED') {
    console.info(
      `[webhook] inbound opt-out for non-connected connection restaurantId=${connection.restaurantId} (ignored)`,
    )
    return
  }

  const restaurantId = connection.restaurantId

  let phoneNormalized: string
  try {
    phoneNormalized = normalizeIncomingSender(message.sender)
  } catch (err) {
    if (err instanceof PhoneNormalizationError) {
      console.info('[webhook] inbound opt-out with unparseable sender ignored')
      return
    }
    throw err
  }

  await prisma.notificationOptOut.upsert({
    where: {
      restaurantId_phoneNormalized: { restaurantId, phoneNormalized },
    },
    create: { restaurantId, phoneNormalized },
    update: {},
  })

  console.info(`[webhook] opt-out recorded restaurantId=${restaurantId}`)
}

function normalizeIncomingSender(raw: string): string {
  const withPrefix = raw.startsWith('+') ? raw : `+${raw}`
  return normalizePhone(withPrefix)
}

type TransitionTarget = 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'IGNORED'

function mapEventStatus(status: string): TransitionTarget {
  switch (status) {
    case 'sent':
      return 'SENT'
    case 'delivered':
      return 'DELIVERED'
    case 'read':
      return 'READ'
    case 'failed':
      return 'FAILED'
    default:
      return 'IGNORED'
  }
}

async function transitionAttempt(attemptId: string, orderId: string, event: ParsedStatusEvent): Promise<void> {
  const target = mapEventStatus(event.status)
  const timestamp = Number(event.timestamp)
  const eventTime = Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp * 1000) : new Date()

  if (target === 'SENT') {
    console.info(`[webhook] attempt=${attemptId} orderId=${orderId} sent event acknowledged (no state change)`)
    return
  }

  if (target === 'FAILED') {
    console.warn(`[webhook] attempt=${attemptId} orderId=${orderId} failure event logged (no state change)`)
    return
  }

  if (target === 'IGNORED') {
    console.info(`[webhook] attempt=${attemptId} orderId=${orderId} unrecognized status ignored`)
    return
  }

  if (target === 'DELIVERED') {
    const result = await prisma.notificationAttempt.updateMany({
      where: { id: attemptId, jobStatus: 'SENT' },
      data: { jobStatus: 'DELIVERED', deliveredAt: eventTime },
    })
    if (result.count > 0) {
      console.info(`[webhook] attempt=${attemptId} orderId=${orderId} transitioned to DELIVERED`)
    }
    return
  }

  const result = await prisma.notificationAttempt.updateMany({
    where: { id: attemptId, jobStatus: { in: ['SENT', 'DELIVERED'] } },
    data: { jobStatus: 'READ', readAt: eventTime },
  })
  if (result.count > 0) {
    console.info(`[webhook] attempt=${attemptId} orderId=${orderId} transitioned to READ`)
  }
}

webhookRouter.post('/', async (req, res) => {
  const secret = process.env.WHATSAPP_APP_SECRET?.trim() ?? ''
  const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from('')
  const signature =
    typeof req.headers['x-hub-signature-256'] === 'string' ? req.headers['x-hub-signature-256'] : undefined

  if (!verifyWebhookSignature(secret, body, signature)) {
    res.status(403).json({ error: 'Invalid webhook signature' })
    return
  }

  let payload: unknown
  try {
    payload = JSON.parse(body.toString('utf8')) as unknown
  } catch {
    console.warn('[webhook] invalid JSON body after signature verification')
    res.status(400).json({ error: 'Invalid JSON body' })
    return
  }

  const events = parseStatusEvents(payload)
  const inboundMessages = parseInboundMessages(payload)

  if (events.length === 0 && inboundMessages.length === 0) {
    console.info('[webhook] acknowledged event with no message_status or inbound message entries')
    res.status(200).json({ status: 'ok' })
    return
  }

  try {
    for (const event of events) {
      await applyStatusEvent(event)
    }
    for (const inboundMessage of inboundMessages) {
      await applyInboundMessage(inboundMessage)
    }
  } catch (err) {
    console.error('[webhook] processing error', err instanceof Error ? err.message : String(err))
    res.status(500).json({ error: 'Processing error' })
    return
  }

  res.status(200).json({ status: 'ok' })
})