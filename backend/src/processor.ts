import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import {
  getConfigFromEnv,
  getTemplateIdentifierFromEnv,
  getTemplateIdentityFromEnv,
  sendWhatsAppTemplate,
  WhatsAppApiError,
  type WhatsAppConfig,
} from './whatsappClient.js'
import { decryptToken } from './crypto.js'
import type { EncryptedToken } from './crypto.js'
import { RestaurantDeactivatedError } from './orders.js'

const prisma = new PrismaClient()

export interface NotificationPayload {
  orderId: string
  restaurantId: string
  customerPhone: string
}

export type FailureType = 'transient' | 'permanent'

export interface NotificationSendResult {
  providerMessageId: string
}

export interface NotificationSender {
  send(payload: NotificationPayload): Promise<NotificationSendResult>
}

let failPredicate: ((payload: NotificationPayload) => FailureType | null) | null = null

export function createMockSender(): NotificationSender {
  return {
    async send(payload: NotificationPayload): Promise<NotificationSendResult> {
      const result = failPredicate?.(payload)
      if (result === 'transient') {
        throw new Error('Mock transient failure')
      }
      if (result === 'permanent') {
        throw new Error('Mock permanent failure')
      }
      return { providerMessageId: `mock-message-id-${randomUUID()}` }
    },
  }
}

let sender: NotificationSender = createMockSender()

export function setNotificationSender(s: NotificationSender): void {
  sender = s
}

export function getNotificationSender(): NotificationSender {
  return sender
}

export function createRealWhatsAppSender(config?: WhatsAppConfig): NotificationSender | null {
  const resolvedConfig = config ?? getConfigFromEnv()
  if (!resolvedConfig) return null

  return {
    async send(payload: NotificationPayload): Promise<NotificationSendResult> {
      const result = await sendWhatsAppTemplate(resolvedConfig, {
        to: payload.customerPhone,
        bodyParameters: [],
      })
      return { providerMessageId: result.providerMessageId }
    },
  }
}

export type WhatsAppSenderUnavailableCode =
  | 'CONNECTION_NOT_FOUND'
  | 'CONNECTION_DISCONNECTED'
  | 'CONNECTION_NOT_CONNECTED'
  | 'MISSING_PHONE_NUMBER_ID'
  | 'MISSING_ENCRYPTED_TOKEN'
  | 'TOKEN_DECRYPTION_FAILED'
  | 'TEMPLATE_CONFIG_MISSING'

export class WhatsAppSenderUnavailableError extends Error {
  readonly code: WhatsAppSenderUnavailableCode

  constructor(code: WhatsAppSenderUnavailableCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'WhatsAppSenderUnavailableError'
    this.code = code
  }
}

export async function resolveRestaurantWhatsAppCredentials(
  restaurantId: string,
): Promise<{ phoneNumberId: string; accessToken: string }> {
  const connection = await prisma.whatsAppConnection.findUnique({ where: { restaurantId } })

  if (!connection) {
    throw new WhatsAppSenderUnavailableError(
      'CONNECTION_NOT_FOUND',
      `No WhatsApp connection found for restaurant ${restaurantId}`,
    )
  }
  if (connection.connectionStatus === 'DISCONNECTED') {
    throw new WhatsAppSenderUnavailableError(
      'CONNECTION_DISCONNECTED',
      `WhatsApp connection for restaurant ${restaurantId} is DISCONNECTED`,
    )
  }
  if (connection.connectionStatus !== 'CONNECTED') {
    throw new WhatsAppSenderUnavailableError(
      'CONNECTION_NOT_CONNECTED',
      `WhatsApp connection for restaurant ${restaurantId} is not CONNECTED`,
    )
  }
  if (!connection.phoneNumberId) {
    throw new WhatsAppSenderUnavailableError(
      'MISSING_PHONE_NUMBER_ID',
      `WhatsApp connection for restaurant ${restaurantId} has no phone number ID`,
    )
  }
  if (!connection.accessTokenEncrypted) {
    throw new WhatsAppSenderUnavailableError(
      'MISSING_ENCRYPTED_TOKEN',
      `WhatsApp connection for restaurant ${restaurantId} has no encrypted access token`,
    )
  }

  let accessToken: string
  try {
    accessToken = decryptToken(connection.accessTokenEncrypted as EncryptedToken)
  } catch (cause) {
    throw new WhatsAppSenderUnavailableError(
      'TOKEN_DECRYPTION_FAILED',
      `Failed to decrypt WhatsApp access token for restaurant ${restaurantId}`,
      { cause },
    )
  }

  return { phoneNumberId: connection.phoneNumberId, accessToken }
}

export function createRestaurantAwareWhatsAppSender(): NotificationSender {
  return {
    async send(payload: NotificationPayload): Promise<NotificationSendResult> {
      const template = getTemplateIdentityFromEnv()
      if (!template) {
        throw new WhatsAppSenderUnavailableError(
          'TEMPLATE_CONFIG_MISSING',
          'WhatsApp notification template configuration is missing',
        )
      }

      const { phoneNumberId, accessToken } = await resolveRestaurantWhatsAppCredentials(
        payload.restaurantId,
      )

      const result = await sendWhatsAppTemplate(
        {
          phoneNumberId,
          accessToken,
          templateName: template.templateName,
          templateLanguage: template.templateLanguage,
          apiVersion: template.apiVersion,
        },
        {
          to: payload.customerPhone,
          bodyParameters: [],
        },
      )

      return { providerMessageId: result.providerMessageId }
    },
  }
}

export function setSendFailurePredicate(fn: (payload: NotificationPayload) => FailureType | null): void {
  failPredicate = fn
}

export function clearSendFailurePredicate(): void {
  failPredicate = null
}

export type SendFailureKind = 'transient' | 'permanent' | 'unknown'

export interface SendFailureInfo {
  kind: SendFailureKind
  errorCode: string
  errorMessage: string
}

const MAX_ERROR_MESSAGE_LENGTH = 2000

function buildWhatsAppErrorMessage(err: WhatsAppApiError): string {
  const parts: string[] = []
  const meta = err.meta
  if (meta?.type) parts.push(meta.type)
  if (meta?.message) {
    parts.push(meta.message)
  } else {
    parts.push(err.message)
  }
  if (meta?.errorSubcode !== undefined) parts.push(`subcode=${meta.errorSubcode}`)
  if (meta?.fbtraceId) parts.push(`fbtrace=${meta.fbtraceId}`)
  return parts.join(' - ').slice(0, MAX_ERROR_MESSAGE_LENGTH)
}

function whatsappErrorCode(err: WhatsAppApiError): string | null {
  const meta = err.meta
  if (meta?.code !== undefined) return String(meta.code)
  if (meta?.errorSubcode !== undefined) return String(meta.errorSubcode)
  return null
}

export function classifySendError(err: unknown): SendFailureInfo {
  if (err instanceof WhatsAppApiError) {
    const status = err.status
    const meta = err.meta

    if (status === undefined) {
      return { kind: 'transient', errorCode: 'NO_RESPONSE', errorMessage: buildWhatsAppErrorMessage(err) }
    }

    if (status >= 500) {
      return { kind: 'transient', errorCode: `HTTP_${status}`, errorMessage: buildWhatsAppErrorMessage(err) }
    }

    if (status === 429 || meta?.code === 130429 || meta?.errorSubcode === 130429 || meta?.code === 80007) {
      return { kind: 'transient', errorCode: 'RATE_LIMITED', errorMessage: buildWhatsAppErrorMessage(err) }
    }

    if (meta?.type === 'OAuthException') {
      const code = whatsappErrorCode(err)
      return { kind: 'permanent', errorCode: code ? `META_${code}` : 'META_AUTH', errorMessage: buildWhatsAppErrorMessage(err) }
    }

    const code = whatsappErrorCode(err)
    return { kind: 'unknown', errorCode: code ? `META_${code}` : `HTTP_${status}`, errorMessage: buildWhatsAppErrorMessage(err) }
  }

  if (err instanceof WhatsAppSenderUnavailableError) {
    return {
      kind: 'permanent',
      errorCode: err.code,
      errorMessage: err.message.slice(0, MAX_ERROR_MESSAGE_LENGTH),
    }
  }

  const message = err instanceof Error ? err.message : String(err)

  if (message.includes('transient')) {
    return { kind: 'transient', errorCode: 'MOCK_TRANSIENT', errorMessage: message.slice(0, MAX_ERROR_MESSAGE_LENGTH) }
  }
  if (message.includes('permanent')) {
    return { kind: 'permanent', errorCode: 'MOCK_PERMANENT', errorMessage: message.slice(0, MAX_ERROR_MESSAGE_LENGTH) }
  }

  return { kind: 'unknown', errorCode: 'UNKNOWN', errorMessage: message.slice(0, MAX_ERROR_MESSAGE_LENGTH) }
}

const MAX_RETRIES = 3

function getRetryBackoffMs(): number {
  const envMs = parseInt(process.env.RETRY_BACKOFF_MS ?? '', 10)
  return Number.isFinite(envMs) ? envMs : 30_000
}

export async function claimAndProcessOne(): Promise<boolean> {
  const claimed = await claimOne()
  if (!claimed) return false

  await processAttempt(claimed.id)
  return true
}

async function claimOne(): Promise<{ id: string } | null> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT na.id
    FROM notification_attempts na
    JOIN orders o ON o.id = na.order_id
    JOIN restaurants r ON r.id = o.restaurant_id
    WHERE na.job_status = 'PENDING'
      AND r.status != 'DEACTIVATED'
      AND (na.next_retry_at IS NULL OR na.next_retry_at <= NOW())
    ORDER BY na.created_at ASC
    LIMIT 1
    FOR UPDATE OF na SKIP LOCKED
  `

  if (rows.length === 0) return null

  const claimed = rows[0]!
  const now = new Date()

  await prisma.notificationAttempt.update({
    where: { id: claimed.id },
    data: {
      jobStatus: 'PROCESSING',
      claimedAt: now,
    },
  })

  return claimed
}

async function processAttempt(attemptId: string): Promise<void> {
  const attempt = await prisma.notificationAttempt.findUnique({
    where: { id: attemptId },
    include: { order: true },
  })

  if (!attempt || attempt.jobStatus !== 'PROCESSING') return

  const payload: NotificationPayload = {
    orderId: attempt.orderId,
    restaurantId: attempt.order.restaurantId,
    customerPhone: attempt.order.customerPhone ?? '',
  }

  try {
    const result = await getNotificationSender().send(payload)
    await prisma.notificationAttempt.update({
      where: { id: attemptId },
      data: {
        jobStatus: 'SENT',
        sentAt: new Date(),
        providerMessageId: result.providerMessageId,
        errorCode: null,
        errorMessage: null,
      },
    })
  } catch (err) {
    const failure = classifySendError(err)

    let retryEligible = failure.kind === 'transient' && attempt.retryCount < MAX_RETRIES
    if (retryEligible) {
      const restaurant = await prisma.restaurant.findUnique({
        where: { id: attempt.order.restaurantId },
        select: { status: true },
      })
      if (restaurant?.status === 'DEACTIVATED') {
        retryEligible = false
      }
    }

    if (retryEligible) {
      const nextRetryAt = new Date(Date.now() + getRetryBackoffMs())
      await prisma.notificationAttempt.update({
        where: { id: attemptId },
        data: {
          retryCount: { increment: 1 },
          jobStatus: 'PENDING',
          claimedAt: null,
          nextRetryAt,
          errorCode: failure.errorCode,
          errorMessage: failure.errorMessage,
        },
      })
    } else {
      await prisma.notificationAttempt.update({
        where: { id: attemptId },
        data: {
          jobStatus: 'FAILED',
          failedAt: new Date(),
          errorCode: failure.errorCode,
          errorMessage: failure.errorMessage,
        },
      })
    }

    console.warn(
      `[notification] send failed attempt=${attemptId} kind=${failure.kind} code=${failure.errorCode}`,
    )
  }
}

export async function recoverStuckJobs(
  thresholdMs: number = 2 * 60 * 1000,
): Promise<number> {
  const cutoff = new Date(Date.now() - thresholdMs)

  const result = await prisma.notificationAttempt.updateMany({
    where: {
      jobStatus: 'PROCESSING',
      claimedAt: { lt: cutoff },
    },
    data: {
      jobStatus: 'PENDING',
      claimedAt: null,
    },
  })

  return result.count
}

const DEFAULT_RETENTION_HOURS = 72

function getRetentionHours(): number {
  const envHours = parseInt(process.env.RETENTION_HOURS ?? '', 10)
  return Number.isFinite(envHours) ? envHours : DEFAULT_RETENTION_HOURS
}

export async function scrubExpiredPhones(
  retentionHours?: number,
): Promise<number> {
  const hours = retentionHours ?? getRetentionHours()
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000)

  const result = await prisma.order.updateMany({
    where: {
      status: { in: ['COLLECTED', 'CANCELLED'] },
      terminalAt: { not: null, lt: cutoff },
      customerPhone: { not: null },
    },
    data: {
      customerPhone: null,
      phoneScrubbedAt: new Date(),
    },
  })

  return result.count
}

export async function recallOrder(
  restaurantId: string,
  orderId: string,
): Promise<{ attemptNumber: number }> {
  return prisma.$transaction(async (tx) => {
    const restaurant = await tx.restaurant.findUnique({
      where: { id: restaurantId },
      select: { status: true },
    })
    if (restaurant?.status === 'DEACTIVATED') {
      throw new RestaurantDeactivatedError('Restaurant is deactivated')
    }

    const rows = await tx.$queryRaw<
      { id: string; status: string }[]
    >`SELECT id, status FROM orders WHERE id = ${orderId} AND restaurant_id = ${restaurantId} FOR UPDATE`

    if (rows.length === 0) {
      throw new RecallError('Order not found')
    }

    const order = rows[0]!
    if (order.status !== 'READY') {
      throw new RecallError('Order must be READY to recall')
    }

    const activeAttempt = await tx.notificationAttempt.findFirst({
      where: {
        orderId,
        jobStatus: { in: ['PENDING', 'PROCESSING'] },
      },
    })

    if (activeAttempt) {
      throw new RecallError('Order has an active notification attempt')
    }

    const recallAttempts = await tx.notificationAttempt.count({
      where: { orderId },
    })

    if (recallAttempts >= 4) {
      throw new RecallError('Maximum recall attempts reached')
    }

    const maxAttempt = await tx.notificationAttempt.aggregate({
      where: { orderId },
      _max: { attemptNumber: true },
    })

    const nextAttemptNumber = (maxAttempt._max.attemptNumber ?? 0) + 1

    const attempt = await tx.notificationAttempt.create({
      data: {
        orderId,
        attemptNumber: nextAttemptNumber,
        channel: 'WHATSAPP',
        jobStatus: 'PENDING',
        templateIdentifierSnapshot: getTemplateIdentifierFromEnv(),
      },
    })

    return { attemptNumber: attempt.attemptNumber }
  })
}

export class RecallError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RecallError'
  }
}

let intervalHandle: ReturnType<typeof setInterval> | null = null
let scrubIntervalHandle: ReturnType<typeof setInterval> | null = null

export function startProcessor(intervalMs?: number): void {
  if (intervalHandle) return

  const envMs = parseInt(process.env.PROCESSOR_INTERVAL_MS ?? '', 10)
  const ms = intervalMs ?? (Number.isFinite(envMs) ? envMs : 5000)

  intervalHandle = setInterval(async () => {
    try {
      await claimAndProcessOne()
    } catch {
      // claim/processing error — do not crash, do not skip recovery
    }
    try {
      await recoverStuckJobs()
    } catch {
      // recovery error — do not crash
    }
  }, ms)

  if (intervalHandle.unref) {
    intervalHandle.unref()
  }

  if (!scrubIntervalHandle) {
    const scrubEnvMs = parseInt(process.env.SCRUB_INTERVAL_MS ?? '', 10)
    const scrubMs = Number.isFinite(scrubEnvMs) ? scrubEnvMs : 60 * 60 * 1000

    scrubIntervalHandle = setInterval(async () => {
      try {
        await scrubExpiredPhones()
      } catch {
        // scrub error — do not crash
      }
    }, scrubMs)

    if (scrubIntervalHandle.unref) {
      scrubIntervalHandle.unref()
    }
  }
}

export function stopProcessor(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle)
    intervalHandle = null
  }
  if (scrubIntervalHandle) {
    clearInterval(scrubIntervalHandle)
    scrubIntervalHandle = null
  }
}
